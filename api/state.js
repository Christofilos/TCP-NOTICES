'use strict';
// GET: read the saved data. PUT or POST: save it. Needs the password.
const L = require('./_lib');
module.exports = async function (req, res) {
  if (!(await L.requireAuth(req, res))) return;
  if (!L.redisConf()) return L.send(res, 503, { error: 'redis-not-configured' });
  try {
    if (req.method === 'GET') {
      const rec = await L.loadState();
      return L.send(res, 200, rec ? { state: rec.state, rev: rec.rev, updatedAt: rec.updatedAt } : { state: null, rev: 0 });
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await L.readBody(req);
      if (!body) return L.send(res, 400, { error: 'bad-json' });
      const clean = L.cleanState(body.state);
      if (!clean) return L.send(res, 400, { error: 'bad-data' });
      const cur = await L.loadState();
      const curRev = cur ? Number(cur.rev) || 0 : 0;
      // Another device saved since this one last loaded: refuse unless told to overwrite.
      if (!body.force && Number(body.baseRev) !== curRev) {
        return L.send(res, 409, { error: 'conflict', rev: curRev, updatedAt: cur ? cur.updatedAt : null });
      }
      const rec = { state: clean, rev: curRev + 1, updatedAt: new Date().toISOString() };
      await L.redis(['SET', L.KEYS.state, JSON.stringify(rec)]);
      return L.send(res, 200, { ok: true, rev: rec.rev, updatedAt: rec.updatedAt });
    }
    res.setHeader('Allow', 'GET, PUT, POST');
    return L.send(res, 405, { error: 'method-not-allowed' });
  } catch (e) {
    return L.send(res, 500, { error: 'server-error', detail: String(e.message).slice(0, 200) });
  }
};
