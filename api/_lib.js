'use strict';
/*
 * Shared helpers for the serverless functions in /api.
 * No npm packages are used on purpose: only Node built-ins and fetch.
 * Files starting with an underscore are not exposed as web addresses by Vercel.
 */
const crypto = require('crypto');

const KEYS = {
  state: 'tcp:state',      // JSON string: { state, rev, updatedAt }
  sent: 'tcp:sent',        // hash: "<noticeId>:<days>:<dueDate>" -> time it was sent
  log: 'tcp:log',          // list of JSON strings, newest first
  last: 'tcp:lastrun',     // JSON string: summary of the last reminder run
  fail: 'tcp:fail:',       // + ip: wrong-password counter
  tests: 'tcp:testmails'   // test email counter
};
const LIMITS = { contracts: 500, notices: 5000, recipients: 20, perRun: 50, logKeep: 200, failMax: 10 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function env(name) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : '';
}

/* ---------- Redis (Upstash REST API) ---------- */

function redisConf() {
  const url = env('KV_REST_API_URL') || env('UPSTASH_REDIS_REST_URL');
  const token = env('KV_REST_API_TOKEN') || env('UPSTASH_REDIS_REST_TOKEN');
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

async function redis(cmd) {
  const c = redisConf();
  if (!c) { const e = new Error('redis-not-configured'); e.code = 'redis-not-configured'; throw e; }
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

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return null; } }
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1000000) return null;
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return null; }
}

function sha(s) { return crypto.createHash('sha256').update(String(s)).digest(); }
function safeEqual(a, b) { return crypto.timingSafeEqual(sha(a), sha(b)); }

function clientIp(req) {
  const f = req.headers['x-forwarded-for'];
  if (f) return String(f).split(',')[0].trim().slice(0, 60);
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/* Password check for everything except /api/ping and the cron endpoint. Fails closed. */
async function requireAuth(req, res) {
  const want = env('APP_PASSWORD');
  if (!want) { send(res, 503, { error: 'password-not-configured' }); return false; }
  const ip = clientIp(req);
  if (redisConf()) {
    try {
      const n = Number(await redis(['GET', KEYS.fail + ip])) || 0;
      if (n >= LIMITS.failMax) { send(res, 429, { error: 'too-many-attempts' }); return false; }
    } catch (e) { /* the limiter is best effort */ }
  }
  if (!safeEqual(req.headers['x-app-password'] || '', want)) {
    if (redisConf()) {
      try {
        const n = await redis(['INCR', KEYS.fail + ip]);
        if (Number(n) === 1) await redis(['EXPIRE', KEYS.fail + ip, 900]);
      } catch (e) { /* ignore */ }
    }
    send(res, 401, { error: 'wrong-password' });
    return false;
  }
  return true;
}

/* ---------- Dates (all reminder maths uses the UK calendar day) ---------- */

function londonToday(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now || new Date());
}
function dayNum(s) { const p = s.split('-').map(Number); return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000); }
function daysUntil(today, date) { return dayNum(date) - dayNum(today); }
function fmtDate(s) { return new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }

/* ---------- Data checking: never trust what the browser sends ---------- */

function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
function nums(v) { return Array.isArray(v) ? v.map(Number).filter(function (x) { return isFinite(x) && x >= 0 && x <= 3650; }).slice(0, 3) : undefined; }

function cleanState(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.contracts) || !Array.isArray(raw.notices)) return null;
  if (raw.contracts.length > LIMITS.contracts || raw.notices.length > LIMITS.notices) return null;
  const seen = {};
  const contracts = [];
  raw.contracts.forEach(function (c) {
    if (!c || typeof c !== 'object') return;
    const id = str(c.id, 60);
    if (!id || seen[id]) return;
    seen[id] = true;
    contracts.push({ id: id, ref: str(c.ref, 40), vessel: str(c.vessel, 60), party: str(c.party, 60),
      delivery: DATE_RE.test(c.delivery) ? c.delivery : '', redelivery: DATE_RE.test(c.redelivery) ? c.redelivery : '' });
  });
  const seenN = {};
  const notices = [];
  raw.notices.forEach(function (n) {
    if (!n || typeof n !== 'object') return;
    const id = str(n.id, 80);
    if (!id || seenN[id] || !DATE_RE.test(n.date)) return;
    seenN[id] = true;
    const out = { id: id, cid: str(n.cid, 60), title: str(n.title, 80), type: n.type === 'contract' ? 'contract' : 'shipping', date: n.date, done: !!n.done };
    if (n.archived === true) { out.archived = true; if (DATE_RE.test(n.archivedAt)) out.archivedAt = n.archivedAt; }
    if (Array.isArray(n.rems)) {
      out.rems = n.rems.slice(0, 3).map(function (r) {
        r = r || {};
        const days = Math.max(0, Math.min(3650, parseInt(r.days, 10) || 0));
        const to = (Array.isArray(r.to) ? r.to : []).map(function (x) { return str(x, 120).trim(); })
          .filter(function (x) { return MAIL_RE.test(x); }).slice(0, LIMITS.recipients);
        return { days: days, to: to };
      });
    }
    if (typeof n.remind === 'number' && isFinite(n.remind)) out.remind = n.remind;
    const rs = nums(n.reminds); if (rs) out.reminds = rs;
    notices.push(out);
  });
  return { contracts: contracts, notices: notices };
}

async function loadState() {
  const raw = await redis(['GET', KEYS.state]);
  if (!raw) return null;
  try { const rec = JSON.parse(raw); return rec && rec.state ? rec : null; } catch (e) { return null; }
}

/* ---------- Which reminders are due today? (pure, easy to test) ---------- */
/*
 * Same rule as the page: for each open notice, look at the reminder stage reached
 * (the smallest "days before" that is still at least the days left). Send that one
 * if it has recipients and has not been sent for this due date. Overdue notices get nothing.
 */
function pickDue(state, today, sentMap) {
  const out = [];
  const byContract = {};
  state.contracts.forEach(function (c) { byContract[c.id] = c; });
  state.notices.forEach(function (n) {
    if (n.done || n.archived || !n.rems || !n.rems.length) return;
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

function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function oneLine(s) { return String(s).replace(/[\r\n]+/g, ' ').trim(); }

function buildEmail(it) {
  const n = it.notice, c = it.contract || {};
  const when = it.d === 0 ? 'due today' : it.d === 1 ? 'due tomorrow' : 'due in ' + it.d + ' days';
  const subject = oneLine('Reminder: ' + n.title + (c.vessel ? ' - ' + c.vessel : '') + ' (' + when + ')');
  const lines = [
    ['Notice', n.title],
    ['Contract', c.vessel ? c.vessel + ' / ' + (c.party || '') + (c.ref ? ' (ref ' + c.ref + ')' : '') : 'Unknown contract'],
    ['Due date', fmtDate(n.date) + ' (' + when + ')'],
    ['Type', n.type === 'shipping' ? 'Shipping notice' : 'Contract obligation'],
    ['Reminder', it.rem.days + (it.rem.days === 1 ? ' day' : ' days') + ' before the due date']
  ];
  const text = lines.map(function (l) { return l[0] + ': ' + l[1]; }).join('\n') + '\n\nSent automatically by TCP Notices.';
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#18242F">' +
    '<p style="margin:0 0 12px"><strong>' + esc(n.title) + '</strong> is ' + esc(when) + '.</p>' +
    '<table style="border-collapse:collapse">' + lines.map(function (l) {
      return '<tr><td style="padding:3px 14px 3px 0;color:#5C6B78">' + esc(l[0]) + '</td><td style="padding:3px 0">' + esc(l[1]) + '</td></tr>';
    }).join('') + '</table>' +
    '<p style="margin:16px 0 0;color:#5C6B78;font-size:13px">Sent automatically by TCP Notices.</p></div>';
  return { subject: subject, text: text, html: html };
}

/* ---------- Resend ---------- */

function fromAddress() { return env('RESEND_FROM') || 'TCP Notices <onboarding@resend.dev>'; }

async function sendResend(msg) {
  const key = env('RESEND_API_KEY');
  if (!key) return { ok: false, error: 'RESEND_API_KEY is not set in Vercel.' };
  const headers = { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  if (msg.idem) headers['Idempotency-Key'] = String(msg.idem).slice(0, 250);
  let r;
  try {
    r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: headers,
      body: JSON.stringify({ from: fromAddress(), to: msg.to, subject: msg.subject, text: msg.text, html: msg.html })
    });
  } catch (e) { return { ok: false, error: 'Could not reach Resend: ' + e.message }; }
  const j = await r.json().catch(function () { return {}; });
  if (!r.ok) return { ok: false, status: r.status, error: String((j && (j.message || (j.error && j.error.message))) || 'HTTP ' + r.status).slice(0, 300) };
  return { ok: true, id: j && j.id };
}

/* ---------- The reminder run (used by the daily job and the page's buttons) ---------- */

function pairsToMap(flat) {
  const m = {};
  if (Array.isArray(flat)) for (let i = 0; i + 1 < flat.length; i += 2) m[flat[i]] = flat[i + 1];
  return m;
}
function pause(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function runReminders(opts) {
  opts = opts || {};
  const today = londonToday(opts.now);
  const result = { today: today, dryRun: !!opts.dryRun, due: [], sent: 0, failed: 0, note: '' };
  const rec = await loadState();
  if (!rec) {
    result.note = 'No data has been saved to cloud storage yet.';
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
      const r = await sendResend({ to: it.rem.to, subject: mail.subject, text: mail.text, html: mail.html, idem: it.key });
      const entry = { t: new Date().toISOString(), title: it.notice.title, vessel: it.contract ? it.contract.vessel : '', date: it.notice.date, stage: it.rem.days, to: it.rem.to.length, ok: r.ok };
      if (r.ok) { result.sent++; entry.id = r.id; await redis(['HSET', KEYS.sent, it.key, entry.t]); }
      else { result.failed++; entry.error = r.error; }
      await redis(['LPUSH', KEYS.log, JSON.stringify(entry)]);
      await redis(['LTRIM', KEYS.log, 0, LIMITS.logKeep - 1]);
      if (i < items.length - 1) await pause(opts.pauseMs === undefined ? 600 : opts.pauseMs);
    }
    await redis(['SET', KEYS.last, JSON.stringify({ at: new Date().toISOString(), result: result })]);
  }
  return result;
}

module.exports = {
  KEYS, LIMITS, MAIL_RE, env, redisConf, redis, send, readBody, safeEqual, requireAuth,
  londonToday, daysUntil, fmtDate, cleanState, loadState, pickDue, buildEmail, sendResend, fromAddress, runReminders
};
