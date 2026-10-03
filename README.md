# Uni Planner

Fall 2026 timetable, semester calendar and deadlines, with push notifications:

- **1 hour and 30 minutes before every class** (skips midterm week, winter break and holidays)
- **The evening before** every GCA, exam, quiz, assignment, homework, graded lab, pre-lab and project deadline (20:00 by default)

All of it is editable in the app's Reminders tab. Data lives in Supabase (same project as PPL Coach and Nutrition Coach, tables `planner_*`), protected by row-level security. The app is a static PWA served by GitHub Pages.

## How notifications work
`pg_cron` calls the `planner-push` Edge Function every minute. The function works out which reminders are due,
logs each one in `planner_sent` so it's sent once, and delivers it with Web Push to every device you turned reminders on for.
The reminder logic lives in `supabase/functions/planner-push/core.js` and is shared with the app's "Coming up" preview.

## Setup (once)
1. **Supabase → SQL Editor:** run `supabase/setup.sql`.
2. **Edge Function:** deploy `supabase/functions/planner-push` (both `index.ts` and `core.js`) with JWT verification **off**
   (`supabase functions deploy planner-push --no-verify-jwt`).
3. **Edge Function secrets:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` address), `CRON_SECRET`.
   The public key must match `vapidPublicKey` in `config.js`. Never commit the private key or cron secret.
4. **Schedule** (SQL Editor, with your own secret):
   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   select cron.schedule('planner-push', '* * * * *', $$
     select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/planner-push',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
       body := '{}'::jsonb, timeout_milliseconds := 20000);
   $$);
   ```
5. **GitHub → Settings → Pages:** deploy from branch `main`, folder `/ (root)`.
6. Open the app, sign in, go to **Reminders → Turn on reminders**, then **Send a test**.
   On iPhone, first add the app to the Home Screen (Share → Add to Home Screen) and open it from there.

## Updating
Bump `VERSION` in `sw.js` whenever files change, so installed copies pick up the new version.

Tests: `npm test` (the payload-encryption test runs when `ECE_DIR` points at a `node_modules` containing `http_ece`).
