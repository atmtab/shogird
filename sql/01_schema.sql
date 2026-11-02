-- Shogird: схема PostgreSQL (SPEC §5). Перезапускаемая: сначала удаляем всё старое.
-- ВНИМАНИЕ: стирает данные. Запуск: npm run db:reset (из папки server/).

DROP VIEW IF EXISTS v_vacancy_catalog;
DROP MATERIALIZED VIEW IF EXISTS mv_direction_monthly;
DROP TABLE IF EXISTS applications_archive CASCADE;
DROP TABLE IF EXISTS interviews CASCADE;
DROP TABLE IF EXISTS interview_slots CASCADE;
DROP TABLE IF EXISTS applications CASCADE;
DROP TABLE IF EXISTS vacancy_skills CASCADE;
DROP TABLE IF EXISTS student_skills CASCADE;
DROP TABLE IF EXISTS vacancies CASCADE;
DROP TABLE IF EXISTS skills CASCADE;
DROP TABLE IF EXISTS companies CASCADE;
DROP TABLE IF EXISTS students CASCADE;
DROP TABLE IF EXISTS universities CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ---------- Учётные записи ----------
CREATE TABLE users (
  user_id       SERIAL PRIMARY KEY,
  email         VARCHAR(120) NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash VARCHAR(100) NOT NULL,                         -- bcrypt
  role          VARCHAR(10)  NOT NULL CHECK (role IN ('student', 'company', 'admin')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE universities (
  university_id SERIAL PRIMARY KEY,
  name          VARCHAR(150) NOT NULL UNIQUE,
  short_name    VARCHAR(20),
  city          VARCHAR(50)  NOT NULL
);

CREATE TABLE students (
  student_id    SERIAL PRIMARY KEY,
  user_id       INT NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  full_name     VARCHAR(100) NOT NULL,
  university_id INT REFERENCES universities(university_id),
  course        SMALLINT CHECK (course BETWEEN 1 AND 6),
  city          VARCHAR(50) NOT NULL DEFAULT 'Tashkent',
  phone         VARCHAR(20) CHECK (phone ~ '^\+998[0-9]{9}$'),
  bio           TEXT,
  github_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE companies (
  company_id         SERIAL PRIMARY KEY,
  user_id            INT NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  name               VARCHAR(120) NOT NULL UNIQUE,
  city               VARCHAR(50)  NOT NULL,
  website            TEXT,
  description        TEXT,
  employees_range    VARCHAR(10) CHECK (employees_range IN ('1-10', '11-50', '51-200', '200+')),
  is_itpark_resident BOOLEAN NOT NULL DEFAULT false,
  logo_url           TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE skills (
  skill_id SERIAL PRIMARY KEY,
  name     VARCHAR(50) NOT NULL UNIQUE,
  category VARCHAR(20) NOT NULL
    CHECK (category IN ('frontend', 'backend', 'mobile', 'data', 'design', 'qa', 'devops', 'pm'))
);

-- M:N студенты <-> навыки
CREATE TABLE student_skills (
  student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  skill_id   INT NOT NULL REFERENCES skills(skill_id),
  level      SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 5),
  PRIMARY KEY (student_id, skill_id)
);

-- ---------- Вакансии ----------
CREATE TABLE vacancies (
  vacancy_id      SERIAL PRIMARY KEY,
  company_id      INT NOT NULL REFERENCES companies(company_id),
  title           VARCHAR(150) NOT NULL,
  description     TEXT NOT NULL,
  direction       VARCHAR(20) NOT NULL
    CHECK (direction IN ('frontend', 'backend', 'mobile', 'data', 'design', 'qa', 'devops', 'pm')),
  work_format     VARCHAR(10) NOT NULL CHECK (work_format IN ('office', 'remote', 'hybrid')),
  city            VARCHAR(50) NOT NULL,
  is_paid         BOOLEAN NOT NULL DEFAULT false,
  -- Деньги только в NUMERIC (не FLOAT): сумма в сумах в месяц
  stipend         NUMERIC(12,2) CHECK (stipend IS NULL OR stipend >= 0),
  duration_months SMALLINT NOT NULL CHECK (duration_months BETWEEN 1 AND 12),
  seats           SMALLINT NOT NULL CHECK (seats > 0),
  seats_left      SMALLINT NOT NULL,
  status          VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'closed')),
  deadline        DATE,                                         -- NULL = без дедлайна
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Мест не может стать меньше нуля или больше, чем всего: последняя линия защиты для T3
  CONSTRAINT vacancies_seats_left_range CHECK (seats_left BETWEEN 0 AND seats),
  -- Стипендия указывается только у оплачиваемых стажировок
  CONSTRAINT vacancies_paid_stipend CHECK (is_paid OR stipend IS NULL)
);

-- M:N вакансии <-> навыки
CREATE TABLE vacancy_skills (
  vacancy_id  INT NOT NULL REFERENCES vacancies(vacancy_id) ON DELETE CASCADE,
  skill_id    INT NOT NULL REFERENCES skills(skill_id),
  is_required BOOLEAN NOT NULL DEFAULT true,                    -- false = «будет плюсом»
  PRIMARY KEY (vacancy_id, skill_id)
);

-- ---------- Заявки и собеседования ----------
CREATE TABLE applications (
  application_id SERIAL PRIMARY KEY,
  vacancy_id     INT NOT NULL REFERENCES vacancies(vacancy_id),
  student_id     INT NOT NULL REFERENCES students(student_id),
  status         VARCHAR(12) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'shortlisted', 'interview', 'offer', 'accepted', 'declined', 'rejected', 'withdrawn')),
  cover_letter   TEXT,
  company_note   TEXT,                                          -- видна только компании
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vacancy_id, student_id)                               -- одна заявка на вакансию
);

CREATE TABLE interview_slots (
  slot_id      SERIAL PRIMARY KEY,
  vacancy_id   INT NOT NULL REFERENCES vacancies(vacancy_id) ON DELETE CASCADE,
  starts_at    TIMESTAMPTZ NOT NULL,
  duration_min SMALLINT NOT NULL DEFAULT 30 CHECK (duration_min BETWEEN 10 AND 180),
  place        TEXT,
  is_booked    BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (vacancy_id, starts_at)
);

CREATE TABLE interviews (
  interview_id   SERIAL PRIMARY KEY,
  slot_id        INT NOT NULL REFERENCES interview_slots(slot_id),
  application_id INT NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
  status         VARCHAR(10) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'done', 'no_show', 'cancelled')),
  score          SMALLINT CHECK (score IS NULL OR score BETWEEN 1 AND 5),
  feedback       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Вторая линия защиты от двойной брони (первая: UPDATE ... WHERE is_booked = false).
-- Частичные индексы: отменённое собеседование освобождает слот и заявку.
CREATE UNIQUE INDEX uq_interviews_slot_active
  ON interviews (slot_id) WHERE status <> 'cancelled';
CREATE UNIQUE INDEX uq_interviews_application_active
  ON interviews (application_id) WHERE status <> 'cancelled';

-- ---------- Индексы на FK и частые фильтры (SPEC §5.4) ----------
CREATE INDEX idx_students_university      ON students (university_id);
CREATE INDEX idx_vacancies_company        ON vacancies (company_id);
CREATE INDEX idx_vacancies_status_dir     ON vacancies (status, direction);
CREATE INDEX idx_vacancies_city           ON vacancies (city);
CREATE INDEX idx_vacancy_skills_skill     ON vacancy_skills (skill_id);
CREATE INDEX idx_student_skills_skill     ON student_skills (skill_id);
CREATE INDEX idx_applications_student     ON applications (student_id);
CREATE INDEX idx_applications_vac_status  ON applications (vacancy_id, status);
CREATE INDEX idx_slots_vacancy_starts     ON interview_slots (vacancy_id, starts_at);

-- ---------- Представление для каталога ----------
CREATE VIEW v_vacancy_catalog AS
SELECT v.vacancy_id, v.title, v.direction, v.work_format, v.city, v.is_paid, v.stipend,
       v.duration_months, v.seats, v.seats_left, v.status, v.deadline, v.created_at,
       c.company_id, c.name AS company_name, c.is_itpark_resident, c.logo_url,
       (SELECT count(*) FROM applications a WHERE a.vacancy_id = v.vacancy_id)::int AS applications_count
FROM vacancies v
JOIN companies c ON c.company_id = v.company_id;
