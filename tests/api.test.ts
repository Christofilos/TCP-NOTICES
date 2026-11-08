// Tests for the server code in lib/server. Real Redis and Brevo are replaced by stand-ins,
// so this checks our logic only, not the live services.
// Ported from the old tests/api.js; the handlers now take a web Request and return a Response.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fakes from './fakes';
import * as L from '../lib/server/core';
import * as H from '../lib/server/handlers';

let pass = 0, fail = 0;
function check(name: string, cond: unknown) { if (cond) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name); } }

fakes.setTestEnv('correct horse');
const sentMails = fakes.sentMails;

async function call(handler: (req: Request) => Promise<Response>, o: { method?: string; ip?: string; headers?: Record<string, string>; body?: unknown }) {
  const init: RequestInit = { method: o.method || 'GET', headers: Object.assign({ 'x-forwarded-for': o.ip || '1.1.1.1' }, o.headers || {}) };
  if (o.body !== undefined) { init.body = JSON.stringify(o.body); (init.headers as Record<string, string>)['content-type'] = 'application/json'; }
  const res = await handler(new Request('http://test.local/x', init));
  return { status: res.status, json: await res.json() as any, headers: res.headers };
}
const PW = { 'x-app-password': 'correct horse' };

(async function () {
  console.log('dates');
  check('london today is a date', /^\d{4}-\d{2}-\d{2}$/.test(L.londonToday()));
  check('london day rolls at UK midnight (summer)', L.londonToday(new Date('2026-07-01T23:30:00Z')) === '2026-07-02');
  check('london day in winter is UTC', L.londonToday(new Date('2026-12-01T23:30:00Z')) === '2026-12-01');
  check('daysUntil across month end', L.daysUntil('2026-11-28', '2026-12-05') === 7);

  console.log('cleanState');
  check('rejects junk', L.cleanState(null) === null && L.cleanState({}) === null && L.cleanState({ contracts: 1, notices: [] }) === null);
  const dirty = { contracts: [{ id: 'c1', vessel: '<b>MV</b>', party: 'X', delivery: '2026-12-01', redelivery: 'bad', evil: 1 }, { id: 'c1' }],
    notices: [{ id: 'n1', cid: 'c1', title: 'T', type: 'weird', date: '2026-11-10', rems: [{ days: '7', to: ['a@x.com', 'nope', 5] }, { days: -3, to: [] }, {}, {}, {}], x: 1 },
      { id: 'n2', date: 'not-a-date' }] };
  const cs = L.cleanState(dirty) as any;
  check('drops duplicate contract and bad-date notice', cs.contracts.length === 1 && cs.notices.length === 1);
  check('bad redelivery blanked, extra fields removed', cs.contracts[0].redelivery === '' && cs.contracts[0].evil === undefined && cs.notices[0].x === undefined);
  check('type falls back to shipping', cs.notices[0].type === 'shipping');
  check('keeps 3 reminders, valid emails only, clamps days', cs.notices[0].rems.length === 3 && cs.notices[0].rems[0].days === 7 && cs.notices[0].rems[0].to.length === 1 && cs.notices[0].rems[1].days === 0);
  const old = L.cleanState({ contracts: [], notices: [{ id: 'o1', cid: 'c0', title: 'Old', type: 'shipping', date: '2026-11-10', remind: 5 }, { id: 'o2', cid: 'c0', title: 'Older', type: 'contract', date: '2026-11-11', reminds: [10, 'x', 3] }] }) as any;
  check('keeps the older reminder fields (remind, reminds)', old.notices[0].remind === 5 && old.notices[1].reminds.join() === '10,3');
  const timed = L.cleanState({ contracts: [{ id: 'c1', delivery: '2026-12-01', deliveryTime: '08:00', redeliveryTime: '25:61' }],
    notices: [{ id: 't1', date: '2026-11-10', time: '14:30' }, { id: 't2', date: '2026-11-10', time: 'noon' }] }) as any;
  check('keeps valid times, drops invalid ones', timed.contracts[0].deliveryTime === '08:00' && timed.contracts[0].redeliveryTime === undefined && timed.notices[0].time === '14:30' && timed.notices[1].time === undefined);

  console.log('pickDue');
  const st: any = { contracts: [{ id: 'c1', vessel: 'MV Test', party: 'Acme', ref: 'R1' }],
    notices: [
      { id: 'a', cid: 'c1', title: 'Due in 10', type: 'shipping', date: '2026-11-14', done: false, rems: [{ days: 30, to: ['a@x.com'] }, { days: 10, to: ['b@x.com'] }, { days: 3, to: ['c@x.com'] }] },
      { id: 'b', cid: 'c1', title: 'Too early', type: 'shipping', date: '2026-12-31', done: false, rems: [{ days: 7, to: ['a@x.com'] }] },
      { id: 'c', cid: 'c1', title: 'Overdue', type: 'contract', date: '2026-11-01', done: false, rems: [{ days: 7, to: ['a@x.com'] }] },
      { id: 'd', cid: 'c1', title: 'Done', type: 'contract', date: '2026-11-05', done: true, rems: [{ days: 7, to: ['a@x.com'] }] },
      { id: 'e', cid: 'c1', title: 'No recipients', type: 'contract', date: '2026-11-05', done: false, rems: [{ days: 7, to: [] }] },
      { id: 'f', cid: 'c1', title: 'Today', type: 'shipping', date: '2026-11-04', done: false, rems: [{ days: 3, to: ['z@x.com'] }] }
    ] };
  const due = L.pickDue(st, '2026-11-04', {});
  check('picks only the notices that need mail', due.map(function (x) { return x.notice.id; }).sort().join() === 'a,f');
  check('picks the stage reached (10 days, not 30)', due.filter(function (x) { return x.notice.id === 'a'; })[0].rem.days === 10);
  check('skips already sent', L.pickDue(st, '2026-11-04', { 'a:10:2026-11-14': 'x' }).length === 1);
  check('later stage is sent again after earlier one', L.pickDue(st, '2026-11-11', { 'a:10:2026-11-14': 'x' }).filter(function (x) { return x.notice.id === 'a'; })[0].rem.days === 3);
  check('changed due date counts as new', L.pickDue(st, '2026-11-04', { 'a:10:2026-11-13': 'x' }).length === 2);

  console.log('archiving, switches and comments');
  const offSt = JSON.parse(JSON.stringify(st)); offSt.notices[0].done = true;
  check('switched-off (done) notices are never emailed', L.pickDue(offSt, '2026-11-04', {}).map(function (x) { return x.notice.id; }).join() === 'f');
  const archSt = JSON.parse(JSON.stringify(st)); archSt.notices[0].archived = true;
  check('archived notices are never emailed', L.pickDue(archSt, '2026-11-04', {}).map(function (x) { return x.notice.id; }).join() === 'f');
  const archC = JSON.parse(JSON.stringify(st)); archC.contracts[0].archived = true;
  check('notices on an archived contract are never emailed', L.pickDue(archC, '2026-11-04', {}).length === 0);
  const kept = L.cleanState({ contracts: [{ id: 'k', vessel: 'V', archived: true, archivedAt: '2026-11-07' }, { id: 'j', archived: 1, archivedAt: 'x' }],
    notices: [{ id: 'z', date: '2026-11-10', archived: true, archivedAt: '2026-11-07', notes: '  Agreed by email  ' }, { id: 'y', date: '2026-11-10', archived: 'yes', notes: 'x'.repeat(1500) }, { id: 'w', date: '2026-11-10', notes: 42 }] }) as any;
  check('archive flags and dates survive saving, junk does not', kept.contracts[0].archived === true && kept.contracts[0].archivedAt === '2026-11-07' && kept.contracts[1].archived === undefined && kept.notices[0].archived === true && kept.notices[0].archivedAt === '2026-11-07' && kept.notices[1].archived === undefined);
  check('comments survive saving, trimmed and capped at 1000', kept.notices[0].notes === 'Agreed by email' && kept.notices[1].notes.length === 1000 && kept.notices[2].notes === undefined);

  console.log('email text');
  const mail = L.buildEmail({ notice: { title: '<script>x</script>', date: '2026-11-14', type: 'shipping' }, contract: { vessel: 'MV\nTest', party: 'A&B', ref: '' }, rem: { days: 10 }, d: 10 });
  check('html escapes user text', mail.html.indexOf('<script>') < 0 && mail.html.indexOf('&lt;script&gt;') > 0 && mail.html.indexOf('A&amp;B') > 0);
  check('subject has no line breaks', mail.subject.indexOf('\n') < 0);
  const mailN = L.buildEmail({ notice: { title: 'T', date: '2026-11-14', type: 'shipping', notes: 'Check <b>bunkers</b>' }, contract: { vessel: 'V' }, rem: { days: 3 }, d: 3 });
  check('email includes comments, escaped in the HTML', /Comments: Check <b>bunkers<\/b>/.test(mailN.text) && mailN.html.indexOf('Check &lt;b&gt;bunkers') > 0 && mailN.html.indexOf('<b>bunkers') < 0);
  const timedMail = L.buildEmail({ notice: { title: 'T', date: '2026-11-14', time: '14:30', type: 'shipping' }, contract: null, rem: { days: 10 }, d: 10 });
  check('email shows the due time when set', /Due date: 14 Nov 2026 at 14:30/.test(timedMail.text) && !/ at /.test(mail.text.split('\n')[2]));

  console.log('endpoints: password');
  let r = await call(H.ping, {});
  check('ping is public and shows no secrets', r.status === 200 && r.json.redis && r.json.brevo && r.json.sender && JSON.stringify(r.json).indexOf('xkeysib') < 0 && JSON.stringify(r.json).indexOf('example.com') < 0 && JSON.stringify(r.json).indexOf('correct') < 0);
  r = await call(H.getState, {});
  check('state without password is 401', r.status === 401);
  r = await call(H.getState, { headers: { 'x-app-password': 'wrong' } });
  check('state with wrong password is 401', r.status === 401);
  for (let i = 0; i < 12; i++) r = await call(H.getState, { ip: '9.9.9.9', headers: { 'x-app-password': 'bad' + i } });
  check('too many wrong passwords gets locked (429)', r.status === 429);
  r = await call(H.getState, { ip: '9.9.9.9', headers: PW });
  check('locked address is refused even with right password', r.status === 429);
  const savedPw = process.env.APP_PASSWORD; delete process.env.APP_PASSWORD;
  r = await call(H.getState, { headers: PW });
  check('no APP_PASSWORD set means closed (503)', r.status === 503);
  process.env.APP_PASSWORD = savedPw;
  r = await call(H.putState, { method: 'PUT', body: { state: st, baseRev: 0 } });
  check('saving needs the password too', r.status === 401);
  check('responses are never cached', r.headers.get('cache-control') === 'no-store');

  console.log('endpoints: state');
  r = await call(H.getState, { headers: PW });
  check('empty store returns null state', r.status === 200 && r.json.state === null && r.json.rev === 0);
  r = await call(H.putState, { method: 'PUT', headers: PW, body: { state: { nope: 1 }, baseRev: 0 } });
  check('bad data refused (400)', r.status === 400);
  const bad = await H.putState(new Request('http://test.local/x', { method: 'PUT', headers: PW, body: 'not json' }));
  check('broken JSON refused (400)', bad.status === 400);
  r = await call(H.putState, { method: 'PUT', headers: PW, body: { state: st, baseRev: 0 } });
  check('first save works, rev 1', r.status === 200 && r.json.rev === 1);
  r = await call(H.putState, { method: 'PUT', headers: PW, body: { state: st, baseRev: 0 } });
  check('stale save refused (409)', r.status === 409 && r.json.rev === 1);
  r = await call(H.putState, { method: 'PUT', headers: PW, body: { state: st, baseRev: 0, force: true } });
  check('forced save works, rev 2', r.status === 200 && r.json.rev === 2);
  r = await call(H.getState, { headers: PW });
  check('read back what was saved', r.json.state.notices.length === 6 && r.json.rev === 2);

  console.log('endpoints: test email');
  r = await call(H.testEmail, { method: 'POST', headers: PW, body: { to: 'not an email' } });
  check('bad address refused', r.status === 400);
  r = await call(H.testEmail, { method: 'POST', body: { to: 'a@x.com' } });
  check('test email needs password', r.status === 401);
  r = await call(H.testEmail, { method: 'POST', headers: PW, body: { to: 'me@x.com' } });
  check('test email sent through Brevo', r.status === 200 && sentMails.length === 1 && sentMails[0].body.to[0].email === 'me@x.com' && sentMails[0].headers['api-key'] === 'xkeysib-fake' && sentMails[0].body.sender.email === 'notices@example.com' && sentMails[0].body.sender.name === 'TCP Notices');
  fakes.mode.brevo = 'fail';
  r = await call(H.testEmail, { method: 'POST', headers: PW, body: { to: 'me@x.com' } });
  check('Brevo refusal is reported with its reason', r.status === 502 && /sender/.test(r.json.detail));
  fakes.mode.brevo = 'ok';

  console.log('endpoints: reminders');
  // make the data due relative to the real today so the endpoint's own clock matches
  const today = L.londonToday();
  const in3 = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + 3)).toISOString().slice(0, 10);
  const live: any = { contracts: [{ id: 'c1', vessel: 'MV Live', party: 'P', ref: '', delivery: '', redelivery: '' }],
    notices: [{ id: 'n1', cid: 'c1', title: 'Live notice', type: 'shipping', date: in3, done: false, rems: [{ days: 7, to: ['a@x.com', 'b@x.com'] }] }] };
  await call(H.putState, { method: 'PUT', headers: PW, body: { state: live, baseRev: 2 } });
  r = await call(H.reminders, { method: 'POST', headers: PW, body: {} });
  check('preview lists due reminder and sends nothing', r.status === 200 && r.json.dryRun && r.json.due.length === 1 && sentMails.length === 1);
  const before = sentMails.length;
  r = await call(H.cron, { headers: { authorization: 'Bearer wrong' } });
  check('cron refuses wrong secret', r.status === 401 && sentMails.length === before);
  r = await call(H.cron, {});
  check('cron refuses no secret', r.status === 401);
  r = await call(H.cron, { headers: { authorization: 'Bearer cronsecret' } });
  check('cron sends one email to both recipients', r.status === 200 && r.json.sent === 1 && sentMails.length === before + 1 && sentMails[before].body.to.length === 2);
  check('sender comes from BREVO_FROM', sentMails[before].body.sender.email === 'notices@example.com');
  r = await call(H.cron, { headers: { authorization: 'Bearer cronsecret' } });
  check('running again sends nothing new', r.json.sent === 0 && sentMails.length === before + 1);
  r = await call(H.status, { headers: PW });
  check('status shows last run and log', r.status === 200 && r.json.last && r.json.log.length === 1 && r.json.log[0].ok === true);

  console.log('failure handling');
  const live2 = JSON.parse(JSON.stringify(live)); live2.notices[0].id = 'n2';
  const rev = (await call(H.getState, { headers: PW })).json.rev;
  await call(H.putState, { method: 'PUT', headers: PW, body: { state: live2, baseRev: rev } });
  fakes.mode.brevo = 'fail';
  r = await call(H.cron, { headers: { authorization: 'Bearer cronsecret' } });
  check('failed send is counted, not marked as sent', r.json.failed === 1 && r.json.sent === 0);
  fakes.mode.brevo = 'ok';
  r = await call(H.cron, { headers: { authorization: 'Bearer cronsecret' } });
  check('failed reminder is retried next run', r.json.sent === 1);

  console.log('route table');
  check('route table lists every endpoint', Object.keys(H.routes).sort().join() === '/api/cron/send-reminders,/api/ping,/api/reminders,/api/state,/api/status,/api/test-email');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
