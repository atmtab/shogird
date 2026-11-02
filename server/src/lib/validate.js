// Серверная валидация (клиенту не доверяем). Любая ошибка = 400 VALIDATION с понятным текстом.
import { httpError } from './errors.js';

const bad = (msg) => httpError(400, 'VALIDATION', msg);
const empty = (v) => v === undefined || v === null || v === '';

export function str(v, name, { min = 1, max = 255, required = true } = {}) {
  if (empty(v)) { if (required) throw bad(`${name} is required`); return null; }
  if (typeof v !== 'string') throw bad(`${name} must be a string`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw bad(`${name} must be ${min}..${max} characters`);
  return s;
}

export function int(v, name, { min, max, required = true } = {}) {
  if (empty(v)) { if (required) throw bad(`${name} is required`); return null; }
  const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be an integer ${min}..${max}`);
  return n;
}

export function oneOf(v, name, list, { required = true } = {}) {
  if (empty(v)) { if (required) throw bad(`${name} is required`); return null; }
  if (!list.includes(v)) throw bad(`${name} must be one of: ${list.join(', ')}`);
  return v;
}

export function bool(v, name, { required = false, fallback = false } = {}) {
  if (v === undefined || v === null) { if (required) throw bad(`${name} is required`); return fallback; }
  if (typeof v !== 'boolean') throw bad(`${name} must be true or false`);
  return v;
}

// Деньги: число >= 0, не более 2 знаков после запятой (в БД NUMERIC(12,2))
export function money(v, name, { required = false } = {}) {
  if (empty(v)) { if (required) throw bad(`${name} is required`); return null; }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n >= 1e10 || Math.abs(Math.round(n * 100) - n * 100) > 1e-6) throw bad(`${name} must be a non-negative amount`);
  return n;
}

// Дата YYYY-MM-DD (настоящая календарная дата)
export function dateOnly(v, name, { required = false } = {}) {
  if (empty(v)) { if (required) throw bad(`${name} is required`); return null; }
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) {
    throw bad(`${name} must be a date YYYY-MM-DD`);
  }
  return v;
}

export function array(v, name, { max = 50, required = false } = {}) {
  if (empty(v)) { if (required) throw bad(`${name} is required`); return []; }
  if (!Array.isArray(v) || v.length > max) throw bad(`${name} must be an array of at most ${max} items`);
  return v;
}

export function url(v, name) {
  const s = str(v, name, { max: 300, required: false });
  if (s && !/^https?:\/\/\S+$/.test(s)) throw bad(`${name} must start with http:// or https://`);
  return s;
}

// ID из req.params. Мусор или число меньше 1 = такой записи нет (404), а не 400.
export function paramId(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw httpError(404, 'NOT_FOUND', 'Not found');
  return n;
}

export const isPgError = (e, code) => Boolean(e) && e.code === code;
