/*
 * The server endpoints, as plain functions that take a web Request and return a Response.
 * The Next.js route files in app/api/ call these. The tests call them directly.
 * Same behaviour as the old api/*.js files.
 */
import * as L from './core';

function serverError(e: unknown): Response {
  return L.json(500, { error: 'server-error', detail: String((e as Error).message).slice(0, 200) });
}

// Public health check. Says only whether each setting exists, never its value.
export async function ping(): Promise<Response> {
  return L.json(200, {
    ok: true,
    redis: !!L.redisConf(),
    resend: !!L.env('RESEND_API_KEY'),
    password: !!L.env('APP_PASSWORD'),
    cron: !!L.env('CRON_SECRET'),
    sender: L.env('RESEND_FROM') ? 'custom' : 'resend-test-address'
  });
}

// GET: read the team data. Needs the password.
export async function getState(req: Request): Promise<Response> {
  const denied = await L.requireAuth(req); if (denied) return denied;
  if (!L.redisConf()) return L.json(503, { error: 'redis-not-configured' });
  try {
    const rec = await L.loadState();
    return L.json(200, rec ? { state: rec.state, rev: rec.rev, updatedAt: rec.updatedAt } : { state: null, rev: 0 });
  } catch (e) { return serverError(e); }
}

// PUT or POST: save the team data. Needs the password.
// Refuses a save based on an older revision (409) unless "force" is set.
export async function putState(req: Request): Promise<Response> {
  const denied = await L.requireAuth(req); if (denied) return denied;
  if (!L.redisConf()) return L.json(503, { error: 'redis-not-configured' });
  try {
    const body = await L.readBody(req);
    if (!body) return L.json(400, { error: 'bad-json' });
    const clean = L.cleanState(body.state);
    if (!clean) return L.json(400, { error: 'bad-data' });
    const cur = await L.loadState();
    const curRev = cur ? Number(cur.rev) || 0 : 0;
    if (!body.force && Number(body.baseRev) !== curRev) {
      return L.json(409, { error: 'conflict', rev: curRev, updatedAt: cur ? cur.updatedAt : null });
    }
    const rec = { state: clean, rev: curRev + 1, updatedAt: new Date().toISOString() };
    await L.redis(['SET', L.KEYS.state, JSON.stringify(rec)]);
    return L.json(200, { ok: true, rev: rec.rev, updatedAt: rec.updatedAt });
  } catch (e) { return serverError(e); }
}

// Last reminder run and the list of emails sent. Needs the password.
export async function status(req: Request): Promise<Response> {
  const denied = await L.requireAuth(req); if (denied) return denied;
  if (!L.redisConf()) return L.json(503, { error: 'redis-not-configured' });
  try {
    const last = await L.redis(['GET', L.KEYS.last]);
    const log = await L.redis(['LRANGE', L.KEYS.log, 0, 29]);
    return L.json(200, {
      today: L.londonToday(),
      last: last ? JSON.parse(last) : null,
      log: ((log || []) as string[]).map(function (s) { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean),
      resend: !!L.env('RESEND_API_KEY'),
      sender: L.env('RESEND_FROM') ? 'custom' : 'resend-test-address'
    });
  } catch (e) { return serverError(e); }
}

// One test email so you can check Resend is connected. Needs the password. 20 a day at most.
export async function testEmail(req: Request): Promise<Response> {
  const denied = await L.requireAuth(req); if (denied) return denied;
  const body = await L.readBody(req);
  const to = body && typeof body.to === 'string' ? body.to.trim() : '';
  if (!L.MAIL_RE.test(to) || to.length > 120) return L.json(400, { error: 'bad-email' });
  if (L.redisConf()) {
    try {
      const k = L.KEYS.tests + ':' + L.londonToday();
      const n = Number(await L.redis(['INCR', k]));
      if (n === 1) await L.redis(['EXPIRE', k, 172800]);
      if (n > 20) return L.json(429, { error: 'daily-test-limit' });
    } catch (e) { /* limiter is best effort */ }
  }
  const r = await L.sendResend({
    to: [to],
    subject: 'TCP Notices test email',
    text: 'This is a test from TCP Notices. If you can read this, Resend is connected.',
    html: '<p style="font-family:Arial,sans-serif">This is a test from <strong>TCP Notices</strong>. If you can read this, Resend is connected.</p>'
  });
  if (!r.ok) return L.json(502, { error: 'send-failed', detail: r.error, status: r.status || null });
  return L.json(200, { ok: true, id: r.id });
}

// Page buttons: preview (dryRun, the default) or send today's reminders now. Needs the password.
export async function reminders(req: Request): Promise<Response> {
  const denied = await L.requireAuth(req); if (denied) return denied;
  if (!L.redisConf()) return L.json(503, { error: 'redis-not-configured' });
  const body = (await L.readBody(req)) || {};
  try {
    return L.json(200, await L.runReminders({ dryRun: body.dryRun !== false }));
  } catch (e) { return serverError(e); }
}

// Called once a day by Vercel Cron, which sends "Authorization: Bearer <CRON_SECRET>".
export async function cron(req: Request): Promise<Response> {
  const secret = L.env('CRON_SECRET');
  if (!secret) return L.json(503, { error: 'cron-secret-not-configured' });
  const got = req.headers.get('authorization') || '';
  if (!L.safeEqual(got, 'Bearer ' + secret)) return L.json(401, { error: 'unauthorized' });
  if (!L.redisConf()) return L.json(503, { error: 'redis-not-configured' });
  try {
    return L.json(200, await L.runReminders({ dryRun: false }));
  } catch (e) { return serverError(e); }
}

/*
 * Route table: web address -> method -> handler. Used by the test server.
 * Keep it in step with the files in app/api/.
 */
export const routes: Record<string, Record<string, (req: Request) => Promise<Response>>> = {
  '/api/ping': { GET: ping },
  '/api/state': { GET: getState, PUT: putState, POST: putState },
  '/api/status': { GET: status },
  '/api/test-email': { POST: testEmail },
  '/api/reminders': { POST: reminders },
  '/api/cron/send-reminders': { GET: cron }
};
