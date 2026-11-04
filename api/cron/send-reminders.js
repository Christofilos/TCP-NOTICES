'use strict';
// Called once a day by Vercel Cron. Vercel sends "Authorization: Bearer <CRON_SECRET>".
const L = require('../_lib');
module.exports = async function (req, res) {
  const secret = L.env('CRON_SECRET');
  if (!secret) return L.send(res, 503, { error: 'cron-secret-not-configured' });
  const got = String(req.headers.authorization || '');
  if (!L.safeEqual(got, 'Bearer ' + secret)) return L.send(res, 401, { error: 'unauthorized' });
  if (!L.redisConf()) return L.send(res, 503, { error: 'redis-not-configured' });
  try {
    const result = await L.runReminders({ dryRun: false });
    L.send(res, 200, result);
  } catch (e) {
    L.send(res, 500, { error: 'server-error', detail: String(e.message).slice(0, 200) });
  }
};
