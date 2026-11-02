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
