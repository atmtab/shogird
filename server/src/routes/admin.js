import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { pool, mongo } from '../db.js';
import { httpError, wrap } from '../lib/errors.js';
import { str, int, oneOf, paramId } from '../lib/validate.js';
import { VACANCY_STATUSES } from '../lib/constants.js';
import { camel, likeEscape } from '../lib/util.js';
import { safeMongo } from '../lib/events.js';
import { requireRole } from '../middleware/auth.js';

// Роутер монтируется на /api/admin. Только роль admin: всё остальное получает 401 или 403.
// Схему БД не меняем (SPEC §5 закрыт), поэтому админ умеет смотреть пользователей и модерировать
// вакансии (поле status) и отзывы (Mongo). Блокировки пользователей нет: для неё нужна новая колонка.
const router = Router();
router.use(requireRole('admin'));

const PAGE_SIZE = 20;
const pageOf = (q) => int(q.page ?? 1, 'page', { min: 1, max: 100000 });

// ---------- Обзор ----------
router.get('/overview', wrap(async (req, res) => {
  const [users, vacancies, applications] = await Promise.all([
    pool.query('SELECT role, count(*)::int AS n FROM users GROUP BY role'),
    pool.query('SELECT status, count(*)::int AS n FROM vacancies GROUP BY status'),
    pool.query('SELECT status, count(*)::int AS n FROM applications GROUP BY status'),
  ]);
  const toMap = (r) => Object.fromEntries(r.rows.map((x) => [x.role ?? x.status, x.n]));
  const reviews = await safeMongo(mongo().then((db) => db.collection('internship_reviews').countDocuments({})), null);
  res.json({ users: toMap(users), vacancies: toMap(vacancies), applications: toMap(applications), reviews });
}));

// ---------- Пользователи (только просмотр) ----------
router.get('/users', wrap(async (req, res) => {
  const q = str(req.query.q, 'q', { max: 100, required: false });
  const page = pageOf(req.query);
  const params = [];
  let where = '';
  if (q) { params.push(`%${likeEscape(q)}%`); where = `WHERE u.email ILIKE $${params.length}`; }
  const total = (await pool.query(`SELECT count(*)::int AS n FROM users u ${where}`, params)).rows[0].n;
  params.push(PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const rows = (await pool.query(
    `SELECT u.user_id, u.email, u.role, u.created_at, COALESCE(s.full_name, c.name) AS name
     FROM users u
     LEFT JOIN students s  ON s.user_id = u.user_id
     LEFT JOIN companies c ON c.user_id = u.user_id
     ${where}
     ORDER BY u.user_id
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
  res.json({ items: rows.map(camel), total, page, pageSize: PAGE_SIZE });
}));

// ---------- Модерация вакансий ----------
router.get('/vacancies', wrap(async (req, res) => {
  const status = oneOf(req.query.status, 'status', VACANCY_STATUSES, { required: false });
  const page = pageOf(req.query);
  const params = [];
  let where = '';
  if (status) { params.push(status); where = `WHERE v.status = $${params.length}`; }
  const total = (await pool.query(`SELECT count(*)::int AS n FROM vacancies v ${where}`, params)).rows[0].n;
  params.push(PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const rows = (await pool.query(
    `SELECT v.vacancy_id, v.title, v.status, v.seats, v.seats_left, v.deadline, c.name AS company_name,
            (SELECT count(*) FROM applications a WHERE a.vacancy_id = v.vacancy_id)::int AS applications
     FROM vacancies v
     JOIN companies c ON c.company_id = v.company_id
     ${where}
     ORDER BY v.vacancy_id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
  res.json({ items: rows.map(camel), total, page, pageSize: PAGE_SIZE });
}));

// Админ переключает только open <-> closed. Черновик принадлежит компании, его админ не публикует.
// Проверка и изменение одним запросом; снять закрытие с вакансии без мест нельзя (их исчерпал T3).
router.patch('/vacancies/:id', wrap(async (req, res) => {
  const id = paramId(req.params.id);
  const status = oneOf(req.body?.status, 'status', ['open', 'closed']);
  const from = status === 'open' ? 'closed' : 'open';
  const r = await pool.query(
    `UPDATE vacancies SET status = $1::text, updated_at = now()
     WHERE vacancy_id = $2 AND status = $3 AND ($1::text = 'closed' OR seats_left > 0)
     RETURNING vacancy_id, status`, [status, id, from]);
  if (!r.rowCount) {
    const exists = await pool.query('SELECT 1 FROM vacancies WHERE vacancy_id = $1', [id]);
    if (!exists.rowCount) throw httpError(404, 'NOT_FOUND', 'Vacancy not found');
    throw httpError(409, 'INVALID_STATUS', 'Vacancy cannot move to this status');
  }
  res.json(camel(r.rows[0]));
}));

// ---------- Модерация отзывов (MongoDB) ----------
router.get('/reviews', wrap(async (req, res) => {
  const page = pageOf(req.query);
  const db = await mongo();
  const col = db.collection('internship_reviews');
  const [total, docs] = await Promise.all([
    col.countDocuments({}),
    col.find({}).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray(),
  ]);
  // Названия компаний берём из PostgreSQL одним запросом (ID в Mongo совпадают с PG)
  const ids = [...new Set(docs.map((d) => d.companyId))];
  const names = ids.length
    ? (await pool.query('SELECT company_id, name FROM companies WHERE company_id = ANY($1::int[])', [ids])).rows
    : [];
  const nameOf = new Map(names.map((x) => [x.company_id, x.name]));
  res.json({
    items: docs.map((d) => ({
      id: String(d._id), companyId: d.companyId, companyName: nameOf.get(d.companyId) ?? null, studentId: d.studentId,
      rating: d.rating, pros: d.pros ?? '', cons: d.cons ?? '', createdAt: d.createdAt,
    })),
    total, page, pageSize: PAGE_SIZE,
  });
}));

router.delete('/reviews/:id', wrap(async (req, res) => {
  if (!ObjectId.isValid(req.params.id) || String(req.params.id).length !== 24) throw httpError(404, 'NOT_FOUND', 'Review not found');
  const db = await mongo();
  const r = await db.collection('internship_reviews').deleteOne({ _id: new ObjectId(req.params.id) });
  if (!r.deletedCount) throw httpError(404, 'NOT_FOUND', 'Review not found');
  res.json({ ok: true });
}));

export default router;
