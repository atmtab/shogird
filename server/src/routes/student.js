import { Router } from 'express';
import { pool, mongo, withTransaction } from '../db.js';
import { httpError, wrap } from '../lib/errors.js';
import { str, int, oneOf, url, array, bool, paramId, isPgError } from '../lib/validate.js';
import { CITIES } from '../lib/constants.js';
import { ACTIVE, canMove } from '../lib/statuses.js';
import { camel } from '../lib/util.js';
import { matchMap } from '../lib/match.js';
import { logEvent, safeMongo } from '../lib/events.js';
import { requireRole } from '../middleware/auth.js';

// Роутер монтируется на /api, поэтому пути здесь полные. Всё внутри только для роли student.
const router = Router();
const student = requireRole('student');

// ---------- Профиль и навыки ----------

// 10. Профиль
router.get('/me/profile', student, wrap(async (req, res) => {
  const p = (await pool.query(
    `SELECT s.student_id, s.full_name, s.university_id, u.name AS university_name, s.course, s.city, s.phone, s.bio, s.github_url
     FROM students s LEFT JOIN universities u ON u.university_id = s.university_id
     WHERE s.student_id = $1`, [req.user.profileId])).rows[0];
  if (!p) throw httpError(404, 'NOT_FOUND', 'Profile not found');
  const skills = (await pool.query(
    `SELECT ss.skill_id, s.name, s.category, ss.level FROM student_skills ss JOIN skills s ON s.skill_id = ss.skill_id
     WHERE ss.student_id = $1 ORDER BY ss.level DESC, s.name`, [req.user.profileId])).rows;
  res.json({ ...camel(p), skills: skills.map(camel) });
}));

router.put('/me/profile', student, wrap(async (req, res) => {
  const b = req.body || {};
  const phone = str(b.phone, 'phone', { max: 20, required: false });
  if (phone && !/^\+998\d{9}$/.test(phone)) throw httpError(400, 'VALIDATION', 'phone must look like +998901234567');
  try {
    const r = await pool.query(
      `UPDATE students SET full_name = $2, university_id = $3, course = $4, city = $5, phone = $6, bio = $7, github_url = $8
       WHERE student_id = $1 RETURNING student_id`,
      [req.user.profileId, str(b.fullName, 'fullName', { min: 2, max: 100 }),
        int(b.universityId, 'universityId', { min: 1, max: 2147483647, required: false }),
        int(b.course, 'course', { min: 1, max: 6, required: false }),
        oneOf(b.city ?? 'Tashkent', 'city', CITIES), phone,
        str(b.bio, 'bio', { max: 2000, required: false }), url(b.githubUrl, 'githubUrl')]);
    if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'Profile not found');
  } catch (e) {
    if (isPgError(e, '23503')) throw httpError(400, 'VALIDATION', 'Unknown university');
    throw e;
  }
  res.json({ ok: true });
}));

// 11. T5. Полная замена набора навыков: DELETE + INSERT в одной транзакции
router.put('/me/skills', student, wrap(async (req, res) => {
  const items = array(req.body, 'body', { max: 60, required: true });
  const skillIds = [];
  const levels = [];
  for (const it of items) {
    skillIds.push(int(it?.skillId, 'skillId', { min: 1, max: 2147483647 }));
    levels.push(int(it?.level, 'level', { min: 1, max: 5 }));
  }
  if (new Set(skillIds).size !== skillIds.length) throw httpError(400, 'VALIDATION', 'skillId values must be unique');

  try {
    await withTransaction(async (client) => {
      await client.query('DELETE FROM student_skills WHERE student_id = $1', [req.user.profileId]);
      await client.query(
        `INSERT INTO student_skills (student_id, skill_id, level)
         SELECT $1, t.skill_id, t.level FROM unnest($2::int[], $3::int[]) AS t(skill_id, level)`,
        [req.user.profileId, skillIds, levels]);
    });
  } catch (e) {
    if (isPgError(e, '23503')) throw httpError(400, 'VALIDATION', 'Unknown skill');
    throw e;
  }
  res.json({ ok: true, count: skillIds.length });
}));

// ---------- Резюме (MongoDB) ----------

// 12. Читаем резюме
router.get('/me/resume', student, wrap(async (req, res) => {
  const db = await mongo();
  const doc = await db.collection('resumes').findOne({ studentId: req.user.profileId }, { projection: { _id: 0 } });
  res.json(doc || { studentId: req.user.profileId, about: '', languages: [], projects: [], certificates: [], updatedAt: null });
}));

// Резюме гибкое, но поля и размеры проверяем: сохраняем только известные поля
router.put('/me/resume', student, wrap(async (req, res) => {
  const b = req.body || {};
  const doc = {
    studentId: req.user.profileId,
    about: str(b.about, 'about', { max: 2000, required: false }) ?? '',
    languages: array(b.languages, 'languages', { max: 10 }).map((l) => ({
      code: str(l?.code, 'language code', { max: 5 }), level: str(l?.level, 'language level', { max: 20 }) })),
    projects: array(b.projects, 'projects', { max: 10 }).map((p) => ({
      title: str(p?.title, 'project title', { max: 120 }), url: url(p?.url, 'project url'),
      stack: array(p?.stack, 'project stack', { max: 15 }).map((s) => str(s, 'stack item', { max: 40 })) })),
    certificates: array(b.certificates, 'certificates', { max: 10 }).map((c) => ({
      name: str(c?.name, 'certificate name', { max: 120 }), year: int(c?.year, 'certificate year', { min: 1990, max: 2100 }) })),
    updatedAt: new Date(),
  };
  const db = await mongo();
  await db.collection('resumes').replaceOne({ studentId: doc.studentId }, doc, { upsert: true });
  res.json({ ok: true });
}));

// ---------- Рекомендации, отклики, заявки ----------

// 13. Топ-10 открытых вакансий по % совпадения (+ статус заявки, если студент уже откликался)
router.get('/me/recommendations', student, wrap(async (req, res) => {
  const open = (await pool.query(
    `SELECT vacancy_id FROM vacancies WHERE status = 'open' AND (deadline IS NULL OR deadline >= current_date)`)).rows;
  const matches = await matchMap(pool, req.user.profileId, open.map((r) => r.vacancy_id));
  const top = [...matches.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 10);
  const ids = top.map(([id]) => id);
  const rows = ids.length ? (await pool.query(
    `SELECT c.vacancy_id, c.title, c.direction, c.work_format, c.city, c.is_paid, c.stipend, c.company_id, c.company_name,
            c.is_itpark_resident, a.status AS application_status
     FROM v_vacancy_catalog c
     LEFT JOIN applications a ON a.vacancy_id = c.vacancy_id AND a.student_id = $2
     WHERE c.vacancy_id = ANY($1::int[])`, [ids, req.user.profileId])).rows : [];
  const byId = new Map(rows.map((r) => [r.vacancy_id, r]));
  res.json(top.map(([id, pct]) => ({ ...camel(byId.get(id)), matchPct: pct })));
}));

// 14. Отклик. Проверка вакансии и вставка идут одним запросом (INSERT ... SELECT ... WHERE), без гонки между SELECT и INSERT
router.post('/vacancies/:id/apply', student, wrap(async (req, res) => {
  const vacancyId = paramId(req.params.id);
  const coverLetter = str(req.body?.coverLetter, 'coverLetter', { max: 2000, required: false });
  let created;
  try {
    created = await pool.query(
      `INSERT INTO applications (vacancy_id, student_id, cover_letter)
       SELECT v.vacancy_id, $2, $3 FROM vacancies v
       WHERE v.vacancy_id = $1 AND v.status = 'open' AND (v.deadline IS NULL OR v.deadline >= current_date)
       RETURNING application_id, status`, [vacancyId, req.user.profileId, coverLetter]);
  } catch (e) {
    if (isPgError(e, '23505')) throw httpError(409, 'ALREADY_APPLIED', 'You have already applied to this vacancy');
    throw e;
  }
  if (!created.rowCount) {
    // Вставки не было: выясняем причину только для ответа
    const v = (await pool.query(
      'SELECT status, (deadline < current_date) AS expired FROM vacancies WHERE vacancy_id = $1', [vacancyId])).rows[0];
    if (!v || v.status === 'draft') throw httpError(404, 'NOT_FOUND', 'Vacancy not found');
    if (v.status === 'closed') throw httpError(409, 'VACANCY_CLOSED', 'Vacancy is closed');
    throw httpError(409, 'DEADLINE_PASSED', 'Application deadline has passed');
  }
  const info = (await pool.query('SELECT company_id, direction, city FROM vacancies WHERE vacancy_id = $1', [vacancyId])).rows[0];
  logEvent(req, 'apply', { vacancyId, companyId: info.company_id, direction: info.direction, city: info.city });
  res.status(201).json(camel(created.rows[0]));
}));

// 15. Мои заявки с компанией и временем собеседования
router.get('/me/applications', student, wrap(async (req, res) => {
  const r = await pool.query(
    `SELECT a.application_id, a.vacancy_id, a.status, a.cover_letter, a.created_at, a.updated_at,
            v.title, v.company_id, c.name AS company_name, v.seats_left,
            sl.slot_id AS interview_slot_id, sl.starts_at AS interview_at, sl.place AS interview_place
     FROM applications a
     JOIN vacancies v ON v.vacancy_id = a.vacancy_id
     JOIN companies c ON c.company_id = v.company_id
     LEFT JOIN interviews i ON i.application_id = a.application_id AND i.status <> 'cancelled'
     LEFT JOIN interview_slots sl ON sl.slot_id = i.slot_id
     WHERE a.student_id = $1
     ORDER BY a.updated_at DESC, a.application_id DESC`, [req.user.profileId]);
  res.json(r.rows.map(camel));
}));

// 16. Свободные будущие слоты (только при статусе shortlisted)
router.get('/applications/:id/slots', student, wrap(async (req, res) => {
  const id = paramId(req.params.id);
  const a = (await pool.query(
    'SELECT vacancy_id, status FROM applications WHERE application_id = $1 AND student_id = $2',
    [id, req.user.profileId])).rows[0];
  if (!a) throw httpError(404, 'NOT_FOUND', 'Application not found');
  if (a.status !== 'shortlisted') throw httpError(409, 'INVALID_STATUS', 'Slots are available only for shortlisted applications');
  const r = await pool.query(
    `SELECT slot_id, starts_at, duration_min, place FROM interview_slots
     WHERE vacancy_id = $1 AND is_booked = false AND starts_at > now() ORDER BY starts_at`, [a.vacancy_id]);
  res.json(r.rows.map(camel));
}));

// 17. T2. Бронь слота собеседования
router.post('/applications/:id/book', student, wrap(async (req, res) => {
  const id = paramId(req.params.id);
  const slotId = int(req.body?.slotId, 'slotId', { min: 1, max: 2147483647 });

  const info = await withTransaction(async (client) => {
    // 1. Блокируем заявку: два параллельных клика одного студента не пройдут вместе
    const a = (await client.query(
      `SELECT a.vacancy_id, a.status, v.company_id, v.direction, v.city
       FROM applications a JOIN vacancies v ON v.vacancy_id = a.vacancy_id
       WHERE a.application_id = $1 AND a.student_id = $2 FOR UPDATE OF a`, [id, req.user.profileId])).rows[0];
    if (!a) throw httpError(404, 'NOT_FOUND', 'Application not found');
    if (!canMove('student', a.status, 'interview')) throw httpError(409, 'INVALID_STATUS', 'Application must be shortlisted');

    // 2. Проверка и бронь одним запросом: если слот уже занят, затронется 0 строк (отдельный SELECT создал бы гонку)
    const slot = await client.query(
      `UPDATE interview_slots SET is_booked = true
       WHERE slot_id = $1 AND vacancy_id = $2 AND is_booked = false AND starts_at > now()
       RETURNING slot_id, starts_at, place`, [slotId, a.vacancy_id]);
    if (!slot.rowCount) throw httpError(409, 'SLOT_TAKEN', 'This slot is no longer available');

    // 3-4. Собеседование и новый статус заявки. Частичный уникальный индекс защищает от двойной брони во второй раз
    try {
      await client.query('INSERT INTO interviews (slot_id, application_id) VALUES ($1, $2)', [slotId, id]);
    } catch (e) {
      if (isPgError(e, '23505')) throw httpError(409, 'SLOT_TAKEN', 'This slot is no longer available');
      throw e;
    }
    await client.query("UPDATE applications SET status = 'interview', updated_at = now() WHERE application_id = $1", [id]);
    return { a, slot: slot.rows[0] };
  });

  // 5. Событие пишем только после COMMIT и без await
  logEvent(req, 'slot_booked', { vacancyId: info.a.vacancy_id, companyId: info.a.company_id, direction: info.a.direction, city: info.a.city });
  res.json({ ok: true, status: 'interview', slot: camel(info.slot) });
}));

// 18. T3. Принять оффер (демо «последнее место»)
router.post('/applications/:id/accept', student, wrap(async (req, res) => {
  const id = paramId(req.params.id);

  const info = await withTransaction(async (client) => {
    // 1. Блокируем заявку; принять можно только оффер
    const a = (await client.query(
      `SELECT a.vacancy_id, a.status, v.company_id, v.direction, v.city
       FROM applications a JOIN vacancies v ON v.vacancy_id = a.vacancy_id
       WHERE a.application_id = $1 AND a.student_id = $2 FOR UPDATE OF a`, [id, req.user.profileId])).rows[0];
    if (!a) throw httpError(404, 'NOT_FOUND', 'Application not found');
    if (!canMove('student', a.status, 'accepted')) throw httpError(409, 'INVALID_STATUS', 'Application has no offer to accept');

    // 2. Место забираем одним UPDATE: условие seats_left > 0 проверяется атомарно.
    //    Второй студент на последнее место ждёт COMMIT первого, перечитывает строку и получает 0 строк.
    const seat = await client.query(
      `UPDATE vacancies
       SET seats_left = seats_left - 1,
           status = CASE WHEN seats_left = 1 THEN 'closed' ELSE status END,
           updated_at = now()
       WHERE vacancy_id = $1 AND seats_left > 0
       RETURNING seats_left`, [a.vacancy_id]);
    if (!seat.rowCount) throw httpError(409, 'NO_SEATS', 'No seats left on this vacancy');

    // 3. Заявка принята
    await client.query("UPDATE applications SET status = 'accepted', updated_at = now() WHERE application_id = $1", [id]);

    // 4. Принять можно только один оффер: остальные активные заявки студента отзываем
    const others = await client.query(
      `UPDATE applications SET status = 'withdrawn', updated_at = now()
       WHERE student_id = $1 AND application_id <> $2 AND status = ANY($3::text[])
       RETURNING application_id`, [req.user.profileId, id, ACTIVE]);

    // 5. Их будущие собеседования отменяем, слоты освобождаем
    if (others.rowCount) {
      const cancelled = await client.query(
        `UPDATE interviews SET status = 'cancelled'
         WHERE application_id = ANY($1::int[]) AND status = 'scheduled' RETURNING slot_id`,
        [others.rows.map((r) => r.application_id)]);
      if (cancelled.rowCount) {
        await client.query('UPDATE interview_slots SET is_booked = false WHERE slot_id = ANY($1::int[])',
          [cancelled.rows.map((r) => r.slot_id)]);
      }
    }
    return { a, seatsLeft: seat.rows[0].seats_left, withdrawn: others.rowCount };
  });

  // 6. После COMMIT, без await
  logEvent(req, 'offer_accepted', { vacancyId: info.a.vacancy_id, companyId: info.a.company_id, direction: info.a.direction, city: info.a.city });
  res.json({ ok: true, status: 'accepted', seatsLeft: info.seatsLeft, withdrawnApplications: info.withdrawn });
}));

// Определяет причину, по которой UPDATE заявки студента не затронул строк: чужая/несуществующая (404) или неподходящий статус (409)
async function failReason(client, id, studentId) {
  const r = await client.query('SELECT 1 FROM applications WHERE application_id = $1 AND student_id = $2', [id, studentId]);
  return r.rowCount ? httpError(409, 'INVALID_STATUS', 'Status change is not allowed now')
                    : httpError(404, 'NOT_FOUND', 'Application not found');
}

// 19. Отказ от оффера
router.post('/applications/:id/decline', student, wrap(async (req, res) => {
  const id = paramId(req.params.id);
  const r = await pool.query(
    `UPDATE applications SET status = 'declined', updated_at = now()
     WHERE application_id = $1 AND student_id = $2 AND status = 'offer' RETURNING application_id`, [id, req.user.profileId]);
  if (!r.rowCount) throw await failReason(pool, id, req.user.profileId);
  res.json({ ok: true, status: 'declined' });
}));

// 19. Отзыв заявки; если было собеседование, оно отменяется и слот освобождается
router.post('/applications/:id/withdraw', student, wrap(async (req, res) => {
  const id = paramId(req.params.id);
  await withTransaction(async (client) => {
    const r = await client.query(
      `UPDATE applications SET status = 'withdrawn', updated_at = now()
       WHERE application_id = $1 AND student_id = $2 AND status = ANY($3::text[]) RETURNING application_id`,
      [id, req.user.profileId, ACTIVE]);
    if (!r.rowCount) throw await failReason(client, id, req.user.profileId);
    const cancelled = await client.query(
      "UPDATE interviews SET status = 'cancelled' WHERE application_id = $1 AND status = 'scheduled' RETURNING slot_id", [id]);
    if (cancelled.rowCount) {
      await client.query('UPDATE interview_slots SET is_booked = false WHERE slot_id = ANY($1::int[])',
        [cancelled.rows.map((x) => x.slot_id)]);
    }
  });
  res.json({ ok: true, status: 'withdrawn' });
}));

// 20. Отзыв о стажировке (§6.5): право проверяем в PostgreSQL, сам отзыв пишем в MongoDB
router.post('/companies/:id/reviews', student, wrap(async (req, res) => {
  const companyId = paramId(req.params.id);
  const b = req.body || {};
  const review = {
    companyId, studentId: req.user.profileId,
    rating: int(b.rating, 'rating', { min: 1, max: 5 }),
    pros: str(b.pros, 'pros', { max: 500, required: false }) ?? '',
    cons: str(b.cons, 'cons', { max: 500, required: false }) ?? '',
    tags: array(b.tags, 'tags', { max: 5 }).map((t) => str(t, 'tag', { max: 30 })),
    wouldRecommend: bool(b.wouldRecommend, 'wouldRecommend'),
    createdAt: new Date(),
  };

  const company = await pool.query('SELECT 1 FROM companies WHERE company_id = $1', [companyId]);
  if (!company.rowCount) throw httpError(404, 'NOT_FOUND', 'Company not found');
  const allowed = await pool.query(
    `SELECT 1 FROM applications a JOIN vacancies v ON v.vacancy_id = a.vacancy_id
     WHERE a.student_id = $1 AND v.company_id = $2 AND a.status = 'accepted' LIMIT 1`, [req.user.profileId, companyId]);
  if (!allowed.rowCount) throw httpError(403, 'REVIEW_NOT_ALLOWED', 'Only students with an accepted internship can review');

  try {
    const db = await mongo();
    await db.collection('internship_reviews').insertOne(review);
  } catch (e) {
    if (e.code === 11000) throw httpError(409, 'REVIEW_EXISTS', 'You have already reviewed this company');   // уникальный индекс (companyId, studentId)
    throw e;
  }
  res.status(201).json({ ok: true });
}));

export default router;
