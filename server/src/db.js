import 'dotenv/config';
import pg from 'pg';
import { MongoClient } from 'mongodb';

// DATE (oid 1082) отдаём строкой 'YYYY-MM-DD': иначе pg делает из неё Date в локальной зоне, и дата в JSON сдвигается на день.
pg.types.setTypeParser(1082, (value) => value);

// PGSSL=true нужен для Supabase; локально SSL выключен.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Клиент Mongo создаём сразу, но соединяемся лениво: сервер должен стартовать,
// даже если Mongo временно недоступна (пишем события «без await», сбой не критичен).
const mongoClient = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
let mongoReady = null;

// Транзакция по шаблону гайда: BEGIN -> работа -> COMMIT; при ошибке ROLLBACK и проброс ошибки; client всегда возвращается в пул.
export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function mongo() {
  if (!mongoReady) mongoReady = mongoClient.connect().catch((e) => { mongoReady = null; throw e; });
  await mongoReady;
  return mongoClient.db(process.env.MONGODB_DB || 'shogird');
}
