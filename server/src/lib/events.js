// Запись аналитики в MongoDB. ВСЕГДА без await и только после COMMIT: сбой логирования не должен ломать запрос.
import { mongo } from '../db.js';

function deviceOf(req) {
  const ua = req?.headers?.['user-agent'] || '';
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  return /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : 'desktop';
}

export function logEvent(req, type, extra = {}) {
  const u = req?.user;
  mongo()
    .then((db) => db.collection('events').insertOne({
      type,
      userId: u?.userId ?? null,
      role: u?.role === 'student' || u?.role === 'company' ? u.role : 'guest',
      vacancyId: null, companyId: null, direction: null, city: null,
      device: deviceOf(req),
      ...extra,
      ts: new Date(),
    }))
    .catch((e) => console.error('event log failed:', e.message));
}

export function logSearch(req, doc) {
  mongo()
    .then((db) => db.collection('search_logs').insertOne({ ...doc, userId: req?.user?.userId ?? null, ts: new Date() }))
    .catch((e) => console.error('search log failed:', e.message));
}

// Чтение из Mongo в ответах API: если база недоступна, отдаём запасное значение, а не 500.
export const safeMongo = (promise, fallback) => promise.catch((e) => { console.error('mongo read failed:', e.message); return fallback; });
