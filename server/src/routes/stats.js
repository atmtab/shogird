import { Router } from 'express';
import { pool, mongo } from '../db.js';
import { wrap } from '../lib/errors.js';
import { oneOf } from '../lib/validate.js';
import { DIRECTIONS } from '../lib/constants.js';
import { camel } from '../lib/util.js';
import { safeMongo } from '../lib/events.js';

// Публичная аналитика (все роуты без авторизации). Данные собираются из обеих баз.
const router = Router();
const daysAgo = (n) => new Date(Date.now() - n * 24 * 3600 * 1000);

// 29. KPI
router.get('/overview', wrap(async (req, res) => {
  const pgRow = (await pool.query(
    `SELECT (SELECT count(*) FROM vacancies WHERE status = 'open')::int AS open_vacancies,
            (SELECT count(*) FROM students)::int AS students,
            (SELECT count(*) FROM companies)::int AS companies,
            (SELECT count(*) FROM applications)::int AS applications,
            (SELECT COALESCE(round(100.0 * count(*) FILTER (WHERE status = 'accepted') / NULLIF(count(*), 0), 1), 0)::float
               FROM applications) AS accepted_pct`)).rows[0];
  const events7d = await safeMongo(mongo().then((db) => db.collection('events').countDocuments({ ts: { $gte: daysAgo(7) } })), null);
  res.json({ ...camel(pgRow), events7d });
}));

// 30. «Разрыв навыков»: спрос студентов (поиски, Mongo) против требований вакансий и умений студентов (PG)
router.get('/skills-gap', wrap(async (req, res) => {
  const [pg, searches] = await Promise.all([
    pool.query(
      `SELECT s.name,
              (SELECT count(DISTINCT vs.vacancy_id) FROM vacancy_skills vs JOIN vacancies v ON v.vacancy_id = vs.vacancy_id
                WHERE vs.skill_id = s.skill_id AND v.status = 'open')::int AS vacancies,
              (SELECT count(*) FROM student_skills ss WHERE ss.skill_id = s.skill_id)::int AS students
       FROM skills s`),
    safeMongo(mongo().then((db) => db.collection('search_logs').aggregate([
      { $unwind: '$filters.skills' },
      { $group: { _id: '$filters.skills', searches: { $sum: 1 } } },
    ]).toArray()), []),
  ]);
  const searchMap = new Map(searches.map((s) => [s._id, s.searches]));
  const items = pg.rows.map((r) => ({
    skill: r.name, searches: searchMap.get(r.name) || 0, vacancies: r.vacancies, students: r.students,
    deficit: r.vacancies - r.students,        // дефицит = спрос вакансий минус предложение студентов
  }));
  items.sort((a, b) => b.deficit - a.deficit || b.vacancies - a.vacancies || a.skill.localeCompare(b.skill));
  res.json(items);
}));

// 31. Воронка: просмотры -> отклики -> собеседования -> принятые
router.get('/funnel', wrap(async (req, res) => {
  const direction = oneOf(req.query.direction, 'direction', DIRECTIONS, { required: false });
  const match = direction ? { direction } : {};
  const rows = await safeMongo(mongo().then((db) => db.collection('events').aggregate([
    { $match: match },
    { $group: { _id: '$type', n: { $sum: 1 } } },
  ]).toArray()), []);
  const n = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  res.json({ direction, views: n.vacancy_view || 0, applications: n.apply || 0, interviews: n.slot_booked || 0, accepted: n.offer_accepted || 0 });
}));

// 32. Города: вакансии, заявки, средняя стипендия (GROUP BY + HAVING)
router.get('/cities', wrap(async (req, res) => {
  const r = await pool.query(
    `SELECT v.city, count(DISTINCT v.vacancy_id)::int AS vacancies, count(a.application_id)::int AS applications,
            round(avg(v.stipend))::float AS avg_stipend
     FROM vacancies v LEFT JOIN applications a ON a.vacancy_id = v.vacancy_id
     WHERE v.status = 'open'
     GROUP BY v.city
     HAVING count(DISTINCT v.vacancy_id) >= 1
     ORDER BY vacancies DESC, v.city`);
  res.json(r.rows.map(camel));
}));

// 33. События по дням за 30 дней
router.get('/activity', wrap(async (req, res) => {
  const rows = await safeMongo(mongo().then((db) => db.collection('events').aggregate([
    { $match: { ts: { $gte: daysAgo(30) } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } }, events: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray()), []);
  res.json(rows.map((r) => ({ day: r._id, events: r.events })));
}));

// 34. Топ компаний: заявки (PG) + просмотры вакансий и рейтинг (Mongo)
router.get('/top-companies', wrap(async (req, res) => {
  const pg = (await pool.query(
    `SELECT c.company_id, c.name, c.is_itpark_resident, count(a.application_id)::int AS applications
     FROM companies c
     LEFT JOIN vacancies v ON v.company_id = c.company_id
     LEFT JOIN applications a ON a.vacancy_id = v.vacancy_id
     GROUP BY c.company_id ORDER BY applications DESC, c.name LIMIT 5`)).rows;
  const ids = pg.map((r) => r.company_id);
  const [views, ratings] = await Promise.all([
    safeMongo(mongo().then((db) => db.collection('events').aggregate([
      { $match: { type: 'vacancy_view', companyId: { $in: ids } } },
      { $group: { _id: '$companyId', views: { $sum: 1 } } },
    ]).toArray()), []),
    safeMongo(mongo().then((db) => db.collection('internship_reviews').aggregate([
      { $match: { companyId: { $in: ids } } },
      { $group: { _id: '$companyId', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]).toArray()), []),
  ]);
  const v = new Map(views.map((x) => [x._id, x.views]));
  const rt = new Map(ratings.map((x) => [x._id, x]));
  res.json(pg.map((r) => ({
    ...camel(r), views: v.get(r.company_id) || 0,
    rating: rt.has(r.company_id) ? Math.round(rt.get(r.company_id).avg * 10) / 10 : null,
    reviews: rt.get(r.company_id)?.count || 0,
  })));
}));

export default router;
