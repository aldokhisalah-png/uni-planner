// Fall '26 planner — timetable, deadlines and reminder settings, stored in Supabase.
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
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const NOTIFY_KINDS = ['gca', 'exam', 'quiz', 'assignment', 'hw', 'lab', 'prelab', 'project'];
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
  $app.innerHTML = `<div class="login"><h1>Fall <i>’26</i></h1><div class="card"><p>${esc(msg)}</p><div><button class="btn primary" id="retry">Try again</button></div></div></div>`;
  document.getElementById('retry').onclick = () => loadData();
}
function renderLogin(err = '') {
  $app.innerHTML = `<div class="login">
    <div class="head-t"><span class="meta">AUM · Computer Eng.</span><h1>Fall <i>’26</i></h1>
      <p class="lede">Sign in with the same account you use for PPL Coach and Nutrition Coach.</p></div>
    <form class="card" id="login">
      <div class="field"><label for="em">Email</label><input class="in" id="em" type="email" autocomplete="email" required></div>
      <div class="field"><label for="pw">Password</label><input class="in" id="pw" type="password" autocomplete="current-password" required></div>
      ${err ? `<p class="err">${esc(err)}</p>` : ''}
      <div><button class="btn primary" type="submit">Sign in</button></div>
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
  $app.innerHTML = `<div class="wrap">
    <header class="top">
      <div class="brand"><b>Fall <i>’26</i></b><span>AUM · Computer Eng.</span>${st.offline ? '<em>offline copy</em>' : ''}</div>
      <nav class="tabs" aria-label="Sections">${VIEWS.map(([id, label]) => `<button class="tab" data-view="${id}" ${st.view === id ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav>
    </header>
    <main id="main" class="view">${({ today: viewToday, week: viewWeek, calendar: viewCalendar, deadlines: viewDeadlines, settings: viewSettings })[st.view]()}</main>
  </div>`;
  $app.querySelectorAll('.tab').forEach(b => b.onclick = () => go(b.dataset.view));
  bind();
}
function go(view) {
  st.view = view; ls.set('up-view', view); history.replaceState(null, '', '#' + view);
  render(); window.scrollTo(0, 0);
}

// ---------- shared pieces ----------
const COURSE_INFO = {
  'BIOL 110': { name: 'Fundamentals of Biology I', h: 150 },
  'MA 265': { name: 'Linear Algebra', h: 60 },
  'CE 337': { name: 'ASIC Design Lab', h: 295 },
  'CE 462': { name: 'OOP in C++ & Java', h: 225 },
  'CE 468': { name: 'Compilers', h: 15 },
  'CE 400': { name: 'Prof. Dev. & Grad Project I', h: 95 },
  AUM: { name: 'Academic calendar', h: null }
};
const info = course => COURSE_INFO[course] || { name: course, h: 200 };
// Colour hooks: tone() adds the classes, hue() the inline hue, for any element that shows a course.
const isExamish = e => e.kind === 'exam' || (e.course === 'AUM' && /exam/i.test(e.title));
const tone = (course, exam = false) => exam ? 'c exams' : info(course).h == null ? 'c aum' : 'c';
const hue = course => `--h:${info(course).h ?? 0}`;
const EXAM_RANGES = [['2026-11-07', '2026-11-14'], ['2027-01-16', '2027-01-24']];
const inExams = d => EXAM_RANGES.some(([a, b]) => d >= a && d <= b);
const NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const word = n => NUM[n] || String(n);
const daysUntil = date => Math.round((Date.parse(date) - Date.parse(nowLocal().date)) / 864e5);
function rel(date) {
  const d = daysUntil(date);
  return d < 0 ? '' : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d < 14 ? `In ${d} days` : `In ${Math.round(d / 7)} weeks`;
}
function classesOn(date) {
  const s = st.settings, dow = msToLocal(localToMs(date, '12:00', off()), off()).dow;
  if (date < s.term_start || date > s.term_end || (s.skip_dates || []).includes(date)) return [];
  return st.classes.filter(c => Number(c.weekday) === dow);
}
const isOff = date => date < st.settings.term_start || date > st.settings.term_end || (st.settings.skip_dates || []).includes(date);
function willRemind(e) {
  const s = st.settings;
  return s.notify_events && e.remind !== false && !e.done && (s.event_kinds || []).includes(e.kind);
}
const gradedList = () => st.events.filter(graded);
function progress() {
  const g = gradedList(), d = g.filter(e => e.done).length;
  return `<div class="prog"><div class="prog-l"><span>Done this term</span><b>${d} / ${g.length}</b></div>
    <div class="bar"><i style="width:${g.length ? d / g.length * 100 : 0}%"></i></div></div>`;
}
function checkBtn(e, sm = false) {
  return `<button class="check${sm ? ' sm' : ''}${e.done ? ' on' : ''}" data-done="${e.id}" aria-pressed="${!!e.done}" aria-label="${e.done ? 'Mark not done' : 'Mark done'}: ${esc(e.title)}">${e.done ? '✓' : ''}</button>`;
}
function tags(e) {
  const ex = isExamish(e);
  return `<span class="tags"><span class="code">${ex && e.course === 'AUM' ? 'Exams' : esc(e.course)}</span>${e.weight ? `<span class="pct">${esc(e.weight)}</span>` : ''}${willRemind(e) ? '<span class="bell">· reminder</span>' : ''}</span>`;
}
// One deadline row: tick (graded work) or bullet, date, then the tappable body that opens the editor.
function rowHtml(e, withDate = true) {
  const l = evLocal(e), ex = isExamish(e);
  const kind = ex ? 'exam' : e.kind === 'academic' ? 'academic' : e.kind === 'info' ? 'info' : '';
  return `<div class="row ${kind} ${e.done ? 'done' : ''} ${withDate ? '' : 'nodate'} ${tone(e.course, ex)}" style="${hue(e.course)}">
    ${graded(e) ? checkBtn(e, true) : '<span class="bullet"></span>'}
    ${withDate ? `<span class="when">${prettyDate(l.date)}${e.all_day ? '' : '<br>' + l.time}</span>` : ''}
    <button class="open" data-event="${e.id}">${tags(e)}<span class="ttl">${esc(e.title)}</span>${e.note ? `<span class="sub">${esc(e.note)}</span>` : ''}</button>
  </div>`;
}
function pushNotice() {
  if (st.push === 'on' || st.push === 'checking') return '';
  const msg = {
    off: 'Reminders are off on this device. Turn them on to get a nudge an hour and 30 minutes before each class, and the evening before graded work.',
    'ios-install': 'To get reminders on iPhone, tap Share, then Add to Home Screen, then open the planner from your Home Screen.',
    denied: 'Notifications are blocked for this app. Allow them in your browser or phone settings, then reload.',
    unsupported: 'This browser can’t receive notifications. Use Chrome on Android, or add the app to your iPhone Home Screen.'
  }[st.push];
  return `<div class="notice"><p>${msg}</p>${st.push === 'off' ? `<button class="btn sage" data-act="push-on" ${st.pushBusy ? 'disabled' : ''}>Turn on reminders</button>` : ''}</div>`;
}

// ---------- Today ----------
function viewToday() {
  const t = nowLocal(), today = t.date, s = st.settings;
  const tw = termWeek(today);
  const weekLabel = tw < 1 ? 'Before term' : tw <= 17 ? `Week ${tw} of 17` : today <= '2027-01-24' ? 'Final exams' : 'Term over';
  const hour = Number(t.time.slice(0, 2));
  const greet = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : 'evening';
  const [y, m, d] = today.split('-').map(Number);
  const dateLabel = `${DAYS[t.dow]}, ${d} ${MONTHS[m - 1]}`;

  // Summary: plain facts only — classes today, things due today, and the next graded item after today.
  const todays = classesOn(today);
  const dueToday = st.events.filter(e => graded(e) && !e.done && evLocal(e).date === today).length;
  let summary = todays.length ? `${word(todays.length)} class${todays.length > 1 ? 'es' : ''} today` : 'No classes today';
  summary += dueToday ? `, and ${word(dueToday).toLowerCase()} thing${dueToday > 1 ? 's' : ''} due.` : ', and nothing due.';
  const next = st.events.find(e => graded(e) && !e.done && evLocal(e).date > today);
  summary += next ? ` Next up: ${next.course} ${next.title}, ${rel(evLocal(next).date).toLowerCase()}.` : ' Nothing else is due this term.';

  const t0 = Date.parse(s.term_start), t1 = Date.parse(s.term_end);
  const termPct = Math.min(100, Math.max(0, Math.round((Date.parse(today) - t0) / (t1 - t0) * 100)));
  const short = ds => { const [, mm, dd] = ds.split('-').map(Number); return `${dd} ${MONTHS[mm - 1].slice(0, 3)}`; };

  // Week strip: Sunday → Saturday of this week.
  const sun = addDays(today, -t.dow);
  const strip = Array.from({ length: 7 }, (_, i) => {
    const ds = addDays(sun, i), n = classesOn(ds).length, wk = i >= 5;
    const dues = st.events.filter(e => graded(e) && evLocal(e).date === ds);
    const note = inExams(ds) ? 'Exams' : wk ? 'Free' : isOff(ds) ? (ds < s.term_start || ds > s.term_end ? '—' : 'No classes') : `${n} class${n === 1 ? '' : 'es'}`;
    const cls = ds === today ? 'now' : wk ? 'off' : ds < today ? 'past' : '';
    return `<button class="sday ${cls}" data-strip="${ds}" aria-label="${prettyDate(ds)}: ${note}${dues.length ? `, ${dues.length} due` : ''}">
      <span class="wd">${DAYS[i].slice(0, 3)}</span><span class="n">${Number(ds.slice(8))}</span>
      <span class="dots">${dues.map(e => `<i class="${tone(e.course)}" style="${hue(e.course)}"></i>`).join('')}</span>
      <span class="note">${note}</span></button>`;
  }).join('');

  // Today's classes, or why there are none and when the next one is.
  const nowT = t.time;
  let classesHtml;
  if (todays.length) {
    classesHtml = `<div class="cls-list">${todays.map(c => {
      const s0 = hhmm(c.start_time), e0 = hhmm(c.end_time), now = s0 <= nowT && nowT < e0, past = e0 <= nowT;
      return `<div class="cls ${now ? 'now' : ''} ${past ? 'past' : ''} ${tone(c.course)}" style="${hue(c.course)}">
        <div class="t">${s0}<small>${e0}</small></div><div class="rail"></div>
        <div><div class="nm">${esc(info(c.course).name)}${now ? '<span class="pill">Now</span>' : ''}</div>
        <div class="sub">${esc(c.course)} ${c.kind === 'Lab' ? 'Lab' : 'Lecture'} · <span>${esc(c.room || '')}</span></div></div></div>`;
    }).join('')}</div>`;
  } else {
    const why = t.dow >= 5 ? 'Fridays and Saturdays are yours.' : inExams(today) ? 'It’s exam week. Check Moodle for your exam times.'
      : (today < s.term_start || today > s.term_end) ? 'The term isn’t in session.' : 'A day off from classes.';
    let nextC = '';
    for (let i = 1; i <= 21; i++) {
      const ds = addDays(today, i), l = classesOn(ds);
      if (l.length) { const c = l[0]; nextC = `Next class: ${esc(c.course)} ${c.kind === 'Lab' ? 'Lab' : 'Lecture'}, ${i === 1 ? 'tomorrow' : prettyDate(ds)} at ${hhmm(c.start_time)}.`; break; }
    }
    classesHtml = `<div class="off-day"><b>No classes today.</b><p class="muted">${why}${nextC ? ' ' + nextC : ''}</p></div>`;
  }
  const meta = todays.length ? `${hhmm(todays[0].start_time)} – ${hhmm(todays[todays.length - 1].end_time)}` : 'Day off';

  const upcoming = st.events.filter(e => e.kind !== 'info' && !e.done && evLocal(e).date >= today).slice(0, 5);
  const upHtml = upcoming.map(e => {
    const l = evLocal(e), [, mm, dd] = l.date.split('-').map(Number), ex = isExamish(e);
    return `<div class="up-row ${tone(e.course, ex)}" style="${hue(e.course)}">
      <div class="dt"><b>${dd}</b><span>${MONTHS[mm - 1].slice(0, 3)}</span></div>
      <button class="open bd" data-event="${e.id}">
        <span class="tags"><span class="code">${ex && e.course === 'AUM' ? 'Exams' : esc(e.course)}</span><span class="rel">${rel(l.date)}${e.all_day ? '' : ' · ' + l.time}</span></span>
        <span class="ttl">${esc(e.title)}${e.weight ? `<span class="pct">${esc(e.weight)}</span>` : ''}</span>
        ${e.note ? `<span class="sub">${esc(e.note)}</span>` : ''}</button>
      ${graded(e) ? checkBtn(e) : '<span></span>'}</div>`;
  }).join('');

  return `${pushNotice()}
  <section class="hero">
    <div class="eyebrow">${dateLabel} · ${weekLabel}</div>
    <h1>Good <i>${greet}</i>.</h1>
    <p class="summary">${esc(summary)}</p>
    <div class="prog"><div class="bar"><i style="width:${termPct}%"></i></div>
      <div class="ends"><span>${short(s.term_start)}</span><span>${termPct}% of the term behind you</span><span>${short(s.term_end)}</span></div></div>
  </section>
  <section class="strip" aria-label="This week">${strip}</section>
  <div class="two-up">
    <section class="card"><div class="card-h"><h2>Today</h2><span class="meta">${meta}</span></div>${classesHtml}</section>
    <section class="card" style="gap:12px"><div class="card-h"><h2>Coming up</h2><button class="link" data-go="deadlines">All deadlines →</button></div>
      <div class="up">${upHtml || '<p class="empty-serif" style="padding:16px 0">Nothing left. You made it.</p>'}</div>
      <div class="up-foot">${progress()}</div></section>
  </div>`;
}

// ---------- Week ----------
function viewWeek() {
  const H0 = 8, H1 = 20, PX = 56, OFF = 10, H = (H1 - H0) * PX + OFF * 2;
  const toMin = x => { const [a, b] = hhmm(x).split(':').map(Number); return a * 60 + b; };
  const t = nowLocal(), mins = toMin(t.time), teaching = !isOff(t.date);
  const hours = Array.from({ length: H1 - H0 + 1 }, (_, i) => ({ label: `${pad(H0 + i)}:00`, top: i * PX + OFF }));
  let html = '<div></div>' + DAYS.slice(0, 5).map((n, i) => `<div class="dh ${i === t.dow ? 'today' : ''}">${n}${i === t.dow ? ' · today' : ''}</div>`).join('');
  html += `<div class="times" style="height:${H}px">${hours.map(h => `<span class="hl" style="top:${h.top}px">${h.label}</span>`).join('')}</div>`;
  for (let d = 0; d < 5; d++) {
    const isT = d === t.dow;
    html += `<div class="col ${isT ? 'today' : ''}" style="height:${H}px">${hours.map(h => `<div class="hr" style="top:${h.top}px"></div>`).join('')}`;
    for (const c of st.classes.filter(k => Number(k.weekday) === d)) {
      const s0 = toMin(c.start_time), e0 = toMin(c.end_time), h = (e0 - s0) / 60 * PX - 4;
      html += `<button class="blk ${tone(c.course)}" data-class="${c.id}" style="${hue(c.course)};top:${(s0 - H0 * 60) / 60 * PX + OFF + 2}px;height:${h}px" title="${esc(info(c.course).name)} · ${esc(c.instructor || '')}">
        <b>${esc(c.course)}${c.kind === 'Lab' ? ' Lab' : ''}</b><span>${hhmm(c.start_time)}–${hhmm(c.end_time)}</span>
        ${h > 48 ? `<span>${esc(c.room || '')}</span>` : ''}${h > 88 && c.instructor ? `<em>${esc(c.instructor)}</em>` : ''}</button>`;
    }
    if (isT && teaching && mins >= H0 * 60 && mins <= H1 * 60) html += `<div class="nowline" style="top:${(mins - H0 * 60) / 60 * PX + OFF}px"></div>`;
    html += '</div>';
  }
  const used = Object.keys(COURSE_INFO).filter(k => st.classes.some(c => c.course === k));
  const extra = st.classes.filter(c => Number(c.weekday) > 4);
  return `<div class="head"><div class="head-t"><h2 class="title">Your <i>week</i></h2>
      <p class="lede">Sunday to Thursday, the same every week. Tap a class to change its time or room; reminders follow these times.</p></div>
      <button class="btn" data-act="add-class">Add class</button></div>
    <div class="tt-box"><div class="tt">${html}</div></div>
    ${extra.length ? `<p class="also">Also on ${extra.map(c => `${DAYS[c.weekday]} ${hhmm(c.start_time)} ${esc(c.course)}`).join(', ')}.</p>` : ''}
    <div class="legend">${used.map(k => `<div class="lg ${tone(k)}" style="${hue(k)}"><i></i><div><b>${k}</b><span>${esc(COURSE_INFO[k].name)}</span></div></div>`).join('')}</div>`;
}

// ---------- Calendar ----------
function viewCalendar() {
  const s = st.settings, today = nowLocal().date;
  const months = [];
  let [y, m] = s.term_start.split('-').map(Number); m -= 1;
  const [ey, em] = s.term_end.split('-').map(Number);
  while (y < ey || (y === ey && m <= em - 1)) {
    const first = new Date(Date.UTC(y, m, 1)).getUTCDay(), n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    let cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(w => `<span class="wd">${w}</span>`).join('') + '<span></span>'.repeat(first), count = 0;
    for (let d = 1; d <= n; d++) {
      const ds = `${y}-${pad(m + 1)}-${pad(d)}`, wd = (first + d - 1) % 7;
      const evs = st.events.filter(e => graded(e) && evLocal(e).date === ds); count += evs.length;
      const cls = ['day'];
      if (wd >= 5) cls.push('wk');
      if (inExams(ds)) cls.push('exam'); else if ((s.skip_dates || []).includes(ds)) cls.push('hol');
      if (ds === today) cls.push('today');
      if (ds === st.selDay) cls.push('sel');
      cells += `<button class="${cls.join(' ')}" data-day="${ds}" aria-label="${prettyDate(ds)}${evs.length ? `, ${evs.length} due` : ''}"><span>${d}</span>
        <span class="dots">${evs.map(e => `<i class="${tone(e.course)}" style="${hue(e.course)}"></i>`).join('')}</span></button>`;
    }
    months.push(`<div class="month"><div class="month-h"><b>${MONTHS[m]}</b><span class="meta">${count ? `${count} due` : ''}</span></div><div class="mg">${cells}</div></div>`);
    if (++m === 12) { m = 0; y++; }
  }
  const sel = st.selDay;
  let panel = '<p class="empty-serif">Pick a day above to see what’s on it.</p>';
  if (sel) {
    const evs = st.events.filter(e => evLocal(e).date === sel), cl = classesOn(sel);
    const emptyText = inExams(sel) ? 'Inside the exam period. Check Moodle for your exact times.' : (s.skip_dates || []).includes(sel) ? 'A day off. Nothing to do but rest.' : 'Nothing on this day.';
    panel = `<div class="card-h"><h3>${prettyDate(sel)}</h3><span style="display:flex;gap:16px"><button class="link" data-act="add-event" data-date="${sel}">Add item</button><button class="link" data-act="clear-sel">Clear</button></span></div>
      ${evs.map(e => rowHtml(e, false)).join('')}
      ${cl.length ? `<div class="cls-list">${cl.map(c => `<div class="cls ${tone(c.course)}" style="${hue(c.course)}"><div class="t">${hhmm(c.start_time)}<small>${hhmm(c.end_time)}</small></div><div class="rail"></div>
        <div><div class="nm">${esc(info(c.course).name)}</div><div class="sub">${esc(c.course)} ${c.kind === 'Lab' ? 'Lab' : 'Lecture'} · <span>${esc(c.room || '')}</span></div></div></div>`).join('')}</div>` : ''}
      ${!evs.length && !cl.length ? `<p class="muted">${emptyText}</p>` : ''}`;
  }
  return `<div class="head-t"><h2 class="title">The <i>semester</i></h2><p class="lede">Four months, seen from above. Tap any day to see what’s on it.</p></div>
    <div class="months">${months.join('')}</div>
    <div class="key"><span><i style="background:var(--exam-bg)"></i>Exam period</span><span><i style="background:var(--raised)"></i>No classes</span><span><i style="background:var(--ink)"></i>Today</span><span><i class="dot"></i>Graded work</span></div>
    <section class="card" id="daycard" style="gap:14px">${panel}</section>`;
}

// ---------- Deadlines ----------
function viewDeadlines() {
  const t = nowLocal(), curW = termWeek(t.date);
  let list = st.events.filter(e => !st.filt.size || st.filt.has(e.course) || e.course === 'AUM');
  if (!st.showPast) list = list.filter(e => termWeek(evLocal(e).date) >= curW);
  const groups = new Map();
  for (const e of list) { const w = termWeek(evLocal(e).date); if (!groups.has(w)) groups.set(w, []); groups.get(w).push(e); }
  const short = ds => prettyDate(ds).slice(4);
  const html = [...groups.keys()].sort((a, b) => a - b).map(w => {
    const s0 = addDays(st.settings.term_start, (w - 1) * 7);
    return `<div class="grp ${w === curW ? 'cur' : ''}"><div class="grp-l"><b>${w < 1 ? 'Before term' : `Week ${w}`}</b><span>${short(s0)} – ${short(addDays(s0, 6))}</span>${w === curW ? '<span class="pill">This week</span>' : ''}</div>
      <div class="rows">${groups.get(w).map(e => rowHtml(e)).join('')}</div></div>`;
  }).join('');
  const courses = Object.keys(COURSE_INFO).filter(c => c !== 'AUM' && st.events.some(e => e.course === c));
  return `<div class="head"><div class="head-t"><h2 class="title">One week <i>at a time</i></h2>
      <p class="lede">Everything that’s due, in order. Tick things off as you go; it syncs to your other devices. Tap an item to edit it.</p></div>
      <div style="flex:0 1 280px;min-width:220px;display:flex;flex-direction:column;gap:12px">${progress()}<button class="btn primary" data-act="add-event" style="align-self:flex-end">Add item</button></div></div>
    <div class="chips"><button class="chip" data-filt="" aria-pressed="${!st.filt.size}">All</button>
      ${courses.map(k => `<button class="chip ${tone(k)}" style="${hue(k)}" data-filt="${k}" aria-pressed="${st.filt.has(k)}"><i></i>${k}</button>`).join('')}
      <button class="link" data-act="past">${st.showPast ? 'Hide past weeks' : 'Show past weeks'}</button></div>
    <div class="groups">${html || '<p class="empty-serif">Nothing here. Enjoy it.</p>'}</div>
    <p class="fine">Dates come from each syllabus weekly calendar, matched to your section’s meeting day. Midterm and final times aren’t in the syllabi yet. When they’re announced, use Add item with type Exam and you’ll get a reminder the evening before. Israa &amp; Mi’raj (5 Jan) is pending official confirmation. Check Moodle for syllabus updates.</p>`;
}

// ---------- Reminders ----------
function viewSettings() {
  const s = st.settings;
  const pill = { on: '<span class="pill sage">On</span>', off: '<span class="pill soft">Off</span>', checking: '<span class="pill soft">Checking</span>', denied: '<span class="pill warn">Blocked</span>', unsupported: '<span class="pill warn">Not supported</span>', 'ios-install': '<span class="pill warn">Add to Home Screen</span>' }[st.push];
  const upcoming = remindersBetween(s, st.classes, st.events, Date.now(), Date.now() + 7 * 864e5);
  const leads = s.class_leads || [];
  return `<div class="head-t"><h2 class="title">Your <i>reminders</i></h2><p class="lede">An hour and 30 minutes before each class, and the evening before anything graded. Change it here; every device follows.</p></div>
  ${pushNotice()}
  <div class="set-grid">
    <section class="card"><div class="card-h"><h3>This device</h3>${pill}</div>
      <p class="muted">${esc(deviceName())}. Each phone or laptop needs reminders turned on once.</p>
      <div class="inline">
        ${st.push === 'on' ? `<button class="btn" data-act="push-off" ${st.pushBusy ? 'disabled' : ''}>Turn off here</button>` : `<button class="btn sage" data-act="push-on" ${st.pushBusy || st.push === 'denied' || st.push === 'unsupported' ? 'disabled' : ''}>Turn on reminders</button>`}
        <button class="btn" data-act="push-test" ${st.pushBusy || st.push !== 'on' ? 'disabled' : ''}>Send a test</button></div></section>
    <form class="card" id="setform"><div class="card-h"><h3>What to remind you about</h3></div>
      <div class="fields">
        <label class="tick"><input type="checkbox" id="s-cls" ${s.notify_classes ? 'checked' : ''}> Before every class</label>
        <div class="inline">Remind me <input class="in" type="number" id="s-l1" min="0" max="600" step="5" value="${leads[0] ?? ''}" aria-label="First reminder, minutes before"> and
          <input class="in" type="number" id="s-l2" min="0" max="600" step="5" value="${leads[1] ?? ''}" aria-label="Second reminder, minutes before"> minutes before</div>
        <label class="tick"><input type="checkbox" id="s-ev" ${s.notify_events ? 'checked' : ''}> The day before graded work, at</label>
        <div class="inline"><input class="in" type="time" id="s-time" value="${hhmm(s.day_before_time)}" aria-label="Reminder time the day before"></div>
        <div class="kinds">${NOTIFY_KINDS.map(k => `<label class="tick"><input type="checkbox" data-kind="${k}" ${(s.event_kinds || []).includes(k) ? 'checked' : ''}> ${KIND_LABELS[k]}</label>`).join('')}</div>
      </div>
      <div class="actions"><button class="btn primary" type="submit">Save</button></div></form>
    <section class="card"><div class="card-h"><h3>The next 7 days</h3><span class="meta">${upcoming.length} reminders</span></div>
      <div class="nextrem">${upcoming.slice(0, 12).map(r => { const l = msToLocal(r.at, off()); return `<div><span>${esc(r.title)}</span><span>${prettyDate(l.date)} ${l.time}</span></div>`; }).join('') || '<p class="muted">Nothing scheduled.</p>'}</div>
      ${upcoming.length > 12 ? `<p class="meta">and ${upcoming.length - 12} more</p>` : ''}</section>
    <section class="card"><div class="card-h"><h3>Term dates</h3></div>
      <div class="two"><div class="field"><label for="t-start">Term starts</label><input class="in" type="date" id="t-start" value="${s.term_start}"></div>
        <div class="field"><label for="t-end">Classes end</label><input class="in" type="date" id="t-end" value="${s.term_end}"></div></div>
      <div class="lbl">Days with no classes <span class="muted">(no class reminders; tap one to remove it)</span></div>
      <div class="dates">${(s.skip_dates || []).slice().sort().map(d => `<button data-unskip="${d}" aria-label="Remove ${prettyDate(d)}">${prettyDate(d)}</button>`).join('') || '<p class="muted">None.</p>'}</div>
      <div class="inline"><input class="in" type="date" id="t-skip" aria-label="Add a day with no classes"><button class="btn" data-act="skip-add">Add day</button>
        <button class="btn primary" data-act="term-save" style="margin-left:auto">Save dates</button></div></section>
    <section class="card"><div class="card-h"><h3>Account</h3></div>
      <div class="inline" style="justify-content:space-between"><span class="mono" style="font-size:13px">${esc(st.session.user.email)}</span><button class="btn" data-act="signout">Sign out</button></div></section>
  </div>`;
}

// ---------- sheets ----------
function openEvent(e, date) {
  const isNew = !e;
  const l = e ? evLocal(e) : { date: date || nowLocal().date, time: '08:30' };
  e = e || { course: 'MA 265', kind: 'assignment', title: '', all_day: false, weight: '', note: '', remind: true };
  const kinds = Object.keys(KIND_LABELS);
  $sheet.innerHTML = `<form method="dialog" id="evform">
    <h2>${isNew ? 'Add item' : 'Edit item'}</h2>
    <div class="two"><div class="field"><label for="f-course">Course</label><select class="in" id="f-course">${COURSES.map(c => `<option ${c === e.course ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label for="f-kind">Type</label><select class="in" id="f-kind">${kinds.map(k => `<option value="${k}" ${k === e.kind ? 'selected' : ''}>${KIND_LABELS[k]}</option>`).join('')}</select></div></div>
    <div class="field"><label for="f-title">Title</label><input class="in" id="f-title" required value="${esc(e.title)}" placeholder="e.g. Midterm exam"></div>
    <div class="two"><div class="field"><label for="f-date">Date</label><input class="in" id="f-date" type="date" required value="${l.date}"></div>
      <div class="field"><label for="f-time">Time</label><input class="in" id="f-time" type="time" value="${e.all_day ? '' : l.time}"></div></div>
    <label class="tick"><input type="checkbox" id="f-allday" ${e.all_day ? 'checked' : ''}> All day (no time)</label>
    <div class="two"><div class="field"><label for="f-weight">Weight</label><input class="in" id="f-weight" value="${esc(e.weight || '')}" placeholder="20%"></div>
      <div class="field"><label for="f-note">Note</label><input class="in" id="f-note" value="${esc(e.note || '')}" placeholder="Room, chapters…"></div></div>
    <label class="tick"><input type="checkbox" id="f-remind" ${e.remind !== false ? 'checked' : ''}> Remind me the day before</label>
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
    <div class="two"><div class="field"><label for="c-course">Course</label><select class="in" id="c-course">${COURSES.filter(x => x !== 'AUM').map(x => `<option ${x === c.course ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="field"><label for="c-kind">Type</label><select class="in" id="c-kind">${['Lecture', 'Lab'].map(x => `<option ${x === c.kind ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
    <div class="field"><label for="c-day">Day</label><select class="in" id="c-day">${DAYS.map((d, i) => `<option value="${i}" ${i === Number(c.weekday) ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
    <div class="two"><div class="field"><label for="c-start">Starts</label><input class="in" id="c-start" type="time" required value="${hhmm(c.start_time)}"></div>
      <div class="field"><label for="c-end">Ends</label><input class="in" id="c-end" type="time" required value="${hhmm(c.end_time)}"></div></div>
    <div class="two"><div class="field"><label for="c-room">Room</label><input class="in" id="c-room" value="${esc(c.room || '')}"></div>
      <div class="field"><label for="c-who">Instructor</label><input class="in" id="c-who" value="${esc(c.instructor || '')}"></div></div>
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
async function toggleDone(id) {
  const e = st.events.find(x => x.id === id); if (!e) return;
  const was = !!e.done; e.done = !was; render();
  const { error } = await sb.from('planner_events').update({ done: e.done, updated_at: new Date().toISOString() }).eq('id', e.id);
  if (error) { e.done = was; render(); return toast(friendly(error)); }
  cache();
}
function bind() {
  const main = document.getElementById('main');
  main.onclick = async ev => {
    const el = ev.target.closest('[data-act],[data-go],[data-done],[data-event],[data-class],[data-day],[data-strip],[data-filt],[data-unskip]');
    if (!el) return;
    const d = el.dataset;
    if (d.go) return go(d.go);
    if (d.done) return toggleDone(d.done);
    if (d.event) return openEvent(st.events.find(e => e.id === d.event));
    if (d.class) return openClass(st.classes.find(c => c.id === d.class));
    if (d.strip) { st.selDay = d.strip; return go('calendar'); }
    if (d.day) { st.selDay = st.selDay === d.day ? null : d.day; render(); if (st.selDay) document.getElementById('daycard')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
    if (d.filt !== undefined) { if (!d.filt) st.filt.clear(); else st.filt.has(d.filt) ? st.filt.delete(d.filt) : st.filt.add(d.filt); return render(); }
    if (d.unskip) { if (await saveSettings({ skip_dates: (st.settings.skip_dates || []).filter(x => x !== d.unskip) })) { toast('Removed.'); render(); } return; }
    switch (d.act) {
      case 'push-on': return enablePush();
      case 'push-off': return disablePush();
      case 'push-test': return testPush();
      case 'add-event': return openEvent(null, d.date);
      case 'add-class': return openClass(null);
      case 'clear-sel': st.selDay = null; return render();
      case 'past': st.showPast = !st.showPast; return render();
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
