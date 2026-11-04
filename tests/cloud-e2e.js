'use strict';
// Browser test of the cloud panel against the local test server (stand-in Redis and Resend).
const { chromium } = require('playwright');
const { start } = require('./server');
const fails = [];
const ok = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' -> ' + extra : '')); if (!cond) fails.push(name); };
function plusDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const SEED = { contracts: [{ id: 'c1', ref: 'R1', vessel: 'MV Cloud', party: 'Acme', delivery: plusDays(30), redelivery: plusDays(300) }],
  notices: [{ id: 'n1', cid: 'c1', title: 'Cloud notice', type: 'shipping', date: plusDays(3), done: false, rems: [{ days: 7, to: ['a@x.com'] }] }] };

(async () => {
  const s = await start(0);
  const URL = 'http://127.0.0.1:' + s.port + '/';
  const b = await chromium.launch();
  async function device(seed) {
    const ctx = await b.newContext({ viewport: { width: 1200, height: 1000 } });
    if (seed) await ctx.addInitScript(function (st) { if (!localStorage.getItem('deadlineCalendar.v2')) localStorage.setItem('deadlineCalendar.v2', JSON.stringify(st)); }, seed);
    const p = await ctx.newPage();
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    p.on('dialog', async d => { p.errs.push('DIALOG ' + d.message()); await d.dismiss(); });
    await p.goto(URL); await p.waitForTimeout(400);
    return p;
  }
  const msg = p => p.textContent('#cl-msg');

  // Device A has data, connects with wrong then right password
  const A = await device(SEED);
  await A.click('#cloud summary');
  await A.fill('#cl-pw', 'nope'); await A.click('#cl-go'); await A.waitForTimeout(400);
  ok('wrong password message', /not right/.test(await msg(A)), await msg(A));
  ok('tools stay hidden after wrong password', !(await A.isVisible('#cl-tools')));
  await A.fill('#cl-pw', 'test-pass'); await A.press('#cl-pw', 'Enter'); await A.waitForTimeout(800);
  ok('tools shown after connecting', await A.isVisible('#cl-tools'));
  const rec = JSON.parse(s.fakes.db['tcp:state'] || 'null');
  ok('first connect uploads local data to cloud', rec && rec.state.notices.length === 1 && rec.rev === 1, JSON.stringify(rec && rec.rev));
  ok('password is not left in the box', (await A.inputValue('#cl-pw')) === '');
  ok('no page errors or dialogs (A)', A.errs.length === 0, A.errs.join('|'));

  // Editing on A auto-saves to cloud
  await A.evaluate(function () { state.notices[0].title = 'Renamed in A'; save(); });
  await A.waitForTimeout(1400);
  ok('edit auto-saves to cloud', JSON.parse(s.fakes.db['tcp:state']).state.notices[0].title === 'Renamed in A' && JSON.parse(s.fakes.db['tcp:state']).rev === 2);

  // Test email
  await A.fill('#cl-to', 'bad'); await A.click('#cl-test'); await A.waitForTimeout(200);
  ok('bad test address caught in page', /valid email/.test(await msg(A)));
  await A.fill('#cl-to', 'me@x.com'); await A.click('#cl-test'); await A.waitForTimeout(500);
  ok('test email sent', /Test email sent/.test(await msg(A)) && s.fakes.sentMails.length === 1, await msg(A));
  s.fakes.mode.resend = 'fail';
  await A.click('#cl-test'); await A.waitForTimeout(500);
  ok('Resend refusal shown with reason', /Resend refused.*domain/.test(await msg(A)), await msg(A));
  s.fakes.mode.resend = 'ok';

  // Preview and run
  await A.click('#cl-prev'); await A.waitForTimeout(600);
  ok('preview lists the due reminder', /1 reminder email/.test(await msg(A)) && /Renamed in A/.test(await A.textContent('#cl-out')), await msg(A));
  ok('preview sent nothing', s.fakes.sentMails.length === 1);
  await A.click('#cl-run'); await A.waitForTimeout(1200);
  ok('run sends the email', /1 sent, 0 failed/.test(await msg(A)) && s.fakes.sentMails.length === 2, await msg(A));
  await A.click('#cl-run'); await A.waitForTimeout(600);
  ok('second run sends nothing', /0 sent/.test(await msg(A)) && s.fakes.sentMails.length === 2);
  await A.click('#cl-stat'); await A.waitForTimeout(500);
  ok('sent list shows the email', /sent: Renamed in A/.test(await A.textContent('#cl-out')), await A.textContent('#cl-out'));

  // Device B starts empty, connects, gets A's data
  const B = await device(null);
  await B.click('#cloud summary'); await B.fill('#cl-pw', 'test-pass'); await B.click('#cl-go'); await B.waitForTimeout(800);
  const bState = await B.evaluate(() => JSON.parse(localStorage.getItem('deadlineCalendar.v2')));
  ok('empty device loads cloud data', bState.notices.length === 1 && bState.notices[0].title === 'Renamed in A');
  ok('contract visible on page', (await B.locator('#list .ccard').count()) === 1);
  ok('password remembered for next visit', await B.evaluate(() => JSON.parse(localStorage.getItem('deadlineCalendar.cloud.v1')).pw === 'test-pass'));
  await B.reload(); await B.waitForTimeout(900);
  ok('reconnects by itself after reload', await B.isVisible('#cl-tools'));

  // Conflict: B saves, then A (stale) saves
  await B.evaluate(function () { state.notices[0].title = 'Newer from B'; save(); });
  await B.waitForTimeout(1400);
  await A.evaluate(function () { state.notices[0].title = 'Stale from A'; save(); });
  await A.waitForTimeout(1500);
  ok('stale device is asked to choose, nothing overwritten', await A.isVisible('#cl-choice') && JSON.parse(s.fakes.db['tcp:state']).state.notices[0].title === 'Newer from B', await msg(A));
  await A.click('#cl-usecloud'); await A.waitForTimeout(500);
  ok('choosing cloud data adopts it', (await A.evaluate(() => state.notices[0].title)) === 'Newer from B' && !(await A.isVisible('#cl-choice')));

  // Different data on both: choice offered, and "use this device" wins
  const C = await device({ contracts: [{ id: 'cx', ref: '', vessel: 'MV Other', party: 'Z', delivery: '', redelivery: '' }], notices: [] });
  await C.click('#cloud summary'); await C.fill('#cl-pw', 'test-pass'); await C.click('#cl-go'); await C.waitForTimeout(800);
  ok('different data offers a choice', await C.isVisible('#cl-choice'));
  await C.click('#cl-usehere'); await C.waitForTimeout(700);
  ok('use this device overwrites cloud', JSON.parse(s.fakes.db['tcp:state']).state.contracts[0].vessel === 'MV Other');

  // Disconnect
  await C.click('#cl-off'); await C.waitForTimeout(200);
  ok('disconnect hides tools and forgets password', !(await C.isVisible('#cl-tools')) && await C.evaluate(() => JSON.parse(localStorage.getItem('deadlineCalendar.cloud.v1')).pw === ''));
  ok('no page errors or dialogs (B, C)', B.errs.length === 0 && C.errs.length === 0, B.errs.concat(C.errs).join('|'));

  // Offline file:// page: no server
  const ctx = await b.newContext(); const F = await ctx.newPage(); const ferrs = [];
  F.on('pageerror', e => ferrs.push(e.message));
  await F.goto('file://' + require('path').resolve(__dirname, '../index.html')); await F.waitForTimeout(500);
  await F.click('#cloud summary'); await F.fill('#cl-pw', 'x'); await F.click('#cl-go'); await F.waitForTimeout(600);
  ok('file page says cloud is not reachable, no errors', /not reachable/.test(await msg(F)) && ferrs.length === 0, await msg(F) + ferrs.join('|'));
  ok('plain app still works on file page', await F.isVisible('#c-submit'));

  // Phone width
  const ph = await b.newContext({ viewport: { width: 390, height: 800 } }); const P = await ph.newPage();
  await P.goto(URL); await P.click('#cloud summary'); await P.waitForTimeout(200);
  ok('no sideways scroll at 390px with cloud panel open', await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

  await b.close(); s.srv.close();
  console.log(fails.length ? '\nFAILED: ' + fails.join('; ') : '\nAll cloud checks passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
