// Процент совпадения (SPEC §6.4): обязательный навык весит 1, «будет плюсом» 0,5.
// $1 = student_id, $2 = массив vacancy_id. У вакансии без навыков строки нет, в UI бейдж не показывается.
export const MATCH_SQL = `
  SELECT vs.vacancy_id,
         ROUND(100.0 * SUM(CASE WHEN ss.skill_id IS NOT NULL
                                THEN CASE WHEN vs.is_required THEN 1 ELSE 0.5 END ELSE 0 END)
                     / SUM(CASE WHEN vs.is_required THEN 1 ELSE 0.5 END))::int AS match_pct
  FROM vacancy_skills vs
  LEFT JOIN student_skills ss ON ss.skill_id = vs.skill_id AND ss.student_id = $1
  WHERE vs.vacancy_id = ANY($2::int[])
  GROUP BY vs.vacancy_id`;

export async function matchMap(db, studentId, vacancyIds) {
  if (!vacancyIds.length) return new Map();
  const r = await db.query(MATCH_SQL, [studentId, vacancyIds]);
  return new Map(r.rows.map((x) => [x.vacancy_id, x.match_pct]));
}
