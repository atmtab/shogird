// Общие хелперы фронтенда: api(), esc(), форматирование, шапка, модалка, тосты, карточка вакансии.
// Подключается как ES-модуль со всех страниц. Никакого текста интерфейса здесь нет, только ключи i18n.
import { t, applyI18n, getLang, setLang, onLangChange } from './i18n.js';

export { t, applyI18n, getLang, setLang, onLangChange };

// ---------- Безопасность: любой текст из БД или от пользователя вставляем в innerHTML только через esc() ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- API ----------
function apiError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw apiError(0, 'NETWORK', 'Network error');
  }
  let data = null;
  try { data = await res.json(); } catch { /* пустое тело */ }
  if (!res.ok) throw apiError(res.status, data?.code || 'SERVER_ERROR', data?.error || 'Error');
  return data;
}

// Текст ошибки: перевод по коду, иначе английский текст сервера
export function errText(e) {
  const key = 'err.' + e.code;
  const s = t(key);
  return s !== key ? s : (e.message || t('err.SERVER_ERROR'));
}

// ---------- Текущий пользователь ----------
let mePromise = null;
export function getMe(force = false) {
  if (!mePromise || force) {
    mePromise = api('/auth/me?optional=true').catch(() => null);   // гость = null (сервер отвечает 200 null, а не 401)
  }
  return mePromise;
}

// Кабинет доступен только своей роли; иначе отправляем на вход
export async function requireRole(role) {
  const me = await getMe();
  if (!me || me.role !== role) {
    location.replace('auth.html');
    return null;
  }
  return me;
}

// ---------- Форматирование ----------
const LOCALES = { ru: 'ru-RU', uz: 'uz-UZ', en: 'en-US' };
export const locale = () => LOCALES[getLang()] || 'ru-RU';

export function fmtMoney(n) {
  if (n == null) return '';
  return `${new Intl.NumberFormat(locale()).format(n)} ${t('money.unit')}`;
}

// Даты из API приходят как 'YYYY-MM-DD' (DATE) или ISO-строка (TIMESTAMPTZ)
export function fmtDate(v) {
  if (!v) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00') : new Date(v);
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

export function fmtDateTime(v) {
  if (!v) return '';
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(v));
}

// ---------- Маленькие кирпичики разметки ----------
export const badge = (status) => `<span class="badge st-${esc(status)}">${esc(t('status.' + status))}</span>`;
export const chip = (text, cls = '') => `<span class="chip ${cls}">${esc(text)}</span>`;
export const matchBadge = (pct) => {
  if (pct == null) return '';
  const cls = pct >= 70 ? 'high' : pct >= 40 ? 'mid' : 'low';
  return `<span class="match ${cls}">${esc(t('match.badge', { pct }))}</span>`;
};
export const empty = (key) => `<p class="empty">${esc(t(key))}</p>`;
export const loading = () => `<p class="empty">${esc(t('common.loading'))}</p>`;
export const errorBox = (e) => `<p class="error-box" role="alert">${esc(errText(e))}</p>`;

// <option> для select: items = [[value, label]]
export const options = (items, selected = '') => items.map(([v, label]) =>
  `<option value="${esc(v)}"${String(v) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`).join('');
export const enumOptions = (prefix, values, selected = '', withAll = false) =>
  options([...(withAll ? [['', t('common.all')]] : []), ...values.map((v) => [v, t(`${prefix}.${v}`)])], selected);

export function stipendText(v) {
  if (!v.isPaid) return t('vacancy.unpaid');
  return v.stipend != null ? `${fmtMoney(v.stipend)} ${t('vacancy.perMonth')}` : t('vacancy.paid');
}

// Карточка вакансии (каталог, рекомендации, профиль компании)
export function vacancyCard(v) {
  const skills = (v.skills || []).map((s) => chip(s)).join('');
  return `
    <article class="card vacancy-card">
      <div class="card-top">
        <a class="card-title" href="vacancy.html?id=${encodeURIComponent(v.vacancyId)}">${esc(v.title)}</a>
        ${matchBadge(v.matchPct)}
      </div>
      <div class="card-sub">
        ${v.companyId ? `<a href="company.html?id=${encodeURIComponent(v.companyId)}">${esc(v.companyName)}</a>` : ''}
        ${v.isItparkResident ? `<span class="badge itpark">${esc(t('company.itpark'))}</span>` : ''}
      </div>
      <p class="meta">${esc(t('city.' + v.city))} · ${esc(t('format.' + v.workFormat))}</p>
      <p class="money">${esc(stipendText(v))}</p>
      ${skills ? `<div class="chips">${skills}</div>` : ''}
      ${v.applicationStatus ? `<p class="meta">${badge(v.applicationStatus)}</p>` : ''}
    </article>`;
}

// ---------- Модалка и тосты ----------
export function openModal(title, bodyHtml) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" type="button" data-close aria-label="${esc(t('common.close'))}">×</button></div>
      <div class="modal-body">${bodyHtml}</div>
    </div>`;
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  return { el: overlay.querySelector('.modal-body'), close };
}

export function toast(message, type = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// Кнопка на время запроса блокируется, чтобы не отправить форму дважды
export async function withBusy(button, fn) {
  if (button) button.disabled = true;
  try { return await fn(); } finally { if (button) button.disabled = false; }
}

// ---------- Шапка ----------
const STAR = `<svg class="logo-star" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"/><rect x="5" y="5" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" transform="rotate(45 12 12)"/></svg>`;

export async function mountHeader(active = '') {
  const me = await getMe();
  const el = document.getElementById('site-header');
  const render = () => {
    const cabinet = me ? (me.role === 'company' ? 'company-panel.html' : 'student.html') : null;
    const link = (href, key, id) => `<a href="${href}" class="${active === id ? 'active' : ''}">${esc(t(key))}</a>`;
    el.innerHTML = `
      <div class="container header-inner">
        <a class="logo" href="index.html">${STAR}<span>Shogird</span></a>
        <div class="lang-switch" role="group">
          ${['ru', 'uz', 'en'].map((l) => `<button type="button" data-lang="${l}" class="${getLang() === l ? 'active' : ''}">${l.toUpperCase()}</button>`).join('')}
        </div>
        <nav class="nav">
          ${link('index.html', 'nav.vacancies', 'catalog')}
          ${link('dashboard.html', 'nav.analytics', 'dashboard')}
          ${me ? link(cabinet, 'nav.cabinet', 'cabinet') + `<button type="button" class="linklike" id="logout-btn">${esc(t('nav.logout'))}</button>`
               : link('auth.html', 'nav.login', 'auth')}
        </nav>
      </div>`;
    el.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
    el.querySelector('#logout-btn')?.addEventListener('click', async () => {
      try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* всё равно уходим на главную */ }
      location.href = 'index.html';
    });
  };
  render();
  onLangChange(render);
}

// Первичное применение переводов к статической разметке страницы
export function initI18n() {
  applyI18n(document);
  onLangChange(() => applyI18n(document));
}

// Данные из ?id= в адресе
export const queryId = () => Number(new URLSearchParams(location.search).get('id'));

// Вкладки: переключают .tab-panel по data-tab; состояние хранится в location.hash
export function setupTabs(defaultTab, onShow) {
  const show = (name) => {
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
    history.replaceState(null, '', '#' + name);
    onShow(name);
  };
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  const initial = location.hash.slice(1);
  show(document.getElementById('tab-' + initial) ? initial : defaultTab);
}
