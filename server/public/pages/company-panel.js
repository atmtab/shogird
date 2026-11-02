// Кабинет компании: вакансии (форма T4), кандидаты с % совпадения, слоты собеседований.
import { api, esc, t, mountHeader, initI18n, onLangChange, requireRole, setupTabs, options, enumOptions, chip, badge, matchBadge,
  stipendText, fmtDate, fmtDateTime, errText, errorBox, empty, loading, toast, withBusy } from '../app.js';

const me = await requireRole('company');
// requireRole уже отправил гостя на auth.html; дальше модуль не выполняем (вечный промис вместо ошибки в консоли)
if (!me) await new Promise(() => {});

await mountHeader('cabinet');
initI18n();

const S = { meta: null, vacancies: null, editing: null, formOpen: false, selected: null, candidates: null, slots: null, tab: 'vacancies' };
const panel = (name) => document.getElementById('tab-' + name);
const val = (id) => { const v = document.getElementById(id)?.value.trim(); return v ? v : null; };

async function ensureData() {
  if (!S.meta) S.meta = await api('/meta');
  if (!S.vacancies) S.vacancies = await api('/company/vacancies');
  if (S.selected == null && S.vacancies.length) S.selected = S.vacancies[0].vacancyId;
}

// Выбор вакансии для вкладок «Кандидаты» и «Слоты»
function vacancyPicker() {
  return `<div class="field"><label for="pick">${esc(t('cp.vacancy'))}</label>
    <select id="pick">${options(S.vacancies.map((v) => [v.vacancyId, v.title]), S.selected)}</select></div>`;
}

// ======================= Вакансии =======================
function vacancyForm() {
  const v = S.editing || { title: '', description: '', direction: 'backend', workFormat: 'hybrid', city: 'Tashkent', isPaid: true, stipend: null,
    durationMonths: 3, seats: 1, status: 'open', deadline: null, skills: [] };
  const chosen = new Map(v.skills.map((s) => [s.skillId, s.isRequired]));
  const byCat = {};
  for (const s of S.meta.skills) (byCat[s.category] ||= []).push(s);
  return `
    <form class="card" id="vacancy-form" novalidate>
      <h2>${esc(t(S.editing ? 'cp.editVacancy' : 'cp.newVacancy'))}</h2>
      <div class="field"><label for="v-title">${esc(t('cp.title'))}</label><input id="v-title" maxlength="150" value="${esc(v.title)}"></div>
      <div class="field"><label for="v-desc">${esc(t('cp.description'))}</label><textarea id="v-desc" maxlength="5000">${esc(v.description)}</textarea></div>
      <div class="row three">
        <div class="field"><label for="v-dir">${esc(t('filter.direction'))}</label><select id="v-dir">${enumOptions('direction', S.meta.directions, v.direction)}</select></div>
        <div class="field"><label for="v-fmt">${esc(t('filter.format'))}</label><select id="v-fmt">${enumOptions('format', S.meta.formats, v.workFormat)}</select></div>
        <div class="field"><label for="v-city">${esc(t('filter.city'))}</label><select id="v-city">${enumOptions('city', S.meta.cities, v.city)}</select></div>
      </div>
      <div class="row three">
        <div class="field"><label class="check"><input type="checkbox" id="v-paid"${v.isPaid ? ' checked' : ''}>${esc(t('filter.paid'))}</label>
          <input id="v-stipend" type="number" min="0" step="1000" placeholder="${esc(t('cp.stipend'))}" value="${esc(v.stipend ?? '')}"${v.isPaid ? '' : ' disabled'}></div>
        <div class="field"><label for="v-months">${esc(t('cp.months'))}</label><input id="v-months" type="number" min="1" max="12" value="${esc(v.durationMonths)}"></div>
        <div class="field"><label for="v-seats">${esc(t('cp.seats'))}</label><input id="v-seats" type="number" min="1" max="1000" value="${esc(v.seats)}"></div>
      </div>
      <div class="row two">
        <div class="field"><label for="v-status">${esc(t('cp.status'))}</label><select id="v-status">${enumOptions('vstatus', ['draft', 'open', 'closed'], v.status)}</select></div>
        <div class="field"><label for="v-deadline">${esc(t('cp.deadline'))}</label><input id="v-deadline" type="date" value="${esc(v.deadline || '')}"></div>
      </div>
      <h3>${esc(t('profile.skills'))}</h3>
      <p class="meta">${esc(t('cp.skillsHint'))}</p>
      ${Object.entries(byCat).map(([cat, list]) => `
        <div class="skill-group"><h3>${esc(t('direction.' + cat))}</h3>
          ${list.map((s) => `<div class="skill-row">
            <label><input type="checkbox" data-vskill="${s.skillId}"${chosen.has(s.skillId) ? ' checked' : ''}>${esc(s.name)}</label>
            <label class="check" style="flex:none"><input type="checkbox" data-vreq="${s.skillId}"${chosen.get(s.skillId) === false ? '' : ' checked'}${chosen.has(s.skillId) ? '' : ' disabled'}>${esc(t('cp.required'))}</label>
          </div>`).join('')}
        </div>`).join('')}
      <div class="actions">
        <button class="btn" type="submit">${esc(t('common.save'))}</button>
        <button class="btn secondary" type="button" id="cancel-form">${esc(t('common.cancel'))}</button>
      </div>
    </form>`;
}

function renderVacancies() {
  if (!S.vacancies || !S.meta) return;
  const list = S.vacancies.length ? S.vacancies.map((v) => `
    <article class="card">
      <div class="card-top"><a class="card-title" href="vacancy.html?id=${v.vacancyId}">${esc(v.title)}</a><span class="badge st-${esc(v.status)}">${esc(t('vstatus.' + v.status))}</span></div>
      <p class="meta">${esc(t('city.' + v.city))} · ${esc(t('format.' + v.workFormat))} · ${esc(stipendText(v))} · ${esc(t('vacancy.seats', { left: v.seatsLeft, total: v.seats }))}</p>
      <div class="chips">${Object.entries(v.applicationsByStatus).map(([st, n]) => `<span class="chip">${esc(t('status.' + st))}: ${n}</span>`).join('') || `<span class="meta">${esc(t('cp.noApplications'))}</span>`}</div>
      <div class="actions">
        <button class="btn secondary small" data-edit="${v.vacancyId}">${esc(t('common.edit'))}</button>
        ${v.status !== 'closed' ? `<button class="btn danger small" data-close="${v.vacancyId}">${esc(t('cp.close'))}</button>` : ''}
      </div>
    </article>`).join('') : empty('cp.noVacancies');

  panel('vacancies').innerHTML = `
    ${S.formOpen ? vacancyForm() : `<button class="btn" id="new-vacancy">${esc(t('cp.newVacancy'))}</button>`}
    <div style="margin-top:16px">${list}</div>`;

  document.getElementById('new-vacancy')?.addEventListener('click', () => { S.editing = null; S.formOpen = true; renderVacancies(); });
  panel('vacancies').querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    S.editing = S.vacancies.find((v) => v.vacancyId === Number(b.dataset.edit));
    S.formOpen = true;
    renderVacancies();
    window.scrollTo(0, 0);
  }));
  panel('vacancies').querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(t('cp.confirmClose'))) return;
    await withBusy(b, async () => {
      try { await api(`/company/vacancies/${b.dataset.close}`, { method: 'DELETE' }); toast(t('common.saved')); } catch (e) { toast(errText(e), 'error'); }
      S.vacancies = null;
      await reloadVacancies();
    });
  }));

  const form = document.getElementById('vacancy-form');
  if (!form) return;
  document.getElementById('cancel-form').addEventListener('click', () => { S.formOpen = false; S.editing = null; renderVacancies(); });
  document.getElementById('v-paid').addEventListener('change', (e) => { document.getElementById('v-stipend').disabled = !e.target.checked; });
  form.addEventListener('change', (e) => {
    if (e.target.dataset.vskill) form.querySelector(`[data-vreq="${e.target.dataset.vskill}"]`).disabled = !e.target.checked;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const paid = document.getElementById('v-paid').checked;
    const skills = [...form.querySelectorAll('[data-vskill]:checked')].map((c) => ({
      skillId: Number(c.dataset.vskill), isRequired: form.querySelector(`[data-vreq="${c.dataset.vskill}"]`).checked }));
    const body = {
      title: val('v-title'), description: val('v-desc'), direction: val('v-dir'), workFormat: val('v-fmt'), city: val('v-city'),
      isPaid: paid, stipend: paid && val('v-stipend') ? Number(val('v-stipend')) : null,
      durationMonths: Number(val('v-months')), seats: Number(val('v-seats')), status: val('v-status'), deadline: val('v-deadline'), skills };
    await withBusy(e.target.querySelector('button[type=submit]'), async () => {
      try {
        if (S.editing) await api(`/company/vacancies/${S.editing.vacancyId}`, { method: 'PUT', body });
        else await api('/company/vacancies', { method: 'POST', body });
        toast(t('common.saved'));
        S.formOpen = false; S.editing = null;
        await reloadVacancies();
      } catch (ex) { toast(errText(ex), 'error'); }
    });
  });
}

async function reloadVacancies() {
  S.vacancies = await api('/company/vacancies');
  if (!S.vacancies.some((v) => v.vacancyId === S.selected)) S.selected = S.vacancies[0]?.vacancyId ?? null;
  S.candidates = null; S.slots = null;
  renderVacancies();
}

// ======================= Кандидаты =======================
function candidateCard(c) {
  const skills = c.skills.map((s) => chip(`${s.name} · ${s.level}`)).join('');
  const actions = {
    submitted: ['shortlisted', 'rejected'], shortlisted: ['rejected'], interview: ['offer', 'rejected'],
  }[c.status] || [];
  const btnClass = { shortlisted: 'accent', offer: 'accent', rejected: 'danger' };
  return `
    <article class="card cand" data-app="${c.applicationId}">
      <div class="head"><b>${esc(c.fullName)}</b><span>${matchBadge(c.matchPct)} ${badge(c.status)}</span></div>
      <p class="meta">${esc([c.university, c.course ? t('profile.courseN', { n: c.course }) : '', t('city.' + c.city)].filter(Boolean).join(' · '))}</p>
      ${c.githubUrl && /^https?:\/\//.test(c.githubUrl) ? `<p><a href="${esc(c.githubUrl)}" target="_blank" rel="noopener noreferrer">GitHub</a></p>` : ''}
      <div class="chips">${skills}</div>
      ${c.resume ? `<p class="meta" style="margin-top:8px">${esc(t('cp.resumeBrief', { n: c.resume.projectsCount }))}${c.resume.about ? ' · ' + esc(c.resume.about.slice(0, 120)) : ''}</p>` : ''}
      ${c.coverLetter ? `<p class="note">${esc(c.coverLetter)}</p>` : ''}
      <div class="field" style="margin-top:8px"><label>${esc(t('cp.note'))}</label>
        <input data-note maxlength="1000" value="${esc(c.companyNote || '')}"></div>
      ${c.status === 'interview' ? `<div class="row two"><div class="field"><label>${esc(t('cp.score'))}</label>
        <select data-score>${options([['', t('common.none')], ...[5, 4, 3, 2, 1].map((n) => [n, n])])}</select></div>
        <div class="field"><label>${esc(t('cp.feedback'))}</label><input data-feedback maxlength="1000"></div></div>` : ''}
      <div class="actions">
        ${actions.map((a) => `<button class="btn ${btnClass[a]} small" data-status="${a}">${esc(t('cp.to_' + a))}</button>`).join('')}
        <button class="btn secondary small" data-save-note>${esc(t('cp.saveNote'))}</button>
      </div>
    </article>`;
}

function renderCandidates() {
  if (!S.vacancies) return;
  if (!S.vacancies.length) { panel('candidates').innerHTML = empty('cp.noVacancies'); return; }
  panel('candidates').innerHTML = vacancyPicker() + (S.candidates
    ? (S.candidates.length ? S.candidates.map(candidateCard).join('') : empty('cp.noCandidates')) : loading());
  document.getElementById('pick').addEventListener('change', (e) => { S.selected = Number(e.target.value); S.candidates = null; loadCandidates(); });
}

async function loadCandidates() {
  renderCandidates();
  try {
    S.candidates = await api(`/company/vacancies/${S.selected}/applications`);
    renderCandidates();
  } catch (e) { panel('candidates').innerHTML = vacancyPicker() + errorBox(e); }
}

panel('candidates').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-status], [data-save-note]');
  if (!btn) return;
  const card = btn.closest('[data-app]');
  const body = { companyNote: card.querySelector('[data-note]').value.trim() || null };
  if (btn.dataset.status) {
    body.status = btn.dataset.status;
    const score = card.querySelector('[data-score]')?.value;
    if (score) body.score = Number(score);
    const fb = card.querySelector('[data-feedback]')?.value.trim();
    if (fb) body.feedback = fb;
  }
  await withBusy(btn, async () => {
    try {
      await api(`/company/applications/${card.dataset.app}`, { method: 'PATCH', body });
      toast(t('common.saved'));
    } catch (ex) { toast(errText(ex), 'error'); }
    S.vacancies = await api('/company/vacancies');
    await loadCandidates();   // после ошибки список тоже обновляем
  });
});

// ======================= Слоты =======================
function renderSlots() {
  if (!S.vacancies) return;
  if (!S.vacancies.length) { panel('slots').innerHTML = empty('cp.noVacancies'); return; }
  const list = !S.slots ? loading() : S.slots.length ? S.slots.map((s) => `
    <article class="card">
      <div class="card-top"><b>${esc(fmtDateTime(s.startsAt))}</b>
        ${s.isBooked ? `<span class="badge st-interview">${esc(t('cp.booked'))}</span>` : `<span class="badge st-open">${esc(t('cp.free'))}</span>`}</div>
      <p class="meta">${esc(t('apps.minutes', { n: s.durationMin }))}${s.place ? ' · ' + esc(s.place) : ''}${s.candidateName ? ' · ' + esc(s.candidateName) : ''}</p>
      ${s.isBooked ? '' : `<button class="btn danger small" data-del-slot="${s.slotId}">${esc(t('common.delete'))}</button>`}
    </article>`).join('') : empty('cp.noSlots');

  panel('slots').innerHTML = vacancyPicker() + `
    <form class="card" id="slot-form" style="margin-bottom:16px">
      <h3>${esc(t('cp.newSlot'))}</h3>
      <div class="row three">
        <div class="field"><label for="s-at">${esc(t('cp.slotStart'))}</label><input id="s-at" type="datetime-local" required></div>
        <div class="field"><label for="s-dur">${esc(t('cp.slotDuration'))}</label>
          <select id="s-dur">${options([15, 30, 45, 60, 90].map((n) => [n, t('apps.minutes', { n })]), 30)}</select></div>
        <div class="field"><label for="s-place">${esc(t('cp.slotPlace'))}</label><input id="s-place" maxlength="300"></div>
      </div>
      <button class="btn" type="submit">${esc(t('cp.addSlot'))}</button>
    </form>${list}`;

  document.getElementById('pick').addEventListener('change', (e) => { S.selected = Number(e.target.value); S.slots = null; loadSlots(); });
  document.getElementById('slot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const at = document.getElementById('s-at').value;
    if (!at) return;
    await withBusy(e.target.querySelector('button'), async () => {
      try {
        await api(`/company/vacancies/${S.selected}/slots`, { method: 'POST', body: {
          startsAt: new Date(at).toISOString(), durationMin: Number(document.getElementById('s-dur').value), place: val('s-place') } });
        toast(t('common.saved'));
        await loadSlots();
      } catch (ex) { toast(errText(ex), 'error'); }
    });
  });
  panel('slots').querySelectorAll('[data-del-slot]').forEach((b) => b.addEventListener('click', async () => {
    await withBusy(b, async () => {
      try { await api(`/company/slots/${b.dataset.delSlot}`, { method: 'DELETE' }); toast(t('common.saved')); } catch (ex) { toast(errText(ex), 'error'); }
      await loadSlots();
    });
  }));
}

async function loadSlots() {
  try {
    S.slots = await api(`/company/vacancies/${S.selected}/slots`);
    renderSlots();
  } catch (e) { panel('slots').innerHTML = vacancyPicker() + errorBox(e); }
}

// ======================= Вкладки =======================
async function loadTab(name) {
  S.tab = name;
  try {
    panel(name).innerHTML = S.vacancies ? panel(name).innerHTML : loading();
    await ensureData();
    if (name === 'vacancies') renderVacancies();
    if (name === 'candidates') await loadCandidates();
    if (name === 'slots') { renderSlots(); await loadSlots(); }
  } catch (e) { panel(name).innerHTML = errorBox(e); }
}

onLangChange(() => ({ vacancies: renderVacancies, candidates: renderCandidates, slots: renderSlots })[S.tab]());
setupTabs('vacancies', loadTab);
