// Создаёт базу из DATABASE_URL, если её ещё нет. Подключается к служебной базе postgres.
import 'dotenv/config';
import pg from 'pg';

const url = new URL(process.env.DATABASE_URL);
const dbName = url.pathname.slice(1);
url.pathname = '/postgres';

const client = new pg.Client({
  connectionString: url.toString(),
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});
await client.connect();
try {
  const r = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (r.rowCount) {
    console.log(`База "${dbName}" уже существует`);
  } else {
    // CREATE DATABASE не принимает параметры; имя берём из .env, а не от пользователя, и экранируем кавычки.
    await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    console.log(`База "${dbName}" создана`);
  }
} finally {
  await client.end();
}
