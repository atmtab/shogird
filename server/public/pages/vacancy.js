// Карточка вакансии: условия, навыки (у студента свои подсвечены), компания, отклик.
import { api, esc, t, mountHeader, initI18n, onLangChange, getMe, queryId, stipendText, fmtDate, chip, badge, matchBadge,
  errorBox, errText, toast, withBusy, loading } from '../app.js';

const content = document.getElementById('content');
let v = null;
let me = null;

await mountHeader();
initI18n();
me = await getMe();

function skillsBlock() {
  const required = v.skills.filter((s) => s.isRequired);
  const plus = v.skills.filter((s) => !s.isRequired);
  const chips = (list, cls) => list.map((s) => chip(s.name, s.have ? 'have' : cls)).join('');
  return `
    <h2>${esc(t('vacancy.skills'))}</h2>
    ${required.length ? `<p class="meta">${esc(t('vacancy.required'))}</p><div class="chips">${chips(required, '')}</div>` : ''}
    ${plus.length ? `<p class="meta" style="margin-top:10px">${esc(t('vacancy.nice'))}</p><div class="chips">${chips(plus, 'plus')}</div>` : ''}
    ${me?.role === 'student' ? `<p class="meta" style="margin-top:10px">${esc(t('vacancy.haveHint'))}</p>` : ''}`;
}

function applyBlock() {
  if (!me) return `<p>${esc(t('vacancy.loginToApply'))}</p><a class="btn" href="auth.html">${esc(t('nav.login'))}</a>`;
  if (me.role !== 'student') return '';
  if (v.application) return `<p>${esc(t('vacancy.yourStatus'))} ${badge(v.application.status)}</p><a class="btn secondary small" href="student.html#applications">${esc(t('vacancy.myApplications'))}</a>`;
  if (v.status !== 'open') return `<p class="meta">${esc(t('err.VACANCY_CLOSED'))}</p>`;
  return `
    <form id="apply-form">
      <div class="field"><label for="cover">${esc(t('vacancy.cover'))}</label>
        <textarea id="cover" maxlength="2000" placeholder="${esc(t('vacancy.coverHint'))}"></textarea></div>
      <button class="btn accent" type="submit">${esc(t('vacancy.apply'))}</button>
    </form>`;
}

function render() {
  if (!v) return;
  const rating = v.companyRating?.count ? `★ ${v.companyRating.avg} (${esc(t('company.reviewsCount', { n: v.companyRating.count }))})` : esc(t('company.noReviews'));
  content.innerHTML = `
    <div class="two-col">
      <section class="card">
        <div class="card-top"><h1>${esc(v.title)}</h1>${matchBadge(v.matchPct)}</div>
        <p class="meta">${esc(t('city.' + v.city))} · ${esc(t('format.' + v.workFormat))} · ${esc(t('direction.' + v.direction))}</p>
        <p class="money">${esc(stipendText(v))}</p>
        <p class="meta">${esc(t('vacancy.duration', { n: v.durationMonths }))} · ${esc(t('vacancy.seats', { left: v.seatsLeft, total: v.seats }))}
          ${v.deadline ? ' · ' + esc(t('vacancy.deadline', { date: fmtDate(v.deadline) })) : ''}</p>
        ${v.status !== 'open' ? `<p><span class="badge st-${esc(v.status)}">${esc(t('vstatus.' + v.status))}</span></p>` : ''}
        <p style="white-space:pre-line">${esc(v.description)}</p>
        ${skillsBlock()}
        ${v.views30d != null ? `<p class="meta" style="margin-top:12px">${esc(t('vacancy.views', { n: v.views30d }))}</p>` : ''}
      </section>
      <aside>
        <section class="card">
          <h3><a href="company.html?id=${encodeURIComponent(v.companyId)}">${esc(v.companyName)}</a></h3>
          ${v.isItparkResident ? `<p><span class="badge itpark">${esc(t('company.itpark'))}</span></p>` : ''}
          <p class="meta">${esc(t('city.' + v.companyCity))}${v.employeesRange ? ' · ' + esc(t('company.employees', { range: v.employeesRange })) : ''}</p>
          <p class="meta">${rating}</p>
        </section>
        <section class="card" id="apply-card">${applyBlock()}</section>
      </aside>
    </div>`;

  document.getElementById('apply-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    await withBusy(btn, async () => {
      try {
        await api(`/vacancies/${v.vacancyId}/apply`, { method: 'POST', body: { coverLetter: document.getElementById('cover').value } });
        toast(t('vacancy.applied'));
        await load();
      } catch (err) {
        toast(errText(err), 'error');
      }
    });
  });
}

async function load() {
  try {
    v = await api('/vacancies/' + queryId());
    render();
  } catch (e) {
    content.innerHTML = errorBox(e);
  }
}

content.innerHTML = loading();
onLangChange(render);
await load();
