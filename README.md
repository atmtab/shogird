# Shogird: платформа стажировок для студентов и IT-компаний Узбекистана

Студент находит стажировку, видит «процент совпадения» со своими навыками, откликается и бронирует время собеседования. Компания ведёт кандидатов по воронке и выдаёт офферы. На главной странице «Аналитика» показан **разрыв навыков**: чего ищут студенты, что требуют вакансии и что реально умеют студенты.

Проект сделан по гайду курса *Big Data* (`docs/BigData_3Week_Project_Guide.pdf`): две базы данных (PostgreSQL и MongoDB), транзакции, индексы с замерами `EXPLAIN`, облачный деплой.

**Живой сайт:** https://shogird.onrender.com (бесплатный тариф Render засыпает после ~15 минут простоя, первый запрос после паузы занимает до минуты)

- `SPEC.md` описывает, что строим. `CLAUDE.md` описывает, как строим. `docs/NOTES.md` хранит решения, замеры и открытые вопросы.
- Интерфейс на трёх языках: русский, узбекский (латиница) и английский.

---

## Содержание
1. [Быстрый старт](#1-быстрый-старт-windows)
2. [Демо-аккаунты и сценарии](#2-демо-аккаунты-и-сценарии)
3. [Архитектура](#3-архитектура)
4. [Структура репозитория](#4-структура-репозитория)
5. [База данных PostgreSQL](#5-база-данных-postgresql)
6. [Транзакции T1–T5](#6-транзакции-t1t5)
7. [MongoDB](#7-mongodb)
8. [Индексы и EXPLAIN](#8-индексы-и-explain)
9. [API](#9-api)
10. [Фронтенд](#10-фронтенд)
11. [Команды npm](#11-команды-npm)
12. [Проверка](#12-проверка)
13. [Деплой: Supabase, Atlas, Render](#13-деплой-supabase-atlas-render)
14. [Скриншоты](#14-скриншоты)
15. [Ответы на вопросы защиты](#15-ответы-на-вопросы-защиты)
16. [Ограничения](#16-ограничения)

---

## 1. Быстрый старт (Windows)

**Нужно установить:** Node.js 20+, PostgreSQL 16/17 и MongoDB Community Server (обе как службы: `localhost:5432` и `localhost:27017`). Для запросов к Mongo вручную нужен `mongosh`, для SQL вручную `psql` (оба необязательны для запуска сайта).

```bash
cd server
npm install
copy .env.example .env        # в PowerShell и cmd. Затем впишите пароль PostgreSQL в DATABASE_URL
npm run db:create             # создать базу shogird, если её нет
npm run db:reset              # схема + сид (СТИРАЕТ данные в базе)
npm run seed:mongo            # Mongo: события, поиски, резюме, отзывы (СТИРАЕТ данные)
npm run dev                   # http://localhost:3000
```

Проверка: http://localhost:3000/api/health вернёт `{"ok":true, ...}`.

Порядок важен: `seed:mongo` читает ID студентов, вакансий и компаний из PostgreSQL, поэтому сначала `db:reset`.

### Переменные окружения (`server/.env`)

| Переменная | Значение |
|---|---|
| `DATABASE_URL` | `postgres://postgres:ПАРОЛЬ@localhost:5432/shogird` |
| `PGSSL` | `false` локально, `true` для Supabase |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` локально или строка `mongodb+srv://…` для Atlas |
| `MONGODB_DB` | `shogird` |
| `JWT_SECRET` | длинная случайная строка (сервер без неё не запускается) |
| `NODE_ENV` | `development` или `production` |
| `PORT` | `3000` (на Render не задаётся, Render сам определяет порт) |

Файл `.env` не попадает в git. Случайный секрет можно получить так: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

### Защита от потери данных
`db:reset` и `seed:mongo` отказываются работать, если `DATABASE_URL` или `MONGODB_URI` указывают не на `localhost` или `127.0.0.1`. Для облака нужен явный флаг `--cloud` (например, `npm run seed:mongo -- --cloud`). Используйте его только осознанно: команды стирают таблицы и коллекции.

---

## 2. Демо-аккаунты и сценарии

Пароль у всех демо-аккаунтов: `Shogird2026!`

| Роль | Email | Кто это |
|---|---|---|
| Студент | `aziza@example.uz` | Азиза, 6 навыков, сценарии D1 и D2 |
| Студент | `bekzod@example.uz` | Бекзод, сценарий D2 |
| Компания | `hr@registanlabs.example.uz` | Registan Labs |
| Админ | `admin@example.uz` | Админ-панель (раздел 9.1) |

Все компании и люди в сиде вымышленные, email только на `example.uz`.

### Сценарии
- **D1. Бронь слота (T2).** Азиза → «Кабинет» → «Мои заявки» → у заявки *Frontend Intern (React)* кнопка «Выбрать время» → выбрать слот. Статус станет «Собеседование».
- **D2. Последнее место (T3).** На *Junior Backend Intern* (Registan Labs) осталось 1 место, у Азизы и Бекзода статус «Оффер». Первый, кто нажмёт «Принять оффер», получает место, второй видит «Мест больше нет» (`409 NO_SEATS`), данные не меняются.
- **D3. Занятый слот.** Попытка забронировать уже занятый слот (например, через Thunder Client или `curl`) даёт `409 SLOT_TAKEN`.
- **D4. Воронка компании.** Registan Labs → «Кабинет» → «Кандидаты» → выбрать вакансию → двигать кандидатов: «В шорт-лист», «Оффер», «Отказ».

> **Порядок D1 + D2.** Оффер сначала принимает **Бекзод**, потом Азиза получает `NO_SEATS`. Если первой примет оффер Азиза, по правилу T3 её собеседование из D1 автоматически отменится: принять можно только один оффер.

> **Сброс демо.** После показа данные изменены. Чтобы начать заново, локально выполните `npm run db:reset` и `npm run seed:mongo`. В облаке то же делается только с флагом `--cloud` и с вашего ведома.

> **Сроки вакансий.** Дедлайны в сиде заданы как «сегодня + N дней», поэтому через 15–50 дней вакансии начнут исчезать из каталога. Запускайте `db:reset` непосредственно перед показом.

---

## 3. Архитектура

```
Браузер (HTML + CSS + JS, fetch)
        │  JSON, httpOnly cookie shogird_token
        ▼
Express 4 (server/src): роуты → lib/ (валидация, статусы, match, события)
        │                          │
        ▼                          ▼
PostgreSQL (Supabase)         MongoDB (Atlas M0)
структурные данные            события, поиски, резюме, отзывы
транзакции, ограничения       гибкая структура, большие объёмы
```

**Что где лежит и почему**

| PostgreSQL | MongoDB |
|---|---|
| users, universities, students, companies, skills, student_skills, vacancies, vacancy_skills, applications, interview_slots, interviews | `events`, `search_logs`, `resumes`, `internship_reviews` |
| Нужны связи, уникальность, транзакции и ограничения целостности | Нужны быстрый поток записей, гибкая структура документа и агрегации |

Числовые ID в Mongo (`studentId`, `vacancyId`, `companyId`) совпадают с ID в PostgreSQL.

**Принципы кода**
- Стек: Node.js 20+, Express 4, ES-модули, **без TypeScript и без сборки**. Зависимости: `express`, `pg`, `mongodb`, `dotenv`, `bcryptjs`, `jsonwebtoken`, `cookie-parser`.
- SQL только параметризованный (`$1, $2…`). Деньги в `NUMERIC(12,2)`. `SELECT *` в роутах нет.
- Проверка и изменение выполняются **одним** запросом (`UPDATE … WHERE seats_left > 0`), а не `SELECT`, а потом `UPDATE`.
- События аналитики пишутся в Mongo **после** `COMMIT` и **без** `await`: сбой логирования не ломает запрос пользователя.
- Каждый async-роут обёрнут в `wrap()`, ошибки отдаются как `{ error, code }`.
- Комментарии в коде на русском и объясняют *почему*.

---

## 4. Структура репозитория

```
shogird/
├── SPEC.md, CLAUDE.md, README.md
├── docs/
│   ├── NOTES.md                решения, замеры, открытые вопросы
│   ├── er_diagram.png          ER-диаграмма PostgreSQL
│   ├── report/                 скриншоты
│   └── BigData_3Week_Project_Guide.pdf
├── sql/
│   ├── 01_schema.sql           схема (перезапускаемая)
│   ├── 02_seed.sql             сид + демо-сценарии D1–D4
│   ├── 03_queries.sql          20 учебных запросов (JOIN, GROUP BY, подзапросы, CTE, оконные)
│   └── 04_big_data.sql         500 000 строк + EXPLAIN до и после индекса
├── mongo/
│   ├── 01_setup.mongodb.js     коллекции и индексы
│   └── 02_queries.mongodb.js   12 запросов и агрегаций
└── server/
    ├── package.json, .env.example
    ├── scripts/                db-create, run-sql, seed-mongo, smoke, i18n-check, hash-password
    ├── src/
    │   ├── server.js           тонкий файл: подключает роуты
    │   ├── db.js               pool, withTransaction(), клиент Mongo
    │   ├── middleware/auth.js  cookie + JWT, requireRole
    │   ├── lib/                errors, validate, statuses, match, events, util, constants
    │   └── routes/             auth, catalog, student, company, stats
    └── public/                 фронтенд: 7 страниц, pages/*.js, app.js, i18n.js, style.css
```

---

## 5. База данных PostgreSQL

ER-диаграмма: ![ER](docs/er_diagram.png)

- **11 таблиц.** Две связи «многие ко многим»: студенты ↔ навыки (`student_skills`, уровень 1–5) и вакансии ↔ навыки (`vacancy_skills`, обязательный навык или «будет плюсом»).
- **Ограничения целостности:** `CHECK (seats_left BETWEEN 0 AND seats)`, `CHECK (is_paid OR stipend IS NULL)`, `CHECK` на роли, статусы, направления, курс, оценку и формат телефона, `UNIQUE (vacancy_id, student_id)` (одна заявка на вакансию), `UNIQUE (vacancy_id, starts_at)`.
- **Частичные уникальные индексы** `uq_interviews_slot_active` и `uq_interviews_application_active` (`WHERE status <> 'cancelled'`): вторая линия защиты от двойной брони. Отменённое собеседование освобождает слот и заявку.
- **Статусы заявки:** `submitted → shortlisted → interview → offer → accepted`, а также `declined`, `rejected`, `withdrawn`. Допустимые переходы описаны в одном месте: `server/src/lib/statuses.js`.
- **Процент совпадения** (`lib/match.js`): обязательный навык весит 1, «будет плюсом» 0,5. Процент равен сумме весов навыков студента, делённой на сумму весов всех навыков вакансии.

---

## 6. Транзакции T1–T5

Шаблон везде один (`withTransaction()` в `db.js`): `connect → BEGIN → … → COMMIT`; в `catch` `ROLLBACK` и повторный `throw`; в `finally` `release`.

| № | Операция | Суть |
|---|---|---|
| T1 | Регистрация | `INSERT users` + `INSERT students/companies`. Дубликат email откатывает всё, ответ `409 EMAIL_TAKEN` |
| T2 | **Бронь слота** | `SELECT … FOR UPDATE` заявки → `UPDATE interview_slots SET is_booked = true WHERE … AND is_booked = false AND starts_at > now()` → `INSERT interviews` → статус заявки `interview`. 0 затронутых строк → `ROLLBACK`, `409 SLOT_TAKEN` |
| T3 | **Принять оффер** | `FOR UPDATE` заявки → `UPDATE vacancies SET seats_left = seats_left - 1 … WHERE seats_left > 0` → заявка `accepted` → остальные активные заявки студента `withdrawn`, их собеседования `cancelled`, слоты освобождены. 0 строк → `ROLLBACK`, `409 NO_SEATS` |
| T4 | Сохранение вакансии | `INSERT/UPDATE vacancies` + замена `vacancy_skills` |
| T5 | Навыки студента | `DELETE student_skills` + `INSERT` |

**Почему проверка внутри `UPDATE`, а не отдельным `SELECT`.** Между `SELECT` и `UPDATE` другой запрос может занять то же место или слот. Условие `WHERE seats_left > 0` проверяется и применяется атомарно, а `FOR UPDATE` сериализует конкурентные действия над одной заявкой. Проверено гонкой: два параллельных `accept` дают `[200, 409 NO_SEATS]`.

---

## 7. MongoDB

| Коллекция | Что хранит | Индексы |
|---|---|---|
| `events` | Просмотры вакансий, отклики, брони, принятые офферы | `{type, ts}`, `{vacancyId}` (индекс `{direction, type}` создаётся в демо-замере, раздел 8) |
| `search_logs` | Каждый поиск по каталогу: запрос, фильтры, число результатов | `{ts}`, `{filters.skills}` |
| `resumes` | Резюме студентов: проекты, опыт, ссылки (гибкая структура) | `{studentId}` (уникальный) |
| `internship_reviews` | Отзывы студентов о стажировках | `{companyId, createdAt}`, `{companyId, studentId}` (уникальный) |

В сиде: 60 000 событий, 30 000 поисков, 40 резюме, 40 отзывов. Генераторы детерминированные (фиксированный PRNG), даты задаются относительно текущего момента.

Аналитика «разрыв навыков» объединяет обе базы: сколько раз навык искали (Mongo, `$unwind` по `filters.skills`), сколько открытых вакансий его требуют и сколько студентов им владеют (PostgreSQL). Дефицит равен спросу вакансий минус предложению студентов.

Запросы вручную: `mongosh mongodb://127.0.0.1:27017/shogird --file mongo/02_queries.mongodb.js`.

---

## 8. Индексы и EXPLAIN

**PostgreSQL** (`sql/04_big_data.sql`): запрос «backend-заявки в Ташкенте за 30 дней» по таблице из 500 000 строк.

| | План | Время выполнения |
|---|---|---|
| До индекса | Parallel Seq Scan | 68,4 мс |
| После индекса `(direction, city, applied_at)` | Bitmap Index Scan | 1,0 мс |

**MongoDB** (`events.find({direction: 'backend', type: 'apply'})`):

| | План | Просмотрено документов | Время |
|---|---|---|---|
| До индекса `{direction, type}` | IXSCAN по `{type, ts}` | 8 896 | 17 мс |
| После | IXSCAN по `{direction, type}` | 1 145 | 4 мс |

Цифры взяты из локального замера на этой машине. Время зависит от железа и от того, прогрет ли кэш, но порядок разницы повторяется. Индекс ускоряет чтение, но замедляет запись и занимает место, поэтому индексы стоят на частых фильтрах и внешних ключах, а не на всех колонках.

Запустить замер самому: `npm run db:bigdata` (около 7 секунд, создаёт архивную таблицу, не трогает остальные).

---

## 9. API

Базовый путь `/api`. Авторизация через httpOnly cookie `shogird_token` (JWT, 7 дней, `sameSite=lax`, `secure` в production). Ответы в формате JSON, поля в camelCase.

### Публичные
| Метод и путь | Описание |
|---|---|
| `GET /api/health` | Состояние PG и Mongo: `{ ok, postgresTime, mongoEvents }` |
| `GET /api/meta` | Навыки, вузы, города, направления для фильтров и форм |
| `GET /api/vacancies?q&direction&city&format&paid&skill&resident&page` | Каталог, 12 на страницу. Поиск пишется в `search_logs` |
| `GET /api/vacancies/:id` | Вакансия, компания, навыки, просмотры и рейтинг; для студента ещё `matchPct` и статус заявки |
| `GET /api/companies/:id` | Профиль компании, вакансии, отзывы |
| `GET /api/stats/overview` · `skills-gap` · `funnel?direction=` · `cities` · `activity` · `top-companies` | Аналитика |

### Аутентификация
`POST /api/auth/register` (T1) · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me`. Для гостя `me` отвечает `401`; с параметром `?optional=true` отвечает `200 null` (так на страницах гостя нет красных ошибок в консоли).

### Студент (роль `student`)
`GET/PUT /api/me/profile` · `PUT /api/me/skills` (T5) · `GET/PUT /api/me/resume` · `GET /api/me/recommendations` · `POST /api/vacancies/:id/apply` · `GET /api/me/applications` · `GET /api/applications/:id/slots` · `POST /api/applications/:id/book` (T2) · `POST /api/applications/:id/accept` (T3) · `POST /api/applications/:id/decline` · `POST /api/applications/:id/withdraw` · `POST /api/companies/:id/reviews`

### Компания (роль `company`)
`GET/POST /api/company/vacancies` (T4) · `PUT/DELETE /api/company/vacancies/:id` (T4; `DELETE` закрывает вакансию, не удаляет) · `GET /api/company/vacancies/:id/applications` (кандидаты, сортировка по %) · `PATCH /api/company/applications/:id` · `GET/POST /api/company/vacancies/:id/slots` · `DELETE /api/company/slots/:id`

Компания видит только свои сущности: на чужой ID отвечает `404`.

### 9.1 Админ-панель
Войдите как `admin@example.uz` (пароль демо-аккаунтов): после входа откроется `admin.html`, в шапке пункт «Админка». Вкладки:
- **Обзор:** пользователи по ролям, вакансии и заявки по статусам, число отзывов.
- **Пользователи:** список с поиском по email (только просмотр).
- **Вакансии:** все вакансии (в том числе черновики и закрытые) с фильтром по статусу; кнопки «Закрыть» и «Открыть снова». Вакансию без свободных мест открыть нельзя.
- **Отзывы:** отзывы из MongoDB, можно удалить.

Роуты: `GET /api/admin/overview`, `GET /api/admin/users?q&page`, `GET /api/admin/vacancies?status&page`, `PATCH /api/admin/vacancies/:id`, `GET /api/admin/reviews?page`, `DELETE /api/admin/reviews/:id`. Все доступны только роли `admin` (гость получает 401, студент и компания 403). Схема БД не менялась, поэтому блокировки пользователей нет.

### Ошибки
Формат `{ "error": "текст", "code": "КОД" }`. Фронтенд показывает `t('err.' + code)` на языке пользователя.

| Статус | Коды |
|---|---|
| 400 | `VALIDATION`, `SLOT_IN_PAST` |
| 401 | `UNAUTHORIZED`, `INVALID_CREDENTIALS` |
| 403 | `FORBIDDEN`, `REVIEW_NOT_ALLOWED` |
| 404 | `NOT_FOUND` |
| 409 | `EMAIL_TAKEN`, `ALREADY_APPLIED`, `VACANCY_CLOSED`, `DEADLINE_PASSED`, `INVALID_STATUS`, `SLOT_TAKEN`, `SLOT_BOOKED`, `NO_SEATS`, `REVIEW_EXISTS` |
| 500 | `SERVER_ERROR` |

### Примеры
```bash
# Вход и сохранение cookie
curl -c jar.txt -X POST https://shogird.onrender.com/api/auth/login \
  -H "content-type: application/json" \
  -d '{"email":"aziza@example.uz","password":"Shogird2026!"}'

# Рекомендации для студента
curl -b jar.txt https://shogird.onrender.com/api/me/recommendations

# Каталог с фильтрами
curl "https://shogird.onrender.com/api/vacancies?direction=backend&city=Tashkent"
```

---

## 10. Фронтенд

Чистые HTML, CSS и JS (ES-модули), без фреймворков, без сборки и без Chart.js: графики сделаны на CSS-полосах.

| Страница | Для кого | Содержимое |
|---|---|---|
| `admin.html` | админ | Обзор, пользователи, модерация вакансий и отзывов |
| `index.html` | все | Каталог, поиск, фильтры, карточки с % совпадения, пагинация |
| `vacancy.html?id=` | все | Описание, навыки (свои подсвечены), места, форма отклика |
| `company.html?id=` | все | Публичный профиль компании, вакансии, отзывы |
| `dashboard.html` | все | KPI, разрыв навыков, воронка, города, активность, топ компаний |
| `auth.html` | гость | Вход и регистрация (студент или компания) |
| `student.html` | студент | Профиль и навыки, резюме, заявки (бронь, оффер, отзыв), рекомендации |
| `company-panel.html` | компания | Вакансии, кандидаты (статусы, оценка), слоты |

- **Три языка** (RU, UZ, EN) переключаются без перезагрузки страницы. Выбор хранится в `localStorage['shogird.lang']` (единственное, что хранится в `localStorage`; токен в JS не попадает).
- Весь текст интерфейса берётся из словаря `public/i18n.js` (270 ключей на каждый язык). Узбекский написан латиницей с символом ʻ. Проверка: `npm run i18n:check`.
- Любой текст из базы вставляется в `innerHTML` только через `esc()`.
- Mobile-first: верстка проверена на ширине 360 px, без горизонтального скролла.
- Шрифт Manrope подключается с Google Fonts; без интернета работает системный шрифт.

---

## 11. Команды npm

Запускаются из папки `server/`.

| Команда | Что делает |
|---|---|
| `npm install` | Ставит зависимости |
| `npm run dev` | Сервер с автоперезапуском, http://localhost:3000 |
| `npm start` | Сервер без перезапуска (для Render) |
| `npm run db:create` | Создаёт базу `shogird`, если её нет |
| `npm run db:reset` | `01_schema.sql` + `02_seed.sql`. **Стирает данные** |
| `npm run db:bigdata` | `04_big_data.sql`: 500 000 строк и EXPLAIN до/после индекса |
| `npm run seed:mongo` | Пересоздаёт коллекции Mongo и генерирует данные. **Стирает данные** |
| `npm run smoke` | Сквозная проверка API (сервер должен быть запущен; сам делает `db:reset`, только localhost) |
| `npm run i18n:check` | Сверка словарей ru/uz/en и использования ключей в коде |

Все команды кроссплатформенные (без `rm`, `cp`, `VAR=x cmd`).

---

## 12. Проверка

- **`npm run smoke`:** 172 проверки API (включая админ-панель), проходит сценарии D1–D4 и коды 200/201/400/401/403/404/409.
- **Гонка за последнее место:** два параллельных `accept` дают `[200, 409 NO_SEATS]`.
- **`npm run i18n:check`:** одинаковые ключи и плейсхолдеры во всех языках, ключи из кода есть в словаре.
- **Браузер (Chrome, эмуляция 360 px):** 36 сочетаний «страница или вкладка × язык»: нет «сырых» ключей, нет горизонтального скролла, консоль чистая. Сценарии D1 и D2 пройдены в браузере.
- **Облако:** `GET /api/health` отвечает `ok`, вход, каталог, рекомендации и аналитика работают на https://shogird.onrender.com.

Не проверялось: реальные телефоны, Safari и Firefox. Узбекские и английские тексты не вычитывал носитель языка.

---

## 13. Деплой: Supabase, Atlas, Render

1. **Supabase (PostgreSQL).** Создать проект. Подключаться через **Session pooler** (хост `…pooler.supabase.com`, порт `5432`, логин `postgres.<project-ref>`). Прямой хост `db.<ref>.supabase.co` работает только по IPv6 и из Render недоступен. Порт `6543` (Transaction pooler) не подходит: он ломает `BEGIN … COMMIT`. Схему и сид залить так: `npm run db:reset -- --cloud` с облачным `DATABASE_URL` и `PGSSL=true`, либо выполнить `01_schema.sql` и `02_seed.sql` в SQL Editor.
2. **MongoDB Atlas (M0).** Создать кластер и пользователя с паролем из букв и цифр. **Network Access: `0.0.0.0/0`** (у бесплатного Render нет постоянного IP; без этой записи Mongo молча не отвечает, а в `/api/health` будет `mongoEvents: null`). Данные: `npm run seed:mongo -- --cloud` с облачными `DATABASE_URL` и `MONGODB_URI`.
3. **Render (Web Service).** Репозиторий с GitHub, **Root Directory** `server`, **Build** `npm install`, **Start** `npm start`. Переменные: `DATABASE_URL`, `PGSSL=true`, `MONGODB_URI`, `MONGODB_DB=shogird`, `JWT_SECRET`, `NODE_ENV=production`. `PORT` не задавать. В коде включён `app.set('trust proxy', 1)`, без него `secure`-cookie за прокси Render не работает.
4. **План Б** на случай проблем с сетью: `cloudflared tunnel --url http://localhost:3000`.

Секреты (пароли баз, `JWT_SECRET`) хранятся только в `.env` и в переменных Render, в git их нет. Если пароль где-то засветился, сбросьте его в панели Supabase или Atlas и обновите переменную в Render.

---

## 14. Скриншоты

Снимки публичного сайта на ширине 360 px лежат в `docs/report/`:

| Файл | Что на нём |
|---|---|
| `01-catalog-ru.png`, `01-catalog-uz.png`, `01-catalog-en.png` | Каталог на трёх языках |
| `02-vacancy.png` | Карточка вакансии |
| `03-company.png` | Профиль компании |
| `04-dashboard.png` | Дашборд: разрыв навыков, воронка, города, активность |
| `05-student-profile.png`, `06-student-applications.png`, `07-student-recommendations.png` | Кабинет студента |
| `08-company-vacancies.png`, `09-company-candidates.png` | Кабинет компании |
| `10-catalog-desktop.png` | Каталог на ширине 1280 px |

---

## 15. Ответы на вопросы защиты

- **Зачем частичный уникальный индекс, если есть `is_booked`?** `is_booked` защищает на уровне запроса, индекс гарантирует то же на уровне базы, даже если в будущем появится другой путь записи. Частичный, потому что отменённое собеседование не должно блокировать слот и заявку.
- **Что, если два студента принимают последнее место одновременно?** Оба запроса доходят до `UPDATE … WHERE seats_left > 0`. Строка блокируется, второй видит `seats_left = 0`, получает 0 затронутых строк, транзакция откатывается и клиент получает `409 NO_SEATS`. Проверено тестом.
- **Почему `seats_left > 0` внутри `UPDATE`, а не отдельным `SELECT`?** Между `SELECT` и `UPDATE` состояние может измениться (гонка). Условие в `UPDATE` атомарно.
- **Почему события пишутся в Mongo после COMMIT и без `await`?** Откатившаяся транзакция не должна оставлять событий, а сбой логирования не должен ломать ответ пользователю.
- **Почему JWT в httpOnly cookie, а не в `localStorage`?** Скрипт на странице (при XSS) не может прочитать httpOnly cookie. `sameSite=lax` защищает от межсайтовых запросов.
- **Как считается match score?** Взвешенно: обязательный навык 1, «будет плюсом» 0,5; процент равен весу найденных навыков, делённому на общий вес (раздел 5).
- **Почему поисковые запросы в Mongo?** Это поток записей с гибкой структурой фильтров (разный набор полей и массив навыков), для него удобны документы и агрегация `$unwind`.
- **Что ускоряет индекс и что он замедляет?** Ускоряет выборки по условию (68 мс → 1 мс на 500 000 строк). Замедляет вставки и обновления и занимает место.
- **Почему деньги в `NUMERIC`, а не во `FLOAT`?** `FLOAT` даёт ошибки округления, `NUMERIC(12,2)` хранит точное значение.

---

## 16. Ограничения

- Админ-панель минимальная (без блокировки пользователей), нет сброса пароля, подтверждения email и ограничения числа попыток входа (по SPEC §15 это вне объёма; админ-панель добавлена отдельно, см. 9.1). Для защиты от перебора пароля в production стоило бы добавить rate limit.
- Статус `offer` можно выдать, когда `seats_left = 0`: студент получит `NO_SEATS` при принятии (так устроено демо D2).
- Smoke-тест работает только с localhost, потому что стирает данные.
- Бесплатные тарифы: Render засыпает после простоя, Atlas M0 ограничен 512 МБ, Supabase приостанавливает неактивные проекты.
- Узбекские и английские тексты переведены без вычитки носителем языка.
- Подробные решения и открытые вопросы: `docs/NOTES.md`.
