// Сквозная проверка API (SPEC §16, Фаза 3). Сервер должен быть запущен: npm run dev
// Запуск: npm run smoke
// ВНИМАНИЕ: в начале скрипт делает db:reset (для localhost), чтобы сценарии D1–D4 шли с известного состояния.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mongo } from '../src/db.js';

const BASE = process.env.SMOKE_URL || `http://localhost:${process.env.PORT || 3000}`;
const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASSWORD = 'Shogird2026!';

// ---------- Мини-клиент с cookie ----------
class Client {
  constructor() { this.cookies = {}; }
  async req(method, url, body, raw) {
    const headers = {};
    if (body !== undefined || raw !== undefined) headers['content-type'] = 'application/json';
    const cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.cookie = cookie;
    const res = await fetch(BASE + url, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (value === '') delete this.cookies[name]; else this.cookies[name] = value;
    }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  get(u) { return this.req('GET', u); }
  post(u, b) { return this.req('POST', u, b ?? {}); }
  put(u, b) { return this.req('PUT', u, b); }
  patch(u, b) { return this.req('PATCH', u, b); }
  del(u) { return this.req('DELETE', u); }
}

let failed = 0;
let total = 0;
function check(name, ok, details = '') {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && details ? `   -> ${details}` : ''}`);
}
// Проверка статуса (и кода ошибки, если указан)
function expect(name, r, status, code) {
  const ok = r.status === status && (!code || r.data?.code === code);
  check(name, ok, `ждали ${status}${code ? ' ' + code : ''}, пришло ${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
  return r.data;
}
async function login(email) {
  const c = new Client();
  expect(`вход ${email}`, await c.post('/api/auth/login', { email, password: PASSWORD }), 200);
  return c;
}

// ---------- 0. Чистое состояние ----------
console.log('== Сброс базы (db:reset)');
execFileSync(process.execPath, ['scripts/run-sql.js', '../sql/01_schema.sql', '../sql/02_seed.sql'], { cwd: serverDir, stdio: 'inherit' });
const mdb = await mongo();
await mdb.collection('internship_reviews').deleteOne({ companyId: 1, studentId: 2 });
const startedAt = new Date();

// ---------- 1. Публичные роуты ----------
console.log('\n== Публичные роуты');
const guest = new Client();
const health = expect('GET /api/health', await guest.get('/api/health'), 200);
check('health: ok и mongoEvents', health.ok === true && typeof health.mongoEvents === 'number');
const meta = expect('GET /api/meta', await guest.get('/api/meta'), 200);
check('meta: навыки, вузы, города', meta.skills.length > 30 && meta.universities.length === 10 && meta.cities.length === 9);
const list = expect('GET /api/vacancies', await guest.get('/api/vacancies'), 200);
check('каталог: 12 на странице, есть следующая', list.items.length === 12 && list.pages >= 2 && list.total > 12);
check('каталог: у карточки навыки, не больше 3', list.items.every((i) => i.skills.length <= 3));
expect('каталог: неверное направление', await guest.get('/api/vacancies?direction=cooking'), 400, 'VALIDATION');
const remote = expect('каталог: фильтры paid+remote+навык', await guest.get('/api/vacancies?paid=true&format=remote&skill=Docker'), 200);
check('фильтры сузили выдачу', remote.total > 0 && remote.total < list.total);
const evil = expect('каталог: SQL-инъекция в q безопасна', await guest.get("/api/vacancies?q=' OR 1=1 --"), 200);
check('инъекция ничего не нашла', evil.total === 0);
const v1 = expect('GET /api/vacancies/1', await guest.get('/api/vacancies/1'), 200);
check('карточка: навыки, рейтинг, просмотры', v1.skills.length === 6 && v1.companyRating.count > 0 && typeof v1.views30d === 'number');
check('дедлайн приходит строкой YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(v1.deadline));
expect('вакансия-черновик скрыта', await guest.get('/api/vacancies/21'), 404, 'NOT_FOUND');
expect('вакансия с мусорным id', await guest.get('/api/vacancies/abc'), 404, 'NOT_FOUND');
const co1 = expect('GET /api/companies/1', await guest.get('/api/companies/1'), 200);
check('профиль компании: вакансии и отзывы', co1.vacancies.length >= 3 && co1.reviews.length > 0);
expect('неизвестный роут API', await guest.get('/api/nothing'), 404, 'NOT_FOUND');

// ---------- 2. Аутентификация ----------
console.log('\n== Аутентификация и роли');
expect('/auth/me без входа', await guest.get('/api/auth/me'), 401, 'UNAUTHORIZED');
{ const r = await guest.get('/api/auth/me?optional=true'); check('/auth/me?optional=true для гостя: 200 null', r.status === 200 && r.data === null); }
expect('вход: неверный пароль', await guest.post('/api/auth/login', { email: 'aziza@example.uz', password: 'wrong-password' }), 401, 'INVALID_CREDENTIALS');
expect('вход: нет такого email (тот же код)', await guest.post('/api/auth/login', { email: 'nobody@example.uz', password: 'wrong-password' }), 401, 'INVALID_CREDENTIALS');
expect('сломанный JSON', await guest.req('POST', '/api/auth/login', undefined, '{not json'), 400, 'VALIDATION');
expect('регистрация: короткий пароль', await guest.post('/api/auth/register', { role: 'student', email: 'x@example.uz', password: '123', fullName: 'Test User' }), 400, 'VALIDATION');
expect('регистрация: неверная роль', await guest.post('/api/auth/register', { role: 'admin', email: 'x@example.uz', password: PASSWORD }), 400, 'VALIDATION');
expect('регистрация: занятый email', await guest.post('/api/auth/register', { role: 'student', email: 'Aziza@example.uz', password: PASSWORD, fullName: 'Another Aziza' }), 409, 'EMAIL_TAKEN');
const fresh = new Client();
const email = `smoke.${Date.now()}@example.uz`;
expect('регистрация студента (T1)', await fresh.post('/api/auth/register', { role: 'student', email, password: PASSWORD, fullName: 'Smoke Student', city: 'Samarkand' }), 201);
const me = expect('/auth/me после регистрации', await fresh.get('/api/auth/me'), 200);
check('me: роль student и имя', me.role === 'student' && me.name === 'Smoke Student');
expect('студент в кабинет компании', await fresh.get('/api/company/vacancies'), 403, 'FORBIDDEN');
expect('гость в кабинет компании', await guest.get('/api/company/vacancies'), 401, 'UNAUTHORIZED');
expect('гость откликается', await guest.post('/api/vacancies/3/apply'), 401, 'UNAUTHORIZED');

// ---------- 3. Профиль, навыки, резюме ----------
console.log('\n== Профиль студента, навыки (T5), резюме');
expect('профиль: неверный телефон', await fresh.put('/api/me/profile', { fullName: 'Smoke Student', city: 'Samarkand', phone: '12345' }), 400, 'VALIDATION');
expect('профиль: сохранение', await fresh.put('/api/me/profile', { fullName: 'Smoke Student', universityId: 3, course: 2, city: 'Samarkand', phone: '+998901234567', bio: 'Hello' }), 200);
expect('навыки: неизвестный skillId', await fresh.put('/api/me/skills', [{ skillId: 99999, level: 3 }]), 400, 'VALIDATION');
expect('навыки: уровень вне 1..5', await fresh.put('/api/me/skills', [{ skillId: 1, level: 9 }]), 400, 'VALIDATION');
expect('навыки: замена набора', await fresh.put('/api/me/skills', [{ skillId: 1, level: 3 }, { skillId: 36, level: 2 }]), 200);
const prof = expect('профиль: чтение', await fresh.get('/api/me/profile'), 200);
check('профиль: 2 навыка и университет', prof.skills.length === 2 && prof.universityId === 3);
expect('резюме: сохранение', await fresh.put('/api/me/resume', { about: 'About me', languages: [{ code: 'uz', level: 'native' }], projects: [{ title: 'Demo', url: 'https://example.uz/p', stack: ['JavaScript'] }], certificates: [{ name: 'SQL', year: 2025 }] }), 200);
const resume = expect('резюме: чтение', await fresh.get('/api/me/resume'), 200);
check('резюме: проект на месте', resume.projects?.[0]?.title === 'Demo');
expect('резюме: плохой URL', await fresh.put('/api/me/resume', { about: 'x', projects: [{ title: 'P', url: 'javascript:alert(1)' }] }), 400, 'VALIDATION');

// ---------- 4. Отклики ----------
console.log('\n== Отклики и рекомендации');
const aziza = await login('aziza@example.uz');
expect('отклик на вакансию 3', await aziza.post('/api/vacancies/3/apply', { coverLetter: 'Hi!' }), 201);
expect('повторный отклик', await aziza.post('/api/vacancies/3/apply'), 409, 'ALREADY_APPLIED');
expect('отклик на закрытую (6)', await aziza.post('/api/vacancies/6/apply'), 409, 'VACANCY_CLOSED');
expect('отклик на черновик (21)', await aziza.post('/api/vacancies/21/apply'), 404, 'NOT_FOUND');
expect('отклик на несуществующую', await aziza.post('/api/vacancies/9999/apply'), 404, 'NOT_FOUND');
const recs = expect('рекомендации', await aziza.get('/api/me/recommendations'), 200);
check('рекомендации: 10 штук по убыванию %', recs.length === 10 && recs.every((r, i) => i === 0 || recs[i - 1].matchPct >= r.matchPct));
const v2 = expect('карточка вакансии 2 для Азизы', await aziza.get('/api/vacancies/2'), 200);
check('match 100% и навыки подсвечены', v2.matchPct === 100 && v2.skills.every((s) => typeof s.have === 'boolean'));
check('в карточке виден статус её заявки', v2.application?.status === 'shortlisted');

// ---------- 5. Кабинет компании: валидация и изоляция ----------
console.log('\n== Кабинет компании');
const reg = await login('hr@registanlabs.example.uz');
const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const vBody = { title: 'Smoke Test Vacancy', description: 'Description for the smoke test vacancy', direction: 'backend', workFormat: 'remote',
  city: 'Tashkent', isPaid: true, stipend: 1500000, durationMonths: 3, seats: 2, status: 'open', deadline: yesterday,
  skills: [{ skillId: 11, isRequired: true }, { skillId: 36, isRequired: false }] };
expect('вакансия: без названия', await reg.post('/api/company/vacancies', { ...vBody, title: '' }), 400, 'VALIDATION');
expect('вакансия: стипендия без оплаты', await reg.post('/api/company/vacancies', { ...vBody, isPaid: false }), 400, 'VALIDATION');
expect('вакансия: неизвестный навык', await reg.post('/api/company/vacancies', { ...vBody, skills: [{ skillId: 99999 }] }), 400, 'VALIDATION');
const created = expect('вакансия: создание (T4)', await reg.post('/api/company/vacancies', vBody), 201);
const newId = created.vacancyId;
expect('отклик после дедлайна', await aziza.post(`/api/vacancies/${newId}/apply`), 409, 'DEADLINE_PASSED');
expect('вакансия: редактирование (T4)', await reg.put(`/api/company/vacancies/${newId}`, { ...vBody, deadline: null, seats: 3, skills: [{ skillId: 7 }] }), 200);
const mine = expect('GET /company/vacancies', await reg.get('/api/company/vacancies'), 200);
const mineNew = mine.find((v) => v.vacancyId === newId);
check('свои вакансии: места пересчитаны (3 места, 0 занято)', mineNew?.seats === 3 && mineNew?.seatsLeft === 3 && mineNew.skills.length === 1);
check('свои вакансии: счётчики по статусам', mine.find((v) => v.vacancyId === 1).applicationsByStatus.offer === 2);
expect('вакансия: закрытие', await reg.del(`/api/company/vacancies/${newId}`), 200);
// Откат T4: неудачное редактирование не должно менять навыки вакансии 1
expect('вакансия 1: seats=1 оставляет 0 мест при open', await reg.put('/api/company/vacancies/1', { ...vBody, seats: 1, deadline: null, skills: [{ skillId: 1 }] }), 400, 'VALIDATION');
const v1after = await guest.get('/api/vacancies/1');
check('откат T4: у вакансии 1 прежние 6 навыков и 1 место', v1after.data.skills.length === 6 && v1after.data.seatsLeft === 1);
expect('чужая вакансия (Silk Code) — кандидаты', await reg.get('/api/company/vacancies/4/applications'), 404, 'NOT_FOUND');
expect('чужая вакансия — редактирование', await reg.put('/api/company/vacancies/4', vBody), 404, 'NOT_FOUND');
expect('чужая заявка — смена статуса', await reg.patch('/api/company/applications/15', { status: 'shortlisted' }), 404, 'NOT_FOUND');
expect('чужие слоты', await reg.get('/api/company/vacancies/4/slots'), 404, 'NOT_FOUND');
expect('чужой слот — удаление', await reg.del('/api/company/slots/16'), 404, 'NOT_FOUND');

// ---------- 6. D1 + D3: бронь слота (T2) ----------
console.log('\n== D1/D3: бронь слота (T2)');
const slots = expect('слоты для заявки 8', await aziza.get('/api/applications/8/slots'), 200);
check('свободные будущие слоты есть, занятого (8) нет', slots.length >= 4 && !slots.some((s) => s.slotId === 8));
expect('D3: занятый слот 8', await aziza.post('/api/applications/8/book', { slotId: 8 }), 409, 'SLOT_TAKEN');
expect('чужая заявка (2)', await aziza.post('/api/applications/2/book', { slotId: 9 }), 404, 'NOT_FOUND');
expect('заявка не shortlisted (1: offer)', await aziza.post('/api/applications/1/book', { slotId: 9 }), 409, 'INVALID_STATUS');
expect('слоты при статусе offer', await aziza.get('/api/applications/1/slots'), 409, 'INVALID_STATUS');
expect('слот без slotId', await aziza.post('/api/applications/8/book', {}), 400, 'VALIDATION');
expect('D1: бронь слота 9', await aziza.post('/api/applications/8/book', { slotId: 9 }), 200);
const myApps = expect('мои заявки', await aziza.get('/api/me/applications'), 200);
const app8 = myApps.find((a) => a.applicationId === 8);
check('заявка 8: interview со временем', app8.status === 'interview' && Boolean(app8.interviewAt));
expect('повторная бронь той же заявки', await aziza.post('/api/applications/8/book', { slotId: 10 }), 409, 'INVALID_STATUS');

// ---------- 7. D4: компания двигает кандидатов ----------
console.log('\n== D4: воронка компании');
const cands = expect('кандидаты вакансии 2', await reg.get('/api/company/vacancies/2/applications'), 200);
const pcts = cands.map((c) => c.matchPct ?? -1);
check('кандидаты отсортированы по match_pct', pcts.every((p, i) => i === 0 || pcts[i - 1] >= p));
check('есть submitted и interview', cands.some((c) => c.status === 'submitted') && cands.some((c) => c.status === 'interview'));
expect('PATCH 9: submitted -> shortlisted', await reg.patch('/api/company/applications/9', { status: 'shortlisted', companyNote: 'ok' }), 200);
expect('PATCH 9: shortlisted -> offer недопустимо', await reg.patch('/api/company/applications/9', { status: 'offer' }), 409, 'INVALID_STATUS');
expect('PATCH: статус вне списка', await reg.patch('/api/company/applications/9', { status: 'accepted' }), 400, 'VALIDATION');
expect('PATCH: пустое тело', await reg.patch('/api/company/applications/9', {}), 400, 'VALIDATION');
expect('PATCH 10: interview -> offer с оценкой', await reg.patch('/api/company/applications/10', { status: 'offer', score: 5, feedback: 'Great' }), 200);
const slotsAfter = expect('слоты вакансии 2', await reg.get('/api/company/vacancies/2/slots'), 200);
check('слот 9 занят Азизой', slotsAfter.find((s) => s.slotId === 9)?.isBooked === true && Boolean(slotsAfter.find((s) => s.slotId === 9)?.candidateName));
expect('слот в прошлом', await reg.post('/api/company/vacancies/2/slots', { startsAt: new Date(Date.now() - 3600e3).toISOString() }), 400, 'SLOT_IN_PAST');
expect('слот с мусорной датой', await reg.post('/api/company/vacancies/2/slots', { startsAt: 'tomorrow-ish' }), 400, 'VALIDATION');
const future = new Date(Date.now() + 20 * 864e5).toISOString();
expect('создание слота', await reg.post('/api/company/vacancies/2/slots', { startsAt: future, durationMin: 45, place: 'Zoom' }), 201);
expect('слот на то же время', await reg.post('/api/company/vacancies/2/slots', { startsAt: future }), 400, 'VALIDATION');
expect('удаление занятого слота 9', await reg.del('/api/company/slots/9'), 409, 'SLOT_BOOKED');
expect('удаление свободного слота 12', await reg.del('/api/company/slots/12'), 200);

// ---------- 8. D2: последнее место (T3) ----------
console.log('\n== D2: последнее место (T3)');
const bekzod = await login('bekzod@example.uz');
expect('чужая заявка (1) не принимается', await bekzod.post('/api/applications/1/accept'), 404, 'NOT_FOUND');
const acc = expect('Бекзод принимает оффер (заявка 2)', await bekzod.post('/api/applications/2/accept'), 200);
check('осталось 0 мест', acc.seatsLeft === 0);
expect('Азиза: мест нет', await aziza.post('/api/applications/1/accept'), 409, 'NO_SEATS');
const apps2 = (await aziza.get('/api/me/applications')).data;
check('ROLLBACK: заявка Азизы осталась offer', apps2.find((a) => a.applicationId === 1).status === 'offer');
check('ROLLBACK: её собеседование (заявка 8) не тронуто', apps2.find((a) => a.applicationId === 8).status === 'interview');
const v1closed = (await guest.get('/api/vacancies/1')).data;
check('вакансия 1: seats_left=0 и закрыта', v1closed.seatsLeft === 0 && v1closed.status === 'closed');
expect('повторное принятие', await bekzod.post('/api/applications/2/accept'), 409, 'INVALID_STATUS');
// T3, побочные эффекты: студент 6 принимает оффер на вакансию 12 -> его другая активная заявка (4) отзывается
const s6 = await login('sardor.nazar@example.uz');
const acc6 = expect('студент 6 принимает оффер (заявка 45)', await s6.post('/api/applications/45/accept'), 200);
check('T3: отозвана 1 другая заявка', acc6.withdrawnApplications === 1);
const s6apps = (await s6.get('/api/me/applications')).data;
check('T3: заявка 4 стала withdrawn', s6apps.find((a) => a.applicationId === 4).status === 'withdrawn');

// ---------- 9. Отказ, отзыв заявки, отзывы ----------
console.log('\n== Отказ, отзыв заявки, отзывы о стажировке');
expect('отзыв заявки 8 (было собеседование)', await aziza.post('/api/applications/8/withdraw'), 200);
const slotsFree = (await reg.get('/api/company/vacancies/2/slots')).data;
check('слот 9 снова свободен', slotsFree.find((s) => s.slotId === 9)?.isBooked === false);
expect('повторный отзыв', await aziza.post('/api/applications/8/withdraw'), 409, 'INVALID_STATUS');
expect('Азиза отказывается от оффера', await aziza.post('/api/applications/1/decline'), 200);
expect('повторный отказ', await aziza.post('/api/applications/1/decline'), 409, 'INVALID_STATUS');
expect('отзыв: рейтинг вне 1..5', await bekzod.post('/api/companies/1/reviews', { rating: 9 }), 400, 'VALIDATION');
expect('отзыв: нет принятой заявки', await aziza.post('/api/companies/1/reviews', { rating: 5 }), 403, 'REVIEW_NOT_ALLOWED');
expect('отзыв: неизвестная компания', await bekzod.post('/api/companies/999/reviews', { rating: 5 }), 404, 'NOT_FOUND');
expect('отзыв Бекзода о Registan Labs', await bekzod.post('/api/companies/1/reviews', { rating: 5, pros: 'Great mentor', tags: ['mentorship'], wouldRecommend: true }), 201);
expect('второй отзыв той же пары', await bekzod.post('/api/companies/1/reviews', { rating: 4 }), 409, 'REVIEW_EXISTS');

// ---------- 10. Аналитика ----------
console.log('\n== Аналитика');
const ov = expect('/stats/overview', await guest.get('/api/stats/overview'), 200);
check('KPI: числа', ov.openVacancies > 0 && ov.students === 41 && typeof ov.events7d === 'number' && typeof ov.acceptedPct === 'number');
const gap = expect('/stats/skills-gap', await guest.get('/api/stats/skills-gap'), 200);
check('разрыв навыков: дефицит по убыванию', gap.length > 30 && gap[0].deficit >= gap[1].deficit && 'searches' in gap[0]);
const fun = expect('/stats/funnel', await guest.get('/api/stats/funnel'), 200);
check('воронка: просмотры больше откликов', fun.views > fun.applications && fun.applications > fun.accepted);
const funB = expect('/stats/funnel?direction=backend', await guest.get('/api/stats/funnel?direction=backend'), 200);
check('воронка по направлению меньше общей', funB.views < fun.views && funB.views > 0);
expect('/stats/funnel: неверное направление', await guest.get('/api/stats/funnel?direction=x'), 400, 'VALIDATION');
check('/stats/cities', (await guest.get('/api/stats/cities')).data.length > 3);
check('/stats/activity', (await guest.get('/api/stats/activity')).data.length > 20);
const top = expect('/stats/top-companies', await guest.get('/api/stats/top-companies'), 200);
check('топ компаний: 5 шт., есть просмотры', top.length === 5 && top[0].views > 0);

// ---------- 11. События в Mongo пишутся после COMMIT ----------
console.log('\n== События в MongoDB');
await new Promise((r) => setTimeout(r, 800));   // события пишутся без await, даём им дойти
for (const type of ['apply', 'slot_booked', 'offer_accepted', 'vacancy_view']) {
  const n = await mdb.collection('events').countDocuments({ type, ts: { $gte: startedAt } });
  check(`событие ${type} записано`, n >= 1, `найдено ${n}`);
}
check('поиск попал в search_logs', (await mdb.collection('search_logs').countDocuments({ ts: { $gte: startedAt } })) >= 3);

// ---------- 11b. Админ-панель ----------
console.log('\n== Админ-панель');
expect('admin: гость -> 401', await guest.get('/api/admin/overview'), 401, 'UNAUTHORIZED');
expect('admin: студент -> 403', await aziza.get('/api/admin/overview'), 403, 'FORBIDDEN');
expect('admin: компания -> 403', await reg.get('/api/admin/users'), 403, 'FORBIDDEN');
const admin = await login('admin@example.uz');
const adminOv = expect('admin: обзор', await admin.get('/api/admin/overview'), 200);
check('admin: обзор считает роли и статусы', adminOv.users.admin === 1 && adminOv.users.student >= 40 && adminOv.vacancies.open > 0 && adminOv.applications.accepted >= 1 && adminOv.reviews > 0);
const usersAll = expect('admin: пользователи', await admin.get('/api/admin/users'), 200);
check('admin: пользователи, постранично по 20', usersAll.total >= 53 && usersAll.items.length === 20 && !('passwordHash' in usersAll.items[0]));
const usersQ = expect('admin: поиск по email', await admin.get('/api/admin/users?q=aziza'), 200);
check('admin: поиск нашёл Азизу', usersQ.total === 1 && usersQ.items[0].name === 'Aziza Karimova');
expect('admin: страница 0 -> 400', await admin.get('/api/admin/users?page=0'), 400, 'VALIDATION');
const vOpen = expect('admin: вакансии open', await admin.get('/api/admin/vacancies?status=open'), 200);
check('admin: фильтр по статусу', vOpen.items.length > 0 && vOpen.items.every((v) => v.status === 'open'));
expect('admin: неверный статус фильтра -> 400', await admin.get('/api/admin/vacancies?status=zzz'), 400, 'VALIDATION');
const target = vOpen.items[0].vacancyId;
expect('admin: закрыть вакансию', await admin.patch(`/api/admin/vacancies/${target}`, { status: 'closed' }), 200);
expect('admin: повторное закрытие -> 409', await admin.patch(`/api/admin/vacancies/${target}`, { status: 'closed' }), 409, 'INVALID_STATUS');
check('admin: закрытая вакансия пропала из каталога', (await guest.get(`/api/vacancies?q=${encodeURIComponent(vOpen.items[0].title)}`)).data.items.every((v) => v.vacancyId !== target));
expect('admin: открыть снова', await admin.patch(`/api/admin/vacancies/${target}`, { status: 'open' }), 200);
expect('admin: вакансия без мест не открывается (T3 её закрыл)', await admin.patch('/api/admin/vacancies/1', { status: 'open' }), 409, 'INVALID_STATUS');
expect('admin: статус draft недопустим -> 400', await admin.patch(`/api/admin/vacancies/${target}`, { status: 'draft' }), 400, 'VALIDATION');
expect('admin: несуществующая вакансия -> 404', await admin.patch('/api/admin/vacancies/999999', { status: 'closed' }), 404, 'NOT_FOUND');
const revs = expect('admin: отзывы', await admin.get('/api/admin/reviews'), 200);
check('admin: отзывы с названием компании', revs.total > 0 && revs.items.length === 20 && typeof revs.items[0].companyName === 'string');
const myReview = revs.items.find((r) => r.companyId === 1 && r.studentId === 2);   // тестовый отзыв этого прогона (раздел отзывов выше)
check('admin: виден отзыв, созданный студентом', Boolean(myReview));
if (myReview) {
  expect('admin: удалить отзыв', await admin.del(`/api/admin/reviews/${myReview.id}`), 200);
  expect('admin: повторное удаление -> 404', await admin.del(`/api/admin/reviews/${myReview.id}`), 404, 'NOT_FOUND');
}
expect('admin: мусорный id отзыва -> 404', await admin.del('/api/admin/reviews/abc'), 404, 'NOT_FOUND');
expect('admin: logout', await admin.post('/api/auth/logout'), 200);

// ---------- 12. Выход ----------
console.log('\n== Выход');
expect('logout', await aziza.post('/api/auth/logout'), 200);
expect('после logout /auth/me', await aziza.get('/api/auth/me'), 401, 'UNAUTHORIZED');

// Уборка тестовых данных Mongo (в PG всё вернёт следующий db:reset)
await mdb.collection('internship_reviews').deleteOne({ companyId: 1, studentId: 2 });
await mdb.collection('resumes').deleteMany({ studentId: { $gt: 40 } });

console.log(`\n${failed ? 'ПРОВАЛ' : 'ВСЁ ЗЕЛЁНОЕ'}: ${total - failed}/${total} проверок`);
process.exit(failed ? 1 : 0);
