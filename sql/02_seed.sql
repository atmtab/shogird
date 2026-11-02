-- Shogird: сид-данные (SPEC §11). Запускается после 01_schema.sql.
-- Все компании вымышленные, email только на example.uz, пароль у всех: Shogird2026!
-- Даты задаются относительно now(), чтобы слоты не «протухали». Случайности нет: всё вычисляется по формулам.
-- ID заданы явно (чтобы ID в MongoDB совпадали с PostgreSQL), в конце сдвигаем счётчики SERIAL.

-- ---------- Вузы ----------
INSERT INTO universities (university_id, name, short_name, city) VALUES
 (1,  'Inha University in Tashkent',                    'INHA',     'Tashkent'),
 (2,  'Westminster International University in Tashkent','WIUT',     'Tashkent'),
 (3,  'Tashkent University of Information Technologies', 'TUIT',     'Tashkent'),
 (4,  'Turin Polytechnic University in Tashkent',        'TPU',      'Tashkent'),
 (5,  'National University of Uzbekistan',               'NUUz',     'Tashkent'),
 (6,  'Samarkand State University',                      'SamSU',    'Samarkand'),
 (7,  'New Uzbekistan University',                       'NewUU',    'Tashkent'),
 (8,  'Amity University Tashkent',                       'Amity',    'Tashkent'),
 (9,  'Webster University Tashkent',                     'Webster',  'Tashkent'),
 (10, 'Central Asian University',                        'CAU',      'Tashkent');

-- ---------- Навыки (42) ----------
INSERT INTO skills (skill_id, name, category) VALUES
 (1,'JavaScript','frontend'),(2,'HTML/CSS','frontend'),(3,'React','frontend'),(4,'Vue','frontend'),(5,'TypeScript','frontend'),
 (6,'Node.js','backend'),(7,'Python','backend'),(8,'Java','backend'),(9,'PHP','backend'),(10,'Django','backend'),
 (11,'SQL','backend'),(12,'PostgreSQL','backend'),(13,'MongoDB','backend'),(14,'REST API','backend'),(15,'C#','backend'),
 (16,'Flutter','mobile'),(17,'Kotlin','mobile'),(18,'Swift','mobile'),(19,'React Native','mobile'),(20,'Dart','mobile'),
 (21,'Pandas','data'),(22,'Machine Learning','data'),(23,'Power BI','data'),(24,'Excel','data'),(25,'Statistics','data'),(26,'Tableau','data'),
 (27,'Figma','design'),(28,'UI/UX','design'),(29,'Photoshop','design'),(30,'Illustrator','design'),
 (31,'Manual Testing','qa'),(32,'Selenium','qa'),(33,'Postman','qa'),(34,'Test Automation','qa'),
 (35,'Docker','devops'),(36,'Git','devops'),(37,'Linux','devops'),(38,'CI/CD','devops'),(39,'AWS','devops'),
 (40,'Scrum','pm'),(41,'Jira','pm'),(42,'Business Analysis','pm');

-- ---------- Пользователи-компании (user_id 1..12) и админ (53) ----------
-- Хэш bcrypt (cost 10) пароля Shogird2026!, получен scripts/hash-password.js
INSERT INTO users (user_id, email, password_hash, role, created_at)
SELECT u.user_id, u.email, h.x, 'company', now() - interval '120 days'
FROM (VALUES
 (1,'hr@registanlabs.example.uz'),(2,'hr@silkcode.example.uz'),(3,'hr@chorsudigital.example.uz'),
 (4,'hr@navoisoft.example.uz'),(5,'hr@bulut.example.uz'),(6,'hr@amudaryodata.example.uz'),
 (7,'hr@kapalakmobile.example.uz'),(8,'hr@tashkentailab.example.uz'),(9,'hr@ferganapixel.example.uz'),
 (10,'hr@bukharabyte.example.uz'),(11,'hr@andijansystems.example.uz'),(12,'hr@nukuscloud.example.uz')
) AS u(user_id, email)
CROSS JOIN (VALUES ('$2a$10$HnhROQVrxdXAgUFEoLUD3e8L/DzwyOQdFogvnn/dd59kiepLMTOQy')) AS h(x);

INSERT INTO users (user_id, email, password_hash, role, created_at)
VALUES (53, 'admin@example.uz', '$2a$10$HnhROQVrxdXAgUFEoLUD3e8L/DzwyOQdFogvnn/dd59kiepLMTOQy', 'admin', now() - interval '120 days');

-- ---------- Компании (12, из них 7 резидентов IT Park) ----------
INSERT INTO companies (company_id, user_id, name, city, website, description, employees_range, is_itpark_resident, logo_url, created_at) VALUES
 (1, 1, 'Registan Labs',     'Tashkent',  'https://registanlabs.example.uz',   'Продуктовая студия: backend и web для финтеха.',            '51-200', true,  '/placeholder.svg?text=RL', now() - interval '110 days'),
 (2, 2, 'Silk Code',         'Tashkent',  'https://silkcode.example.uz',       'Разработка веб-сервисов на заказ.',                          '11-50',  true,  '/placeholder.svg?text=SC', now() - interval '110 days'),
 (3, 3, 'Chorsu Digital',    'Tashkent',  'https://chorsudigital.example.uz',  'Цифровое агентство: дизайн, аналитика, маркетинг.',          '51-200', true,  '/placeholder.svg?text=CD', now() - interval '108 days'),
 (4, 4, 'Navoiy Soft',       'Samarkand', 'https://navoisoft.example.uz',      'Корпоративные системы и мобильные приложения.',              '11-50',  true,  '/placeholder.svg?text=NS', now() - interval '105 days'),
 (5, 5, 'Bulut Tech',        'Tashkent',  'https://bulut.example.uz',          'Облачная инфраструктура и DevOps-услуги.',                   '51-200', true,  '/placeholder.svg?text=BT', now() - interval '100 days'),
 (6, 6, 'Amudaryo Data',     'Urgench',   'https://amudaryodata.example.uz',   'Аналитика данных и машинное обучение для агросектора.',      '11-50',  true,  '/placeholder.svg?text=AD', now() - interval '98 days'),
 (7, 7, 'Kapalak Mobile',    'Tashkent',  'https://kapalakmobile.example.uz',  'Мобильные приложения для Android и iOS.',                    '11-50',  true,  '/placeholder.svg?text=KM', now() - interval '95 days'),
 (8, 8, 'Tashkent AI Lab',   'Tashkent',  'https://tashkentailab.example.uz',  'Исследования в области NLP для узбекского языка.',           '1-10',   false, '/placeholder.svg?text=AI', now() - interval '90 days'),
 (9, 9, 'Fergana Pixel',     'Fergana',   'https://ferganapixel.example.uz',   'Студия графического и веб-дизайна.',                         '1-10',   false, '/placeholder.svg?text=FP', now() - interval '88 days'),
 (10,10,'Bukhara Byte',      'Bukhara',   'https://bukharabyte.example.uz',    'Управление проектами и разработка для малого бизнеса.',      '11-50',  false, '/placeholder.svg?text=BB', now() - interval '85 days'),
 (11,11,'Andijan Systems',   'Andijan',   'https://andijansystems.example.uz', 'Тестирование и сопровождение ПО.',                           '11-50',  false, '/placeholder.svg?text=AS', now() - interval '80 days'),
 (12,12,'Nukus Cloud',       'Nukus',     'https://nukuscloud.example.uz',     'Хостинг и облачные сервисы Каракалпакстана.',                '1-10',   false, '/placeholder.svg?text=NC', now() - interval '75 days');

-- ---------- Студенты (40) ----------
-- Временная таблица с именами: из неё берутся и users, и students, чтобы данные совпадали.
CREATE TEMP TABLE tmp_students AS
SELECT i,
       CASE WHEN i % 2 = 1
            THEN (ARRAY['Aziza','Malika','Dilnoza','Madina','Nodira','Zarina','Sevara','Gulnora','Shahzoda','Kamola',
                        'Feruza','Laylo','Mohira','Nigora','Olima','Parizoda','Rayhona','Sitora','Umida','Yulduz'])[(i + 1) / 2]
            ELSE (ARRAY['Bekzod','Jasur','Sardor','Azizbek','Dilshod','Otabek','Javohir','Sherzod','Timur','Ulugbek',
                        'Farrux','Islom','Komil','Behruz','Doston','Eldor','Husan','Mirzo','Nodir','Rustam'])[i / 2]
       END AS first_name,
       (ARRAY['Karim','Tursun','Rahim','Yusup','Abdulla','Nazar','Umar','Ergash','Hamid','Ismail',
              'Mansur','Nurmat','Olim','Pulat','Qodir','Sobir','Tohir','Usmon','Valijon','Zokir'])[(i - 1) % 20 + 1] AS stem
FROM generate_series(1, 40) AS i;

INSERT INTO users (user_id, email, password_hash, role, created_at)
SELECT 12 + i,
       CASE i WHEN 1 THEN 'aziza@example.uz' WHEN 2 THEN 'bekzod@example.uz'
              ELSE lower(first_name) || '.' || lower(stem) || '@example.uz' END,
       '$2a$10$HnhROQVrxdXAgUFEoLUD3e8L/DzwyOQdFogvnn/dd59kiepLMTOQy', 'student',
       now() - (70 - i) * interval '1 day'
FROM tmp_students;

INSERT INTO students (student_id, user_id, full_name, university_id, course, city, phone, bio, github_url, created_at)
SELECT i, 12 + i,
       first_name || ' ' || stem || CASE WHEN i % 2 = 1 THEN 'ova' ELSE 'ov' END,
       uni,
       (i % 4) + 1 + CASE WHEN i % 7 = 0 THEN 1 ELSE 0 END,
       CASE WHEN i <= 2 THEN 'Tashkent'
            WHEN uni = 6 THEN 'Samarkand'
            ELSE (ARRAY['Tashkent','Tashkent','Tashkent','Samarkand','Bukhara','Namangan','Andijan','Fergana','Tashkent'])[i % 9 + 1] END,
       '+99890' || lpad((1000000 + i * 7919)::text, 7, '0'),
       CASE WHEN i % 3 = 0 THEN NULL
            WHEN i = 1 THEN 'Люблю frontend и дизайн интерфейсов. Ищу первую стажировку.'
            WHEN i = 2 THEN 'Пишу backend на Python и Node.js, интересуюсь базами данных.'
            ELSE 'Студент, ищу стажировку для практики и первого опыта в команде.' END,
       CASE WHEN i % 4 = 0 THEN NULL ELSE 'https://github.com/' || lower(first_name) || lower(stem) END,
       now() - (70 - i) * interval '1 day'
FROM (SELECT t.*, CASE WHEN t.i = 1 THEN 1 WHEN t.i = 2 THEN 3 ELSE (t.i * 7) % 10 + 1 END AS uni FROM tmp_students t) s;

DROP TABLE tmp_students;

-- ---------- Навыки студентов (~160) ----------
-- Демо-студенты задаются вручную, остальные 38: четыре навыка из «пула».
-- Пул намеренно перекошен: много Python/React/UI-UX, мало SQL/Git/Docker (история для «разрыва навыков»).
INSERT INTO student_skills (student_id, skill_id, level) VALUES
 (1, 1, 4), (1, 3, 3), (1, 2, 4), (1, 5, 2), (1, 27, 2), (1, 36, 2),     -- Азиза: frontend
 (2, 7, 4), (2, 6, 3), (2, 11, 3), (2, 12, 2), (2, 36, 3), (2, 14, 2);   -- Бекзод: backend

INSERT INTO student_skills (student_id, skill_id, level)
SELECT s, (ARRAY[7,3,28,1,2, 7,3,28,27,24, 6,7,1,3,31, 16,21,22,2,1,
                 11,36,35,14,8, 5,15,13,19,23, 29,40,12,17,25, 10,4,9,37,32])[(s * 5 + k * 11) % 40 + 1],
       1 + (s + k) % 5
FROM generate_series(3, 40) AS s, generate_series(0, 3) AS k
ON CONFLICT DO NOTHING;

-- ---------- Вакансии (30: 26 open, 3 closed, 1 draft) ----------
INSERT INTO vacancies (vacancy_id, company_id, title, description, direction, work_format, city, is_paid, stipend,
                       duration_months, seats, seats_left, status, deadline, created_at, updated_at)
SELECT v.id, v.company_id, v.title,
       v.title || ': работа над реальными задачами команды под руководством наставника. Условия и навыки указаны в карточке.',
       v.direction, v.fmt, v.city, v.stipend IS NOT NULL, v.stipend, v.months, v.seats, v.seats_left, v.status,
       CASE WHEN v.dl IS NULL THEN NULL ELSE current_date + v.dl END,
       now() - (40 - v.id) * interval '1 day', now() - (40 - v.id) * interval '1 day'
FROM (VALUES
 -- id, company, title, direction, format, city, stipend, months, seats, left, status, deadline (дней от сегодня)
 (1,  1, 'Junior Backend Intern',        'backend',  'hybrid', 'Tashkent',  4000000, 3, 2, 1, 'open',   30),
 (2,  1, 'Frontend Intern (React)',      'frontend', 'hybrid', 'Tashkent',  3500000, 3, 3, 3, 'open',   25),
 (3,  1, 'QA Intern',                    'qa',       'office', 'Tashkent',  2500000, 3, 2, 2, 'open',   20),
 (4,  2, 'Python Backend Intern',        'backend',  'hybrid', 'Tashkent',  3000000, 4, 2, 1, 'open',   15),
 (5,  2, 'React Developer Intern',       'frontend', 'remote', 'Tashkent',  2800000, 3, 2, 2, 'open',   20),
 (6,  3, 'UI/UX Design Intern',          'design',   'office', 'Tashkent',  2000000, 3, 1, 0, 'closed', -5),
 (7,  3, 'Data Analyst Intern',          'data',     'hybrid', 'Tashkent',  3200000, 4, 2, 2, 'open',   18),
 (8,  4, 'Java Developer Intern',        'backend',  'office', 'Samarkand', 2200000, 6, 2, 2, 'open',   40),
 (9,  4, 'Flutter Mobile Intern',        'mobile',   'hybrid', 'Samarkand', 2500000, 3, 2, 1, 'open',   22),
 (10, 5, 'DevOps Intern',                'devops',   'remote', 'Tashkent',  4500000, 3, 1, 1, 'open',   12),
 (11, 5, 'Node.js Backend Intern',       'backend',  'remote', 'Tashkent',  3800000, 4, 2, 2, 'open',   28),
 (12, 6, 'Machine Learning Intern',      'data',     'remote', 'Urgench',   5000000, 6, 1, 1, 'open',   35),
 (13, 7, 'Android Kotlin Intern',        'mobile',   'office', 'Tashkent',  3000000, 3, 2, 2, 'open',   14),
 (14, 8, 'NLP Research Intern',          'data',     'hybrid', 'Tashkent',  6000000, 6, 2, 2, 'open',   45),
 (15, 9, 'Graphic Designer Intern',      'design',   'office', 'Fergana',   NULL,    2, 1, 1, 'open',   30),
 (16, 10,'Project Manager Intern',       'pm',       'office', 'Bukhara',   NULL,    3, 1, 1, 'open',   21),
 (17, 11,'QA Automation Intern',         'qa',       'hybrid', 'Andijan',   1800000, 3, 1, 1, 'open',   33),
 (18, 12,'Cloud & Linux Intern',         'devops',   'office', 'Nukus',     1500000, 4, 2, 2, 'open',   50),
 (19, 9, 'Web Design Intern',            'design',   'remote', 'Fergana',   1500000, 2, 1, 1, 'closed', -20),
 (20, 11,'PHP Backend Intern',           'backend',  'office', 'Andijan',   1600000, 3, 1, 1, 'closed', -30),
 (21, 1, 'Data Engineering Intern',      'data',     'hybrid', 'Tashkent',  4200000, 4, 1, 1, 'draft',  NULL),
 (22, 2, 'UI/UX Design Intern',          'design',   'hybrid', 'Tashkent',  2600000, 3, 1, 1, 'open',   26),
 (23, 3, 'Frontend Vue Intern',          'frontend', 'remote', 'Tashkent',  2700000, 3, 2, 2, 'open',   19),
 (24, 4, 'QA Manual Testing Intern',     'qa',       'office', 'Samarkand', 1700000, 3, 1, 1, 'open',   24),
 (25, 5, 'Business Analyst Intern',      'pm',       'hybrid', 'Tashkent',  3000000, 4, 1, 1, 'open',   17),
 (26, 6, 'Power BI Analyst Intern',      'data',     'office', 'Urgench',   2400000, 3, 2, 2, 'open',   38),
 (27, 7, 'iOS Swift Intern',             'mobile',   'hybrid', 'Tashkent',  3600000, 4, 1, 1, 'open',   27),
 (28, 8, 'Python Data Intern',           'data',     'remote', 'Tashkent',  3300000, 3, 2, 2, 'open',   16),
 (29, 10,'Full-Stack Intern',            'backend',  'remote', 'Bukhara',   2900000, 4, 2, 2, 'open',   36),
 (30, 12,'Junior DevOps (Docker)',       'devops',   'remote', 'Nukus',     2000000, 3, 1, 1, 'open',   NULL)
) AS v(id, company_id, title, direction, fmt, city, stipend, months, seats, seats_left, status, dl);

-- ---------- Навыки вакансий (~100); SQL, Git, Docker требуются часто ----------
INSERT INTO vacancy_skills (vacancy_id, skill_id, is_required) VALUES
 (1,6,true),(1,11,true),(1,36,true),(1,14,true),(1,12,false),(1,35,false),
 (2,3,true),(2,1,true),(2,2,true),(2,36,true),(2,5,false),
 (3,31,true),(3,33,true),(3,34,false),(3,11,false),(3,36,false),
 (4,7,true),(4,11,true),(4,36,true),(4,10,false),(4,35,false),
 (5,3,true),(5,1,true),(5,5,false),(5,36,true),
 (6,28,true),(6,27,true),
 (7,7,true),(7,11,true),(7,24,true),(7,21,false),(7,23,false),
 (8,8,true),(8,11,true),(8,36,true),(8,14,false),
 (9,16,true),(9,20,true),(9,36,true),
 (10,35,true),(10,37,true),(10,38,true),(10,36,true),
 (11,6,true),(11,13,true),(11,36,true),(11,35,false),
 (12,7,true),(12,22,true),(12,21,true),(12,25,false),
 (13,17,true),(13,36,true),(13,14,false),
 (14,7,true),(14,22,true),(14,36,false),
 (15,29,true),(15,30,true),(15,27,false),
 (16,40,true),(16,41,true),(16,42,false),
 (17,32,true),(17,34,true),(17,31,false),(17,36,false),
 (18,37,true),(18,35,true),(18,39,false),
 (19,27,true),(19,2,true),
 (20,9,true),(20,11,true),
 (21,11,true),(21,7,true),(21,12,false),
 (22,28,true),(22,27,true),(22,29,false),
 (23,4,true),(23,1,true),(23,2,true),
 (24,31,true),(24,41,false),
 (25,42,true),(25,11,true),(25,24,false),
 (26,23,true),(26,24,true),(26,11,true),
 (27,18,true),(27,36,true),
 (28,7,true),(28,21,true),(28,11,false),
 (29,6,true),(29,3,true),(29,11,true),(29,36,true),
 (30,35,true),(30,37,true),(30,36,true);

-- ---------- Заявки (60, покрывают все 8 статусов) ----------
-- Закрытые вакансии: accepted-заявок ровно seats - seats_left (согласовано с транзакцией T3).
INSERT INTO applications (application_id, vacancy_id, student_id, status, cover_letter, company_note, created_at, updated_at)
SELECT a.id, a.vacancy_id, a.student_id, a.status,
       CASE WHEN a.id % 3 = 0 THEN NULL
            ELSE 'Здравствуйте! Хочу пройти стажировку у вас: мне интересна практика, готов(а) уделять учёбе и проекту достаточно времени.' END,
       CASE WHEN a.status IN ('shortlisted','interview','offer','accepted') THEN 'Сильный кандидат, хорошо отвечает на вопросы.'
            WHEN a.status = 'rejected' THEN 'Не хватает базовых навыков для текущей команды.' END,
       now() - (62 - a.id) * interval '1 day',
       LEAST(now(), now() - (62 - a.id) * interval '1 day' + CASE WHEN a.status = 'submitted' THEN interval '0' ELSE interval '2 days' END)
FROM (VALUES
 -- D2: Junior Backend Intern, 1 место осталось, у Азизы (1) и Бекзода (2) статус offer
 (1, 1, 1, 'offer'),      (2, 1, 2, 'offer'),      (3, 1, 5, 'submitted'),  (4, 1, 6, 'submitted'),
 (5, 1, 7, 'interview'),  (6, 1, 8, 'rejected'),   (7, 1, 9, 'accepted'),
 -- D1: у Азизы shortlisted на Frontend Intern со свободными слотами; D4: submitted и interview у Registan Labs
 (8, 2, 1, 'shortlisted'),(9, 2, 10, 'submitted'), (10, 2, 11, 'interview'),(11, 2, 12, 'shortlisted'),(12, 2, 13, 'rejected'),
 (13, 3, 14, 'submitted'),(14, 3, 15, 'shortlisted'),
 (15, 4, 3, 'submitted'), (16, 4, 16, 'accepted'), (17, 4, 17, 'offer'),     (18, 4, 18, 'withdrawn'),
 (19, 5, 4, 'submitted'), (20, 5, 19, 'interview'),(21, 5, 20, 'rejected'),
 (22, 6, 21, 'submitted'),(23, 6, 22, 'shortlisted'),(24, 6, 23, 'accepted'),(25, 6, 24, 'declined'),
 (26, 7, 25, 'submitted'),(27, 7, 26, 'submitted'),(28, 7, 27, 'interview'), (29, 7, 28, 'offer'),
 (30, 8, 29, 'submitted'),(31, 8, 30, 'shortlisted'),(32, 8, 31, 'rejected'),
 (33, 9, 32, 'submitted'),(34, 9, 33, 'accepted'), (35, 9, 34, 'withdrawn'),
 (36, 10, 35, 'submitted'),(37, 10, 36, 'interview'),(38, 10, 37, 'rejected'),
 (39, 11, 3, 'submitted'),(40, 11, 4, 'submitted'),(41, 11, 5, 'shortlisted'),
 (42, 12, 3, 'submitted'),(43, 12, 4, 'submitted'),(44, 12, 5, 'shortlisted'),(45, 12, 6, 'offer'),
 (46, 13, 7, 'submitted'),(47, 13, 8, 'submitted'),
 (48, 14, 9, 'withdrawn'),(49, 14, 10, 'submitted'),(50, 14, 11, 'submitted'),
 (51, 15, 12, 'submitted'),(52, 15, 13, 'submitted'),
 (53, 16, 14, 'submitted'),(54, 16, 15, 'rejected'),
 (55, 17, 21, 'submitted'),
 (56, 18, 22, 'submitted'),(57, 18, 29, 'submitted'),
 (58, 19, 30, 'rejected'),(59, 19, 31, 'rejected'),
 (60, 20, 32, 'rejected')
) AS a(id, vacancy_id, student_id, status);

-- ---------- Слоты собеседований (~47) ----------
-- days: смещение от сегодняшнего дня (минус = прошлое), hour: час начала.
INSERT INTO interview_slots (slot_id, vacancy_id, starts_at, duration_min, place, is_booked)
SELECT s.id, s.vacancy_id,
       date_trunc('day', now()) + s.days * interval '1 day' + s.hour * interval '1 hour',
       30,
       CASE WHEN s.id % 2 = 0 THEN 'Офис компании, Ташкент' ELSE 'Онлайн: ссылка на звонок придёт на почту' END,
       s.booked
FROM (VALUES
 -- id, вакансия, дней, час, занят
 (1, 1, -12, 10, true), (2, 1, -12, 11, true), (3, 1, -11, 10, true), (4, 1, -11, 11, true),
 (5, 1,   2, 10, true),                              -- D3: занятый будущий слот у Junior Backend Intern
 (6, 1,   3, 10, false),(7, 1,   4, 10, false),
 (8, 2,   2, 14, true),                              -- D4: занят кандидатом в статусе interview
 (9, 2,   3, 14, false),(10, 2, 3, 15, false),(11, 2, 4, 14, false),(12, 2, 5, 14, false),  -- D1: свободные слоты для Азизы
 (13, 4, -9, 10, true), (14, 4, -9, 11, true), (15, 4, -8, 10, false),   -- 15: собеседование отменено, слот свободен
 (16, 5,  2, 11, true),
 (17, 6, -20, 10, true),(18, 6, -20, 11, true),
 (19, 7,  3, 12, true), (20, 7, -5, 10, true),
 (21, 9, -7, 10, true),
 (22, 10, 4, 10, true),
 (23, 12, -4, 10, true)
) AS s(id, vacancy_id, days, hour, booked);

-- Свободные будущие слоты на +6 и +7 дней у ещё 12 вакансий (24 штуки)
INSERT INTO interview_slots (slot_id, vacancy_id, starts_at, duration_min, place, is_booked)
SELECT 23 + row_number() OVER (ORDER BY v.vacancy_id, d.days), v.vacancy_id,
       date_trunc('day', now()) + d.days * interval '1 day' + interval '10 hours',
       30, 'Офис компании', false
FROM (VALUES (3),(5),(7),(8),(9),(10),(11),(12),(13),(14),(15),(16)) AS v(vacancy_id)
CROSS JOIN (VALUES (6),(7)) AS d(days);

-- ---------- Собеседования (17: 11 done, 5 scheduled, 1 cancelled) ----------
INSERT INTO interviews (interview_id, slot_id, application_id, status, score, feedback, created_at) VALUES
 (1,  1,  1,  'done', 5, 'Отличное понимание REST и SQL.',              now() - interval '13 days'),
 (2,  2,  2,  'done', 4, 'Хорошая база, нужно подтянуть тесты.',        now() - interval '13 days'),
 (3,  3,  7,  'done', 5, 'Уверенный кандидат, принят.',                 now() - interval '12 days'),
 (4,  4,  6,  'done', 2, 'Слабое знание основ backend.',                now() - interval '12 days'),
 (5,  5,  5,  'scheduled', NULL, NULL,                                  now() - interval '1 day'),
 (6,  8,  10, 'scheduled', NULL, NULL,                                  now() - interval '1 day'),
 (7,  13, 16, 'done', 5, 'Сильные навыки Python.',                      now() - interval '10 days'),
 (8,  14, 17, 'done', 4, 'Хороший кандидат, оффер отправлен.',          now() - interval '10 days'),
 (9,  15, 18, 'cancelled', NULL, NULL,                                  now() - interval '9 days'),
 (10, 16, 20, 'scheduled', NULL, NULL,                                  now() - interval '1 day'),
 (11, 17, 24, 'done', 5, 'Отличное портфолио.',                         now() - interval '21 days'),
 (12, 18, 25, 'done', 4, 'Хорошее портфолио, оффер отправлен.',         now() - interval '21 days'),
 (13, 19, 28, 'scheduled', NULL, NULL,                                  now() - interval '1 day'),
 (14, 20, 29, 'done', 4, 'Хорошо работает с данными.',                  now() - interval '6 days'),
 (15, 21, 34, 'done', 5, 'Сильный мобильный разработчик.',              now() - interval '8 days'),
 (16, 22, 37, 'scheduled', NULL, NULL,                                  now() - interval '1 day'),
 (17, 23, 45, 'done', 4, 'Понимает основы ML, оффер отправлен.',        now() - interval '5 days');

-- ---------- Счётчики SERIAL после вставки с явными ID ----------
SELECT setval(pg_get_serial_sequence('users', 'user_id'),                  (SELECT max(user_id) FROM users));
SELECT setval(pg_get_serial_sequence('universities', 'university_id'),     (SELECT max(university_id) FROM universities));
SELECT setval(pg_get_serial_sequence('students', 'student_id'),            (SELECT max(student_id) FROM students));
SELECT setval(pg_get_serial_sequence('companies', 'company_id'),           (SELECT max(company_id) FROM companies));
SELECT setval(pg_get_serial_sequence('skills', 'skill_id'),                (SELECT max(skill_id) FROM skills));
SELECT setval(pg_get_serial_sequence('vacancies', 'vacancy_id'),           (SELECT max(vacancy_id) FROM vacancies));
SELECT setval(pg_get_serial_sequence('applications', 'application_id'),    (SELECT max(application_id) FROM applications));
SELECT setval(pg_get_serial_sequence('interview_slots', 'slot_id'),        (SELECT max(slot_id) FROM interview_slots));
SELECT setval(pg_get_serial_sequence('interviews', 'interview_id'),        (SELECT max(interview_id) FROM interviews));
