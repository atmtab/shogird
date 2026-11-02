-- Shogird: 20 учебных запросов (SPEC §12). Над каждым: бизнес-вопрос.
-- Запускать после db:reset. Запросы 1, 3, 4 и 18 меняют данные; после прогона снова выполните db:reset.
-- Расклад: CRUD 4 · JOIN 5 · GROUP BY 4 · VIEW 1 · окна 2 · подзапрос 1 · транзакция 1 · свои 2.

-- ============ CRUD (4) ============

-- Q1. Бизнес-вопрос: рынок просит Rust, как добавить новый навык в справочник?
INSERT INTO skills (name, category) VALUES ('Rust', 'backend')
ON CONFLICT (name) DO NOTHING;   -- повторный запуск не падает

-- Q2. Какие оплачиваемые remote-стажировки открыты прямо сейчас и сколько платят?
SELECT vacancy_id, title, city, stipend::float AS stipend_uzs
FROM vacancies
WHERE status = 'open' AND work_format = 'remote' AND is_paid
ORDER BY stipend DESC;

-- Q3. Компания просит больше времени на набор: продлить дедлайн вакансии 5 ещё на 14 дней.
UPDATE vacancies
SET deadline = COALESCE(deadline, current_date) + 14, updated_at = now()
WHERE vacancy_id = 5
RETURNING vacancy_id, title, deadline;

-- Q4. Как убрать черновик, который компания передумала публиковать? (сначала создаём тестовый черновик)
INSERT INTO vacancies (company_id, title, description, direction, work_format, city, duration_months, seats, seats_left, status)
VALUES (2, 'Тестовый черновик', 'Временная запись для запроса на удаление', 'backend', 'remote', 'Tashkent', 3, 1, 1, 'draft');

DELETE FROM vacancies
WHERE status = 'draft' AND title = 'Тестовый черновик'
RETURNING vacancy_id, title;

-- ============ JOIN (5) ============

-- Q5. Какие навыки нужны каждой открытой вакансии и у какой компании? (INNER JOIN по 4 таблицам)
SELECT c.name AS company, v.title, s.name AS skill, vs.is_required
FROM vacancies v
JOIN companies c       ON c.company_id = v.company_id
JOIN vacancy_skills vs ON vs.vacancy_id = v.vacancy_id
JOIN skills s          ON s.skill_id = vs.skill_id
WHERE v.status = 'open'
ORDER BY c.name, v.title, vs.is_required DESC, s.name;

-- Q6. Как выглядит воронка по каждой заявке: кто, куда, в каком статусе?
SELECT a.application_id, st.full_name, u.short_name AS university, v.title, c.name AS company, a.status
FROM applications a
JOIN students st ON st.student_id = a.student_id
LEFT JOIN universities u ON u.university_id = st.university_id
JOIN vacancies v ON v.vacancy_id = a.vacancy_id
JOIN companies c ON c.company_id = v.company_id
ORDER BY a.created_at DESC
LIMIT 20;

-- Q7. Какие студенты ни разу не откликнулись? Им можно отправить подсказку. (LEFT JOIN + IS NULL)
SELECT st.student_id, st.full_name, st.city
FROM students st
LEFT JOIN applications a ON a.student_id = st.student_id
WHERE a.application_id IS NULL
ORDER BY st.student_id;

-- Q8. Какие открытые вакансии остались без откликов? Их стоит продвигать. (LEFT JOIN + IS NULL)
SELECT v.vacancy_id, v.title, c.name AS company, v.city
FROM vacancies v
JOIN companies c ON c.company_id = v.company_id
LEFT JOIN applications a ON a.vacancy_id = v.vacancy_id
WHERE v.status = 'open' AND a.application_id IS NULL
ORDER BY v.vacancy_id;

-- Q9. Какие собеседования предстоят и кто на них придёт?
SELECT sl.starts_at, c.name AS company, v.title, st.full_name AS candidate, sl.place
FROM interviews i
JOIN interview_slots sl ON sl.slot_id = i.slot_id
JOIN applications a     ON a.application_id = i.application_id
JOIN students st        ON st.student_id = a.student_id
JOIN vacancies v        ON v.vacancy_id = sl.vacancy_id
JOIN companies c        ON c.company_id = v.company_id
WHERE i.status = 'scheduled' AND sl.starts_at > now()
ORDER BY sl.starts_at;

-- ============ GROUP BY (4) ============

-- Q10. Сколько заявок на каждом этапе воронки?
SELECT status, count(*)::int AS applications
FROM applications
GROUP BY status
ORDER BY applications DESC;

-- Q11. HAVING: какие компании получили больше 5 заявок? (самые востребованные работодатели)
SELECT c.name, count(a.application_id)::int AS applications
FROM companies c
JOIN vacancies v     ON v.company_id = c.company_id
JOIN applications a  ON a.vacancy_id = v.vacancy_id
GROUP BY c.company_id, c.name
HAVING count(a.application_id) > 5
ORDER BY applications DESC;

-- Q12. Сколько в среднем платят в каждом городе и направлении?
SELECT city, direction, count(*)::int AS vacancies, round(avg(stipend))::float AS avg_stipend_uzs
FROM vacancies
WHERE status = 'open' AND is_paid
GROUP BY city, direction
ORDER BY avg_stipend_uzs DESC
LIMIT 10;

-- Q13. Из каких вузов приходят студенты и сколько навыков они в среднем указывают?
SELECT u.short_name, count(DISTINCT st.student_id)::int AS students,
       round(count(ss.skill_id)::numeric / NULLIF(count(DISTINCT st.student_id), 0), 1)::float AS skills_per_student
FROM universities u
LEFT JOIN students st       ON st.university_id = u.university_id
LEFT JOIN student_skills ss ON ss.student_id = st.student_id
GROUP BY u.university_id, u.short_name
ORDER BY students DESC, u.short_name;

-- ============ VIEW (1) ============

-- Q14. Каталог для главной страницы: открытые вакансии резидентов IT Park с числом заявок (представление v_vacancy_catalog).
SELECT vacancy_id, title, company_name, city, work_format, stipend::float AS stipend_uzs, applications_count
FROM v_vacancy_catalog
WHERE status = 'open' AND is_itpark_resident
ORDER BY applications_count DESC, vacancy_id
LIMIT 10;

-- ============ Оконные функции (2) ============

-- Q15. RANK(): какие вакансии самые популярные внутри своей компании?
SELECT c.name AS company, v.title, count(a.application_id)::int AS applications,
       RANK() OVER (PARTITION BY c.company_id ORDER BY count(a.application_id) DESC) AS rank_in_company
FROM vacancies v
JOIN companies c ON c.company_id = v.company_id
LEFT JOIN applications a ON a.vacancy_id = v.vacancy_id
GROUP BY c.company_id, c.name, v.vacancy_id, v.title
ORDER BY c.name, rank_in_company, v.title;

-- Q16. SUM() OVER: как растёт общее число заявок день за днём?
WITH per_day AS (
  SELECT created_at::date AS day, count(*)::int AS applications
  FROM applications
  GROUP BY created_at::date
)
SELECT day, applications, (SUM(applications) OVER (ORDER BY day))::int AS running_total
FROM per_day
ORDER BY day;

-- ============ Подзапрос (1) ============

-- Q17. Какие вакансии платят выше средней стипендии своего направления? (коррелированный подзапрос)
SELECT v.vacancy_id, v.title, v.direction, v.stipend::float AS stipend_uzs
FROM vacancies v
WHERE v.is_paid AND v.status = 'open'
  AND v.stipend > (SELECT avg(v2.stipend) FROM vacancies v2 WHERE v2.direction = v.direction AND v2.is_paid)
ORDER BY v.direction, v.stipend DESC;

-- ============ Транзакция (1) ============

-- Q18. T2 вручную: Азиза (заявка 8, shortlisted) бронирует свободный слот 9 вакансии 2. Всё или ничего.
-- Чтобы прогнать без изменений данных, замените COMMIT на ROLLBACK.
BEGIN;

SELECT application_id, status FROM applications
WHERE application_id = 8 AND student_id = 1 AND status = 'shortlisted'
FOR UPDATE;                                -- блокируем заявку, пока идёт бронь

UPDATE interview_slots SET is_booked = true
WHERE slot_id = 9 AND vacancy_id = 2 AND is_booked = false AND starts_at > now()
RETURNING slot_id, starts_at;              -- 0 строк = слот уже занят (на сервере будет ROLLBACK и 409 SLOT_TAKEN)

INSERT INTO interviews (slot_id, application_id) VALUES (9, 8);

UPDATE applications SET status = 'interview', updated_at = now() WHERE application_id = 8;

COMMIT;

-- ============ По выбору (2) ============

-- Q19. Match score (SPEC §6.4): насколько вакансии подходят Азизе (студент 1)? Обязательный навык весит 1, «плюс» 0,5.
SELECT v.vacancy_id, v.title,
       ROUND(100.0 * SUM(CASE WHEN ss.skill_id IS NOT NULL
                              THEN CASE WHEN vs.is_required THEN 1 ELSE 0.5 END ELSE 0 END)
                   / SUM(CASE WHEN vs.is_required THEN 1 ELSE 0.5 END))::int AS match_pct
FROM vacancies v
JOIN vacancy_skills vs ON vs.vacancy_id = v.vacancy_id
LEFT JOIN student_skills ss ON ss.skill_id = vs.skill_id AND ss.student_id = 1
WHERE v.status = 'open'
GROUP BY v.vacancy_id, v.title
ORDER BY match_pct DESC, v.vacancy_id
LIMIT 10;

-- Q20. Топ навыков в открытых вакансиях против числа студентов с этим навыком (основа «разрыва навыков»).
SELECT s.name AS skill,
       count(DISTINCT vs.vacancy_id)::int AS open_vacancies,
       (SELECT count(*) FROM student_skills ss WHERE ss.skill_id = s.skill_id)::int AS students_with_skill
FROM skills s
JOIN vacancy_skills vs ON vs.skill_id = s.skill_id
JOIN vacancies v       ON v.vacancy_id = vs.vacancy_id AND v.status = 'open'
GROUP BY s.skill_id, s.name
ORDER BY open_vacancies DESC, s.name
LIMIT 10;
