'use strict';
// Button on the page: preview (dryRun) or run today's reminders now. Needs the password.
const L = require('./_lib');
module.exports = async function (req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.send(res, 405, { error: 'method-not-allowed' }); }
  if (!(await L.requireAuth(req, res))) return;
  if (!L.redisConf()) return L.send(res, 503, { error: 'redis-not-configured' });
  const body = (await L.readBody(req)) || {};
  try {
    const result = await L.runReminders({ dryRun: body.dryRun !== false });
    L.send(res, 200, result);
  } catch (e) {
    L.send(res, 500, { error: 'server-error', detail: String(e.message).slice(0, 200) });
  }
};
