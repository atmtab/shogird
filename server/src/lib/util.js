// snake_case из БД -> camelCase для JSON. NUMERIC приходит строкой, поэтому деньги приводим к числу.
const MONEY_KEYS = new Set(['stipend', 'avg_stipend']);
const camelKey = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

export function camel(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[camelKey(k)] = MONEY_KEYS.has(k) && v != null ? Number(v) : v;
  return out;
}

// Экранирование % и _ в строке для ILIKE, чтобы пользователь не подставлял свои шаблоны
export const likeEscape = (s) => s.replace(/[\\%_]/g, '\\$&');
