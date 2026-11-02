// Shogird: MongoDB — коллекции, валидаторы и индексы (SPEC §7).
// Запуск: mongosh mongodb://127.0.0.1:27017/shogird --file mongo/01_setup.mongodb.js
// (или как playground в VS Code). СТИРАЕТ коллекции. Сами данные генерирует: npm run seed:mongo
// (там та же структура; скрипт берёт ID студентов и вакансий из PostgreSQL, чтобы они совпадали).

const d = db.getSiblingDB('shogird');

for (const name of ['events', 'search_logs', 'resumes', 'internship_reviews']) d.getCollection(name).drop();

// Валидаторов схемы нет сознательно: гибкая структура документов — причина выбора Mongo (SPEC §3),
// а корректность данных проверяет сервер. Коллекции создаются явно, чтобы их было видно в Compass.
for (const name of ['events', 'search_logs', 'resumes', 'internship_reviews']) d.createCollection(name);

// Индексы
d.events.createIndex({ type: 1, ts: -1 });
d.events.createIndex({ vacancyId: 1 });
d.search_logs.createIndex({ ts: -1 });
d.search_logs.createIndex({ 'filters.skills': 1 });
d.resumes.createIndex({ studentId: 1 }, { unique: true });
d.internship_reviews.createIndex({ companyId: 1, createdAt: -1 });
d.internship_reviews.createIndex({ companyId: 1, studentId: 1 }, { unique: true });   // один отзыв на пару

print('Коллекции и индексы созданы:', d.getCollectionNames().join(', '));
