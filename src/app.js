// Uni Planner — timetable, deadlines and reminder settings, stored in Supabase.
import { remindersBetween, msToLocal, localToMs, addDays, prettyDate, b64urlToBytes, KIND_LABELS, COURSE_NAMES, DEFAULT_SETTINGS, pad }
  from '../supabase/functions/planner-push/core.js';
import { SEED_SETTINGS, SEED_CLASSES, SEED_EVENTS } from './seed.js';

const CFG = window.UP_CONFIG || {};
const sb = window.supabase && CFG.supabaseUrl
  ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'up-auth' } })
  : null;

const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} } };

const COURSES = ['BIOL 110', 'MA 265', 'CE 337', 'CE 462', 'CE 468', 'CE 400', 'AUM'];
const COLOR = { 'BIOL 110': '--c-biol', 'MA 265': '--c-ma', 'CE 337': '--c-337', 'CE 462': '--c-462', 'CE 468': '--c-468', 'CE 400': '--c-400', AUM: '--c-aum' };
const col = course => `var(${COLOR[course] || '--accent'})`;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const NOTIFY_KINDS = ['gca', 'exam', 'quiz', 'assignment', 'hw', 'lab', 'prelab', 'project'];
const ICONS = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  week: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16M15 4v16"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  deadlines: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>'
};
const VIEWS = [['today', 'Today'], ['week', 'Week'], ['calendar', 'Calendar'], ['deadlines', 'Deadlines'], ['settings', 'Reminders']];

const st = {
  session: null, settings: null, classes: [], events: [], loaded: false, offline: false,
  view: (location.hash || '').slice(1) || ls.get('up-view') || 'today',
  filt: new Set(), showPast: false, selDay: null,
  push: 'checking', pushBusy: false
};
if (!VIEWS.some(v => v[0] === st.view)) st.view = 'today';

// ---------- helpers ----------
const off = () => (st.settings?.tz_offset_min ?? 180);
const nowLocal = () => msToLocal(Date.now(), off());
const evLocal = e => msToLocal(Date.parse(e.due_at), off());
const hhmm = t => String(t || '').slice(0, 5);
const graded = e => NOTIFY_KINDS.includes(e.kind);
const termWeek = date => Math.floor((Date.parse(date) - Date.parse(st.settings?.term_start || '2026-09-20')) / 864e5 / 7) + 1;
function toast(msg) {
  $toast.textContent = msg; $toast.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { $toast.hidden = true; }, 3200);
}
function friendly(e) {
  const m = String(e?.message || e || '');
  if (/fetch|network|Failed/i.test(m)) return 'No connection. Showing the last saved copy.';
  if (/relation .* does not exist|planner_/i.test(m)) return 'The planner tables are missing in Supabase. Run supabase/setup.sql first.';
  return m;
}
function cache() { if (st.session) ls.set(`up-data-${st.session.user.id}`, JSON.stringify({ settings: st.settings, classes: st.classes, events: st.events })); }
const sortEvents = () => st.events.sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at) || a.title.localeCompare(b.title));
const sortClasses = () => st.classes.sort((a, b) => a.weekday - b.weekday || hhmm(a.start_time).localeCompare(hhmm(b.start_time)));

// ---------- data ----------
async function loadData() {
  const cached = ls.get(`up-data-${st.session.user.id}`);
  if (cached && !st.loaded) { try { Object.assign(st, JSON.parse(cached), { loaded: true }); sortEvents(); sortClasses(); render(); } catch (_) {} }
  try {
    const [s, c, e] = await Promise.all([
      sb.from('planner_settings').select('*').maybeSingle(),
      sb.from('planner_classes').select('*'),
      sb.from('planner_events').select('*')
    ]);
    for (const r of [s, c, e]) if (r.error) throw r.error;
    if (!s.data) { await seed(c.data.length === 0, e.data.length === 0); return loadData(); }
    st.settings = { ...DEFAULT_SETTINGS, ...s.data }; st.classes = c.data; st.events = e.data;
    st.loaded = true; st.offline = false; sortEvents(); sortClasses(); cache();
  } catch (err) {
    st.offline = true;
    if (!st.loaded) { renderMessage(friendly(err)); return; }
    toast(friendly(err));
  }
  render();
}
async function seed(needClasses, needEvents) {
  const { error } = await sb.from('planner_settings').upsert({ ...SEED_SETTINGS });
  if (error) throw error;
  if (needClasses) { const r = await sb.from('planner_classes').insert(SEED_CLASSES); if (r.error) throw r.error; }
  if (needEvents) { const r = await sb.from('planner_events').insert(SEED_EVENTS); if (r.error) throw r.error; }
  toast('Loaded your Fall 2026 timetable and deadlines.');
}

// ---------- push notifications on this device ----------
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
async function checkPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { st.push = isIOS && !standalone ? 'ios-install' : 'unsupported'; return; }
  if (Notification.permission === 'denied') { st.push = 'denied'; return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) { st.push = 'off'; return; }
    const { data } = await sb.from('planner_push_subs').select('endpoint').eq('endpoint', sub.endpoint).maybeSingle();
    st.push = data ? 'on' : 'off';
  } catch (_) { st.push = 'off'; }
}
function deviceName() {
  const ua = navigator.userAgent;
  const os = /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad' : /android/i.test(ua) ? 'Android' : /mac/i.test(ua) ? 'Mac' : /windows/i.test(ua) ? 'Windows' : 'Device';
  const br = /edg\//i.test(ua) ? 'Edge' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}
async function enablePush() {
  if (st.push === 'ios-install') { toast('On iPhone: tap Share, then Add to Home Screen, and open Planner from there.'); return; }
  if (!CFG.vapidPublicKey) { toast('The notification key is missing from config.js.'); return; }
  st.pushBusy = true; render();
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { st.push = perm === 'denied' ? 'denied' : 'off'; toast('Notifications were not allowed.'); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(CFG.vapidPublicKey) });
    const j = sub.toJSON();
    const { error } = await sb.from('planner_push_subs').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device: deviceName() });
    if (error) throw error;
    st.push = 'on'; toast('Reminders are on for this device.');
  } catch (e) { toast('Could not turn on notifications: ' + friendly(e)); }
  finally { st.pushBusy = false; render(); }
}
async function disablePush() {
  st.pushBusy = true; render();
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await sb.from('planner_push_subs').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
    st.push = 'off'; toast('Reminders are off for this device.');
  } catch (e) { toast(friendly(e)); }
  finally { st.pushBusy = false; render(); }
}
async function testPush() {
  st.pushBusy = true; render();
  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${CFG.supabaseUrl}/functions/v1/planner-push`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json' }, body: '{}'
    });
    const out = await res.json().catch(() => ({}));
    if (res.status === 404) toast('The planner-push function is not deployed yet.');
    else if (!res.ok) toast(out.error || `Test failed (${res.status}).`);
    else toast(out.delivered ? `Test sent to ${out.delivered} device${out.delivered > 1 ? 's' : ''}.` : 'No device accepted the test. Turn reminders off and on again.');
  } catch (e) { toast(friendly(e)); }
  finally { st.pushBusy = false; render(); }
}

// ---------- shell ----------
function renderMessage(msg) {
  $app.innerHTML = `<div class="login"><h1>Uni Planner</h1><div class="card"><p>${esc(msg)}</p><button class="btn" id="retry">Try again</button></div></div>`;
  document.getElementById('retry').onclick = () => loadData();
}
function renderLogin(err = '') {
  $app.innerHTML = `<div class="login">
    <div><div class="eyebrow">AUM · Fall 2026</div><h1 style="font-size:34px">Uni Planner</h1>
    <p class="muted">Sign in with the same account you use for PPL Coach and Nutrition Coach.</p></div>
    <form class="card" id="login">
      <div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="email" required></div>
      <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required></div>
      ${err ? `<p class="err">${esc(err)}</p>` : ''}
      <button class="btn primary" type="submit">Sign in</button>
    </form></div>`;
  document.getElementById('login').onsubmit = async ev => {
    ev.preventDefault();
    const btn = ev.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Signing in…';
    const { error } = await sb.auth.signInWithPassword({ email: document.getElementById('em').value.trim(), password: document.getElementById('pw').value });
    if (error) renderLogin(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
  };
}
function render() {
  if (!st.session) return renderLogin();
  if (!st.loaded) { $app.innerHTML = '<p class="boot">Loading your planner…</p>'; return; }
  const t = nowLocal(), w = termWeek(t.date);
  $app.innerHTML = `
  <header class="top"><div class="top-in">
    <div class="grow"><h1>Uni Planner</h1><div class="sub">${prettyDate(t.date)}${w >= 1 && w <= 19 ? ` · Week ${w}` : ''}${st.offline ? ' · offline copy' : ''}</div></div>
    <nav class="tabs" aria-label="Sections">${VIEWS.map(([id, label]) => `<button class="tab" data-view="${id}" ${st.view === id ? 'aria-current="page"' : ''}>${ICONS[id]}<span>${label}</span></button>`).join('')}</nav>
  </div></header>
  <main id="main">${({ today: viewToday, week: viewWeek, calendar: viewCalendar, deadlines: viewDeadlines, settings: viewSettings })[st.view]()}</main>`;
  $app.querySelectorAll('.tab').forEach(b => b.onclick = () => go(b.dataset.view));
  bind();
}
function go(view) {
  st.view = view; ls.set('up-view', view); history.replaceState(null, '', '#' + view);
  render(); window.scrollTo(0, 0);
}

// ---------- views ----------
function pushBanner() {
  if (st.push === 'on' || st.push === 'checking') return '';
  const msg = {
    off: 'Turn on reminders to get a notification 1 hour and 30 minutes before each class, and the evening before graded work.',
    'ios-install': 'To get reminders on iPhone, tap Share, then Add to Home Screen, then open Planner from your Home Screen.',
    denied: 'Notifications are blocked for this app. Allow them in your browser or phone settings, then reload.',
    unsupported: 'This browser cannot receive notifications. Use Chrome on Android, or add the app to your iPhone Home Screen.'
  }[st.push];
  return `<div class="banner"><p>${msg}</p>${st.push === 'off' ? `<button class="btn primary" data-act="push-on" ${st.pushBusy ? 'disabled' : ''}>Turn on reminders</button>` : ''}</div>`;
}
function classesOn(date) {
  const dow = msToLocal(localToMs(date, '12:00', off()), off()).dow;
  const s = st.settings;
  if (date < s.term_start || date > s.term_end || (s.skip_dates || []).includes(date)) return [];
  return st.classes.filter(c => Number(c.weekday) === dow);
}
function relDays(date) {
  const n = Math.round((Date.parse(date) - Date.parse(nowLocal().date)) / 864e5);
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 0 ? `${-n} days ago` : `in ${n} days`;
}
function viewToday() {
  const t = nowLocal();
  let day = t.date, list = classesOn(day);
  const nowT = t.time;
  let label = 'Today';
  if (!list.length || list.every(c => hhmm(c.end_time) <= nowT)) {
    for (let i = 1; i <= 21; i++) { const d = addDays(t.date, i); const l = classesOn(d); if (l.length) { day = d; list = l; label = i === 1 ? 'Tomorrow' : 'Next class day'; break; } }
  }
  const cls = list.map(c => {
    const s = hhmm(c.start_time), e = hhmm(c.end_time);
    const state = day === t.date ? (e <= nowT ? 'past' : s <= nowT ? 'now' : '') : '';
    return `<div class="cls ${state}" style="--c:${col(c.course)}"><span class="t">${s}–${e}${state === 'now' ? '<br>now' : ''}</span>
      <span><b>${esc(c.course)}</b> ${c.kind === 'Lab' ? 'Lab' : 'Lecture'}<span class="sub">${esc(c.room || '')}${c.instructor ? ' · ' + esc(c.instructor) : ''}</span></span></div>`;
  }).join('');
  const soon = st.events.filter(e => graded(e) && !e.done && evLocal(e).date >= t.date).slice(0, 6);
  const next = remindersBetween(st.settings, st.classes, st.events, Date.now(), Date.now() + 7 * 864e5).slice(0, 4);
  return `${pushBanner()}
  <div class="today-grid">
    <section class="card"><div class="row-between" style="margin-bottom:10px"><h2>${label}</h2><span class="eyebrow">${prettyDate(day)}</span></div>
      ${cls || '<p class="empty">No classes in the next three weeks.</p>'}</section>
    <section class="card"><div class="row-between" style="margin-bottom:10px"><h2>Due soon</h2><button class="linkbtn" data-go="deadlines">All deadlines</button></div>
      <div class="stack">${soon.map(e => { const l = evLocal(e); return `<div style="--c:${col(e.course)}">
        <span class="eyebrow" style="color:var(--accent)">${prettyDate(l.date)} · ${relDays(l.date)}</span><br>
        <span class="tag">${esc(e.course)}</span>${esc(e.title)}${e.weight ? `<span class="pct">${esc(e.weight)}</span>` : ''}
        ${e.note ? `<span class="sub">${esc(e.note)}</span>` : ''}</div>`; }).join('') || '<p class="empty">Nothing due. Enjoy it.</p>'}</div></section>
    <section class="card"><div class="row-between" style="margin-bottom:10px"><h2>Next reminders</h2><button class="linkbtn" data-go="settings">Settings</button></div>
      <div class="list">${next.map(r => { const l = msToLocal(r.at, off()); return `<div><span>${esc(r.title)}</span><span class="mono small muted">${l.date === t.date ? 'today' : prettyDate(l.date)} ${l.time}</span></div>`; }).join('') || '<p class="empty">No reminders in the next 7 days.</p>'}</div>
      ${st.push !== 'on' ? '<p class="note" style="margin:8px 0 0">These only reach you once reminders are on for this device.</p>' : ''}</section>
  </div>`;
}

function viewWeek() {
  const H0 = 8, H1 = 20, PX = 54, h = (H1 - H0) * PX;
  const toMin = t => { const [a, b] = hhmm(t).split(':').map(Number); return a * 60 + b; };
  const today = nowLocal().dow;
  let html = '<div class="dh"></div>' + DAYS.slice(0, 5).map((n, i) => `<div class="dh${i === today ? ' today' : ''}">${n}</div>`).join('');
  html += `<div class="times" style="height:${h + 8}px">` + Array.from({ length: H1 - H0 + 1 }, (_, i) => `<span class="hl" style="top:${i * PX + 4}px">${pad(H0 + i)}:00</span>`).join('') + '</div>';
  for (let d = 0; d < 5; d++) {
    html += `<div class="col${d === today ? ' today' : ''}" style="height:${h + 8}px">` + Array.from({ length: H1 - H0 + 1 }, (_, i) => `<div class="hr" style="top:${i * PX + 4}px"></div>`).join('');
    for (const c of st.classes.filter(k => Number(k.weekday) === d)) {
      const top = (toMin(c.start_time) - H0 * 60) / 60 * PX + 4, ht = (toMin(c.end_time) - toMin(c.start_time)) / 60 * PX - 3;
      html += `<button class="blk" data-class="${c.id}" style="--c:${col(c.course)};top:${top}px;height:${ht}px" aria-label="Edit ${esc(c.course)} ${esc(c.kind)}">
        <b>${esc(c.course)}${c.kind === 'Lab' ? ' Lab' : ''}</b><span class="t">${hhmm(c.start_time)}–${hhmm(c.end_time)}</span><br>${esc(c.room || '')}${ht > 60 && c.instructor ? `<br><span class="t">${esc(c.instructor)}</span>` : ''}</button>`;
    }
    html += '</div>';
  }
  const used = [...new Set(st.classes.map(c => c.course))];
  const sat = st.classes.filter(c => Number(c.weekday) > 4);
  return `<section><div class="sec-head"><h2>Weekly timetable</h2><button class="btn" data-act="add-class">Add class</button></div>
    <div class="tt-scroll"><div class="tt">${html}</div></div>
    ${sat.length ? `<p class="note">Also on ${sat.map(c => `${DAYS[c.weekday]} ${hhmm(c.start_time)} ${esc(c.course)}`).join(', ')}.</p>` : ''}
    <div class="legend">${used.map(k => `<span style="--c:${col(k)}"><i class="sw"></i>${esc(k)} · ${esc(COURSE_NAMES[k] || '')}</span>`).join('')}</div>
    <p class="note">Tap a class to change its time or room. Reminders follow these times.</p></section>`;
}

function dayFlags(date) {
  const s = st.settings, f = [];
  const evs = st.events.filter(e => evLocal(e).date === date);
  if (evs.some(e => e.kind === 'exam') || inRange(date, '2026-11-07', '2026-11-14') || inRange(date, '2027-01-16', '2027-01-24')) f.push('exam');
  if ((s.skip_dates || []).includes(date) && !f.includes('exam')) f.push('hol');
  return { f, evs };
}
const inRange = (d, a, b) => d >= a && d <= b;
function viewCalendar() {
  const s = st.settings, t = nowLocal().date;
  const out = [];
  let [y, m] = s.term_start.split('-').map(Number); m -= 1;
  const [ey, em] = s.term_end.split('-').map(Number);
  while (y < ey || (y === ey && m <= em - 1)) {
    let g = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(w => `<div class="wd">${w}</div>`).join('');
    const first = new Date(Date.UTC(y, m, 1)).getUTCDay(), n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    g += '<div></div>'.repeat(first);
    for (let d = 1; d <= n; d++) {
      const date = `${y}-${pad(m + 1)}-${pad(d)}`, dow = (first + d - 1) % 7;
      const { f, evs } = dayFlags(date);
      const gr = evs.filter(graded);
      const cls = ['day', ...f]; if (dow >= 5) cls.push('off'); if (date === t) cls.push('today'); if (date === st.selDay) cls.push('sel');
      g += `<button class="${cls.join(' ')}" data-day="${date}" aria-label="${prettyDate(date)}${gr.length ? `, ${gr.length} due` : ''}">${d}<span class="dots">${gr.map(e => `<i style="--c:${col(e.course)}"></i>`).join('')}</span></button>`;
    }
    out.push(`<div class="month"><h3>${MONTHS[m]} ${y}</h3><div class="mg">${g}</div></div>`);
    if (++m === 12) { m = 0; y++; }
  }
  const sel = st.selDay;
  const dayList = sel ? (() => {
    const cl = classesOn(sel), evs = st.events.filter(e => evLocal(e).date === sel);
    return `<section class="card" id="daycard"><div class="row-between" style="margin-bottom:8px"><h2>${prettyDate(sel)}</h2><button class="linkbtn" data-act="add-event" data-date="${sel}">Add item</button></div>
      <div class="stack">${evs.map(itemRow).join('')}${cl.map(c => `<div class="small" style="--c:${col(c.course)}"><span class="tag">${esc(c.course)}</span>${hhmm(c.start_time)}–${hhmm(c.end_time)} ${c.kind} · ${esc(c.room || '')}</div>`).join('')}
      ${!evs.length && !cl.length ? '<p class="empty">Nothing on this day.</p>' : ''}</div></section>`;
  })() : '';
  return `<section><div class="sec-head"><h2>Semester calendar</h2><span class="note">Dots mark graded work. Tap a day to see it.</span></div>
    ${dayList}<div class="months" style="margin-top:${sel ? '16px' : '0'}">${out.join('')}</div>
    <div class="mkey"><span><i style="background:var(--examBg);border:1px solid var(--exam)"></i>Exams</span><span><i style="background:var(--hol)"></i>No classes</span><span><i style="border:1px solid var(--accent)"></i>Today</span></div></section>`;
}

function willRemind(e) {
  const s = st.settings;
  return s.notify_events && e.remind !== false && !e.done && (s.event_kinds || []).includes(e.kind);
}
function itemRow(e) {
  const l = evLocal(e), cls = ['item', e.kind]; if (e.done) cls.push('done');
  const box = graded(e) ? `<input type="checkbox" id="done-${e.id}" data-done="${e.id}" ${e.done ? 'checked' : ''} aria-label="Done: ${esc(e.title)}">` : '<span></span>';
  return `<div class="${cls.join(' ')}" style="--c:${col(e.course)}">${box}
    <span class="d">${prettyDate(l.date)}${e.all_day ? '' : '<br>' + l.time}</span>
    <button class="what" data-event="${e.id}"><span class="tag">${esc(e.course)}</span><span class="what-title">${esc(e.title)}</span>${e.weight ? `<span class="pct">${esc(e.weight)}</span>` : ''}
      ${willRemind(e) ? ' <span class="bell" title="Reminder the evening before">· reminder</span>' : ''}${e.note ? `<span class="sub">${esc(e.note)}</span>` : ''}</button></div>`;
}
function viewDeadlines() {
  const t = nowLocal(), curW = termWeek(t.date);
  let list = st.events.filter(e => !st.filt.size || st.filt.has(e.course) || e.course === 'AUM');
  if (!st.showPast) list = list.filter(e => termWeek(evLocal(e).date) >= curW);
  const groups = new Map();
  for (const e of list) { const w = termWeek(evLocal(e).date); if (!groups.has(w)) groups.set(w, []); groups.get(w).push(e); }
  const start = st.settings.term_start;
  const weeks = [...groups.keys()].sort((a, b) => a - b).map(w => {
    const s = addDays(start, (w - 1) * 7), e = addDays(s, 6);
    const lbl = w < 1 ? 'Before term' : `Week ${w}`;
    return `<div class="wk${w === curW ? ' cur' : ''}"><div class="wl">${lbl}${w === curW ? ' · now' : ''}<small>${prettyDate(s).slice(4)} – ${prettyDate(e).slice(4)}</small></div><div class="rows">${groups.get(w).map(itemRow).join('')}</div></div>`;
  }).join('');
  const courses = COURSES.filter(c => c !== 'AUM' && st.events.some(e => e.course === c));
  return `<section><div class="sec-head"><h2>Deadlines</h2><button class="btn primary" data-act="add-event">Add item</button></div>
    <div class="filters">${courses.map(k => `<button class="chip" data-filt="${k}" aria-pressed="${st.filt.has(k)}" style="--c:${col(k)}"><i class="sw"></i>${k}</button>`).join('')}
      <label class="toggle"><input type="checkbox" id="showpast" ${st.showPast ? 'checked' : ''}> Show past weeks</label></div>
    <div class="weeks">${weeks || '<p class="empty">Nothing here.</p>'}</div>
    <p class="note" style="margin-top:18px">Midterm and final times aren't in the syllabi yet. When they're announced, use Add item with type Exam and you'll get a reminder the evening before.</p></section>`;
}

function viewSettings() {
  const s = st.settings;
  const pill = { on: '<span class="pill ok">On</span>', off: '<span class="pill off">Off</span>', checking: '<span class="pill off">Checking</span>', denied: '<span class="pill warn">Blocked</span>', unsupported: '<span class="pill warn">Not supported</span>', 'ios-install': '<span class="pill warn">Add to Home Screen</span>' }[st.push];
  const upcoming = remindersBetween(s, st.classes, st.events, Date.now(), Date.now() + 7 * 864e5);
  const leads = s.class_leads || [];
  return `${pushBanner()}
  <section class="card set">
    <div class="row-between"><h2>This device</h2>${pill}</div>
    <p class="note" style="margin:0">${esc(deviceName())}. Each phone or laptop needs reminders turned on once.</p>
    <div class="inline">
      ${st.push === 'on' ? `<button class="btn" data-act="push-off" ${st.pushBusy ? 'disabled' : ''}>Turn off on this device</button>` : `<button class="btn primary" data-act="push-on" ${st.pushBusy || st.push === 'denied' || st.push === 'unsupported' ? 'disabled' : ''}>Turn on reminders</button>`}
      <button class="btn" data-act="push-test" ${st.pushBusy || st.push !== 'on' ? 'disabled' : ''}>Send a test</button>
    </div>
  </section>
  <form class="card set" id="setform">
    <h2>What to remind you about</h2>
    <div class="stack">
      <label class="check"><input type="checkbox" id="s-cls" ${s.notify_classes ? 'checked' : ''}> Before every class</label>
      <div class="inline small"><span>Remind me</span>
        <input type="number" id="s-l1" min="0" max="600" step="5" value="${leads[0] ?? ''}" aria-label="First reminder, minutes before"> and
        <input type="number" id="s-l2" min="0" max="600" step="5" value="${leads[1] ?? ''}" aria-label="Second reminder, minutes before"> minutes before</div>
    </div>
    <div class="stack">
      <label class="check"><input type="checkbox" id="s-ev" ${s.notify_events ? 'checked' : ''}> The day before graded work, at</label>
      <div class="inline small"><input type="time" id="s-time" value="${hhmm(s.day_before_time)}" aria-label="Reminder time the day before"></div>
      <div class="kinds">${NOTIFY_KINDS.map(k => `<label class="check small"><input type="checkbox" data-kind="${k}" ${(s.event_kinds || []).includes(k) ? 'checked' : ''}> ${KIND_LABELS[k]}</label>`).join('')}</div>
    </div>
    <div class="actions"><button class="btn primary" type="submit">Save</button></div>
  </form>
  <section class="card set">
    <div class="row-between"><h2>Coming up in the next 7 days</h2><span class="mono small muted">${upcoming.length}</span></div>
    <div class="list">${upcoming.slice(0, 12).map(r => { const l = msToLocal(r.at, off()); return `<div><span>${esc(r.title)}<span class="sub">${esc(r.body)}</span></span><span class="mono small muted" style="white-space:nowrap">${prettyDate(l.date)} ${l.time}</span></div>`; }).join('') || '<p class="empty">Nothing scheduled.</p>'}</div>
    ${upcoming.length > 12 ? `<p class="note" style="margin:0">and ${upcoming.length - 12} more this week.</p>` : ''}
  </section>
  <section class="card set">
    <h2>Term dates</h2>
    <div class="two"><div class="field"><label for="t-start">Term starts</label><input type="date" id="t-start" value="${s.term_start}"></div>
      <div class="field"><label for="t-end">Classes end</label><input type="date" id="t-end" value="${s.term_end}"></div></div>
    <div class="lbl">Days with no classes <span class="muted small">(no class reminders; tap a day to remove it)</span></div>
    <div class="skips">${(s.skip_dates || []).slice().sort().map(d => `<button data-unskip="${d}" aria-label="Remove ${prettyDate(d)}">${prettyDate(d)}</button>`).join('') || '<p class="empty">None.</p>'}</div>
    <div class="inline"><input type="date" id="t-skip" aria-label="Add a day with no classes" style="border:1px solid var(--line);background:var(--bg);border-radius:8px;padding:7px 10px">
      <button class="btn" data-act="skip-add">Add day</button><button class="btn primary" data-act="term-save">Save dates</button></div>
  </section>
  <section class="card set"><h2>Account</h2>
    <div class="row-between"><span class="small">${esc(st.session.user.email)}</span><button class="btn" data-act="signout">Sign out</button></div></section>`;
}

// ---------- sheets ----------
function openEvent(e, date) {
  const isNew = !e;
  const l = e ? evLocal(e) : { date: date || nowLocal().date, time: '08:30' };
  e = e || { course: 'MA 265', kind: 'assignment', title: '', all_day: false, weight: '', note: '', remind: true };
  const kinds = Object.keys(KIND_LABELS);
  $sheet.innerHTML = `<form method="dialog" id="evform">
    <h2>${isNew ? 'Add item' : 'Edit item'}</h2>
    <div class="two"><div class="field"><label for="f-course">Course</label><select id="f-course">${COURSES.map(c => `<option ${c === e.course ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label for="f-kind">Type</label><select id="f-kind">${kinds.map(k => `<option value="${k}" ${k === e.kind ? 'selected' : ''}>${KIND_LABELS[k]}</option>`).join('')}</select></div></div>
    <div class="field"><label for="f-title">Title</label><input id="f-title" required value="${esc(e.title)}" placeholder="e.g. Midterm exam"></div>
    <div class="two"><div class="field"><label for="f-date">Date</label><input id="f-date" type="date" required value="${l.date}"></div>
      <div class="field"><label for="f-time">Time</label><input id="f-time" type="time" value="${e.all_day ? '' : l.time}"></div></div>
    <label class="check small"><input type="checkbox" id="f-allday" ${e.all_day ? 'checked' : ''}> All day (no time)</label>
    <div class="two"><div class="field"><label for="f-weight">Weight</label><input id="f-weight" value="${esc(e.weight || '')}" placeholder="20%"></div>
      <div class="field"><label for="f-note">Note</label><input id="f-note" value="${esc(e.note || '')}" placeholder="Room, chapters…"></div></div>
    <label class="check small"><input type="checkbox" id="f-remind" ${e.remind !== false ? 'checked' : ''}> Remind me the day before</label>
    <div class="actions">${isNew ? '' : '<button class="btn danger left" value="delete" type="button" id="f-del">Delete</button>'}
      <button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" type="submit" id="f-save">Save</button></div>
  </form>`;
  $sheet.showModal();
  const f = document.getElementById('evform');
  f.onsubmit = async ev => {
    ev.preventDefault();
    if (ev.submitter && ev.submitter.value === 'cancel') return $sheet.close();
    const allDay = document.getElementById('f-allday').checked || !document.getElementById('f-time').value;
    const date = document.getElementById('f-date').value, time = allDay ? '00:00' : document.getElementById('f-time').value;
    const row = {
      course: document.getElementById('f-course').value, kind: document.getElementById('f-kind').value,
      title: document.getElementById('f-title').value.trim(), all_day: allDay,
      due_at: new Date(localToMs(date, time, off())).toISOString(),
      weight: document.getElementById('f-weight').value.trim() || null, note: document.getElementById('f-note').value.trim() || null,
      remind: document.getElementById('f-remind').checked, updated_at: new Date().toISOString()
    };
    const q = isNew ? sb.from('planner_events').insert(row).select().single() : sb.from('planner_events').update(row).eq('id', e.id).select().single();
    const { data, error } = await q;
    if (error) return toast(friendly(error));
    if (isNew) st.events.push(data); else Object.assign(st.events.find(x => x.id === e.id), data);
    sortEvents(); cache(); $sheet.close(); toast('Saved.'); render();
  };
  const del = document.getElementById('f-del');
  if (del) del.onclick = async () => {
    if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Tap again to delete'; return; }
    const { error } = await sb.from('planner_events').delete().eq('id', e.id);
    if (error) return toast(friendly(error));
    st.events = st.events.filter(x => x.id !== e.id); cache(); $sheet.close(); toast('Deleted.'); render();
  };
}
function openClass(c) {
  const isNew = !c;
  c = c || { course: 'MA 265', kind: 'Lecture', weekday: 0, start_time: '08:30', end_time: '09:45', room: '', instructor: '' };
  $sheet.innerHTML = `<form method="dialog" id="clform">
    <h2>${isNew ? 'Add class' : 'Edit class'}</h2>
    <div class="two"><div class="field"><label for="c-course">Course</label><select id="c-course">${COURSES.filter(x => x !== 'AUM').map(x => `<option ${x === c.course ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="field"><label for="c-kind">Type</label><select id="c-kind">${['Lecture', 'Lab'].map(x => `<option ${x === c.kind ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
    <div class="field"><label for="c-day">Day</label><select id="c-day">${DAYS.map((d, i) => `<option value="${i}" ${i === Number(c.weekday) ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
    <div class="two"><div class="field"><label for="c-start">Starts</label><input id="c-start" type="time" required value="${hhmm(c.start_time)}"></div>
      <div class="field"><label for="c-end">Ends</label><input id="c-end" type="time" required value="${hhmm(c.end_time)}"></div></div>
    <div class="two"><div class="field"><label for="c-room">Room</label><input id="c-room" value="${esc(c.room || '')}"></div>
      <div class="field"><label for="c-who">Instructor</label><input id="c-who" value="${esc(c.instructor || '')}"></div></div>
    <div class="actions">${isNew ? '' : '<button class="btn danger left" type="button" id="c-del">Delete</button>'}
      <button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" type="submit">Save</button></div>
  </form>`;
  $sheet.showModal();
  document.getElementById('clform').onsubmit = async ev => {
    ev.preventDefault();
    if (ev.submitter && ev.submitter.value === 'cancel') return $sheet.close();
    const row = { course: document.getElementById('c-course').value, kind: document.getElementById('c-kind').value, weekday: Number(document.getElementById('c-day').value),
      start_time: document.getElementById('c-start').value, end_time: document.getElementById('c-end').value,
      room: document.getElementById('c-room').value.trim() || null, instructor: document.getElementById('c-who').value.trim() || null };
    if (row.end_time <= row.start_time) return toast('The end time must be after the start time.');
    const q = isNew ? sb.from('planner_classes').insert(row).select().single() : sb.from('planner_classes').update(row).eq('id', c.id).select().single();
    const { data, error } = await q;
    if (error) return toast(friendly(error));
    if (isNew) st.classes.push(data); else Object.assign(st.classes.find(x => x.id === c.id), data);
    sortClasses(); cache(); $sheet.close(); toast('Saved.'); render();
  };
  const del = document.getElementById('c-del');
  if (del) del.onclick = async () => {
    if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Tap again to delete'; return; }
    const { error } = await sb.from('planner_classes').delete().eq('id', c.id);
    if (error) return toast(friendly(error));
    st.classes = st.classes.filter(x => x.id !== c.id); cache(); $sheet.close(); toast('Deleted.'); render();
  };
}
$sheet.addEventListener('click', e => { if (e.target === $sheet) $sheet.close(); });

// ---------- settings saves ----------
async function saveSettings(patch) {
  const { data, error } = await sb.from('planner_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', st.session.user.id).select().single();
  if (error) { toast(friendly(error)); return false; }
  st.settings = { ...DEFAULT_SETTINGS, ...data }; cache(); return true;
}

// ---------- events ----------
function bind() {
  const main = document.getElementById('main');
  main.onclick = async ev => {
    const el = ev.target.closest('[data-act],[data-go],[data-event],[data-class],[data-day],[data-filt],[data-unskip]');
    if (!el) return;
    const d = el.dataset;
    if (d.go) return go(d.go);
    if (d.event) return openEvent(st.events.find(e => e.id === d.event));
    if (d.class) return openClass(st.classes.find(c => c.id === d.class));
    if (d.day) { st.selDay = st.selDay === d.day ? null : d.day; render(); if (st.selDay) document.getElementById('daycard')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (d.filt) { st.filt.has(d.filt) ? st.filt.delete(d.filt) : st.filt.add(d.filt); return render(); }
    if (d.unskip) { if (await saveSettings({ skip_dates: (st.settings.skip_dates || []).filter(x => x !== d.unskip) })) { toast('Removed.'); render(); } return; }
    switch (d.act) {
      case 'push-on': return enablePush();
      case 'push-off': return disablePush();
      case 'push-test': return testPush();
      case 'add-event': return openEvent(null, d.date);
      case 'add-class': return openClass(null);
      case 'signout': await sb.auth.signOut(); return;
      case 'skip-add': {
        const v = document.getElementById('t-skip').value;
        if (!v) return toast('Pick a date first.');
        const set = new Set(st.settings.skip_dates || []); set.add(v);
        if (await saveSettings({ skip_dates: [...set].sort() })) { toast('Added.'); render(); }
        return;
      }
      case 'term-save': {
        const a = document.getElementById('t-start').value, b = document.getElementById('t-end').value;
        if (!a || !b || b < a) return toast('Classes must end after the term starts.');
        if (await saveSettings({ term_start: a, term_end: b })) { toast('Saved.'); render(); }
      }
    }
  };
  main.onchange = async ev => {
    const t = ev.target;
    if (t.id === 'showpast') { st.showPast = t.checked; return render(); }
    if (t.dataset.done) {
      const e = st.events.find(x => x.id === t.dataset.done);
      const { error } = await sb.from('planner_events').update({ done: t.checked, updated_at: new Date().toISOString() }).eq('id', e.id);
      if (error) { t.checked = !t.checked; return toast(friendly(error)); }
      e.done = t.checked; cache(); render();
    }
  };
  const sf = document.getElementById('setform');
  if (sf) sf.onsubmit = async ev => {
    ev.preventDefault();
    const leads = [document.getElementById('s-l1').value, document.getElementById('s-l2').value].map(Number).filter(n => n > 0);
    const kinds = [...sf.querySelectorAll('[data-kind]')].filter(x => x.checked).map(x => x.dataset.kind);
    const ok = await saveSettings({ notify_classes: document.getElementById('s-cls').checked, class_leads: leads,
      notify_events: document.getElementById('s-ev').checked, day_before_time: document.getElementById('s-time').value || '20:00', event_kinds: kinds });
    if (ok) { toast('Reminder settings saved.'); render(); }
  };
}

// ---------- start ----------
async function start() {
  if (!sb) { renderMessage('Supabase is not configured. Check config.js.'); return; }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const { data: { session } } = await sb.auth.getSession();
  st.session = session;
  sb.auth.onAuthStateChange((evt, s) => {
    const was = st.session?.user?.id; st.session = s;
    if (!s) { st.loaded = false; render(); }
    else if (s.user.id !== was) { st.loaded = false; loadData(); checkPush().then(render); }
  });
  render();
  if (session) { await loadData(); await checkPush(); render(); }
  // Keep "now" and "today" fresh while the app stays open.
  setInterval(() => { if (st.loaded && !$sheet.open && document.visibilityState === 'visible' && ['today', 'week'].includes(st.view)) render(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && st.loaded) loadData(); });
}
start();
