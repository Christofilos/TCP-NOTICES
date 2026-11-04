'use strict';
// Stand-ins for Upstash Redis and Resend, shared by api.js and server.js.
// ---- stand-in Redis and Resend ----
const db = {}; const sentMails = []; const mode = { resend: 'ok' };
global.fetch = async function (url, opts) {
  const body = JSON.parse(opts.body);
  if (String(url).indexOf('api.resend.com') >= 0) {
    if (mode.resend === 'fail') return { ok: false, status: 403, json: async () => ({ message: 'domain not verified' }) };
    sentMails.push({ body: body, headers: opts.headers });
    return { ok: true, status: 200, json: async () => ({ id: 'mail_' + sentMails.length }) };
  }
  const c = body, cmd = c[0].toUpperCase(); let result = null;
  if (cmd === 'GET') result = db[c[1]] === undefined ? null : db[c[1]];
  else if (cmd === 'SET') { db[c[1]] = c[2]; result = 'OK'; }
  else if (cmd === 'INCR') { db[c[1]] = (Number(db[c[1]]) || 0) + 1; result = db[c[1]]; }
  else if (cmd === 'EXPIRE') result = 1;
  else if (cmd === 'HSET') { db[c[1]] = db[c[1]] || {}; db[c[1]][c[2]] = c[3]; result = 1; }
  else if (cmd === 'HGETALL') { const h = db[c[1]] || {}; result = []; Object.keys(h).forEach(function (k) { result.push(k, h[k]); }); }
  else if (cmd === 'LPUSH') { db[c[1]] = db[c[1]] || []; db[c[1]].unshift(c[2]); result = db[c[1]].length; }
  else if (cmd === 'LTRIM') { db[c[1]] = db[c[1]].slice(c[2], c[3] + 1); result = 'OK'; }
  else if (cmd === 'LRANGE') result = (db[c[1]] || []).slice(c[2], c[3] + 1);
  return { ok: true, status: 200, json: async () => ({ result: result }) };
};


module.exports = { db: db, sentMails: sentMails, mode: mode };
