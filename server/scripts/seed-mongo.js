// Пересоздаёт коллекции MongoDB и генерирует данные (SPEC §7). СТИРАЕТ ДАННЫЕ.
// Запуск: npm run seed:mongo [-- --cloud]
// ID студентов, вакансий и компаний читаем из PostgreSQL, поэтому они всегда совпадают с сидом PG.
// Генератор детерминированный (mulberry32 с фиксированным seed), даты считаются от текущего момента.
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import pg from 'pg';

const cloud = process.argv.includes('--cloud');

// Защита от потери данных: чужой хост только с явным --cloud
const mongoHost = new URL(process.env.MONGODB_URI).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(mongoHost) && !cloud) {
  console.error(`Отказ: MONGODB_URI указывает на "${mongoHost}", а не на localhost. Нужен флаг --cloud.`);
  process.exit(1);
}

// ---------- Детерминированный генератор ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261102);
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
// weighted([[значение, вес], ...]) — выбор с весами
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [v, w] of pairs) { if ((r -= w) < 0) return v; }
  return pairs[pairs.length - 1][0];
}
const DAY = 86400000;
// Время события: за последние 90 дней, к сегодняшнему дню активность растёт, пик днём и вечером
function randomTs(maxDays = 90) {
  const daysAgo = maxDays * (1 - Math.pow(rnd(), 0.6));
  const ts = new Date(Date.now() - daysAgo * DAY);
  const hour = Math.min(23, Math.max(0, Math.round(15 + (rnd() + rnd() + rnd() - 1.5) * 8)));
  ts.setHours(hour, int(0, 59), int(0, 59), 0);
  return ts > new Date() ? new Date(Date.now() - int(1, 3600) * 1000) : ts;
}

// ---------- Чтение справочников из PostgreSQL ----------
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});
const vacancies = (await pool.query(
  `SELECT v.vacancy_id AS id, v.company_id, v.title, v.direction, v.city, v.work_format AS format, v.is_paid AS paid, v.status,
          COALESCE(array_agg(s.name) FILTER (WHERE s.name IS NOT NULL), '{}') AS skills
   FROM vacancies v
   LEFT JOIN vacancy_skills vs ON vs.vacancy_id = v.vacancy_id
   LEFT JOIN skills s ON s.skill_id = vs.skill_id
   GROUP BY v.vacancy_id`)).rows;
const students = (await pool.query(
  `SELECT st.student_id AS id, st.user_id, st.full_name,
          COALESCE(array_agg(s.name) FILTER (WHERE s.name IS NOT NULL), '{}') AS skills
   FROM students st
   LEFT JOIN student_skills ss ON ss.student_id = st.student_id
   LEFT JOIN skills s ON s.skill_id = ss.skill_id
   GROUP BY st.student_id ORDER BY st.student_id`)).rows;
const skillNames = (await pool.query('SELECT name FROM skills ORDER BY skill_id')).rows.map((r) => r.name);
const companyIds = (await pool.query('SELECT company_id FROM companies ORDER BY company_id')).rows.map((r) => r.company_id);
const accepted = (await pool.query(
  `SELECT DISTINCT v.company_id, a.student_id FROM applications a JOIN vacancies v ON v.vacancy_id = a.vacancy_id
   WHERE a.status = 'accepted'`)).rows;
await pool.end();

// ---------- events (60 000) ----------
// Популярность вакансий неравномерная: у каждой свой вес по «рангу» (закон Ципфа), черновики не показываем.
const visible = vacancies.filter((v) => v.status !== 'draft');
const shuffled = [...visible].sort(() => rnd() - 0.5);
const vacancyWeights = shuffled.map((v, k) => [v, (v.status === 'open' ? 1 : 0.25) / Math.pow(k + 1, 0.8)]);

const EVENT_TYPES = [['vacancy_view', 70], ['company_view', 5], ['apply', 15], ['slot_booked', 7], ['offer_accepted', 3]];
const events = [];
for (let i = 0; i < 60000; i++) {
  const type = weighted(EVENT_TYPES);
  const v = weighted(vacancyWeights);
  // Бронь, отклик и принятие оффера возможны только у залогиненного студента; просмотры бывают и у гостей
  const isStudent = type !== 'vacancy_view' && type !== 'company_view' ? true : rnd() < 0.6;
  const student = isStudent ? pick(students) : null;
  events.push({
    type,
    userId: student ? student.user_id : null,
    role: student ? 'student' : 'guest',
    vacancyId: type === 'company_view' ? null : v.id,
    companyId: v.company_id,
    direction: v.direction,
    city: v.city,
    device: weighted([['mobile', 65], ['desktop', 30], ['tablet', 5]]),
    ts: randomTs(90),
  });
}

// ---------- search_logs (30 000) ----------
// История для дашборда: студенты ищут Python, React и UI/UX; вакансии же требуют SQL, Git, Docker.
const SEARCH_BOOST = { Python: 12, React: 10, 'UI/UX': 9, JavaScript: 6, Figma: 5, Java: 4, Flutter: 4, Excel: 3, 'Machine Learning': 3, Kotlin: 2 };
const skillWeights = skillNames.map((n) => [n, SEARCH_BOOST[n] || 1]);
const QUERY_WORDS = ['intern', 'стажировка', 'junior', 'amaliyot', 'remote', 'backend', 'дизайн', 'dasturchi', 'аналитик', 'internship'];
const openVacancies = vacancies.filter((v) => v.status === 'open');
const searchLogs = [];
for (let i = 0; i < 30000; i++) {
  const skills = [];
  if (rnd() < 0.6) {
    skills.push(weighted(skillWeights));
    if (rnd() < 0.25) { const s2 = weighted(skillWeights); if (s2 !== skills[0]) skills.push(s2); }
  }
  const filters = {
    direction: rnd() < 0.3 ? pick(['frontend', 'backend', 'mobile', 'data', 'design', 'qa', 'devops', 'pm']) : null,
    city: rnd() < 0.35 ? weighted([['Tashkent', 6], ['Samarkand', 2], ['Bukhara', 1], ['Fergana', 1], ['Andijan', 1]]) : null,
    format: rnd() < 0.2 ? pick(['office', 'remote', 'hybrid']) : null,
    paid: rnd() < 0.25 ? true : null,
    skills,
  };
  const q = rnd() < 0.4 ? (skills.length && rnd() < 0.5 ? skills[0].toLowerCase() : pick(QUERY_WORDS)) : '';
  // results — сколько открытых вакансий реально подошло бы под фильтры (считаем по данным PG)
  const results = openVacancies.filter((v) =>
    (!filters.direction || v.direction === filters.direction) &&
    (!filters.city || v.city === filters.city) &&
    (!filters.format || v.format === filters.format) &&
    (!filters.paid || v.paid) &&
    skills.every((s) => v.skills.includes(s)) &&
    (!q || v.title.toLowerCase().includes(q) || v.skills.some((s) => s.toLowerCase() === q))).length;
  const student = rnd() < 0.55 ? pick(students) : null;
  searchLogs.push({
    q, filters, results,
    userId: student ? student.user_id : null,
    lang: weighted([['ru', 60], ['uz', 25], ['en', 15]]),
    ts: randomTs(90),
  });
}

// ---------- resumes (по одному на студента) ----------
const PROJECTS = ['Телеграм-бот для расписания', 'Сайт-портфолио', 'Учёт расходов', 'Интернет-магазин (учебный)', 'Анализ данных опроса',
  'Мобильное приложение для заметок', 'Парсер вакансий', 'Игра «Змейка»', 'Дашборд продаж', 'API для библиотеки'];
const CERTS = ['Основы SQL', 'Web Development Bootcamp', 'English B2', 'Python для начинающих', 'Основы UI/UX', 'Git и GitHub', 'Scrum Foundation'];
const resumes = students.map((s, idx) => {
  const projectCount = idx % 5 === 0 ? 0 : int(1, 4);       // структура у всех разная: у части только «о себе»
  const certCount = idx % 7 === 0 ? 0 : int(0, 2);
  const doc = {
    studentId: s.id,
    about: `Студент, интересуюсь разработкой. Навыки: ${s.skills.slice(0, 3).join(', ') || 'осваиваю основы'}.`,
    languages: [{ code: 'uz', level: 'native' }, { code: 'ru', level: pick(['B1', 'B2', 'C1']) }],
    updatedAt: randomTs(60),
  };
  if (rnd() < 0.8) doc.languages.push({ code: 'en', level: pick(['A2', 'B1', 'B2']) });
  if (projectCount) {
    doc.projects = Array.from({ length: projectCount }, () => ({
      title: pick(PROJECTS),
      url: rnd() < 0.7 ? `https://github.com/example-student-${s.id}/project-${int(1, 20)}` : null,
      stack: s.skills.length ? Array.from({ length: int(1, Math.min(3, s.skills.length)) }, () => pick(s.skills)) : [],
    }));
  }
  if (certCount) doc.certificates = Array.from({ length: certCount }, () => ({ name: pick(CERTS), year: int(2023, 2026) }));
  return doc;
});

// ---------- internship_reviews (~40) ----------
// Настоящие отзывы идут от студентов с accepted-заявкой (SPEC §6.5). Их в сиде PG всего 4, поэтому остальные
// ~36 — «исторические» отзывы прошлых наборов: пары (компания, студент) выбраны случайно и в PG не подтверждены.
// Демо-студентов 1 и 2 не трогаем: Азиза и Бекзод должны суметь оставить отзыв сами на демо.
const PROS = ['Хороший наставник', 'Реальные задачи', 'Дружная команда', 'Гибкий график', 'Помогли с резюме', 'Современный стек'];
const CONS = ['Мало времени на вопросы', 'Скромная стипендия', 'Долгий отклик на старте', 'Много рутины', 'Нет парковки'];
const TAGS = ['mentorship', 'real-tasks', 'friendly', 'flexible', 'paid-on-time', 'learning', 'fast-feedback'];
const companyBias = Object.fromEntries(companyIds.map((id) => [id, 2.6 + rnd() * 2]));   // у каждой компании свой «средний» рейтинг
const used = new Set();
const reviews = [];
function addReview(companyId, studentId) {
  const key = `${companyId}:${studentId}`;
  if (used.has(key)) return false;
  used.add(key);
  const rating = Math.max(1, Math.min(5, Math.round(companyBias[companyId] + (rnd() - 0.5) * 2)));
  reviews.push({
    companyId, studentId, rating,
    pros: pick(PROS),
    cons: rating >= 4 && rnd() < 0.4 ? '' : pick(CONS),
    tags: Array.from(new Set(Array.from({ length: int(1, 3) }, () => pick(TAGS)))),
    wouldRecommend: rating >= 3,
    createdAt: randomTs(80),
  });
  return true;
}
for (const a of accepted) addReview(a.company_id, a.student_id);
while (reviews.length < 40) {
  const s = students[int(2, students.length - 1)];            // индекс 2+ пропускает студентов 1 и 2
  addReview(pick(companyIds), s.id);
}

// ---------- Запись в MongoDB ----------
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'shogird');

async function reload(name, docs) {
  await db.collection(name).drop().catch(() => {});            // коллекции может не быть при первом запуске
  for (let i = 0; i < docs.length; i += 10000) await db.collection(name).insertMany(docs.slice(i, i + 10000));
  console.log(`${name}: ${docs.length}`);
}
await reload('events', events);
await reload('search_logs', searchLogs);
await reload('resumes', resumes);
await reload('internship_reviews', reviews);

// Индексы создаём после вставки: так быстрее. Те же индексы описаны в mongo/01_setup.mongodb.js.
await db.collection('events').createIndexes([{ key: { type: 1, ts: -1 } }, { key: { vacancyId: 1 } }]);
await db.collection('search_logs').createIndexes([{ key: { ts: -1 } }, { key: { 'filters.skills': 1 } }]);
await db.collection('resumes').createIndex({ studentId: 1 }, { unique: true });
await db.collection('internship_reviews').createIndexes([
  { key: { companyId: 1, createdAt: -1 } },
  { key: { companyId: 1, studentId: 1 }, unique: true },
]);
console.log('Индексы созданы');
await client.close();
