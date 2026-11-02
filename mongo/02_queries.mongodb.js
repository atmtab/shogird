// Shogird: 12 запросов MongoDB (SPEC §12): 5 CRUD, 5 агрегаций, 2 index/explain.
// Запуск: mongosh mongodb://127.0.0.1:27017/shogird --file mongo/02_queries.mongodb.js
// Сначала должны быть данные: npm run seed:mongo. Файл перезапускаемый: тестовые записи сам же и удаляет.

const d = db.getSiblingDB('shogird');
const DAY = 24 * 3600 * 1000;
const since30 = new Date(Date.now() - 30 * DAY);
const title = (s) => print('\n=== ' + s);

// ================= CRUD (5) =================

title('Q1 (read). Что указано в резюме Азизы (studentId 1)? Показываем только нужные поля.');
printjson(d.resumes.findOne({ studentId: 1 }, { _id: 0, studentId: 1, about: 1, languages: 1, 'projects.title': 1 }));

title('Q2 (create). Азиза оставляет отзыв о Registan Labs (companyId 1).');
d.internship_reviews.deleteOne({ companyId: 1, studentId: 1 });   // чтобы запрос можно было повторять
printjson(d.internship_reviews.insertOne({
  companyId: 1, studentId: 1, rating: 4, pros: 'Хороший наставник', cons: 'Мало времени на вопросы',
  tags: ['mentorship', 'learning'], wouldRecommend: true, createdAt: new Date(),
}).acknowledged);

title('Q3 (update). Азиза передумала и ставит 5 звёзд вместо 4.');
printjson(d.internship_reviews.updateOne({ companyId: 1, studentId: 1 }, { $set: { rating: 5, wouldRecommend: true } }).modifiedCount);

title('Q4 (update). В резюме Азизы появился новый проект ($addToSet не даст добавить дубль).');
printjson(d.resumes.updateOne(
  { studentId: 1 },
  { $addToSet: { projects: { title: 'Shogird: платформа стажировок', url: null, stack: ['JavaScript', 'React'] } }, $set: { updatedAt: new Date() } },
).modifiedCount);

title('Q5 (delete). Удаляем тестовый отзыв, чтобы вернуть данные в исходное состояние.');
printjson(d.internship_reviews.deleteOne({ companyId: 1, studentId: 1 }).deletedCount);

// ================= Агрегации (5) =================

title('Q6. Воронка: сколько событий каждого типа?');
printjson(d.events.aggregate([
  { $group: { _id: '$type', events: { $sum: 1 } } },
  { $sort: { events: -1 } },
]).toArray());

title('Q7. Какие вакансии просматривали чаще всего за последние 30 дней? (топ-5)');
printjson(d.events.aggregate([
  { $match: { type: 'vacancy_view', ts: { $gte: since30 } } },
  { $group: { _id: '$vacancyId', views: { $sum: 1 } } },
  { $sort: { views: -1 } },
  { $limit: 5 },
]).toArray());

title('Q8. Какие навыки студенты ищут чаще всего? ($unwind по массиву filters.skills)');
printjson(d.search_logs.aggregate([
  { $unwind: '$filters.skills' },
  { $group: { _id: '$filters.skills', searches: { $sum: 1 }, avgResults: { $avg: '$results' } } },
  { $sort: { searches: -1 } },
  { $limit: 10 },
  { $project: { skill: '$_id', _id: 0, searches: 1, avgResults: { $round: ['$avgResults', 1] } } },
]).toArray());

title('Q9. Как менялась активность по дням за последние 30 дней? (последние 7 дней)');
printjson(d.events.aggregate([
  { $match: { ts: { $gte: since30 } } },
  { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } }, events: { $sum: 1 } } },
  { $sort: { _id: -1 } },
  { $limit: 7 },
]).toArray());

title('Q10. У каких компаний лучший средний рейтинг по отзывам?');
printjson(d.internship_reviews.aggregate([
  { $group: { _id: '$companyId', avgRating: { $avg: '$rating' }, reviews: { $sum: 1 } } },
  { $sort: { avgRating: -1, reviews: -1 } },
  { $limit: 5 },
  { $project: { companyId: '$_id', _id: 0, reviews: 1, avgRating: { $round: ['$avgRating', 2] } } },
]).toArray());

// ================= Индекс и explain (2) =================
// Запрос: сколько откликов (apply) по направлению backend. Сравниваем план до и после индекса {direction, type}.
const explainQuery = () => {
  const s = d.events.find({ direction: 'backend', type: 'apply' }).explain('executionStats');
  const plan = JSON.stringify(s.queryPlanner.winningPlan);
  return {
    stage: plan.includes('IXSCAN') ? 'IXSCAN' : 'COLLSCAN',
    index: (plan.match(/"indexName":"([^"]+)"/) || [])[1] || null,
    nReturned: s.executionStats.nReturned,
    totalDocsExamined: s.executionStats.totalDocsExamined,
    totalKeysExamined: s.executionStats.totalKeysExamined,
    executionTimeMillis: s.executionStats.executionTimeMillis,
  };
};

title('Q11. explain ДО индекса {direction, type}: планировщик берёт индекс по type и вынужден просмотреть все apply-события (totalDocsExamined 8896), чтобы отфильтровать направление.');
try { d.events.dropIndex('direction_1_type_1'); } catch (e) { /* индекса ещё нет — это нормально */ }
printjson(explainQuery());

title('Q12. explain ПОСЛЕ создания индекса {direction: 1, type: 1}: IXSCAN по составному ключу, просматривается ровно столько документов, сколько вернулось (1145).');
d.events.createIndex({ direction: 1, type: 1 });
printjson(explainQuery());
