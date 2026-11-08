/*
 * Server helpers: Redis, the team password, data checking, reminder rules,
 * email text and the reminder run. Ported from the old api/_lib.js with the
 * same rules and the same Redis keys.
 *
 * No npm packages: only Node built-ins and fetch. Nothing here imports Next.js,
 * so the tests can run it directly.
 */
import crypto from 'crypto';
import type { AppState, Contract, Notice, Reminder } from '../types';

export const KEYS = {
  state: 'tcp:state',      // JSON string: { state, rev, updatedAt }
  sent: 'tcp:sent',        // hash: "<noticeId>:<days>:<dueDate>" -> time it was sent
  log: 'tcp:log',          // list of JSON strings, newest first
  last: 'tcp:lastrun',     // JSON string: summary of the last reminder run
  fail: 'tcp:fail:',       // + ip: wrong-password counter
  tests: 'tcp:testmails'   // + ':' + date: test email counter
};
export const LIMITS = { contracts: 500, notices: 5000, recipients: 20, perRun: 50, logKeep: 200, failMax: 10 };
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function env(name: string): string {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : '';
}

/* ---------- Redis (Upstash REST API) ---------- */

export function redisConf(): { url: string; token: string } | null {
  const url = env('KV_REST_API_URL') || env('UPSTASH_REDIS_REST_URL');
  const token = env('KV_REST_API_TOKEN') || env('UPSTASH_REDIS_REST_TOKEN');
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function redis(cmd: (string | number)[]): Promise<any> {
  const c = redisConf();
  if (!c) throw new Error('redis-not-configured');
  const r = await fetch(c.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.error) throw new Error('Redis error: ' + (j && j.error ? j.error : 'HTTP ' + r.status));
  return j.result;
}

/* ---------- Small web helpers ---------- */

export function json(status: number, obj: unknown, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra || {})
  });
}

export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  let text: string;
  try { text = await req.text(); } catch (e) { return null; }
  if (text.length > 1000000) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch (e) { return null; }
}

function sha(s: string): Buffer { return crypto.createHash('sha256').update(String(s)).digest(); }
export function safeEqual(a: string, b: string): boolean { return crypto.timingSafeEqual(sha(a), sha(b)); }

export function clientIp(req: Request): string {
  const f = req.headers.get('x-forwarded-for');
  if (f) return f.split(',')[0].trim().slice(0, 60) || 'unknown';
  return req.headers.get('x-real-ip') || 'unknown';
}

/*
 * Password check for everything except /api/ping and the cron endpoint. Fails closed.
 * Returns null when the password is right, or the error response to send back.
 */
export async function requireAuth(req: Request): Promise<Response | null> {
  const want = env('APP_PASSWORD');
  if (!want) return json(503, { error: 'password-not-configured' });
  const ip = clientIp(req);
  if (redisConf()) {
    try {
      const n = Number(await redis(['GET', KEYS.fail + ip])) || 0;
      if (n >= LIMITS.failMax) return json(429, { error: 'too-many-attempts' });
    } catch (e) { /* the limiter is best effort */ }
  }
  if (!safeEqual(req.headers.get('x-app-password') || '', want)) {
    if (redisConf()) {
      try {
        const n = await redis(['INCR', KEYS.fail + ip]);
        if (Number(n) === 1) await redis(['EXPIRE', KEYS.fail + ip, 900]);
      } catch (e) { /* ignore */ }
    }
    return json(401, { error: 'wrong-password' });
  }
  return null;
}

/* ---------- Dates (all reminder maths uses the UK calendar day) ---------- */

export function londonToday(now?: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now || new Date());
}
function dayNum(s: string): number { const p = s.split('-').map(Number); return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000); }
export function daysUntil(today: string, date: string): number { return dayNum(date) - dayNum(today); }
export function fmtDate(s: string): string {
  return new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/* ---------- Data checking: never trust what the browser sends ---------- */

function str(v: unknown, max: number): string { return typeof v === 'string' ? v.slice(0, max) : ''; }
function nums(v: unknown): number[] | undefined {
  return Array.isArray(v) ? v.map(Number).filter(function (x) { return isFinite(x) && x >= 0 && x <= 3650; }).slice(0, 3) : undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cleanState(raw: any): AppState | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.contracts) || !Array.isArray(raw.notices)) return null;
  if (raw.contracts.length > LIMITS.contracts || raw.notices.length > LIMITS.notices) return null;
  const seen: Record<string, boolean> = {};
  const contracts: Contract[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw.contracts.forEach(function (c: any) {
    if (!c || typeof c !== 'object') return;
    const id = str(c.id, 60);
    if (!id || seen[id]) return;
    seen[id] = true;
    contracts.push({ id: id, ref: str(c.ref, 40), vessel: str(c.vessel, 60), party: str(c.party, 60),
      delivery: DATE_RE.test(c.delivery) ? c.delivery : '', redelivery: DATE_RE.test(c.redelivery) ? c.redelivery : '' });
    const added = contracts[contracts.length - 1];
    if (TIME_RE.test(c.deliveryTime)) added.deliveryTime = c.deliveryTime;
    if (TIME_RE.test(c.redeliveryTime)) added.redeliveryTime = c.redeliveryTime;
    if (c.archived === true) { added.archived = true; if (DATE_RE.test(c.archivedAt)) added.archivedAt = c.archivedAt; }
  });
  const seenN: Record<string, boolean> = {};
  const notices: Notice[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw.notices.forEach(function (n: any) {
    if (!n || typeof n !== 'object') return;
    const id = str(n.id, 80);
    if (!id || seenN[id] || !DATE_RE.test(n.date)) return;
    seenN[id] = true;
    const out: Notice = { id: id, cid: str(n.cid, 60), title: str(n.title, 80), type: n.type === 'contract' ? 'contract' : 'shipping', date: n.date, done: !!n.done };
    if (TIME_RE.test(n.time)) out.time = n.time;
    const notes = str(n.notes, 1000).trim(); if (notes) out.notes = notes;
    if (n.archived === true) { out.archived = true; if (DATE_RE.test(n.archivedAt)) out.archivedAt = n.archivedAt; }
    if (Array.isArray(n.rems)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      out.rems = n.rems.slice(0, 3).map(function (r: any): Reminder {
        r = r || {};
        const days = Math.max(0, Math.min(3650, parseInt(r.days, 10) || 0));
        const to = (Array.isArray(r.to) ? r.to : []).map(function (x: unknown) { return str(x, 120).trim(); })
          .filter(function (x: string) { return MAIL_RE.test(x); }).slice(0, LIMITS.recipients);
        return { days: days, to: to };
      });
    }
    if (typeof n.remind === 'number' && isFinite(n.remind)) out.remind = n.remind;
    const rs = nums(n.reminds); if (rs) out.reminds = rs;
    notices.push(out);
  });
  return { contracts: contracts, notices: notices };
}

export interface StoredState { state: AppState; rev: number; updatedAt: string }

export async function loadState(): Promise<StoredState | null> {
  const raw = await redis(['GET', KEYS.state]);
  if (!raw) return null;
  try { const rec = JSON.parse(raw); return rec && rec.state ? rec : null; } catch (e) { return null; }
}

/* ---------- Which reminders are due today? (pure, easy to test) ---------- */
/*
 * Same rule as the page: for each open notice, look at the reminder stage reached
 * (the smallest "days before" that is still at least the days left). Send that one
 * if it has recipients and has not been sent for this due date. Overdue notices get nothing.
 * Keep in step with currentRem and status in lib/rules.ts.
 */
export interface DueItem { key: string; notice: Notice; contract: Contract | null; rem: Reminder; d: number; total: number }

export function pickDue(state: AppState, today: string, sentMap: Record<string, string> | null): DueItem[] {
  const out: DueItem[] = [];
  const byContract: Record<string, Contract> = {};
  state.contracts.forEach(function (c) { byContract[c.id] = c; });
  state.notices.forEach(function (n) {
    // Switched off (done) and archived notices, and notices of archived contracts, are never emailed.
    if (n.done || n.archived || !n.rems || !n.rems.length) return;
    if (byContract[n.cid] && byContract[n.cid].archived) return;
    const d = daysUntil(today, n.date);
    if (d < 0) return;
    const reached = n.rems.filter(function (r) { return r.days >= d; }).sort(function (a, b) { return a.days - b.days; })[0];
    if (!reached || !reached.to.length) return;
    const key = n.id + ':' + reached.days + ':' + n.date;
    if (sentMap && sentMap[key]) return;
    out.push({ key: key, notice: n, contract: byContract[n.cid] || null, rem: reached, d: d, total: n.rems.length });
  });
  return out;
}

/* ---------- Email text ---------- */

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]; });
}
function oneLine(s: string): string { return String(s).replace(/[\r\n]+/g, ' ').trim(); }

export function buildEmail(it: { notice: Pick<Notice, 'title' | 'date' | 'time' | 'type' | 'notes'>; contract: Partial<Contract> | null; rem: { days: number }; d: number }) {
  const n = it.notice, c = it.contract || {};
  const when = it.d === 0 ? 'due today' : it.d === 1 ? 'due tomorrow' : 'due in ' + it.d + ' days';
  const subject = oneLine('Reminder: ' + n.title + (c.vessel ? ' - ' + c.vessel : '') + ' (' + when + ')');
  const lines: [string, string][] = [
    ['Notice', n.title],
    ['Contract', c.vessel ? c.vessel + ' / ' + (c.party || '') + (c.ref ? ' (ref ' + c.ref + ')' : '') : 'Unknown contract'],
    ['Due date', fmtDate(n.date) + (n.time ? ' at ' + n.time : '') + ' (' + when + ')'],
    ['Type', n.type === 'shipping' ? 'Shipping notice' : 'Contract obligation'],
    ['Reminder', it.rem.days + (it.rem.days === 1 ? ' day' : ' days') + ' before the due date']
  ];
  if (n.notes) lines.push(['Comments', n.notes]);
  const text = lines.map(function (l) { return l[0] + ': ' + l[1]; }).join('\n') + '\n\nSent automatically by TCP Notices.';
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#18242F">' +
    '<p style="margin:0 0 12px"><strong>' + esc(n.title) + '</strong> is ' + esc(when) + '.</p>' +
    '<table style="border-collapse:collapse">' + lines.map(function (l) {
      return '<tr><td style="padding:3px 14px 3px 0;color:#5C6B78">' + esc(l[0]) + '</td><td style="padding:3px 0">' + esc(l[1]) + '</td></tr>';
    }).join('') + '</table>' +
    '<p style="margin:16px 0 0;color:#5C6B78;font-size:13px">Sent automatically by TCP Notices.</p></div>';
  return { subject: subject, text: text, html: html };
}

/* ---------- Brevo ---------- */

// BREVO_FROM is "Name <address>" or just "address". The address must be a verified sender in Brevo.
export function senderOf(): { email: string; name?: string } | null {
  const raw = env('BREVO_FROM');
  const m = /^\s*(?:(.*?)\s*<([^<>\s]+)>|([^<>\s]+))\s*$/.exec(raw);
  if (!m) return null;
  const email = m[2] || m[3];
  const name = (m[1] || '').replace(/^"|"$/g, '').slice(0, 70);
  return name ? { email: email, name: name } : { email: email };
}

export interface SendResult { ok: boolean; id?: string; status?: number; error?: string }

export async function sendEmail(msg: { to: string[]; subject: string; text: string; html: string }): Promise<SendResult> {
  const key = env('BREVO_API_KEY');
  if (!key) return { ok: false, error: 'BREVO_API_KEY is not set in Vercel.' };
  const sender = senderOf();
  if (!sender) return { ok: false, error: 'BREVO_FROM is not set in Vercel (the sender address you verified in Brevo).' };
  let r: Response;
  try {
    r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: sender,
        to: msg.to.map(function (a) { return { email: a }; }),
        subject: msg.subject, textContent: msg.text, htmlContent: msg.html
      })
    });
  } catch (e) { return { ok: false, error: 'Could not reach Brevo: ' + (e as Error).message }; }
  const j = await r.json().catch(function () { return {}; });
  if (!r.ok) return { ok: false, status: r.status, error: String((j && (j.message || j.code)) || 'HTTP ' + r.status).slice(0, 300) };
  return { ok: true, id: j && j.messageId };
}

/* ---------- The reminder run (used by the daily job and the page's buttons) ---------- */

function pairsToMap(flat: unknown): Record<string, string> {
  const m: Record<string, string> = {};
  if (Array.isArray(flat)) for (let i = 0; i + 1 < flat.length; i += 2) m[flat[i]] = flat[i + 1];
  return m;
}
function pause(ms: number): Promise<void> { return new Promise(function (r) { setTimeout(r, ms); }); }

export interface RunResult {
  today: string; dryRun: boolean; sent: number; failed: number; note: string;
  due: { title: string; vessel: string; date: string; daysLeft: number; stage: number; to: string[] }[];
}

export async function runReminders(opts?: { dryRun?: boolean; now?: Date; pauseMs?: number }): Promise<RunResult> {
  opts = opts || {};
  const today = londonToday(opts.now);
  const result: RunResult = { today: today, dryRun: !!opts.dryRun, due: [], sent: 0, failed: 0, note: '' };
  const rec = await loadState();
  if (!rec) {
    result.note = 'No data has been saved yet.';
    if (!opts.dryRun) await redis(['SET', KEYS.last, JSON.stringify({ at: new Date().toISOString(), result: result })]);
    return result;
  }
  const sentMap = pairsToMap(await redis(['HGETALL', KEYS.sent]));
  let items = pickDue(rec.state, today, sentMap);
  if (items.length > LIMITS.perRun) { result.note = 'Only the first ' + LIMITS.perRun + ' reminders are sent per run.'; items = items.slice(0, LIMITS.perRun); }
  result.due = items.map(function (it) {
    return { title: it.notice.title, vessel: it.contract ? it.contract.vessel : '', date: it.notice.date, daysLeft: it.d, stage: it.rem.days, to: it.rem.to };
  });
  if (!opts.dryRun) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const mail = buildEmail(it);
      const r = await sendEmail({ to: it.rem.to, subject: mail.subject, text: mail.text, html: mail.html });
      const entry: Record<string, unknown> = { t: new Date().toISOString(), title: it.notice.title, vessel: it.contract ? it.contract.vessel : '', date: it.notice.date, stage: it.rem.days, to: it.rem.to.length, ok: r.ok };
      if (r.ok) { result.sent++; entry.id = r.id; await redis(['HSET', KEYS.sent, it.key, entry.t as string]); }
      else { result.failed++; entry.error = r.error; }
      await redis(['LPUSH', KEYS.log, JSON.stringify(entry)]);
      await redis(['LTRIM', KEYS.log, 0, LIMITS.logKeep - 1]);
      if (i < items.length - 1) await pause(opts.pauseMs === undefined ? 600 : opts.pauseMs);
    }
    await redis(['SET', KEYS.last, JSON.stringify({ at: new Date().toISOString(), result: result })]);
  }
  return result;
}
