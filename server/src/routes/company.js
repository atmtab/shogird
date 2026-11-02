import { Router } from 'express';
import { pool, mongo, withTransaction } from '../db.js';
import { httpError, wrap } from '../lib/errors.js';
import { str, int, oneOf, bool, money, dateOnly, array, paramId, isPgError } from '../lib/validate.js';
import { DIRECTIONS, FORMATS, CITIES, VACANCY_STATUSES } from '../lib/constants.js';
import { canMove } from '../lib/statuses.js';
import { camel } from '../lib/util.js';
import { safeMongo } from '../lib/events.js';
import { requireRole } from '../middleware/auth.js';

// Роутер монтируется на /api/company. Компания видит и меняет только свои данные: чужой ID даёт 404.
const router = Router();
router.use(requireRole('company'));

// ---------- Вакансии ----------

// Разбор и проверка тела вакансии (общий для POST и PUT)
function parseVacancy(b = {}) {
  const isPaid = bool(b.isPaid, 'isPaid');
  const stipend = money(b.stipend, 'stipend');
  if (!isPaid && stipend !== null) throw httpError(400, 'VALIDATION', 'stipend is allowed only for paid vacancies');
  const skills = array(b.skills, 'skills', { max: 20 }).map((s) => ({
    skillId: int(s?.skillId, 'skillId', { min: 1, max: 2147483647 }),
    isRequired: bool(s?.isRequired, 'isRequired', { fallback: true }),
  }));
  if (new Set(skills.map((s) => s.skillId)).size !== skills.length) throw httpError(400, 'VALIDATION', 'skillId values must be unique');
  return {
    title: str(b.title, 'title', { min: 3, max: 150 }),
    description: str(b.description, 'description', { min: 10, max: 5000 }),
    direction: oneOf(b.direction, 'direction', DIRECTIONS),
    workFormat: oneOf(b.workFormat, 'workFormat', FORMATS),
    city: oneOf(b.city, 'city', CITIES),
    isPaid, stipend,
    durationMonths: int(b.durationMonths, 'durationMonths', { min: 1, max: 12 }),
    seats: int(b.seats, 'seats', { min: 1, max: 1000 }),
    status: oneOf(b.status ?? 'open', 'status', VACANCY_STATUSES),
    deadline: dateOnly(b.deadline, 'deadline'),
    skills,
  };
}

// Замена навыков вакансии внутри транзакции T4
async function saveSkills(client, vacancyId, skills) {
  await client.query('DELETE FROM vacancy_skills WHERE vacancy_id = $1', [vacancyId]);
  await client.query(
    `INSERT INTO vacancy_skills (vacancy_id, skill_id, is_required)
     SELECT $1, t.skill_id, t.is_required FROM unnest($2::int[], $3::bool[]) AS t(skill_id, is_required)`,
    [vacancyId, skills.map((s) => s.skillId), skills.map((s) => s.isRequired)]);
}

function mapDbError(e) {
  if (isPgError(e, '23503')) return httpError(400, 'VALIDATION', 'Unknown skill');
  if (isPgError(e, '23514')) return httpError(400, 'VALIDATION', 'Values violate vacancy constraints (seats, stipend)');
  return e;
}

// Проверка, что вакансия принадлежит компании; иначе 404
async function ownVacancy(vacancyId, companyId) {
  const r = await pool.query('SELECT vacancy_id FROM vacancies WHERE vacancy_id = $1 AND company_id = $2', [vacancyId, companyId]);
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'Vacancy not found');
}

// 21. Свои вакансии: число заявок по статусам и навыки (для формы редактирования)
router.get('/vacancies', wrap(async (req, res) => {
  const r = await pool.query(
    `SELECT v.vacancy_id, v.title, v.description, v.direction, v.work_format, v.city, v.is_paid, v.stipend,
            v.duration_months, v.seats, v.seats_left, v.status, v.deadline, v.created_at,
            (SELECT COALESCE(jsonb_object_agg(t.status, t.n), '{}'::jsonb)
               FROM (SELECT a.status, count(*)::int AS n FROM applications a WHERE a.vacancy_id = v.vacancy_id GROUP BY a.status) t
            ) AS applications_by_status,
            (SELECT COALESCE(json_agg(json_build_object('skillId', vs.skill_id, 'name', s.name, 'isRequired', vs.is_required)
                                      ORDER BY vs.is_required DESC, s.name), '[]'::json)
               FROM vacancy_skills vs JOIN skills s ON s.skill_id = vs.skill_id WHERE vs.vacancy_id = v.vacancy_id
            ) AS skills
     FROM vacancies v WHERE v.company_id = $1 ORDER BY v.created_at DESC, v.vacancy_id DESC`, [req.user.profileId]);
  res.json(r.rows.map(camel));
}));

// 22. T4. Создать вакансию с навыками
router.post('/vacancies', wrap(async (req, res) => {
  const v = parseVacancy(req.body);
  if (v.status === 'closed') throw httpError(400, 'VALIDATION', 'A new vacancy can be created only as draft or open');
  try {
    const id = await withTransaction(async (client) => {
      const r = await client.query(
        `INSERT INTO vacancies (company_id, title, description, direction, work_format, city, is_paid, stipend,
                                duration_months, seats, seats_left, status, deadline)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12) RETURNING vacancy_id`,
        [req.user.profileId, v.title, v.description, v.direction, v.workFormat, v.city, v.isPaid, v.stipend,
          v.durationMonths, v.seats, v.status, v.deadline]);
      await saveSkills(client, r.rows[0].vacancy_id, v.skills);
      return r.rows[0].vacancy_id;
    });
    res.status(201).json({ vacancyId: id });
  } catch (e) { throw mapDbError(e); }
}));

// 23. T4. Редактировать вакансию. Уже занятые места сохраняются: seats_left = новое seats - занято
router.put('/vacancies/:id', wrap(async (req, res) => {
  const id = paramId(req.params.id);
  const v = parseVacancy(req.body);
  try {
    await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE vacancies
         SET title = $3, description = $4, direction = $5, work_format = $6, city = $7, is_paid = $8, stipend = $9,
             duration_months = $10, seats_left = $11 - (seats - seats_left), seats = $11, status = $12, deadline = $13,
             updated_at = now()
         WHERE vacancy_id = $1 AND company_id = $2 RETURNING seats_left, status`,
        [id, req.user.profileId, v.title, v.description, v.direction, v.workFormat, v.city, v.isPaid, v.stipend,
          v.durationMonths, v.seats, v.status, v.deadline]);
      if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'Vacancy not found');
      if (r.rows[0].status === 'open' && r.rows[0].seats_left === 0) {
        throw httpError(400, 'VALIDATION', 'Cannot keep a vacancy open when all seats are taken');
      }
      await saveSkills(client, id, v.skills);
    });
  } catch (e) { throw mapDbError(e); }
  res.json({ ok: true });
}));

// 24. Мягкое закрытие
router.delete('/vacancies/:id', wrap(async (req, res) => {
  const id = paramId(req.params.id);
  const r = await pool.query(
    "UPDATE vacancies SET status = 'closed', updated_at = now() WHERE vacancy_id = $1 AND company_id = $2 RETURNING vacancy_id",
    [id, req.user.profileId]);
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'Vacancy not found');
  res.json({ ok: true, status: 'closed' });
}));

// ---------- Кандидаты ----------

// 25. Кандидаты вакансии: профиль, навыки, % совпадения и краткое резюме из Mongo. Сортировка по match_pct
router.get('/vacancies/:id/applications', wrap(async (req, res) => {
  const id = paramId(req.params.id);
  await ownVacancy(id, req.user.profileId);
  const rows = (await pool.query(
    `SELECT a.application_id, a.status, a.cover_letter, a.company_note, a.created_at,
            st.student_id, st.full_name, st.course, st.city, st.github_url, u.short_name AS university,
            (SELECT ROUND(100.0 * SUM(CASE WHEN ss.skill_id IS NOT NULL THEN w.weight ELSE 0 END) / SUM(w.weight))::int
               FROM (SELECT vs.skill_id, CASE WHEN vs.is_required THEN 1 ELSE 0.5 END AS weight
                       FROM vacancy_skills vs WHERE vs.vacancy_id = a.vacancy_id) w
               LEFT JOIN student_skills ss ON ss.skill_id = w.skill_id AND ss.student_id = a.student_id
            ) AS match_pct,
            (SELECT COALESCE(json_agg(json_build_object('name', s.name, 'level', ss2.level) ORDER BY ss2.level DESC, s.name), '[]'::json)
               FROM student_skills ss2 JOIN skills s ON s.skill_id = ss2.skill_id WHERE ss2.student_id = st.student_id
            ) AS skills
     FROM applications a
     JOIN students st ON st.student_id = a.student_id
     LEFT JOIN universities u ON u.university_id = st.university_id
     WHERE a.vacancy_id = $1
     ORDER BY match_pct DESC NULLS LAST, a.created_at`, [id])).rows;

  const resumes = await safeMongo(mongo().then((db) => db.collection('resumes')
    .find({ studentId: { $in: rows.map((r) => r.student_id) } }, { projection: { _id: 0, studentId: 1, about: 1, projects: 1 } }).toArray()), []);
  const byStudent = new Map(resumes.map((r) => [r.studentId, r]));

  res.json(rows.map((r) => {
    const resume = byStudent.get(r.student_id);
    return { ...camel(r), resume: resume ? { about: resume.about, projectsCount: (resume.projects || []).length } : null };
  }));
}));

// 26. Смена статуса и заметки. Из interview в offer/rejected собеседование становится done (можно передать score и feedback)
router.patch('/applications/:id', wrap(async (req, res) => {
  const id = paramId(req.params.id);
  const b = req.body || {};
  const status = oneOf(b.status, 'status', ['shortlisted', 'rejected', 'offer'], { required: false });
  const note = str(b.companyNote, 'companyNote', { max: 1000, required: false });
  const score = int(b.score, 'score', { min: 1, max: 5, required: false });
  const feedback = str(b.feedback, 'feedback', { max: 1000, required: false });
  if (!status && b.companyNote === undefined) throw httpError(400, 'VALIDATION', 'status or companyNote is required');

  await withTransaction(async (client) => {
    // Заявку находим через вакансию компании: чужая заявка = 404
    const a = (await client.query(
      `SELECT a.status FROM applications a JOIN vacancies v ON v.vacancy_id = a.vacancy_id
       WHERE a.application_id = $1 AND v.company_id = $2 FOR UPDATE OF a`, [id, req.user.profileId])).rows[0];
    if (!a) throw httpError(404, 'NOT_FOUND', 'Application not found');

    if (status) {
      if (!canMove('company', a.status, status)) throw httpError(409, 'INVALID_STATUS', `Cannot move application from ${a.status} to ${status}`);
      await client.query('UPDATE applications SET status = $2, updated_at = now() WHERE application_id = $1', [id, status]);
      if (a.status === 'interview') {
        await client.query(
          "UPDATE interviews SET status = 'done', score = $2, feedback = $3 WHERE application_id = $1 AND status = 'scheduled'",
          [id, score, feedback]);
      }
    }
    if (b.companyNote !== undefined) {
      await client.query('UPDATE applications SET company_note = $2, updated_at = now() WHERE application_id = $1', [id, note]);
    }
  });
  res.json({ ok: true });
}));

// ---------- Слоты собеседований ----------

// 27. Список слотов с информацией о брони
router.get('/vacancies/:id/slots', wrap(async (req, res) => {
  const id = paramId(req.params.id);
  await ownVacancy(id, req.user.profileId);
  const r = await pool.query(
    `SELECT sl.slot_id, sl.starts_at, sl.duration_min, sl.place, sl.is_booked,
            a.application_id, st.full_name AS candidate_name
     FROM interview_slots sl
     LEFT JOIN interviews i ON i.slot_id = sl.slot_id AND i.status <> 'cancelled'
     LEFT JOIN applications a ON a.application_id = i.application_id
     LEFT JOIN students st ON st.student_id = a.student_id
     WHERE sl.vacancy_id = $1 ORDER BY sl.starts_at`, [id]);
  res.json(r.rows.map(camel));
}));

// 27. Создать слот (только в будущем)
router.post('/vacancies/:id/slots', wrap(async (req, res) => {
  const id = paramId(req.params.id);
  await ownVacancy(id, req.user.profileId);
  const b = req.body || {};
  const startsAt = new Date(str(b.startsAt, 'startsAt', { max: 40 }));
  if (Number.isNaN(startsAt.getTime())) throw httpError(400, 'VALIDATION', 'startsAt must be an ISO date-time');
  if (startsAt <= new Date()) throw httpError(400, 'SLOT_IN_PAST', 'Slot must start in the future');
  try {
    const r = await pool.query(
      `INSERT INTO interview_slots (vacancy_id, starts_at, duration_min, place) VALUES ($1, $2, $3, $4)
       RETURNING slot_id, starts_at, duration_min, place, is_booked`,
      [id, startsAt, int(b.durationMin ?? 30, 'durationMin', { min: 10, max: 180 }), str(b.place, 'place', { max: 300, required: false })]);
    res.status(201).json(camel(r.rows[0]));
  } catch (e) {
    if (isPgError(e, '23505')) throw httpError(400, 'VALIDATION', 'A slot at this time already exists');
    throw e;
  }
}));

// 28. Удалить слот, только если он свободен
router.delete('/slots/:id', wrap(async (req, res) => {
  const id = paramId(req.params.id);
  await withTransaction(async (client) => {
    const s = (await client.query(
      `SELECT sl.is_booked FROM interview_slots sl JOIN vacancies v ON v.vacancy_id = sl.vacancy_id
       WHERE sl.slot_id = $1 AND v.company_id = $2 FOR UPDATE OF sl`, [id, req.user.profileId])).rows[0];
    if (!s) throw httpError(404, 'NOT_FOUND', 'Slot not found');
    if (s.is_booked) throw httpError(409, 'SLOT_BOOKED', 'Slot is booked and cannot be deleted');
    // Отменённые собеседования ссылаются на слот по FK, поэтому удаляем и их
    await client.query("DELETE FROM interviews WHERE slot_id = $1 AND status = 'cancelled'", [id]);
    await client.query('DELETE FROM interview_slots WHERE slot_id = $1', [id]);
  });
  res.json({ ok: true });
}));

export default router;
