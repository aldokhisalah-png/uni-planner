// Uni Planner notification sender.
// Called every minute by pg_cron (header x-cron-secret), and by the app's "Send test" button (user's login token).
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { remindersBetween, sendPush } from './core.js';

const env = (k: string) => Deno.env.get(k) ?? '';
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const vapid = { publicKey: env('VAPID_PUBLIC_KEY'), privateKey: env('VAPID_PRIVATE_KEY'), subject: env('VAPID_SUBJECT') || 'mailto:planner@example.com' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// A run looks back 15 minutes, so a late or skipped cron run still delivers; the sent log stops repeats.
const LOOKBACK_MS = 15 * 60000;

async function deliver(userId: string, subs: any[], payload: Record<string, unknown>) {
  let ok = 0;
  for (const s of subs.filter(x => x.user_id === userId)) {
    try {
      const status = await sendPush(s, payload, vapid);
      if (status === 404 || status === 410) await db.from('planner_push_subs').delete().eq('endpoint', s.endpoint);
      else if (status >= 200 && status < 300) ok++;
      else console.error('push failed', status, s.endpoint.slice(0, 60));
    } catch (e) { console.error('push error', e); }
  }
  return ok;
}

async function runSchedule() {
  const now = Date.now(), from = now - LOOKBACK_MS;
  const { data: subs, error: e1 } = await db.from('planner_push_subs').select('*');
  if (e1) throw e1;
  const users = [...new Set((subs ?? []).map(s => s.user_id))];
  if (!users.length) return { users: 0, sent: 0 };
  const [{ data: settings }, { data: classes }, { data: events }] = await Promise.all([
    db.from('planner_settings').select('*').in('user_id', users),
    db.from('planner_classes').select('*').in('user_id', users),
    db.from('planner_events').select('*').in('user_id', users).eq('done', false)
      .gte('due_at', new Date(now - 2 * 86400000).toISOString()).lte('due_at', new Date(now + 3 * 86400000).toISOString())
  ]);
  let sent = 0;
  for (const uid of users) {
    const s = (settings ?? []).find(x => x.user_id === uid);
    if (!s) continue;
    const due = remindersBetween(s, (classes ?? []).filter(c => c.user_id === uid), (events ?? []).filter(e => e.user_id === uid), from, now);
    for (const r of due) {
      // Claim the reminder first; if the row already exists it was sent before, so skip it.
      const { data: claimed, error } = await db.from('planner_sent')
        .upsert({ user_id: uid, key: r.key }, { onConflict: 'user_id,key', ignoreDuplicates: true }).select('key');
      if (error) { console.error(error); continue; }
      if (!claimed?.length) continue;
      sent += await deliver(uid, subs!, { title: r.title, body: r.body, tag: r.tag, url: './' });
    }
  }
  if (new Date(now).getUTCMinutes() === 0) await db.rpc('planner_prune_sent');
  return { users: users.length, sent };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const secret = req.headers.get('x-cron-secret');
    if (secret && env('CRON_SECRET') && secret === env('CRON_SECRET')) return json(await runSchedule());

    // Otherwise it must be the signed-in app asking for a test notification.
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = token ? await db.auth.getUser(token) : { data: { user: null } };
    if (!user) return json({ error: 'Sign in again, then retry.' }, 401);
    const { data: subs } = await db.from('planner_push_subs').select('*').eq('user_id', user.id);
    if (!subs?.length) return json({ error: 'This account has no devices with notifications turned on.' }, 400);
    const ok = await deliver(user.id, subs, { title: 'Uni Planner', body: 'Notifications are working on this device.', tag: 'test', url: './' });
    return json({ devices: subs.length, delivered: ok });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
