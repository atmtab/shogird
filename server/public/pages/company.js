// Публичный профиль компании: описание, открытые вакансии, отзывы стажёров.
import { api, esc, t, mountHeader, initI18n, onLangChange, queryId, vacancyCard, fmtDate, errorBox, empty, loading } from '../app.js';

const content = document.getElementById('content');
let c = null;

await mountHeader();
initI18n();

function render() {
  if (!c) return;
  const rating = c.rating?.count ? `★ ${c.rating.avg} · ${t('company.reviewsCount', { n: c.rating.count })}` : t('company.noReviews');
  const site = c.website && /^https?:\/\//.test(c.website) ? `<p><a href="${esc(c.website)}" target="_blank" rel="noopener noreferrer">${esc(c.website)}</a></p>` : '';
  content.innerHTML = `
    <section class="card">
      <h1>${esc(c.name)}</h1>
      ${c.isItparkResident ? `<p><span class="badge itpark">${esc(t('company.itpark'))}</span></p>` : ''}
      <p class="meta">${esc(t('city.' + c.city))}${c.employeesRange ? ' · ' + esc(t('company.employees', { range: c.employeesRange })) : ''} · ${esc(rating)}</p>
      ${c.description ? `<p>${esc(c.description)}</p>` : ''}${site}
    </section>
    <section class="section" style="margin-top:20px">
      <h2>${esc(t('company.openVacancies'))}</h2>
      ${c.vacancies.length ? `<div class="grid">${c.vacancies.map((v) => vacancyCard({ ...v, companyId: null, companyName: c.name })).join('')}</div>` : empty('company.noVacancies')}
    </section>
    <section class="section">
      <h2>${esc(t('company.reviews'))}</h2>
      ${c.reviews.length ? c.reviews.map((r) => `
        <article class="card">
          <p><b>★ ${esc(r.rating)}/5</b> <span class="meta">${esc(fmtDate(r.createdAt))}</span>
            ${r.wouldRecommend ? `<span class="badge st-accepted">${esc(t('company.recommend'))}</span>` : ''}</p>
          ${r.pros ? `<p>＋ ${esc(r.pros)}</p>` : ''}${r.cons ? `<p>－ ${esc(r.cons)}</p>` : ''}
          <div class="chips">${(r.tags || []).map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>
        </article>`).join('') : empty('company.noReviews')}
    </section>`;
}

content.innerHTML = loading();
try {
  c = await api('/companies/' + queryId());
  render();
} catch (e) {
  content.innerHTML = errorBox(e);
}
onLangChange(render);
