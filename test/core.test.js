import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import {
  classReminders, eventReminders, localToMs, msToLocal, encryptPayload, vapidAuthorization,
  bytesToB64url, b64urlToBytes
} from '../supabase/functions/planner-push/core.js';

const S = { skip_dates: ['2026-11-10'] };
const MA = { id: 'ma-sun', course: 'MA 265', kind: 'Lecture', weekday: 0, start_time: '17:00:00', end_time: '18:15:00', room: 'B2-F-02' };
const LAB = { id: 'bio-lab', course: 'BIOL 110', kind: 'Lab', weekday: 4, start_time: '08:30', end_time: '10:10', room: 'E2-G-02' };

test('local time conversion is UTC+3', () => {
  assert.equal(new Date(localToMs('2026-10-04', '17:00', 180)).toISOString(), '2026-10-04T14:00:00.000Z');
  assert.deepEqual(msToLocal(Date.parse('2026-10-04T21:30:00Z'), 180), { date: '2026-10-05', time: '00:30', dow: 1 });
});

test('class reminders fire 60 and 30 minutes before, once each', () => {
  const from = localToMs('2026-10-04', '00:00', 180), to = localToMs('2026-10-05', '00:00', 180);
  const r = classReminders(S, [MA, LAB], from, to);
  assert.deepEqual(r.map(x => msToLocal(x.at, 180).time), ['16:00', '16:30']);
  assert.equal(r[0].title, 'MA 265 class in 1 hour');
  assert.equal(r[1].title, 'MA 265 class in 30 minutes');
  assert.equal(r[0].body, '17:00–18:15 · B2-F-02');
  assert.notEqual(r[0].key, r[1].key);
});

test('early lab reminder lands at 07:30 and 08:00 on Thursday', () => {
  const from = localToMs('2026-10-08', '00:00', 180), to = localToMs('2026-10-09', '00:00', 180);
  const r = classReminders(S, [LAB], from, to);
  assert.deepEqual(r.map(x => msToLocal(x.at, 180).time), ['07:30', '08:00']);
  assert.equal(r[0].title, 'BIOL 110 lab in 1 hour');
});

test('no class reminders on skipped days, before term or after classes end', () => {
  const tue = { ...MA, id: 't', weekday: 2 };
  const day = d => classReminders(S, [tue], localToMs(d, '00:00', 180), localToMs(addOne(d), '00:00', 180));
  assert.equal(day('2026-11-10').length, 0);   // skip date
  assert.equal(day('2026-09-15').length, 0);   // before term
  assert.equal(day('2027-01-19').length, 0);   // after classes end
  assert.equal(day('2026-10-06').length, 2);
});
function addOne(d) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); }

test('a one-minute window never double-sends across consecutive runs', () => {
  const start = localToMs('2026-10-04', '15:50', 180);
  let n = 0;
  for (let i = 0; i < 60; i++) n += classReminders(S, [MA], start + i * 60000, start + (i + 1) * 60000).length;
  assert.equal(n, 2);
});

test('graded work gets a reminder at 20:00 the evening before', () => {
  const ev = [
    { id: 'g1', course: 'MA 265', title: 'GCA 1', kind: 'gca', due_at: '2026-10-27T17:00:00+03:00', weight: '15%' },
    { id: 'i1', course: 'MA 265', title: 'Assignment opens', kind: 'info', due_at: '2026-10-27T20:00:00+03:00' },
    { id: 'd1', course: 'CE 468', title: 'GCA 1', kind: 'gca', due_at: '2026-10-28T16:30:00+03:00', done: true },
    { id: 'a1', course: 'MA 265', title: 'Assignment', kind: 'assignment', due_at: '2026-10-27T23:59:00+03:00' }
  ];
  const r = eventReminders({}, ev, localToMs('2026-10-26', '00:00', 180), localToMs('2026-10-27', '00:00', 180));
  assert.deepEqual(r.map(x => x.key.split(':')[1]), ['g1', 'a1']);
  assert.equal(msToLocal(r[0].at, 180).date, '2026-10-26');
  assert.equal(msToLocal(r[0].at, 180).time, '20:00');
  assert.equal(r[0].title, 'Tomorrow: MA 265 GCA 1');
  assert.equal(r[0].body, 'Tue 27 Oct, 17:00 · 15%');
  assert.equal(r[1].body, 'Tue 27 Oct, due 23:59');
});

test('push payload decrypts with the reference implementation (set ECE_DIR to a node_modules with http_ece)', { skip: !process.env.ECE_DIR }, async () => {
  const require = createRequire(process.env.ECE_DIR + '/');
  const ece = require('http_ece');
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const body = await encryptPayload('{"title":"hi"}', bytesToB64url(ua.getPublicKey()), bytesToB64url(auth));
  const out = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: auth });
  assert.equal(out.toString(), '{"title":"hi"}');
});

test('VAPID token verifies with the public key', async () => {
  const k = crypto.createECDH('prime256v1'); k.generateKeys();
  const pub = bytesToB64url(k.getPublicKey()), priv = bytesToB64url(k.getPrivateKey());
  const h = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', pub, priv, 'mailto:x@example.com');
  const m = h.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m);
  assert.equal(JSON.parse(Buffer.from(b64urlToBytes(m[2])).toString()).aud, 'https://fcm.googleapis.com');
  const pubKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: bytesToB64url(k.getPublicKey().subarray(1, 33)), y: bytesToB64url(k.getPublicKey().subarray(33)) }, format: 'jwk' });
  const ok = crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: pubKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(b64urlToBytes(m[3])));
  assert.ok(ok);
});
