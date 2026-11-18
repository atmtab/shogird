// Демо-чат в стиле Telegram: заказчик (компания) переписывается с кандидатами-стажёрами.
// Это НЕ рабочая функция: бэкенда и базы нет, сообщения живут только в памяти страницы,
// а ответы кандидатов заготовлены заранее и приходят по кругу с имитацией «печатает…».
import { esc, t, mountHeader, initI18n, onLangChange, locale } from '../app.js';

await mountHeader('chat');
initI18n();

const $ = (id) => document.getElementById(id);

// Кандидаты вымышленные. Имена и названия вакансий не переводятся (как контент из БД), тексты сообщений берутся из словарей по ключам.
const CONTACTS = [
  { id: 'c1', name: 'Dilnoza Karimova', vacancy: 'Junior DevOps (Docker)', color: '#0FA3A3', unread: 1 },
  { id: 'c2', name: 'Jasur Toshmatov', vacancy: 'Full-Stack Intern', color: '#1F3C88', unread: 0 },
  { id: 'c3', name: 'Madina Yusupova', vacancy: 'UI/UX Design Intern', color: '#E2A93B', unread: 0 },
];
const initials = (name) => name.split(' ').map((w) => w[0]).join('');
const minutesAgo = (m) => Date.now() - m * 60000;

// Сообщение хранит либо ключ словаря (key), либо текст пользователя (text): так при смене языка заготовки переводятся
const state = {
  active: null,
  typing: null,        // id собеседника, который «печатает»
  replies: {},         // сколько ответов уже отправлено каждым собеседником
  msgs: Object.fromEntries(CONTACTS.map((c, i) => [c.id, [
    { out: false, key: `chat.${c.id}.h1`, ts: minutesAgo(95 - i * 10) },
    { out: true, key: `chat.${c.id}.h2`, ts: minutesAgo(80 - i * 10) },
    { out: false, key: `chat.${c.id}.h3`, ts: minutesAgo(12 + i * 40) },
  ]])),
};

const body = (m) => (m.key ? t(m.key) : m.text);
const time = (ts) => new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
const last = (id) => state.msgs[id][state.msgs[id].length - 1];
const avatar = (c) => `<span class="avatar" style="background:${c.color}" aria-hidden="true">${esc(initials(c.name))}</span>`;

function renderList() {
  $('chat-list').innerHTML = CONTACTS.map((c) => {
    const m = last(c.id);
    return `<button type="button" class="chat-item${state.active === c.id ? ' active' : ''}" data-id="${c.id}">
      ${avatar(c)}
      <span class="chat-item-body">
        <span class="chat-item-top"><b>${esc(c.name)}</b><small>${esc(time(m.ts))}</small></span>
        <span class="chat-item-bottom"><span class="chat-preview">${m.out ? `<em>${esc(t('chat.you'))}:</em> ` : ''}${esc(body(m))}</span>${c.unread ? `<span class="unread">${esc(c.unread)}</span>` : ''}</span>
      </span></button>`;
  }).join('');
}

function renderThread() {
  const c = CONTACTS.find((x) => x.id === state.active);
  $('chat').classList.toggle('in-conv', !!c);
  $('chat-form').hidden = !c;
  if (!c) {
    $('chat-head').innerHTML = '';
    $('chat-msgs').innerHTML = `<p class="empty">${esc(t('chat.emptyConv'))}</p>`;
    return;
  }
  const status = state.typing === c.id ? `<span class="typing-txt">${esc(t('chat.typing'))}</span>` : esc(t('chat.online'));
  $('chat-head').innerHTML = `
    <button type="button" class="icon-btn chat-back" data-back aria-label="${esc(t('chat.back'))}">‹</button>
    ${avatar(c)}
    <span class="chat-head-info"><b>${esc(c.name)}</b><small>${status} · ${esc(c.vacancy)}</small></span>`;
  const bubbles = state.msgs[c.id].map((m) => `
    <div class="bubble ${m.out ? 'out' : 'in'}"><span>${esc(body(m))}</span><small>${esc(time(m.ts))}${m.out ? ' ✓✓' : ''}</small></div>`).join('');
  const dots = state.typing === c.id ? '<div class="bubble in typing"><i></i><i></i><i></i></div>' : '';
  const box = $('chat-msgs');
  box.innerHTML = bubbles + dots;
  box.scrollTop = box.scrollHeight;
}

const renderAll = () => { renderList(); renderThread(); };

function open(id) {
  state.active = id;
  CONTACTS.find((c) => c.id === id).unread = 0;
  renderAll();
}

// Ответ кандидата: сначала пауза, потом «печатает…», потом сообщение из заготовок (по кругу)
function scheduleReply(id) {
  setTimeout(() => { state.typing = id; renderThread(); }, 700);
  setTimeout(() => {
    const n = (state.replies[id] = (state.replies[id] || 0) + 1);
    state.typing = null;
    state.msgs[id].push({ out: false, key: `chat.${id}.r${((n - 1) % 3) + 1}`, ts: Date.now() });
    if (state.active !== id) CONTACTS.find((c) => c.id === id).unread += 1;
    renderAll();
  }, 2400);
}

$('chat-list').addEventListener('click', (e) => {
  const item = e.target.closest('[data-id]');
  if (item) open(item.dataset.id);
});
$('chat-head').addEventListener('click', (e) => {
  if (e.target.closest('[data-back]')) { state.active = null; renderAll(); }
});
$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text || !state.active) return;
  state.msgs[state.active].push({ out: true, text, ts: Date.now() });
  input.value = '';
  renderAll();
  scheduleReply(state.active);
});

// На широком экране сразу открываем первый чат, на телефоне сначала показываем список
if (matchMedia('(min-width: 760px)').matches) state.active = CONTACTS[0].id;
if (state.active) CONTACTS[0].unread = 0;
renderAll();
onLangChange(renderAll);
