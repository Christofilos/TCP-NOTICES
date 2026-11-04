// Stand-ins for Upstash Redis and Resend, shared by api.test.ts and the test server.
// Replaces the global fetch, so nothing real is ever contacted.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const db: Record<string, any> = {};
export const sentMails: { body: any; headers: Record<string, string> }[] = [];
export const mode = { resend: 'ok' as 'ok' | 'fail' };

function reply(status: number, obj: unknown) {
  return { ok: status < 400, status, json: async () => obj } as unknown as Response;
}

(globalThis as any).fetch = async function (url: string, opts: any) {
  const body = JSON.parse(opts.body);
  if (String(url).indexOf('api.resend.com') >= 0) {
    if (mode.resend === 'fail') return reply(403, { message: 'domain not verified' });
    sentMails.push({ body: body, headers: opts.headers });
    return reply(200, { id: 'mail_' + sentMails.length });
  }
  const c = body, cmd = String(c[0]).toUpperCase(); let result: any = null;
  if (cmd === 'GET') result = db[c[1]] === undefined ? null : db[c[1]];
  else if (cmd === 'SET') { db[c[1]] = c[2]; result = 'OK'; }
  else if (cmd === 'INCR') { db[c[1]] = (Number(db[c[1]]) || 0) + 1; result = db[c[1]]; }
  else if (cmd === 'EXPIRE') result = 1;
  else if (cmd === 'HSET') { db[c[1]] = db[c[1]] || {}; db[c[1]][c[2]] = c[3]; result = 1; }
  else if (cmd === 'HGETALL') { const h = db[c[1]] || {}; result = []; Object.keys(h).forEach(function (k) { result.push(k, h[k]); }); }
  else if (cmd === 'LPUSH') { db[c[1]] = db[c[1]] || []; db[c[1]].unshift(c[2]); result = db[c[1]].length; }
  else if (cmd === 'LTRIM') { db[c[1]] = db[c[1]].slice(c[2], c[3] + 1); result = 'OK'; }
  else if (cmd === 'LRANGE') result = (db[c[1]] || []).slice(c[2], c[3] + 1);
  return reply(200, { result: result });
};

export function setTestEnv(password: string) {
  process.env.KV_REST_API_URL = 'https://fake.upstash.io';
  process.env.KV_REST_API_TOKEN = 'tok';
  process.env.RESEND_API_KEY = 're_fake';
  process.env.APP_PASSWORD = password;
  process.env.CRON_SECRET = 'cronsecret';
}
