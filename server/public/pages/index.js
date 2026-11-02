// Каталог вакансий: поиск, фильтры, карточки, пагинация.
import { api, esc, t, getLang, mountHeader, initI18n, onLangChange, vacancyCard, options, enumOptions, errorBox, empty, loading } from '../app.js';

const state = { meta: null, q: '', direction: '', city: '', format: '', skill: '', paid: false, resident: false, page: 1 };
let timer = null;
let requestNo = 0;   // номер запроса: ответ устаревшего запроса не должен затереть свежий

await mountHeader('catalog');
initI18n();

const filtersEl = document.getElementById('filters');
const resultsEl = document.getElementById('results');
const pagerEl = document.getElementById('pager');
const qEl = document.getElementById('q');

function renderFilters() {
  const skills = (state.meta?.skills || []).map((s) => [s.name, s.name]);
  filtersEl.innerHTML = `
    <div><label for="f-direction">${esc(t('filter.direction'))}</label>
      <select id="f-direction" name="direction">${enumOptions('direction', state.meta?.directions || [], state.direction, true)}</select></div>
    <div><label for="f-city">${esc(t('filter.city'))}</label>
      <select id="f-city" name="city">${enumOptions('city', state.meta?.cities || [], state.city, true)}</select></div>
    <div><label for="f-format">${esc(t('filter.format'))}</label>
      <select id="f-format" name="format">${enumOptions('format', state.meta?.formats || [], state.format, true)}</select></div>
    <div><label for="f-skill">${esc(t('filter.skill'))}</label>
      <select id="f-skill" name="skill">${options([['', t('common.all')], ...skills], state.skill)}</select></div>
    <label class="check"><input type="checkbox" name="paid"${state.paid ? ' checked' : ''}>${esc(t('filter.paid'))}</label>
    <label class="check"><input type="checkbox" name="resident"${state.resident ? ' checked' : ''}>${esc(t('filter.resident'))}</label>`;
}

function renderResults(data) {
  if (!data.items.length) {
    resultsEl.innerHTML = empty('catalog.empty');
    pagerEl.innerHTML = '';
    return;
  }
  resultsEl.innerHTML = `<p class="meta">${esc(t('catalog.found', { n: data.total }))}</p>
    <div class="grid">${data.items.map(vacancyCard).join('')}</div>`;
  pagerEl.innerHTML = data.pages > 1 ? `
    <button class="btn secondary small" id="prev"${data.page <= 1 ? ' disabled' : ''}>${esc(t('common.prev'))}</button>
    <span>${esc(t('common.pageOf', { page: data.page, pages: data.pages }))}</span>
    <button class="btn secondary small" id="next"${data.page >= data.pages ? ' disabled' : ''}>${esc(t('common.next'))}</button>` : '';
  document.getElementById('prev')?.addEventListener('click', () => { state.page--; load(); window.scrollTo(0, 0); });
  document.getElementById('next')?.addEventListener('click', () => { state.page++; load(); window.scrollTo(0, 0); });
}

async function load() {
  const no = ++requestNo;
  const params = new URLSearchParams({ page: state.page, lang: getLang() });
  for (const k of ['q', 'direction', 'city', 'format', 'skill']) if (state[k]) params.set(k, state[k]);
  if (state.paid) params.set('paid', 'true');
  if (state.resident) params.set('resident', 'true');
  resultsEl.innerHTML = loading();
  try {
    const data = await api('/vacancies?' + params);
    if (no === requestNo) renderResults(data);
  } catch (e) {
    if (no === requestNo) { resultsEl.innerHTML = errorBox(e); pagerEl.innerHTML = ''; }
  }
}

function changed() {
  state.page = 1;
  load();
}

// Поиск с задержкой: каждый запрос пишется в search_logs, поэтому не отправляем на каждую букву
qEl.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => { state.q = qEl.value.trim(); changed(); }, 350);
});
filtersEl.addEventListener('change', (e) => {
  const el = e.target;
  state[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  changed();
});

// Язык сменился: перерисовываем фильтры и карточки без перезагрузки страницы
onLangChange(() => { renderFilters(); load(); });

try {
  state.meta = await api('/meta');
} catch (e) {
  resultsEl.innerHTML = errorBox(e);
}
renderFilters();
if (state.meta) load();
