import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { pool, mongo } from './db.js';
import { wrap } from './lib/errors.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import studentRoutes from './routes/student.js';
import companyRoutes from './routes/company.js';
import statsRoutes from './routes/stats.js';
import adminRoutes from './routes/admin.js';

// Без секрета JWT подписи были бы бессмысленны, поэтому падаем сразу при старте
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.startsWith('change-me')) {
  console.error('Задайте JWT_SECRET в server/.env (длинная случайная строка)');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1); // на Render приложение стоит за прокси, иначе secure-cookie не сработает
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
app.use(express.static(publicDir));

// 1. Проверяем обе базы. Падение Mongo не должно скрывать состояние PostgreSQL.
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

app.use('/api/auth', authRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', catalogRoutes);   // /meta, /vacancies, /vacancies/:id, /companies/:id
app.use('/api', studentRoutes);   // /me/*, /vacancies/:id/apply, /applications/:id/*, /companies/:id/reviews

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));

// Единый обработчик ошибок: наружу только { error, code }, подробности 500 остаются в консоли
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body', code: 'VALIDATION' });
  }
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message,
    code: status === 500 ? 'SERVER_ERROR' : err.code || 'SERVER_ERROR',
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Shogird: http://localhost:${port}`));
