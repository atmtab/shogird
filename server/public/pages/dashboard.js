// Аналитика: KPI, «разрыв навыков», воронка, города, активность, топ компаний. Графики на CSS-полосах, без библиотек.
import { api, esc, t, mountHeader, initI18n, onLangChange, fmtMoney, enumOptions, errorBox, loading } from '../app.js';

await mountHeader('dashboard');
initI18n();

const $ = (id) => document.getElementById(id);
const D = { overview: null, gap: null, funnel: null, cities: null, activity: null, top: null, direction: '' };
const pct = (value, max) => (max > 0 ? Math.max(2, Math.round((100 * value) / max)) : 0);   // минимум 2%, чтобы малые значения были видны

// Строка графика: подпись, полоса, значение
const barLine = (label, value, max, cls) => `
  <div class="bar-line"><span class="lbl">${esc(label)}</span>
    <div class="bar"><i class="${cls}" style="width:${pct(value, max)}%"></i></div><span class="val">${esc(value)}</span></div>`;

function renderKpis() {
  const o = D.overview;
  if (!o) return;
  $('kpis').innerHTML = o ? [
    ['dash.kpiVacancies', o.openVacancies], ['dash.kpiStudents', o.students], ['dash.kpiCompanies', o.companies],
    ['dash.kpiApplications', o.applications], ['dash.kpiAccepted', `${o.acceptedPct}%`],
  ].map(([k, v]) => `<div class="kpi"><b>${esc(v)}</b><span>${esc(t(k))}</span></div>`).join('')
    + (o.events7d != null ? `<div class="kpi"><b>${esc(o.events7d)}</b><span>${esc(t('dash.kpiEvents'))}</span></div>` : '') : '';
}

function renderGap() {
  if (!D.gap) return;
  // Три полосы на навык: сколько искали студенты, сколько вакансий требуют, сколько студентов владеют
  const top = D.gap.slice(0, 10);
  const maxSearch = Math.max(...top.map((x) => x.searches), 1);
  const maxCount = Math.max(...top.flatMap((x) => [x.vacancies, x.students]), 1);
  $('gap').innerHTML = `
    <h2>${esc(t('dash.gapTitle'))}</h2>
    <p class="meta">${esc(t('dash.gapHint'))}</p>
    <div class="legend">
      <span><i style="background:var(--zar)"></i>${esc(t('dash.searches'))}</span>
      <span><i style="background:var(--lapis)"></i>${esc(t('dash.vacancies'))}</span>
      <span><i style="background:var(--firuza)"></i>${esc(t('dash.students'))}</span>
    </div>
    ${top.map((x) => `
      <div class="gap-item"><h3><span>${esc(x.skill)}</span><span class="meta">${esc(t('dash.deficit', { n: x.deficit }))}</span></h3>
        ${barLine(t('dash.searches'), x.searches, maxSearch, 'searches')}
        ${barLine(t('dash.vacancies'), x.vacancies, maxCount, 'vacancies')}
        ${barLine(t('dash.students'), x.students, maxCount, 'students')}
      </div>`).join('')}`;
}

function renderFunnel() {
  const f = D.funnel;
  if (!f) return;
  const steps = f ? [['dash.fViews', f.views], ['dash.fApplications', f.applications], ['dash.fInterviews', f.interviews], ['dash.fAccepted', f.accepted]] : [];
  const max = steps[0]?.[1] || 1;
  $('funnel').innerHTML = `
    <h2>${esc(t('dash.funnelTitle'))}</h2>
    <div class="field"><select id="funnel-dir" aria-label="${esc(t('filter.direction'))}">${enumOptions('direction', ['frontend', 'backend', 'mobile', 'data', 'design', 'qa', 'devops', 'pm'], D.direction, true)}</select></div>
    ${steps.map(([k, v]) => `<div class="funnel-step"><div class="bar-line"><span class="lbl" style="width:110px">${esc(t(k))}</span><span class="val" style="width:auto;margin-left:auto">${esc(v)}</span></div>
      <div class="bar"><i style="width:${pct(v, max)}%"></i></div></div>`).join('')}`;
  $('funnel-dir').addEventListener('change', async (e) => {
    D.direction = e.target.value;
    try { D.funnel = await api('/stats/funnel' + (D.direction ? `?direction=${encodeURIComponent(D.direction)}` : '')); } catch { /* оставляем прежние данные */ }
    renderFunnel();
  });
}

function renderCities() {
  if (!D.cities) return;
  const max = Math.max(...D.cities.map((c) => c.vacancies), 1);
  $('cities').innerHTML = `<h2>${esc(t('dash.citiesTitle'))}</h2>` + D.cities.map((c) => `
    <div class="gap-item"><h3><span>${esc(t('city.' + c.city))}</span><span class="meta">${esc(t('dash.cityApps', { n: c.applications }))}</span></h3>
      ${barLine(t('dash.vacancies'), c.vacancies, max, 'vacancies')}
      <p class="meta">${esc(t('dash.avgStipend'))}: ${c.avgStipend ? esc(fmtMoney(c.avgStipend)) : '—'}</p></div>`).join('');
}

function renderActivity() {
  if (!D.activity) return;
  const max = Math.max(...D.activity.map((d) => d.events), 1);
  $('activity').innerHTML = `
    <h2>${esc(t('dash.activityTitle'))}</h2>
    <div class="activity">${D.activity.map((d) => `<div title="${esc(d.day)}: ${esc(d.events)}" style="height:${pct(d.events, max)}%"></div>`).join('')}</div>
    <p class="meta">${esc(D.activity[0]?.day || '')} — ${esc(D.activity.at(-1)?.day || '')}</p>`;
}

function renderTop() {
  if (!D.top) return;
  $('top').innerHTML = `<h2>${esc(t('dash.topTitle'))}</h2>` + D.top.map((c, i) => `
    <p><b>${i + 1}. <a href="company.html?id=${c.companyId}">${esc(c.name)}</a></b>
      ${c.isItparkResident ? `<span class="badge itpark">${esc(t('company.itpark'))}</span>` : ''}<br>
      <span class="meta">${esc(t('dash.topLine', { apps: c.applications, views: c.views }))}${c.rating ? ` · ★ ${esc(c.rating)} (${esc(c.reviews)})` : ''}</span></p>`).join('');
}

function renderAll() {
  renderKpis(); renderGap(); renderFunnel(); renderCities(); renderActivity(); renderTop();
}

['gap', 'funnel', 'cities', 'activity', 'top'].forEach((id) => { $(id).innerHTML = loading(); });
// Каждый блок грузится независимо: сбой одного эндпоинта не должен ронять всю страницу
const jobs = { overview: '/stats/overview', gap: '/stats/skills-gap', funnel: '/stats/funnel', cities: '/stats/cities', activity: '/stats/activity', top: '/stats/top-companies' };
const idOf = { overview: 'kpis', gap: 'gap', funnel: 'funnel', cities: 'cities', activity: 'activity', top: 'top' };
await Promise.all(Object.entries(jobs).map(async ([key, path]) => {
  try { D[key] = await api(path); } catch (e) { $(idOf[key]).innerHTML = errorBox(e); }
}));
renderAll();
onLangChange(renderAll);
