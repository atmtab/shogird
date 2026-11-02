// Проверка переводов: (1) наборы ключей ru/uz/en одинаковы; (2) каждый ключ, упомянутый в коде страниц, есть в словаре;
// (3) в узбекском нет «неправильных» апострофов вместо ʻ (U+02BB). Запуск: npm run i18n:check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dict } from '../public/i18n.js';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
let problems = 0;
const fail = (msg) => { problems++; console.error('ОШИБКА:', msg); };

// 1. Одинаковые наборы ключей
const langs = Object.keys(dict);
const all = new Set(langs.flatMap((l) => Object.keys(dict[l])));
for (const l of langs) {
  for (const k of all) if (!(k in dict[l])) fail(`в словаре "${l}" нет ключа ${k}`);
  for (const [k, v] of Object.entries(dict[l])) if (!String(v).trim()) fail(`пустой перевод ${l}:${k}`);
}

// Одинаковые плейсхолдеры {name} во всех языках
const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
for (const k of all) {
  const sets = new Set(langs.map((l) => ph(dict[l][k] || '')));
  if (sets.size > 1) fail(`разные плейсхолдеры у ключа ${k}`);
}

// 3. Узбекский: апострофы ' и ' после o/g и в словах-исключениях недопустимы, нужен ʻ
for (const [k, v] of Object.entries(dict.uz)) {
  if (/[oOgG]['’`‘]/.test(v)) fail(`uz:${k} содержит неправильный апостроф после o/g: "${v}"`);
}

// 2. Ключи, упомянутые в коде. Берём любые строковые литералы вида namespace.name с известным namespace
const namespaces = new Set([...all].map((k) => k.split('.')[0]));
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p); else if (/\.(html|js)$/.test(f.name) && f.name !== 'i18n.js') files.push(p);
  }
})(pub);

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(pub, file);
  const used = new Set();
  for (const m of text.matchAll(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g)) used.add(m[1]);
  for (const m of text.matchAll(/['"`]([a-z]+\.[A-Za-z0-9_]+)['"`]/g)) if (namespaces.has(m[1].split('.')[0]) && !/.(html|js|css)$/.test(m[1])) used.add(m[1]);   // имена файлов (auth.html) не ключи
  for (const k of used) if (!k.endsWith('_') && !all.has(k))   // 'cp.to_' = префикс динамического ключа cp.to_${status}
     fail(`${rel}: ключ ${k} не найден в словарях`);
  // Динамические ключи вида t('status.' + x): проверяем, что у префикса вообще есть ключи
  for (const m of text.matchAll(/t\(\s*['"`]([a-zA-Z_.]+\.)['"`]\s*\+|t\(`([a-zA-Z_.]+\.)\$\{/g)) {
    const prefix = m[1] || m[2];
    if (![...all].some((k) => k.startsWith(prefix))) fail(`${rel}: нет ключей с префиксом ${prefix}`);
  }
}

if (problems) { console.error(`\nНайдено проблем: ${problems}`); process.exit(1); }
console.log(`i18n OK: ${langs.join('/')} по ${all.size} ключей, проверено файлов: ${files.length}`);
