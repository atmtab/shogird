import { Router } from 'express';
import { pool, mongo } from '../db.js';
import { httpError, wrap } from '../lib/errors.js';
import { oneOf, str, int, paramId } from '../lib/validate.js';
import { DIRECTIONS, FORMATS, CITIES, LANGS } from '../lib/constants.js';
import { camel, likeEscape } from '../lib/util.js';
import { matchMap } from '../lib/match.js';
import { logEvent, logSearch, safeMongo } from '../lib/events.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();
const PAGE_SIZE = 12;

// Колонки каталога перечислены явно (SELECT * в роутах не используем)
const CATALOG_COLS = `c.vacancy_id, c.title, c.direction, c.work_format, c.city, c.is_paid, c.stipend, c.duration_months,
  c.seats, c.seats_left, c.deadline, c.created_at, c.company_id, c.company_name, c.is_itpark_resident, c.logo_url,
  c.applications_count`;

// Рейтинг компании из Mongo: средняя оценка и число отзывов
async function ratingOf(companyId) {
  const db = await mongo();
  const r = await db.collection('internship_reviews').aggregate([
    { $match: { companyId } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]).toArray();
  return r[0] ? { avg: Math.round(r[0].avg * 10) / 10, count: r[0].count } : { avg: null, count: 0 };
}

// 2. Справочники для фильтров и форм
router.get('/meta', wrap(async (req, res) => {
  const [skills, universities] = await Promise.all([
    pool.query('SELECT skill_id, name, category FROM skills ORDER BY category, name'),
    pool.query('SELECT university_id, name, short_name, city FROM universities ORDER BY name'),
  ]);
  res.json({
    skills: skills.rows.map(camel), universities: universities.rows.map(camel),
    cities: CITIES, directions: DIRECTIONS, formats: FORMATS,
  });
}));

// 3. Каталог: поиск, фильтры, пагинация по 12
router.get('/vacancies', optionalAuth, wrap(async (req, res) => {
  const q = req.query;
  const filters = {
    q: str(q.q, 'q', { max: 100, required: false }),
    direction: oneOf(q.direction, 'direction', DIRECTIONS, { required: false }),
    city: oneOf(q.city, 'city', CITIES, { required: false }),
    format: oneOf(q.format, 'format', FORMATS, { required: false }),
    paid: q.paid === 'true' ? true : null,
    resident: q.resident === 'true' ? true : null,
    skills: q.skill ? String(q.skill).split(',').map((s) => str(s, 'skill', { max: 50 })).slice(0, 5) : [],
  };
  const page = int(q.page ?? 1, 'page', { min: 1, max: 100000 });
  const lang = LANGS.includes(q.lang) ? q.lang : 'ru';

  // SQL собирается только из фиксированных кусков; значения пользователя идут исключительно через $1, $2…
  const where = ['c.status = \'open\'', '(c.deadline IS NULL OR c.deadline >= current_date)'];
  const params = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replaceAll('?', `$${params.length}`)); };
  if (filters.q) add('(c.title ILIKE ? OR c.company_name ILIKE ?)', `%${likeEscape(filters.q)}%`);
  if (filters.direction) add('c.direction = ?', filters.direction);
  if (filters.city) add('c.city = ?', filters.city);
  if (filters.format) add('c.work_format = ?', filters.format);
  if (filters.paid) where.push('c.is_paid');
  if (filters.resident) where.push('c.is_itpark_resident');
  for (const s of filters.skills) {
    add(`EXISTS (SELECT 1 FROM vacancy_skills vs JOIN skills s ON s.skill_id = vs.skill_id
                 WHERE vs.vacancy_id = c.vacancy_id AND s.name = ?)`, s);
  }
  const whereSql = where.join(' AND ');

  const total = (await pool.query(`SELECT count(*)::int AS n FROM v_vacancy_catalog c WHERE ${whereSql}`, params)).rows[0].n;
  const rows = (await pool.query(
    `SELECT ${CATALOG_COLS} FROM v_vacancy_catalog c WHERE ${whereSql}
     ORDER BY c.created_at DESC, c.vacancy_id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE])).rows;

  // До 3 навыков на карточку и % совпадения для студента
  const ids = rows.map((r) => r.vacancy_id);
  const skillRows = ids.length ? (await pool.query(
    `SELECT vs.vacancy_id, s.name FROM vacancy_skills vs JOIN skills s ON s.skill_id = vs.skill_id
     WHERE vs.vacancy_id = ANY($1::int[]) ORDER BY vs.is_required DESC, s.name`, [ids])).rows : [];
  const matches = req.user?.role === 'student' ? await matchMap(pool, req.user.profileId, ids) : new Map();

  const items = rows.map((r) => ({
    ...camel(r),
    skills: skillRows.filter((s) => s.vacancy_id === r.vacancy_id).slice(0, 3).map((s) => s.name),
    matchPct: matches.has(r.vacancy_id) ? matches.get(r.vacancy_id) : null,
  }));

  // Каждый поиск идёт в search_logs (спрос на навыки). Без await.
  logSearch(req, { q: filters.q || '', filters: { direction: filters.direction, city: filters.city, format: filters.format,
    paid: filters.paid, skills: filters.skills }, results: total, lang });

  res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
}));

// 4. Карточка вакансии
router.get('/vacancies/:id', optionalAuth, wrap(async (req, res) => {
  const id = paramId(req.params.id);
  const v = (await pool.query(
    `SELECT v.vacancy_id, v.company_id, v.title, v.description, v.direction, v.work_format, v.city, v.is_paid, v.stipend,
            v.duration_months, v.seats, v.seats_left, v.status, v.deadline, v.created_at,
            c.name AS company_name, c.city AS company_city, c.website, c.employees_range, c.is_itpark_resident, c.logo_url
     FROM vacancies v JOIN companies c ON c.company_id = v.company_id
     WHERE v.vacancy_id = $1`, [id])).rows[0];
  // Черновик видит только его компания; для остальных его как будто нет
  const isOwner = req.user?.role === 'company' && req.user.profileId === v?.company_id;
  if (!v || (v.status === 'draft' && !isOwner)) throw httpError(404, 'NOT_FOUND', 'Vacancy not found');

  const isStudent = req.user?.role === 'student';
  const skills = (await pool.query(
    `SELECT s.skill_id, s.name, s.category, vs.is_required,
            (ss.skill_id IS NOT NULL) AS have
     FROM vacancy_skills vs
     JOIN skills s ON s.skill_id = vs.skill_id
     LEFT JOIN student_skills ss ON ss.skill_id = vs.skill_id AND ss.student_id = $2
     WHERE vs.vacancy_id = $1
     ORDER BY vs.is_required DESC, s.name`, [id, isStudent ? req.user.profileId : 0])).rows;

  let matchPct = null;
  let application = null;
  if (isStudent) {
    matchPct = (await matchMap(pool, req.user.profileId, [id])).get(id) ?? null;
    const a = (await pool.query(
      'SELECT application_id, status FROM applications WHERE vacancy_id = $1 AND student_id = $2',
      [id, req.user.profileId])).rows[0];
    application = a ? camel(a) : null;
  }

  // Просмотры за 30 дней и рейтинг компании живут в Mongo
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [views30d, rating] = await Promise.all([
    safeMongo(mongo().then((db) => db.collection('events').countDocuments({ type: 'vacancy_view', vacancyId: id, ts: { $gte: since } })), null),
    safeMongo(ratingOf(v.company_id), { avg: null, count: 0 }),
  ]);

  logEvent(req, 'vacancy_view', { vacancyId: id, companyId: v.company_id, direction: v.direction, city: v.city });

  res.json({
    ...camel(v),
    skills: skills.map((s) => ({ skillId: s.skill_id, name: s.name, category: s.category, isRequired: s.is_required,
      have: isStudent ? s.have : null })),
    views30d, companyRating: rating, matchPct, application,
  });
}));

// 5. Публичный профиль компании
router.get('/companies/:id', wrap(async (req, res) => {
  const id = paramId(req.params.id);
  const c = (await pool.query(
    `SELECT company_id, name, city, website, description, employees_range, is_itpark_resident, logo_url
     FROM companies WHERE company_id = $1`, [id])).rows[0];
  if (!c) throw httpError(404, 'NOT_FOUND', 'Company not found');

  const vacancies = (await pool.query(
    `SELECT vacancy_id, title, direction, work_format, city, is_paid, stipend, seats_left, deadline
     FROM vacancies WHERE company_id = $1 AND status = 'open' ORDER BY created_at DESC`, [id])).rows;
  const reviews = await safeMongo(mongo().then((db) => db.collection('internship_reviews')
    .find({ companyId: id }, { projection: { _id: 0, studentId: 0 } }).sort({ createdAt: -1 }).limit(10).toArray()), []);
  const rating = await safeMongo(ratingOf(id), { avg: null, count: 0 });

  logEvent(req, 'company_view', { companyId: id });
  res.json({ ...camel(c), vacancies: vacancies.map(camel), reviews, rating });
}));

export default router;
