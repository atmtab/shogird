import 'dotenv/config';
import pg from 'pg';
import { MongoClient } from 'mongodb';

// PGSSL=true нужен для Supabase; локально SSL выключен.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Клиент Mongo создаём сразу, но соединяемся лениво: сервер должен стартовать,
// даже если Mongo временно недоступна (пишем события «без await», сбой не критичен).
const mongoClient = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
let mongoReady = null;

export async function mongo() {
  if (!mongoReady) mongoReady = mongoClient.connect().catch((e) => { mongoReady = null; throw e; });
  await mongoReady;
  return mongoClient.db(process.env.MONGODB_DB || 'shogird');
}
