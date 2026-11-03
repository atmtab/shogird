// Админ-панель: обзор, пользователи (просмотр), модерация вакансий и отзывов.
import { api, esc, t, mountHeader, initI18n, onLangChange, requireRole, setupTabs, fmtDate, errText, errorBox, loading, toast, withBusy } from '../app.js';

const me = await requireRole('admin');
// requireRole уже отправил не-админа на auth.html; дальше модуль не выполняем (вечный промис вместо ошибки в консоли)
if (!me) await new Promise(() => {});

await mountHeader('cabinet');
initI18n();

const panel = (name) => document.getElementById('tab-' + name);
const S = {
  tab: 'overview', overview: null,
  users: { q: '', page: 1, data: null }, vacancies: { status: '', page: 1, data: null }, reviews: { page: 1, data: null },
};
const pagesOf = (d) => Math.max(1, Math.ceil(d.total / d.pageSize));
const pagerHtml = (d) => (pagesOf(d) > 1 ? `
  <div class="pager">
    <button class="btn secondary small" data-pg="prev"${d.page <= 1 ? ' disabled' : ''}>${esc(t('common.prev'))}</button>
    <span>${esc(t('common.pageOf', { page: d.page, pages: pagesOf(d) }))}</span>
    <button class="btn secondary small" data-pg="next"${d.page >= pagesOf(d) ? ' disabled' : ''}>${esc(t('common.next'))}</button>
  </div>` : '');
// Подключает кнопки «Назад/Дальше» внутри панели: меняют страницу и перезагружают список
const bindPager = (name, state, load) => panel(name).querySelectorAll('[data-pg]').forEach((b) => b.addEventListener('click', () => {
  state.page += b.dataset.pg === 'next' ? 1 : -1;
  load();
}));

// ======================= Обзор =======================
function countBlock(titleKey, map, labelKey) {
  const rows = Object.entries(map || {}).sort((a, b) => b[1] - a[1]);
  return `<div class="card"><h2>${esc(t(titleKey))}</h2>
    ${rows.map(([k, n]) => `<p class="meta"><b>${esc(n)}</b> · ${esc(t(labelKey + k))}</p>`).join('')}</div>`;
}
function renderOverview() {
  const o = S.overview;
  if (!o) return;
  const sum = (m) => Object.values(m || {}).reduce((a, b) => a + b, 0);
  panel('overview').innerHTML = `
    <div class="kpis">
      ${[['admin.kpiUsers', sum(o.users)], ['admin.kpiVacancies', sum(o.vacancies)], ['admin.kpiApplications', sum(o.applications)], ['admin.kpiReviews', o.reviews ?? t('common.none')]]
        .map(([k, v]) => `<div class="kpi"><b>${esc(v)}</b><span>${esc(t(k))}</span></div>`).join('')}
    </div>
    <div class="two-col">
      ${countBlock('admin.usersByRole', o.users, 'role.')}
      ${countBlock('admin.vacanciesByStatus', o.vacancies, 'vstatus.')}
      ${countBlock('admin.applicationsByStatus', o.applications, 'status.')}
    </div>`;
}
async function loadOverview() {
  panel('overview').innerHTML = loading();
  try { S.overview = await api('/admin/overview'); renderOverview(); } catch (e) { panel('overview').innerHTML = errorBox(e); }
}

// ======================= Пользователи =======================
function renderUsers() {
  const d = S.users.data;
  panel('users').innerHTML = `
    <div class="field"><input id="u-q" type="search" maxlength="100" placeholder="${esc(t('admin.searchEmail'))}" value="${esc(S.users.q)}"></div>
    <div id="u-list">${d ? usersList(d) : loading()}</div>`;
  const input = document.getElementById('u-q');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { S.users.q = input.value.trim(); S.users.page = 1; loadUsers(); }, 350);   // не дёргаем сервер на каждую букву
  });
  if (d) bindPager('users', S.users, loadUsers);
}
const usersList = (d) => (d.items.length ? `<p class="meta">${esc(t('admin.found', { n: d.total }))}</p>
  ${d.items.map((u) => `<div class="card"><div class="card-top"><span class="card-title">${esc(u.email)}</span><span class="badge">${esc(t('role.' + u.role))}</span></div>
    <p class="meta">${esc(u.name || t('common.none'))} · ${esc(t('admin.registered', { date: fmtDate(u.createdAt) }))}</p></div>`).join('')}
  ${pagerHtml(d)}` : `<p class="empty">${esc(t('admin.empty'))}</p>`);
async function loadUsers() {
  const q = S.users.q ? `&q=${encodeURIComponent(S.users.q)}` : '';
  try {
    S.users.data = await api(`/admin/users?page=${S.users.page}${q}`);
    // Перерисовываем только список: поле поиска не трогаем, иначе оно потеряет фокус
    document.getElementById('u-list').innerHTML = usersList(S.users.data);
    bindPager('users', S.users, loadUsers);
  } catch (e) { document.getElementById('u-list').innerHTML = errorBox(e); }
}

// ======================= Вакансии =======================
function renderVacancies() {
  const d = S.vacancies.data;
  panel('vacancies').innerHTML = `
    <div class="field"><select id="v-status">
      <option value="">${esc(t('common.all'))}</option>
      ${['open', 'closed', 'draft'].map((s) => `<option value="${s}"${S.vacancies.status === s ? ' selected' : ''}>${esc(t('vstatus.' + s))}</option>`).join('')}
    </select></div>
    <div id="v-list">${d ? vacanciesList(d) : loading()}</div>`;
  document.getElementById('v-status').addEventListener('change', (e) => { S.vacancies.status = e.target.value; S.vacancies.page = 1; loadVacancies(); });
  if (d) bindVacancyActions();
}
const vacanciesList = (d) => (d.items.length ? `<p class="meta">${esc(t('admin.found', { n: d.total }))}</p>
  ${d.items.map((v) => `<div class="card"><div class="card-top"><span class="card-title">${esc(v.title)}</span><span class="badge st-${esc(v.status)}">${esc(t('vstatus.' + v.status))}</span></div>
    <p class="card-sub">${esc(v.companyName)}</p>
    <p class="meta">${esc(t('admin.seatsLine', { left: v.seatsLeft, seats: v.seats, apps: v.applications }))}${v.deadline ? ' · ' + esc(t('admin.deadline', { date: fmtDate(v.deadline) })) : ''}</p>
    ${v.status === 'open' ? `<div class="actions"><button class="btn danger small" data-set="closed" data-id="${esc(v.vacancyId)}" data-title="${esc(v.title)}">${esc(t('admin.closeVacancy'))}</button></div>` : ''}
    ${v.status === 'closed' && v.seatsLeft > 0 ? `<div class="actions"><button class="btn secondary small" data-set="open" data-id="${esc(v.vacancyId)}" data-title="${esc(v.title)}">${esc(t('admin.openVacancy'))}</button></div>` : ''}
  </div>`).join('')}
  ${pagerHtml(d)}` : `<p class="empty">${esc(t('admin.empty'))}</p>`);
function bindVacancyActions() {
  bindPager('vacancies', S.vacancies, loadVacancies);
  panel('vacancies').querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', async () => {
    const to = b.dataset.set;
    if (!confirm(t(to === 'closed' ? 'admin.confirmClose' : 'admin.confirmOpen', { title: b.dataset.title }))) return;
    try {
      await withBusy(b, () => api(`/admin/vacancies/${b.dataset.id}`, { method: 'PATCH', body: { status: to } }));
      toast(t('admin.updated'));
      S.overview = null;   // счётчики на вкладке «Обзор» устарели
      await loadVacancies();
    } catch (e) { toast(errText(e), 'error'); }
  }));
}
async function loadVacancies() {
  const st = S.vacancies.status ? `&status=${encodeURIComponent(S.vacancies.status)}` : '';
  try {
    S.vacancies.data = await api(`/admin/vacancies?page=${S.vacancies.page}${st}`);
    document.getElementById('v-list').innerHTML = vacanciesList(S.vacancies.data);
    bindVacancyActions();
  } catch (e) { document.getElementById('v-list').innerHTML = errorBox(e); }
}

// ======================= Отзывы =======================
function renderReviews() {
  const d = S.reviews.data;
  panel('reviews').innerHTML = `<div id="r-list">${d ? reviewsList(d) : loading()}</div>`;
  if (d) bindReviewActions();
}
const reviewsList = (d) => (d.items.length ? `<p class="meta">${esc(t('admin.found', { n: d.total }))}</p>
  ${d.items.map((r) => `<div class="card">
    <p class="card-title">${esc(t('admin.reviewMeta', { company: r.companyName || '#' + r.companyId, student: r.studentId, rating: r.rating }))}</p>
    <p class="meta">${esc(fmtDate(r.createdAt))}</p>
    ${r.pros ? `<p class="note"><b>${esc(t('admin.pros'))}:</b> ${esc(r.pros)}</p>` : ''}
    ${r.cons ? `<p class="note"><b>${esc(t('admin.cons'))}:</b> ${esc(r.cons)}</p>` : ''}
    <div class="actions"><button class="btn danger small" data-del="${esc(r.id)}">${esc(t('admin.deleteReview'))}</button></div>
  </div>`).join('')}
  ${pagerHtml(d)}` : `<p class="empty">${esc(t('admin.empty'))}</p>`);
function bindReviewActions() {
  bindPager('reviews', S.reviews, loadReviews);
  panel('reviews').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(t('admin.confirmDelete'))) return;
    try {
      await withBusy(b, () => api(`/admin/reviews/${b.dataset.del}`, { method: 'DELETE' }));
      toast(t('admin.deleted'));
      S.overview = null;
      // Если удалили последний отзыв на странице, возвращаемся на предыдущую
      if (S.reviews.data.items.length === 1 && S.reviews.page > 1) S.reviews.page--;
      await loadReviews();
    } catch (e) { toast(errText(e), 'error'); }
  }));
}
async function loadReviews() {
  try {
    S.reviews.data = await api(`/admin/reviews?page=${S.reviews.page}`);
    document.getElementById('r-list').innerHTML = reviewsList(S.reviews.data);
    bindReviewActions();
  } catch (e) { document.getElementById('r-list').innerHTML = errorBox(e); }
}

// ======================= Вкладки =======================
const renderers = { overview: renderOverview, users: renderUsers, vacancies: renderVacancies, reviews: renderReviews };
async function showTab(name) {
  S.tab = name;
  if (name === 'overview') { S.overview ? renderOverview() : await loadOverview(); }
  if (name === 'users') { renderUsers(); if (!S.users.data) await loadUsers(); }
  if (name === 'vacancies') { renderVacancies(); if (!S.vacancies.data) await loadVacancies(); }
  if (name === 'reviews') { renderReviews(); if (!S.reviews.data) await loadReviews(); }
}
// После закрытия вакансии или удаления отзыва кэш обзора сброшен: при возврате на вкладку загрузим заново
onLangChange(() => renderers[S.tab]());
setupTabs('overview', showTab);
