// Выполняет один или несколько .sql-файлов подряд: node scripts/run-sql.js file1.sql file2.sql [--cloud] [--show]
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const args = process.argv.slice(2);
const cloud = args.includes('--cloud');
const show = args.includes('--show');
const files = args.filter((a) => !a.startsWith('--'));

if (!files.length) {
  console.error('Укажите хотя бы один .sql-файл');
  process.exit(1);
}

// Защита от потери данных: скрипты стирают таблицы, поэтому чужие хосты только с явным --cloud.
const host = new URL(process.env.DATABASE_URL).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) && !cloud) {
  console.error(`Отказ: DATABASE_URL указывает на "${host}", а не на localhost. Нужен флаг --cloud.`);
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});
await client.connect();

try {
  for (const file of files) {
    const sql = fs.readFileSync(path.resolve(file), 'utf8');
    const started = Date.now();
    // Весь файл уходит одним простым запросом: он выполняется как одна неявная транзакция,
    // поэтому при ошибке в середине файла база остаётся в прежнем состоянии.
    let results = await client.query(sql);
    if (!Array.isArray(results)) results = [results];
    console.log(`OK ${path.basename(file)}: ${results.length} команд, ${Date.now() - started} мс`);

    for (const r of results) {
      // Планы EXPLAIN показываем всегда: время выполнения нужно для отчёта.
      if (r.fields?.[0]?.name === 'QUERY PLAN') {
        console.log(r.rows.map((x) => x['QUERY PLAN']).join('\n'));
        console.log('---');
      } else if (show && r.command === 'SELECT') {
        console.log(`[SELECT] строк: ${r.rowCount}`);
        console.table(r.rows.slice(0, 5));
      } else if (show) {
        console.log(`[${r.command}] строк: ${r.rowCount}`);
      }
    }
  }
} catch (e) {
  console.error(`ОШИБКА: ${e.message}`);
  if (e.position) console.error(`Позиция в файле: ${e.position}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
