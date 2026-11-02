// Кабинет студента: профиль и навыки (T5), резюме (Mongo), заявки (слоты T2, оффер T3, отзыв), рекомендации.
import { api, esc, t, mountHeader, initI18n, onLangChange, requireRole, setupTabs, options, enumOptions, chip, badge, vacancyCard,
  fmtDate, fmtDateTime, errText, errorBox, empty, loading, toast, openModal, withBusy } from '../app.js';

const me = await requireRole('student');
// requireRole уже отправил гостя на auth.html; дальше модуль не выполняем (вечный промис вместо ошибки в консоли)
if (!me) await new Promise(() => {});

await mountHeader('cabinet');
initI18n();

const S = { meta: null, profile: null, skills: new Map(), resume: null, apps: null, recs: null, tab: 'profile' };
const panel = (name) => document.getElementById('tab-' + name);

// Читаем значение поля по id (пустая строка = null)
const val = (id) => { const v = document.getElementById(id)?.value.trim(); return v ? v : null; };

// ======================= Профиль и навыки =======================
function renderProfile() {
  const p = S.profile;
  if (!p || !S.meta) return;
  const unis = [['', t('common.none')], ...S.meta.universities.map((u) => [u.universityId, u.name])];
  const byCat = {};
  for (const s of S.meta.skills) (byCat[s.category] ||= []).push(s);

  panel('profile').innerHTML = `
    <div class="two-col">
      <form class="card" id="profile-form" novalidate>
        <h2>${esc(t('student.tabProfile'))}</h2>
        <div class="field"><label for="p-name">${esc(t('profile.fullName'))}</label><input id="p-name" maxlength="100" value="${esc(p.fullName)}"></div>
        <div class="row two">
          <div class="field"><label for="p-uni">${esc(t('profile.university'))}</label><select id="p-uni">${options(unis, p.universityId ?? '')}</select></div>
          <div class="field"><label for="p-course">${esc(t('profile.course'))}</label>
            <select id="p-course">${options([['', t('common.none')], ...[1, 2, 3, 4, 5, 6].map((n) => [n, n])], p.course ?? '')}</select></div>
        </div>
        <div class="row two">
          <div class="field"><label for="p-city">${esc(t('filter.city'))}</label><select id="p-city">${enumOptions('city', S.meta.cities, p.city)}</select></div>
          <div class="field"><label for="p-phone">${esc(t('profile.phone'))}</label><input id="p-phone" type="tel" placeholder="+998901234567" value="${esc(p.phone || '')}"></div>
        </div>
        <div class="field"><label for="p-github">GitHub</label><input id="p-github" type="url" placeholder="https://github.com/…" value="${esc(p.githubUrl || '')}"></div>
        <div class="field"><label for="p-bio">${esc(t('profile.bio'))}</label><textarea id="p-bio" maxlength="2000">${esc(p.bio || '')}</textarea></div>
        <button class="btn" type="submit">${esc(t('common.save'))}</button>
      </form>
      <form class="card" id="skills-form">
        <h2>${esc(t('profile.skills'))}</h2>
        <p class="meta">${esc(t('profile.skillsHint'))}</p>
        ${Object.entries(byCat).map(([cat, list]) => `
          <div class="skill-group"><h3>${esc(t('direction.' + cat))}</h3>
            ${list.map((s) => {
              const level = S.skills.get(s.skillId);
              return `<div class="skill-row">
                <label><input type="checkbox" data-skill="${s.skillId}"${level ? ' checked' : ''}>${esc(s.name)}</label>
                <select data-level="${s.skillId}" aria-label="${esc(t('profile.level'))}"${level ? '' : ' disabled'}>${options([1, 2, 3, 4, 5].map((n) => [n, n]), level || 3)}</select>
              </div>`;
            }).join('')}
          </div>`).join('')}
        <button class="btn" type="submit">${esc(t('profile.saveSkills'))}</button>
      </form>
    </div>`;

  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await withBusy(e.target.querySelector('button'), async () => {
      try {
        await api('/me/profile', { method: 'PUT', body: {
          fullName: val('p-name'), universityId: val('p-uni') && Number(val('p-uni')), course: val('p-course') && Number(val('p-course')),
          city: val('p-city'), phone: val('p-phone'), githubUrl: val('p-github'), bio: val('p-bio') } });
        toast(t('common.saved'));
      } catch (ex) { toast(errText(ex), 'error'); }
    });
  });

  const skillsForm = document.getElementById('skills-form');
  skillsForm.addEventListener('change', (e) => {
    const id = Number(e.target.dataset.skill || e.target.dataset.level);
    const sel = skillsForm.querySelector(`[data-level="${id}"]`);
    if (e.target.dataset.skill) {
      sel.disabled = !e.target.checked;
      if (e.target.checked) S.skills.set(id, Number(sel.value)); else S.skills.delete(id);
    } else if (S.skills.has(id)) {
      S.skills.set(id, Number(e.target.value));
    }
  });
  skillsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await withBusy(e.target.querySelector('button'), async () => {
      try {
        await api('/me/skills', { method: 'PUT', body: [...S.skills].map(([skillId, level]) => ({ skillId, level })) });
        toast(t('common.saved'));
      } catch (ex) { toast(errText(ex), 'error'); }
    });
  });
}

// ======================= Резюме =======================
const LANG_CODES = ['uz', 'ru', 'en'];
const LANG_LEVELS = ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'];

// Читаем текущие значения из формы в S.resume (нужно перед добавлением и удалением строк)
function syncResume() {
  const form = document.getElementById('resume-form');
  if (!form) return;
  const r = S.resume;
  r.about = document.getElementById('r-about').value;
  r.languages = LANG_CODES.map((code) => ({ code, level: document.getElementById('lang-' + code).value })).filter((l) => l.level);
  r.projects = [...form.querySelectorAll('[data-project]')].map((row) => ({
    title: row.querySelector('[name=title]').value.trim(), url: row.querySelector('[name=url]').value.trim() || null,
    stack: row.querySelector('[name=stack]').value.split(',').map((x) => x.trim()).filter(Boolean) }));
  r.certificates = [...form.querySelectorAll('[data-cert]')].map((row) => ({
    name: row.querySelector('[name=name]').value.trim(), year: Number(row.querySelector('[name=year]').value) }));
}

function renderResume() {
  const r = S.resume;
  if (!r) return;
  const langLevel = (code) => (r.languages || []).find((l) => l.code === code)?.level || '';
  panel('resume').innerHTML = `
    <form class="card" id="resume-form" novalidate>
      <h2>${esc(t('student.tabResume'))}</h2>
      <div class="field"><label for="r-about">${esc(t('resume.about'))}</label><textarea id="r-about" maxlength="2000">${esc(r.about || '')}</textarea></div>
      <h3>${esc(t('resume.languages'))}</h3>
      <div class="row three">${LANG_CODES.map((code) => `
        <div class="field"><label for="lang-${code}">${esc(t('lang.' + code))}</label>
          <select id="lang-${code}">${options(LANG_LEVELS.map((l) => [l, l || t('common.none')]), langLevel(code))}</select></div>`).join('')}</div>
      <h3>${esc(t('resume.projects'))}</h3>
      ${(r.projects || []).map((p, i) => `
        <div class="card" data-project="${i}">
          <div class="field"><label>${esc(t('resume.projectTitle'))}</label><input name="title" maxlength="120" value="${esc(p.title)}"></div>
          <div class="row two">
            <div class="field"><label>URL</label><input name="url" type="url" value="${esc(p.url || '')}"></div>
            <div class="field"><label>${esc(t('resume.stack'))}</label><input name="stack" value="${esc((p.stack || []).join(', '))}"></div>
          </div>
          <button type="button" class="btn danger small" data-remove-project="${i}">${esc(t('common.delete'))}</button>
        </div>`).join('')}
      <button type="button" class="btn secondary small" id="add-project">${esc(t('resume.addProject'))}</button>
      <h3 style="margin-top:18px">${esc(t('resume.certificates'))}</h3>
      ${(r.certificates || []).map((c, i) => `
        <div class="row two" data-cert="${i}">
          <div class="field"><label>${esc(t('resume.certName'))}</label><input name="name" maxlength="120" value="${esc(c.name)}"></div>
          <div class="field"><label>${esc(t('resume.certYear'))}</label><input name="year" type="number" min="1990" max="2100" value="${esc(c.year)}"></div>
          <div><button type="button" class="btn danger small" data-remove-cert="${i}">${esc(t('common.delete'))}</button></div>
        </div>`).join('')}
      <button type="button" class="btn secondary small" id="add-cert">${esc(t('resume.addCert'))}</button>
      <div class="actions"><button class="btn" type="submit">${esc(t('common.save'))}</button></div>
    </form>`;

  const form = document.getElementById('resume-form');
  const edit = (fn) => { syncResume(); fn(); renderResume(); };
  document.getElementById('add-project').addEventListener('click', () => edit(() => S.resume.projects.push({ title: '', url: null, stack: [] })));
  document.getElementById('add-cert').addEventListener('click', () => edit(() => S.resume.certificates.push({ name: '', year: new Date().getFullYear() })));
  form.querySelectorAll('[data-remove-project]').forEach((b) => b.addEventListener('click', () => edit(() => S.resume.projects.splice(Number(b.dataset.removeProject), 1))));
  form.querySelectorAll('[data-remove-cert]').forEach((b) => b.addEventListener('click', () => edit(() => S.resume.certificates.splice(Number(b.dataset.removeCert), 1))));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    syncResume();
    await withBusy(e.target.querySelector('button[type=submit]'), async () => {
      try {
        await api('/me/resume', { method: 'PUT', body: S.resume });
        toast(t('common.saved'));
      } catch (ex) { toast(errText(ex), 'error'); }
    });
  });
}

// ======================= Заявки =======================
function appCard(a) {
  const canWithdraw = ['submitted', 'shortlisted', 'interview', 'offer'].includes(a.status);
  return `
    <article class="card" data-app="${a.applicationId}">
      <div class="card-top">
        <a class="card-title" href="vacancy.html?id=${a.vacancyId}">${esc(a.title)}</a>${badge(a.status)}
      </div>
      <p class="card-sub"><a href="company.html?id=${a.companyId}">${esc(a.companyName)}</a> · ${esc(fmtDate(a.createdAt))}</p>
      ${a.interviewAt ? `<p class="note">${esc(t('apps.interviewAt', { when: fmtDateTime(a.interviewAt) }))}${a.interviewPlace ? ` · ${esc(a.interviewPlace)}` : ''}</p>` : ''}
      ${a.status === 'offer' ? `<p class="note">${esc(t('apps.offerHint', { n: a.seatsLeft }))}</p>` : ''}
      <div class="actions">
        ${a.status === 'shortlisted' ? `<button class="btn accent small" data-act="book">${esc(t('apps.pickTime'))}</button>` : ''}
        ${a.status === 'offer' ? `<button class="btn accent small" data-act="accept">${esc(t('apps.accept'))}</button>
          <button class="btn secondary small" data-act="decline">${esc(t('apps.decline'))}</button>` : ''}
        ${a.status === 'accepted' ? `<button class="btn small" data-act="review">${esc(t('apps.review'))}</button>` : ''}
        ${canWithdraw ? `<button class="btn secondary small" data-act="withdraw">${esc(t('apps.withdraw'))}</button>` : ''}
      </div>
    </article>`;
}

function renderApplications() {
  if (!S.apps) return;
  panel('applications').innerHTML = S.apps.length ? S.apps.map(appCard).join('') : `${empty('apps.empty')}<p style="text-align:center"><a class="btn" href="index.html">${esc(t('nav.vacancies'))}</a></p>`;
}

async function loadApplications() {
  panel('applications').innerHTML = loading();
  try {
    S.apps = await api('/me/applications');
    renderApplications();
  } catch (e) { panel('applications').innerHTML = errorBox(e); }
}

// Запрос с подтверждением результата: тост, перезагрузка списка
async function act(button, path, okKey, body = {}) {
  await withBusy(button, async () => {
    try {
      await api(path, { method: 'POST', body });
      toast(t(okKey));
    } catch (e) { toast(errText(e), 'error'); }
    await loadApplications();   // после ошибки список тоже обновляем: состояние могло измениться
  });
}

async function openSlots(appId) {
  const m = openModal(t('apps.pickTime'), loading());
  try {
    const slots = await api(`/applications/${appId}/slots`);
    m.el.innerHTML = slots.length ? slots.map((s) => `
      <button class="btn secondary slot-btn" data-slot="${s.slotId}">${esc(fmtDateTime(s.startsAt))} · ${esc(t('apps.minutes', { n: s.durationMin }))}${s.place ? `<br><small>${esc(s.place)}</small>` : ''}</button>`).join('')
      : empty('apps.noSlots');
    m.el.querySelectorAll('[data-slot]').forEach((b) => b.addEventListener('click', async () => {
      m.close();
      await act(null, `/applications/${appId}/book`, 'apps.booked', { slotId: Number(b.dataset.slot) });
    }));
  } catch (e) { m.el.innerHTML = errorBox(e); }
}

function openReview(a) {
  const m = openModal(t('apps.review'), `
    <form id="review-form">
      <div class="field"><label for="rv-rating">${esc(t('review.rating'))}</label>
        <select id="rv-rating">${options([5, 4, 3, 2, 1].map((n) => [n, '★'.repeat(n)]))}</select></div>
      <div class="field"><label for="rv-pros">${esc(t('review.pros'))}</label><textarea id="rv-pros" maxlength="500"></textarea></div>
      <div class="field"><label for="rv-cons">${esc(t('review.cons'))}</label><textarea id="rv-cons" maxlength="500"></textarea></div>
      <label class="check"><input type="checkbox" id="rv-rec" checked>${esc(t('review.recommend'))}</label>
      <div class="actions"><button class="btn" type="submit">${esc(t('review.send'))}</button></div>
    </form>`);
  m.el.querySelector('#review-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await withBusy(e.target.querySelector('button'), async () => {
      try {
        await api(`/companies/${a.companyId}/reviews`, { method: 'POST', body: {
          rating: Number(document.getElementById('rv-rating').value), pros: val('rv-pros'), cons: val('rv-cons'),
          wouldRecommend: document.getElementById('rv-rec').checked } });
        toast(t('review.thanks'));
        m.close();
      } catch (ex) { toast(errText(ex), 'error'); }
    });
  });
}

panel('applications').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const appId = Number(btn.closest('[data-app]').dataset.app);
  const app = S.apps.find((x) => x.applicationId === appId);
  switch (btn.dataset.act) {
    case 'book': openSlots(appId); break;
    case 'accept': if (confirm(t('apps.confirmAccept'))) act(btn, `/applications/${appId}/accept`, 'apps.accepted'); break;
    case 'decline': if (confirm(t('apps.confirmDecline'))) act(btn, `/applications/${appId}/decline`, 'apps.declined'); break;
    case 'withdraw': if (confirm(t('apps.confirmWithdraw'))) act(btn, `/applications/${appId}/withdraw`, 'apps.withdrawn'); break;
    case 'review': openReview(app); break;
    default:
  }
});

// ======================= Рекомендации =======================
function renderRecs() {
  if (!S.recs) return;
  panel('recommendations').innerHTML = S.recs.length
    ? `<p class="meta">${esc(t('recs.hint'))}</p><div class="grid">${S.recs.map(vacancyCard).join('')}</div>`
    : empty('recs.empty');
}

// ======================= Загрузка по вкладкам =======================
async function loadTab(name) {
  S.tab = name;
  try {
    if (name === 'profile' && !S.profile) {
      panel('profile').innerHTML = loading();
      [S.meta, S.profile] = await Promise.all([S.meta || api('/meta'), api('/me/profile')]);
      S.skills = new Map(S.profile.skills.map((s) => [s.skillId, s.level]));
    }
    if (name === 'resume' && !S.resume) {
      panel('resume').innerHTML = loading();
      S.resume = await api('/me/resume');
      S.resume.languages ||= []; S.resume.projects ||= []; S.resume.certificates ||= [];
    }
    if (name === 'applications') await loadApplications();
    if (name === 'recommendations') {
      panel('recommendations').innerHTML = loading();
      S.recs = await api('/me/recommendations');
    }
    renderTab(name);
  } catch (e) { panel(name).innerHTML = errorBox(e); }
}

function renderTab(name) {
  ({ profile: renderProfile, resume: renderResume, applications: renderApplications, recommendations: renderRecs })[name]();
}

onLangChange(() => {
  if (S.tab === 'resume') syncResume();
  renderTab(S.tab);
});
setupTabs('profile', loadTab);
