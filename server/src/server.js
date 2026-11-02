import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { pool, mongo } from './db.js';
import { wrap } from './lib/errors.js';

const app = express();
app.set('trust proxy', 1); // на Render приложение стоит за прокси, иначе secure-cookie не сработает
app.use(express.json());
app.use(cookieParser());

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
app.use(express.static(publicDir));

// Проверяем обе базы. Падение одной не должно скрывать состояние другой.
app.get('/api/health', wrap(async (req, res) => {
  const pgRes = await pool.query('SELECT now() AS t');
  let mongoEvents = null;
  try {
    mongoEvents = await (await mongo()).collection('events').estimatedDocumentCount();
  } catch (e) {
    console.error('Mongo health:', e.message);
  }
  res.json({ ok: true, postgresTime: pgRes.rows[0].t, mongoEvents });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));

// Единый обработчик ошибок: наружу только { error, code }, подробности в консоль.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message,
    code: err.code || 'SERVER_ERROR',
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Shogird: http://localhost:${port}`));
