'use strict';
// Shows the last reminder run and the list of emails sent. Needs the password.
const L = require('./_lib');
module.exports = async function (req, res) {
  if (!(await L.requireAuth(req, res))) return;
  if (!L.redisConf()) return L.send(res, 503, { error: 'redis-not-configured' });
  try {
    const last = await L.redis(['GET', L.KEYS.last]);
    const log = await L.redis(['LRANGE', L.KEYS.log, 0, 29]);
    L.send(res, 200, {
      today: L.londonToday(),
      last: last ? JSON.parse(last) : null,
      log: (log || []).map(function (s) { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean),
      resend: !!L.env('RESEND_API_KEY'),
      sender: L.env('RESEND_FROM') ? 'custom' : 'resend-test-address'
    });
  } catch (e) {
    L.send(res, 500, { error: 'server-error', detail: String(e.message).slice(0, 200) });
  }
};
