-- Shogird: Big Data эксперимент (SPEC §8). 500 000 строк архива заявок + EXPLAIN ANALYZE до и после индекса.
-- Запуск: npm run db:bigdata (медленно). Файл перезапускаемый.
-- Данные детерминированные: вместо random() берём hashtextextended(i || соль), поэтому
-- два запуска дают одинаковый архив и результаты в отчёте воспроизводимы.

DROP MATERIALIZED VIEW IF EXISTS mv_direction_monthly;
DROP TABLE IF EXISTS applications_archive CASCADE;

CREATE TABLE applications_archive (
  id            BIGSERIAL PRIMARY KEY,
  direction     VARCHAR(20) NOT NULL,
  city          VARCHAR(50) NOT NULL,
  university_id INT NOT NULL,
  status        VARCHAR(12) NOT NULL CHECK (status IN ('accepted', 'rejected', 'no_response')),
  response_hours INT,                                -- NULL, если компания не ответила
  applied_at    TIMESTAMPTZ NOT NULL
);

-- Генерация. h1..h6: независимые «случайные» числа для каждой строки.
-- Сезонность: 40% заявок падают на май–июль (летние стажировки) двух последних завершённых лет.
INSERT INTO applications_archive (direction, city, university_id, status, response_hours, applied_at)
SELECT
  (ARRAY['frontend','backend','mobile','data','design','qa','devops','pm'])[h1 % 8 + 1],
  cities.name,
  h3 % 10 + 1,
  st.status,
  CASE WHEN st.status = 'no_response' THEN NULL
       ELSE 6 + cities.idx * 5 + h5 % 72 END,        -- города отвечают с разной скоростью
  CASE WHEN hs < 40
       THEN make_date(ref.y - hy, 5, 1)::timestamptz + hd * interval '1 day' + hsec * interval '1 second'
       ELSE now() - hu * interval '1 second'   -- равномерно за 730 дней
  END
FROM (
  SELECT i,
         abs(hashtextextended(i::text || 'dir',  0) % 100000) AS h1,
         abs(hashtextextended(i::text || 'city', 0) % 100000) AS h2,
         abs(hashtextextended(i::text || 'uni',  0) % 100000) AS h3,
         abs(hashtextextended(i::text || 'stat', 0) % 100000) AS h4,
         abs(hashtextextended(i::text || 'resp', 0) % 100000) AS h5,
         abs(hashtextextended(i::text || 'season', 0) % 100) AS hs,
         abs(hashtextextended(i::text || 'year', 0) % 2)::int AS hy,
         abs(hashtextextended(i::text || 'day', 0) % 92)::int AS hd,
         abs(hashtextextended(i::text || 'sec', 0) % 86400)::int AS hsec,
         abs(hashtextextended(i::text || 'ts', 0) % 63072000)::int AS hu
  FROM generate_series(1, 500000) AS i
) g
CROSS JOIN LATERAL (
  -- Ташкент получает половину заявок, остальные 8 городов делят вторую половину
  SELECT CASE WHEN g.h2 % 100 < 50 THEN 0 ELSE 1 + g.h2 / 100 % 8 END AS idx
) ci
CROSS JOIN LATERAL (
  SELECT (ARRAY['Tashkent','Samarkand','Bukhara','Namangan','Andijan','Fergana','Nukus','Karshi','Urgench'])[ci.idx + 1] AS name,
         ci.idx
) cities
CROSS JOIN LATERAL (
  SELECT CASE WHEN g.h4 % 100 < 15 THEN 'accepted' WHEN g.h4 % 100 < 50 THEN 'rejected' ELSE 'no_response' END AS status
) st
CROSS JOIN LATERAL (
  -- Лето считаем от последнего завершённого августа: так «май–июль» всегда в прошлом
  SELECT extract(year FROM now())::int - CASE WHEN extract(month FROM now()) < 8 THEN 1 ELSE 0 END AS y
) ref;

ANALYZE applications_archive;

SELECT count(*) AS archive_rows FROM applications_archive;

-- ---------- Эксперимент: backend-заявки в Ташкенте за последние 30 дней ----------
DROP INDEX IF EXISTS idx_archive_dir_city_date;

-- ДО индекса: ожидаем Seq Scan (читается вся таблица)
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*), round(avg(response_hours), 1) AS avg_response_hours
FROM applications_archive
WHERE direction = 'backend' AND city = 'Tashkent' AND applied_at >= now() - interval '30 days';

-- Составной индекс: равенства (direction, city) слева, диапазон (applied_at) справа
CREATE INDEX idx_archive_dir_city_date ON applications_archive (direction, city, applied_at);
ANALYZE applications_archive;

-- ПОСЛЕ индекса: ожидаем Index Scan / Bitmap Index Scan
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*), round(avg(response_hours), 1) AS avg_response_hours
FROM applications_archive
WHERE direction = 'backend' AND city = 'Tashkent' AND applied_at >= now() - interval '30 days';

-- ---------- Аналитика ----------

-- Помесячный тренд: виден пик в мае–июле (сезонность)
SELECT date_trunc('month', applied_at)::date AS month, count(*)::int AS applications
FROM applications_archive
GROUP BY 1
ORDER BY 1;

-- Материализованное представление: сводка по месяцам и направлениям (считается один раз, читается мгновенно)
CREATE MATERIALIZED VIEW mv_direction_monthly AS
SELECT date_trunc('month', applied_at)::date AS month,
       direction,
       count(*)::int AS applications,
       count(*) FILTER (WHERE status = 'accepted')::int AS accepted,
       round(avg(response_hours), 1)::float AS avg_response_hours
FROM applications_archive
GROUP BY 1, 2;

REFRESH MATERIALIZED VIEW mv_direction_monthly;

SELECT * FROM mv_direction_monthly ORDER BY month DESC, direction LIMIT 8;

-- Топ-3 вуза по числу принятых заявок в каждом направлении (ROW_NUMBER по группам)
SELECT direction, university_id, accepted, place
FROM (
  SELECT direction, university_id, count(*)::int AS accepted,
         ROW_NUMBER() OVER (PARTITION BY direction ORDER BY count(*) DESC, university_id) AS place
  FROM applications_archive
  WHERE status = 'accepted'
  GROUP BY direction, university_id
) ranked
WHERE place <= 3
ORDER BY direction, place;

-- Среднее время ответа компаний по городам (NULL у «без ответа» avg() игнорирует)
SELECT city, round(avg(response_hours), 1)::float AS avg_response_hours, count(*)::int AS applications
FROM applications_archive
GROUP BY city
ORDER BY avg_response_hours;
