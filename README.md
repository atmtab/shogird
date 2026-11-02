# Shogird — платформа стажировок для студентов Узбекистана

Подробности: `SPEC.md` (что строим), `CLAUDE.md` (как строим).

## Запуск в 5 шагов (Windows)

1. Установить Node.js 20+, PostgreSQL 16/17 и MongoDB Community (службы на `localhost:5432` и `localhost:27017`).
2. `cd server && npm install`
3. `copy .env.example .env` и вписать пароль PostgreSQL в `DATABASE_URL`.
4. `npm run db:create` и `npm run db:reset` (создать базу, схему и сид).
5. `npm run dev` → http://localhost:3000, проверка: http://localhost:3000/api/health

## Демо-аккаунты
Пароль у всех: `Shogird2026!`

| Роль | Email |
|---|---|
| Студент | `aziza@example.uz` |
| Студент | `bekzod@example.uz` |
| Компания | `hr@registanlabs.example.uz` |

## Сценарий демо D1 + D2: порядок важен
Оффер на Junior Backend Intern (осталось 1 место) сначала принимает **Бекзод**, и **Азиза** получает `409 NO_SEATS`.
Если первой принять оффер Азизе, по правилу T3 её собеседование на Frontend Intern (D1) отменится.

## MongoDB
`npm run seed:mongo` (из `server/`) пересоздаёт коллекции и берёт ID из PostgreSQL, поэтому сначала выполните `npm run db:reset`.
Запросы: `mongosh mongodb://127.0.0.1:27017/shogird --file mongo/02_queries.mongodb.js`.
