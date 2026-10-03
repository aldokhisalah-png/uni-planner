// Shared by the app (preview of upcoming notifications) and the Supabase function (sending them).
// Plain JavaScript with no imports, so it runs in the browser, in Deno and in Node tests.

// ---------------------------------------------------------------------------
// Time helpers. Kuwait has no daylight saving, so a fixed offset (UTC+3 = 180 min) is exact.
// ---------------------------------------------------------------------------
const DAY = 86400000;
export const pad = n => String(n).padStart(2, '0');

// Local wall-clock date + "HH:MM" -> UTC milliseconds.
export function localToMs(dateStr, timeStr, offsetMin) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, mi] = String(timeStr || '00:00').split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, mi) - offsetMin * 60000;
}
// UTC milliseconds -> { date: 'YYYY-MM-DD', time: 'HH:MM', dow: 0..6 } in local time.
export function msToLocal(ms, offsetMin) {
  const t = new Date(ms + offsetMin * 60000);
  return {
    date: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
    time: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`,
    dow: t.getUTCDay()
  };
}
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
const hhmm = t => String(t || '').slice(0, 5);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function prettyDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MON[m - 1]}`;
}

export const COURSE_NAMES = {
  'BIOL 110': 'Biology', 'MA 265': 'Linear Algebra', 'CE 337': 'ASIC Design Lab',
  'CE 462': 'OOP C++/Java', 'CE 468': 'Compilers', 'CE 400': 'Grad Project I'
};
export const KIND_LABELS = {
  gca: 'GCA', exam: 'Exam', quiz: 'Quiz', assignment: 'Assignment', hw: 'Homework',
  lab: 'Graded lab', prelab: 'Pre-lab', project: 'Project', info: 'Info', academic: 'Academic'
};
export const DEFAULT_SETTINGS = {
  tz_offset_min: 180,
  class_leads: [60, 30],
  day_before_time: '20:00',
  term_start: '2026-09-20',
  term_end: '2027-01-14',
  skip_dates: [],
  notify_classes: true,
  notify_events: true,
  event_kinds: ['gca', 'exam', 'quiz', 'assignment', 'hw', 'lab', 'prelab', 'project']
};
const withDefaults = s => ({ ...DEFAULT_SETTINGS, ...(s || {}) });

// ---------------------------------------------------------------------------
// Reminder schedule. Each reminder has a stable key so it is sent only once.
// ---------------------------------------------------------------------------
const leadText = m => m % 60 === 0 ? (m === 60 ? '1 hour' : `${m / 60} hours`) : `${m} minutes`;

// Class reminders whose send time falls in (fromMs, toMs].
export function classReminders(settingsIn, classes, fromMs, toMs) {
  const s = withDefaults(settingsIn);
  if (!s.notify_classes) return [];
  const off = s.tz_offset_min, skip = new Set(s.skip_dates || []);
  const leads = (s.class_leads || []).map(Number).filter(n => n > 0);
  const maxLead = Math.max(0, ...leads);
  const out = [];
  let date = msToLocal(fromMs, off).date;
  const lastDate = msToLocal(toMs + maxLead * 60000, off).date;
  for (; date <= lastDate; date = addDays(date, 1)) {
    if (date < s.term_start || date > s.term_end || skip.has(date)) continue;
    const dow = msToLocal(localToMs(date, '12:00', off), off).dow;
    for (const c of classes) {
      if (Number(c.weekday) !== dow) continue;
      const start = localToMs(date, hhmm(c.start_time), off);
      for (const lead of leads) {
        const at = start - lead * 60000;
        if (at <= fromMs || at > toMs) continue;
        out.push({
          key: `c:${c.id}:${date}:${lead}`, at, kind: 'class',
          title: `${c.course} ${c.kind === 'Lab' ? 'lab' : 'class'} in ${leadText(lead)}`,
          body: `${hhmm(c.start_time)}–${hhmm(c.end_time)}${c.room ? ' · ' + c.room : ''}`,
          tag: `class-${c.id}-${date}`
        });
      }
    }
  }
  return out;
}

// Day-before reminders for graded work, sent at day_before_time on the previous day.
export function eventReminders(settingsIn, events, fromMs, toMs) {
  const s = withDefaults(settingsIn);
  if (!s.notify_events) return [];
  const off = s.tz_offset_min, kinds = new Set(s.event_kinds || []);
  const out = [];
  for (const e of events) {
    if (e.done || e.remind === false || !kinds.has(e.kind)) continue;
    const dueMs = new Date(e.due_at).getTime();
    const due = msToLocal(dueMs, off);
    const at = localToMs(addDays(due.date, -1), s.day_before_time, off);
    if (at <= fromMs || at > toMs) continue;
    const label = e.kind === 'assignment' || e.kind === 'hw' || e.kind === 'prelab' ? 'due' : 'tomorrow';
    out.push({
      key: `e:${e.id}:${dueMs}`, at, kind: 'event',
      title: `Tomorrow: ${e.course} ${e.title}`,
      body: `${prettyDate(due.date)}${e.all_day ? '' : (label === 'due' ? ', due ' : ', ') + due.time}${e.weight ? ' · ' + e.weight : ''}${e.note ? ' · ' + e.note : ''}`,
      tag: `event-${e.id}`
    });
  }
  return out;
}

export function remindersBetween(settings, classes, events, fromMs, toMs) {
  return [...classReminders(settings, classes, fromMs, toMs), ...eventReminders(settings, events, fromMs, toMs)]
    .sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------
// Web Push (RFC 8291 aes128gcm payload encryption + RFC 8292 VAPID), WebCrypto only.
// ---------------------------------------------------------------------------
const enc = new TextEncoder();
export function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64url(bytes) {
  let bin = ''; const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; } return out;
};
async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

// Encrypts a payload for one subscription. Returns the request body bytes.
export async function encryptPayload(plaintext, p256dhB64, authB64, opts = {}) {
  const uaPublic = b64urlToBytes(p256dhB64), authSecret = b64urlToBytes(authB64);
  const asKeys = opts.asKeys || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const padded = concat(typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext, new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, padded));
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

// Signed VAPID header for an endpoint's push service.
export async function vapidAuthorization(endpoint, vapidPublicB64, vapidPrivateB64, subject) {
  const pub = b64urlToBytes(vapidPublicB64);
  const jwk = { kty: 'EC', crv: 'P-256', d: vapidPrivateB64, x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)), ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = bytesToB64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${bytesToB64url(sig)}, k=${vapidPublicB64}`;
}

// Sends one notification. Returns the push service's HTTP status (201 = accepted; 404/410 = subscription gone).
export async function sendPush(sub, payload, vapid, ttlSeconds = 3600) {
  const body = await encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid.publicKey, vapid.privateKey, vapid.subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttlSeconds),
      Urgency: 'high'
    },
    body
  });
  return res.status;
}
