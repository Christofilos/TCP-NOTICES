'use strict';
// Sends one test email so you can check Resend is connected. Needs the password.
const L = require('./_lib');
module.exports = async function (req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.send(res, 405, { error: 'method-not-allowed' }); }
  if (!(await L.requireAuth(req, res))) return;
  const body = await L.readBody(req);
  const to = body && typeof body.to === 'string' ? body.to.trim() : '';
  if (!L.MAIL_RE.test(to) || to.length > 120) return L.send(res, 400, { error: 'bad-email' });
  // Daily cap so a stolen password cannot be used to send lots of mail.
  if (L.redisConf()) {
    try {
      const k = L.KEYS.tests + ':' + L.londonToday();
      const n = Number(await L.redis(['INCR', k]));
      if (n === 1) await L.redis(['EXPIRE', k, 172800]);
      if (n > 20) return L.send(res, 429, { error: 'daily-test-limit' });
    } catch (e) { /* limiter is best effort */ }
  }
  const r = await L.sendResend({
    to: [to],
    subject: 'TCP Notices test email',
    text: 'This is a test from TCP Notices. If you can read this, Resend is connected.',
    html: '<p style="font-family:Arial,sans-serif">This is a test from <strong>TCP Notices</strong>. If you can read this, Resend is connected.</p>'
  });
  if (!r.ok) return L.send(res, 502, { error: 'send-failed', detail: r.error, status: r.status || null });
  L.send(res, 200, { ok: true, id: r.id });
};
