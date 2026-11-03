import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../db.js';
import { httpError, wrap } from '../lib/errors.js';
import { str, int, oneOf, url, isPgError } from '../lib/validate.js';
import { CITIES, EMPLOYEES } from '../lib/constants.js';
import { setAuthCookie, clearAuthCookie, optionalAuth } from '../middleware/auth.js';

const router = Router();
// Хэш-пустышка: при неизвестном email всё равно делаем bcrypt.compare, чтобы время ответа не выдавало существование аккаунта
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

// 6. T1. Регистрация: users + students/companies в одной транзакции
router.post('/register', wrap(async (req, res) => {
  const b = req.body || {};
  const role = oneOf(b.role, 'role', ['student', 'company']);
  const email = str(b.email, 'email', { max: 120 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'VALIDATION', 'email is not valid');
  const password = str(b.password, 'password', { min: 8, max: 72 });   // у bcrypt предел 72 байта
  const city = oneOf(b.city ?? 'Tashkent', 'city', CITIES);

  const profile = role === 'student'
    ? { fullName: str(b.fullName, 'fullName', { min: 2, max: 100 }),
        universityId: int(b.universityId, 'universityId', { min: 1, max: 2147483647, required: false }),
        course: int(b.course, 'course', { min: 1, max: 6, required: false }) }
    : { companyName: str(b.companyName, 'companyName', { min: 2, max: 120 }),
        website: url(b.website, 'website'),
        description: str(b.description, 'description', { max: 2000, required: false }),
        employeesRange: oneOf(b.employeesRange, 'employeesRange', EMPLOYEES, { required: false }) };

  const hash = await bcrypt.hash(password, 10);

  try {
    const user = await withTransaction(async (client) => {
      const u = await client.query(
        'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING user_id',
        [email, hash, role]);
      const userId = u.rows[0].user_id;
      if (role === 'student') {
        const s = await client.query(
          `INSERT INTO students (user_id, full_name, university_id, course, city) VALUES ($1, $2, $3, $4, $5)
           RETURNING student_id`,
          [userId, profile.fullName, profile.universityId, profile.course, city]);
        return { userId, role, profileId: s.rows[0].student_id, name: profile.fullName };
      }
      const c = await client.query(
        `INSERT INTO companies (user_id, name, city, website, description, employees_range) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING company_id`,
        [userId, profile.companyName, city, profile.website, profile.description, profile.employeesRange]);
      return { userId, role, profileId: c.rows[0].company_id, name: profile.companyName };
    });
    setAuthCookie(res, { userId: user.userId, role: user.role, profileId: user.profileId });
    res.status(201).json(user);
  } catch (e) {
    if (isPgError(e, '23505') && e.constraint === 'users_email_key') throw httpError(409, 'EMAIL_TAKEN', 'Email is already registered');
    if (isPgError(e, '23505')) throw httpError(400, 'VALIDATION', 'Company name is already taken');
    if (isPgError(e, '23503')) throw httpError(400, 'VALIDATION', 'Unknown university');
    throw e;
  }
}));

// 7. Вход. Одна и та же ошибка для «нет такого email» и «неверный пароль»
router.post('/login', wrap(async (req, res) => {
  const email = str(req.body?.email, 'email', { max: 120 }).toLowerCase();
  const password = str(req.body?.password, 'password', { max: 72 });

  const r = await pool.query(
    `SELECT u.user_id, u.password_hash, u.role,
            COALESCE(s.student_id, c.company_id) AS profile_id,
            COALESCE(s.full_name, c.name, u.email) AS name
     FROM users u
     LEFT JOIN students s  ON s.user_id = u.user_id
     LEFT JOIN companies c ON c.user_id = u.user_id
     WHERE u.email = $1`, [email]);
  const row = r.rows[0];
  const ok = await bcrypt.compare(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');

  setAuthCookie(res, { userId: row.user_id, role: row.role, profileId: row.profile_id });
  res.json({ userId: row.user_id, role: row.role, profileId: row.profile_id, name: row.name });
}));

// 8. Выход
router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// 9. Кто я
// Для гостя 401 (как в SPEC §9.2). Фронтенд вызывает с ?optional=true и получает 200 с null: иначе при каждом
// заходе гостя в консоли браузера краснеет «401 Unauthorized», а SPEC §10.2 требует чистую консоль.
router.get('/me', optionalAuth, wrap(async (req, res) => {
  if (!req.user) {
    if (req.query.optional === 'true') return res.json(null);
    throw httpError(401, 'UNAUTHORIZED', 'Login required');
  }
  const r = await pool.query(
    `SELECT u.user_id, u.role, COALESCE(s.student_id, c.company_id) AS profile_id, COALESCE(s.full_name, c.name, u.email) AS name
     FROM users u
     LEFT JOIN students s  ON s.user_id = u.user_id
     LEFT JOIN companies c ON c.user_id = u.user_id
     WHERE u.user_id = $1`, [req.user.userId]);
  if (!r.rows[0]) throw httpError(401, 'UNAUTHORIZED', 'Account no longer exists');
  const x = r.rows[0];
  res.json({ userId: x.user_id, role: x.role, profileId: x.profile_id, name: x.name });
}));

export default router;
