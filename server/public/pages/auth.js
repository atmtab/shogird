// Вход и регистрация (студент или компания). После успеха cookie уже стоит, остаётся перейти в кабинет.
import { api, esc, t, mountHeader, initI18n, onLangChange, getMe, setupTabs, options, enumOptions, errText, toast, withBusy } from '../app.js';

await mountHeader('auth');
initI18n();

let meta = null;
let role = 'student';
const loginEl = document.getElementById('tab-login');
const registerEl = document.getElementById('tab-register');

const goCabinet = (r) => { location.href = { company: 'company-panel.html', admin: 'admin.html' }[r] || 'student.html'; };

// Уже вошедшего сразу отправляем в кабинет
const me = await getMe();
if (me) goCabinet(me.role);

function renderLogin() {
  loginEl.innerHTML = `
    <form id="login-form" novalidate>
      <div class="field"><label for="l-email">${esc(t('auth.email'))}</label><input id="l-email" type="email" autocomplete="username" required></div>
      <div class="field"><label for="l-pass">${esc(t('auth.password'))}</label><input id="l-pass" type="password" autocomplete="current-password" required></div>
      <p class="error-box" id="login-error" role="alert" hidden></p>
      <button class="btn" type="submit">${esc(t('auth.login'))}</button>
    </form>`;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('login-error');
    err.hidden = true;
    await withBusy(e.target.querySelector('button'), async () => {
      try {
        const u = await api('/auth/login', { method: 'POST', body: {
          email: document.getElementById('l-email').value, password: document.getElementById('l-pass').value } });
        goCabinet(u.role);
      } catch (ex) {
        err.textContent = errText(ex);
        err.hidden = false;
      }
    });
  });
}

function renderRegister() {
  const unis = [['', t('common.none')], ...(meta?.universities || []).map((u) => [u.universityId, u.shortName || u.name])];
  const isStudent = role === 'student';
  registerEl.innerHTML = `
    <form id="reg-form" novalidate>
      <div class="field">
        <label class="check"><input type="radio" name="role" value="student"${isStudent ? ' checked' : ''}>${esc(t('auth.iStudent'))}</label>
        <label class="check"><input type="radio" name="role" value="company"${!isStudent ? ' checked' : ''}>${esc(t('auth.iCompany'))}</label>
      </div>
      <div class="field"><label for="r-email">${esc(t('auth.email'))}</label><input id="r-email" type="email" autocomplete="username"></div>
      <div class="field"><label for="r-pass">${esc(t('auth.password'))}</label><input id="r-pass" type="password" autocomplete="new-password" minlength="8">
        <p class="meta">${esc(t('auth.passwordHint'))}</p></div>
      ${isStudent ? `
        <div class="field"><label for="r-name">${esc(t('profile.fullName'))}</label><input id="r-name" maxlength="100"></div>
        <div class="row two">
          <div class="field"><label for="r-uni">${esc(t('profile.university'))}</label><select id="r-uni">${options(unis)}</select></div>
          <div class="field"><label for="r-course">${esc(t('profile.course'))}</label>
            <select id="r-course">${options([['', t('common.none')], ...[1, 2, 3, 4, 5, 6].map((n) => [n, n])])}</select></div>
        </div>` : `
        <div class="field"><label for="r-cname">${esc(t('auth.companyName'))}</label><input id="r-cname" maxlength="120"></div>
        <div class="field"><label for="r-web">${esc(t('company.website'))}</label><input id="r-web" type="url" placeholder="https://"></div>
        <div class="field"><label for="r-desc">${esc(t('company.description'))}</label><textarea id="r-desc" maxlength="2000"></textarea></div>`}
      <div class="field"><label for="r-city">${esc(t('filter.city'))}</label>
        <select id="r-city">${enumOptions('city', meta?.cities || [], 'Tashkent')}</select></div>
      <p class="error-box" id="reg-error" role="alert" hidden></p>
      <button class="btn" type="submit">${esc(t('auth.register'))}</button>
    </form>`;

  registerEl.querySelectorAll('[name=role]').forEach((r) => r.addEventListener('change', () => { role = r.value; renderRegister(); }));
  document.getElementById('reg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = (id) => document.getElementById(id)?.value.trim() || undefined;
    const body = { role, email: val('r-email'), password: document.getElementById('r-pass').value, city: val('r-city') };
    if (isStudent) {
      Object.assign(body, { fullName: val('r-name'), universityId: val('r-uni') && Number(val('r-uni')), course: val('r-course') && Number(val('r-course')) });
    } else {
      Object.assign(body, { companyName: val('r-cname'), website: val('r-web'), description: val('r-desc') });
    }
    const err = document.getElementById('reg-error');
    err.hidden = true;
    await withBusy(e.target.querySelector('button[type=submit]'), async () => {
      try {
        const u = await api('/auth/register', { method: 'POST', body });
        toast(t('auth.welcome'));
        goCabinet(u.role);
      } catch (ex) {
        err.textContent = errText(ex);
        err.hidden = false;
      }
    });
  });
}

function renderAll() { renderLogin(); renderRegister(); }

try { meta = await api('/meta'); } catch { /* форма регистрации работает и без справочников */ }
renderAll();
onLangChange(renderAll);
setupTabs(new URLSearchParams(location.search).get('tab') === 'register' ? 'register' : 'login', () => {});
