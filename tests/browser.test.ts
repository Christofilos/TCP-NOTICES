/*
 * Browser tests for the whole page, against the local test server (real React components,
 * real API handlers, stand-in Redis and Resend). Ported from the old e2e.js, excel.js and
 * cloud-e2e.js, plus checks for what is new: sign-in, saving straight to Redis, failed saves,
 * conflicts between devices, and importing the data the old page left in a browser.
 *
 * Uses Playwright's Chromium, or another Chrome if CHROME_PATH is set.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { chromium, type Browser, type Page } from 'playwright';
import { start, PASSWORD } from './harness/server';

const fails: string[] = [];
function ok(name: string, cond: unknown, extra?: string) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' -> ' + extra : ''));
  if (!cond) fails.push(name);
}
function plusDays(n: number) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

(async () => {
  const s = await start(0);
  const URL = 'http://127.0.0.1:' + s.port + '/';
  const b: Browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const errs: string[] = [];
  const stored = () => { const r = s.fakes.db['tcp:state']; return r ? JSON.parse(r) : null; };

  async function device(seed?: Record<string, unknown>, width?: number): Promise<Page> {
    const ctx = await b.newContext({ viewport: { width: width || 1200, height: 1000 } });
    if (seed) await ctx.addInitScript(function (kv: Record<string, unknown>) {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      Object.keys(kv).forEach(function (k) { localStorage.setItem(k, JSON.stringify(kv[k])); });
    }, seed);
    // The test machine has no internet: answer the font and Excel library requests locally.
    await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await ctx.route('**/xlsx.full.min.js', r => r.fulfill({ contentType: 'application/javascript', body: `
      window.__sheets = {};
      window.XLSX = { utils: {
        book_new: () => ({}),
        aoa_to_sheet: (aoa) => ({ aoa }),
        book_append_sheet: (wb, ws, name) => { window.__sheets[name] = ws.aoa; }
      }, write: () => new ArrayBuffer(8) };` }));
    const p = await ctx.newPage();
    countPuts(p);
    p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    p.on('dialog', async d => { errs.push('DIALOG: ' + d.message()); await d.dismiss(); });
    await p.goto(URL);
    return p;
  }
  async function signIn(p: Page, pw?: string) {
    await p.waitForSelector('#cl-pw');
    await p.fill('#cl-pw', pw || PASSWORD);
    await p.click('#cl-go');
    await p.waitForSelector('#tab-c', { timeout: 5000 });
  }
  // Counts finished saves per page. saved() waits for the next one after the action that
  // triggered it (saves wait 500 ms after a change, so the count is read before it happens).
  const puts = new WeakMap<Page, number>();
  function countPuts(p: Page) {
    puts.set(p, 0);
    p.on('requestfinished', r => { if (r.method() === 'PUT' && r.url().endsWith('/api/state')) puts.set(p, (puts.get(p) || 0) + 1); });
    p.on('requestfailed', r => { if (r.method() === 'PUT' && r.url().endsWith('/api/state')) puts.set(p, (puts.get(p) || 0) + 1); });
  }
  async function saved(p: Page) {
    const before = puts.get(p) || 0;
    const until = Date.now() + 5000;
    while ((puts.get(p) || 0) <= before && Date.now() < until) await p.waitForTimeout(50);
    await p.waitForTimeout(100); // let the page show the result
  }
  const text = (p: Page, sel: string) => p.textContent(sel).then(t => t || '');

  /* ---------- Signing in ---------- */
  console.log('signing in');
  const A = await device();
  await A.waitForSelector('#cl-pw');
  ok('first visit shows the sign-in screen', await A.isVisible('#cl-pw') && !(await A.isVisible('#tab-c')));
  await A.fill('#cl-pw', 'nope'); await A.click('#cl-go'); await A.waitForTimeout(300);
  ok('wrong password message', /not right/.test(await text(A, '#login-msg')), await text(A, '#login-msg'));
  await A.fill('#cl-pw', PASSWORD); await A.press('#cl-pw', 'Enter');
  await A.waitForSelector('#tab-c', { timeout: 5000 }).catch(() => null);
  ok('Enter signs in and shows the app', await A.isVisible('#tab-c'));
  ok('empty team data shows empty lists', /No contracts yet/.test(await text(A, '#list')));
  ok('no import offer when the browser has no old data', !(await A.isVisible('#import')));
  ok('password remembered on this device', await A.evaluate(() => JSON.parse(localStorage.getItem('deadlineCalendar.cloud.v1') || '{}').pw === 'test-pass'));
  await A.reload(); await A.waitForSelector('#tab-c', { timeout: 5000 }).catch(() => null);
  ok('stays signed in after reload', await A.isVisible('#tab-c'));

  /* ---------- Contracts and notices (from the old e2e.js) ---------- */
  console.log('workflow');
  await A.click('#c-submit'); await A.waitForTimeout(200);
  ok('empty form saves nothing', (await A.locator('#list .ccard').count()) === 0);
  await A.fill('#c-vessel', 'MV Aurora'); await A.fill('#c-party', 'Nordic Bulk');
  await A.fill('#c-ref', 'TC-1'); await A.fill('#c-del', '2026-11-20'); await A.fill('#c-red', '2026-11-10');
  await A.click('#c-submit'); await A.waitForTimeout(200);
  ok('redelivery before delivery is refused', /on or after/.test(await text(A, '#c-msg')) && (await A.locator('#list .ccard').count()) === 0);
  await A.fill('#c-red', '2027-05-20');
  await A.click('#c-submit'); await saved(A);
  let st = stored();
  ok('contract saved to Redis', st && st.state.contracts.length === 1 && st.state.contracts[0].vessel === 'MV Aurora', JSON.stringify(st && st.state.contracts[0]));
  ok('success message', /Contract saved/.test(await text(A, '#c-msg')));
  ok('form cleared', (await A.inputValue('#c-vessel')) === '');
  ok('contract card shown', (await A.locator('#list .ccard').count()) === 1);
  await A.click('#today');
  if (new Date().getFullYear() === 2026 && new Date().getMonth() === 10) ok('calendar shows delivery', (await A.locator('.chip.leg').count()) >= 1);
  ok('save line says saved', /All changes saved/.test(await text(A, '#save-msg')));

  await A.click('#tab-n');
  ok('notices pane visible', await A.isVisible('#pane-n'));
  ok('contracts pane hidden', !(await A.isVisible('#pane-c')));
  ok('hint shows estimate', /10 days/.test(await text(A, '#n-hint')), await text(A, '#n-hint'));
  await A.click('#n-days-dd summary');
  await A.check('#n-days input[value="5"]'); await A.check('#n-days input[value="2"]');
  ok('summary text', /10, 5, 2 days selected/.test(await text(A, '#n-days-sum')), await text(A, '#n-days-sum'));
  await A.click('#n-submit'); await saved(A);
  st = stored();
  ok('3 notices created', st.state.notices.length === 3, st.state.notices.map((n: any) => n.title + ' ' + n.date).join(' | '));
  ok('dates correct', ['2026-11-10', '2026-11-15', '2026-11-18'].every(d => st.state.notices.some((n: any) => n.date === d)));
  ok('reminders saved', st.state.notices[0].rems && st.state.notices[0].rems[0].days === 7);
  await A.click('#n-submit'); await A.waitForTimeout(300);
  ok('same notices are not added twice', /already on this contract/.test(await text(A, '#n-msg')) && stored().state.notices.length === 3);

  await A.selectOption('#n-what', 'Redelivery notice');
  ok('redelivery default 30 ticked', await A.isChecked('#n-days input[value="30"]'));
  await A.click('#n-submit'); await saved(A);
  ok('redelivery notice date 2027-04-20', stored().state.notices.some((n: any) => n.date === '2027-04-20'));

  await A.selectOption('#n-what', 'Heel nomination');
  ok('heel shows date box', await A.isVisible('#n-date'));
  ok('heel hides day picker', !(await A.isVisible('#n-days-wrap')));
  ok('heel switches type to contract obligation', (await A.inputValue('#n-type')) === 'contract');
  const soon = plusDays(2);
  await A.fill('#n-date', soon);
  await A.fill('#n-remind', '7'); await A.fill('#n-to1', 'a@x.com, b@x.com');
  await A.fill('#n-remind2', '3'); await A.fill('#n-to2', 'bad-address');
  await A.click('#n-submit'); await A.waitForTimeout(200);
  ok('bad email address is caught', /Please fix: bad-address/.test(await text(A, '#n-msg')));
  await A.fill('#n-to2', 'c@x.com');
  await A.fill('#n-remind3', '1'); await A.fill('#n-to3', 'd@x.com');
  await A.click('#n-submit'); await saved(A);
  const heel = stored().state.notices.find((n: any) => n.title === 'Heel nomination');
  ok('heel notice saved', !!heel && heel.date === soon, JSON.stringify(heel));
  ok('recipients saved', heel && heel.rems.length === 3 && heel.rems[0].to.length === 2);
  ok('banner visible', await A.isVisible('#banner'), (await text(A, '#banner')).slice(0, 120));
  ok('email links present', (await A.locator('#nlist a').count()) >= 2);
  const href = await A.locator('#nlist a').first().getAttribute('href');
  // Two days before the due date the 3-day reminder is the one reached, so its recipient gets the link.
  ok('Outlook link goes to the reminder reached', /outlook\.office\.com.*to=c%40x\.com&subject=Reminder/.test(href || ''), (href || '').slice(0, 100));

  await A.selectOption('#n-what', '');
  await A.fill('#n-title', 'Hire payment'); await A.fill('#n-date', '2026-12-01');
  await A.click('#n-submit'); await saved(A);
  ok('custom notice saved', stored().state.notices.some((n: any) => n.title === 'Hire payment'));

  // calendar click fills the due date
  await A.click('#today');
  await A.locator('.cell:not(.blank)').nth(3).click();
  const picked = await A.locator('.cell.sel').getAttribute('aria-label');
  ok('calendar click fills due date', picked !== null && (await A.inputValue('#n-date')) === picked.slice(0, 10), picked + ' / ' + (await A.inputValue('#n-date')));
  ok('chips have text', (await A.locator('.cell .chip').count()) > 0);

  // edit notice
  const editBtns = A.locator('#nlist .editbtn');
  ok('edit buttons exist', (await editBtns.count()) >= 6, 'count=' + (await editBtns.count()));
  await A.locator('#nlist li').filter({ hasText: 'Hire payment' }).locator('.editbtn').click();
  ok('edit mode label', (await text(A, '#n-sum')) === 'Edit notice');
  ok('cancel visible', await A.isVisible('#n-cancel'));
  ok('title prefilled', (await A.inputValue('#n-title')).length > 0);
  await A.fill('#n-title', 'EDITED title'); await A.fill('#n-date', '2026-12-24');
  await A.click('#n-submit'); await saved(A);
  st = stored();
  ok('notice edit applied', st.state.notices.some((n: any) => n.title === 'EDITED title' && n.date === '2026-12-24'));
  ok('count unchanged after edit', st.state.notices.length === 6, 'n=' + st.state.notices.length);
  ok('form reset after edit', (await text(A, '#n-sum')) === 'Add a notice' && (await A.inputValue('#n-what')) === 'Delivery notice');

  // edit contract
  await A.click('#tab-c');
  await A.click('#list .ccard button:has-text("Edit contract")');
  ok('contract form prefilled', (await A.inputValue('#c-vessel')) === 'MV Aurora');
  await A.fill('#c-vessel', 'MV Borealis');
  await A.press('#c-vessel', 'Enter'); await saved(A);
  st = stored();
  ok('Enter saves the contract edit', st.state.contracts[0].vessel === 'MV Borealis' && st.state.contracts.length === 1);
  ok('notices still linked', st.state.notices.every((n: any) => n.cid === st.state.contracts[0].id));

  // second contract, "Add notice" from its card
  await A.fill('#c-vessel', 'MV Two'); await A.fill('#c-party', 'Other Ltd'); await A.fill('#c-del', '2026-12-05'); await A.fill('#c-red', '2027-01-05');
  await A.click('#c-submit'); await saved(A);
  ok('2 contract cards', (await A.locator('#list .ccard').count()) === 2);
  await A.locator('#list .ccard').filter({ hasText: 'MV Two' }).locator('button:has-text("Add notice")').click();
  ok('switched to notices tab', await A.isVisible('#pane-n'));
  ok('contract preselected', /MV Two/.test(await A.evaluate(() => (document.getElementById('n-contract') as HTMLSelectElement).selectedOptions[0].textContent || '')));

  // reload: everything comes back from Redis
  await A.reload(); await A.waitForSelector('#tab-c');
  ok('contracts come back after reload', (await A.locator('#list .ccard').count()) === 2);
  ok('nothing kept in the browser as a data copy', await A.evaluate(() => localStorage.getItem('deadlineCalendar.v2') === null));

  // done tick and delete
  await A.click('#tab-n');
  await A.locator('#nlist li').filter({ hasText: 'Redelivery notice' }).locator('input[type=checkbox]').check(); await saved(A);
  ok('done saved', stored().state.notices.some((n: any) => n.done));
  await A.locator('#nlist li').filter({ hasText: 'Delivery notice (2 days)' }).locator('.del').click(); await saved(A);
  ok('delete notice', stored().state.notices.length === 5);
  await A.click('#tab-c');
  const two = A.locator('#list .ccard').filter({ hasText: 'MV Two' });
  await two.locator('button.danger').click();
  ok('delete asks for a second click', /Click again/.test(await two.locator('button.danger').textContent() || '') && stored().state.contracts.length === 2);
  await two.locator('button.danger').click(); await saved(A);
  ok('second click deletes the contract', stored().state.contracts.length === 1);

  /* ---------- Excel (from the old excel.js) ---------- */
  console.log('excel');
  await A.click('#xl'); await A.waitForFunction(() => /downloaded|did not load/.test(document.getElementById('xl-msg')?.textContent || ''), null, { timeout: 5000 });
  const sheets: any = await A.evaluate(() => (window as any).__sheets);
  ok('two sheets built', sheets && Object.keys(sheets).join() === 'Contracts,Notices by contract', sheets && Object.keys(sheets).join());
  const nrows = sheets && sheets['Notices by contract'];
  ok('every row has 17 columns', nrows && nrows.every((r: any[]) => r.length === 17));
  const drow = nrows && nrows.find((r: any[]) => r[5] === 'Delivery notice (10 days)');
  ok('dates are Excel date numbers', drow && drow[7].t === 'n' && drow[7].v === 46336, drow && JSON.stringify(drow[7]));

  /* ---------- Saving fails, then recovers ---------- */
  console.log('failed save');
  await A.route('**/api/state', r => r.request().method() === 'PUT' ? r.abort() : r.continue());
  await A.click('#tab-n');
  await A.locator('#nlist li').filter({ hasText: 'Delivery notice (5 days)' }).locator('input[type=checkbox]').check();
  await A.waitForSelector('#save-retry', { timeout: 5000 }).catch(() => null);
  ok('failed save is shown with a retry button', /Not saved/.test(await text(A, '#save-msg')) && await A.isVisible('#save-retry'), await text(A, '#save-msg'));
  await A.unroute('**/api/state');
  await A.click('#save-retry'); await saved(A);
  ok('retry saves the change', stored().state.notices.filter((n: any) => n.done).length === 2);

  /* ---------- Email reminders panel (from the old cloud-e2e.js) ---------- */
  console.log('email panel');
  await A.click('#cloud summary');
  await A.fill('#cl-to', 'bad'); await A.click('#cl-test');
  ok('bad test address caught in page', /valid email/.test(await text(A, '#cl-msg')));
  await A.fill('#cl-to', 'me@x.com'); await A.click('#cl-test'); await A.waitForTimeout(400);
  ok('test email sent', /Test email sent/.test(await text(A, '#cl-msg')) && s.fakes.sentMails.length === 1, await text(A, '#cl-msg'));
  s.fakes.mode.resend = 'fail';
  await A.click('#cl-test'); await A.waitForTimeout(400);
  ok('Resend refusal shown with reason', /Resend refused.*domain/.test(await text(A, '#cl-msg')), await text(A, '#cl-msg'));
  s.fakes.mode.resend = 'ok';
  await A.click('#cl-prev'); await A.waitForTimeout(500);
  ok('preview lists the due reminder', /1 reminder email/.test(await text(A, '#cl-msg')) && /Heel nomination/.test(await text(A, '#cl-out')), await text(A, '#cl-msg'));
  ok('preview sent nothing', s.fakes.sentMails.length === 1);
  await A.click('#cl-run'); await A.waitForFunction(() => /sent,/.test(document.getElementById('cl-msg')?.textContent || ''), null, { timeout: 5000 }).catch(() => null);
  ok('run sends the email', /1 sent, 0 failed/.test(await text(A, '#cl-msg')) && s.fakes.sentMails.length === 2, await text(A, '#cl-msg'));
  await A.click('#cl-run'); await A.waitForTimeout(500);
  ok('second run sends nothing', /0 sent/.test(await text(A, '#cl-msg')) && s.fakes.sentMails.length === 2);
  await A.click('#cl-stat'); await A.waitForTimeout(400);
  ok('sent list shows the email', /sent: Heel nomination/.test(await text(A, '#cl-out')), await text(A, '#cl-out'));

  /* ---------- A second device ---------- */
  console.log('two devices');
  const B = await device();
  await signIn(B);
  ok('second device sees the team data', (await B.locator('#list .ccard').count()) === 1 && /MV Borealis/.test(await text(B, '#list')));
  await B.click('#list .ccard button:has-text("Edit contract")');
  await B.fill('#c-ref', 'FROM-B'); await B.click('#c-submit'); await saved(B);
  ok('second device saves', stored().state.contracts[0].ref === 'FROM-B', stored().state.contracts.map((c: any) => c.vessel + ':' + c.ref).join() + ' / ' + await text(B, '#save-msg') + ' / ' + await text(B, '#c-msg'));
  await A.evaluate(() => window.dispatchEvent(new Event('focus'))); await A.waitForTimeout(500);
  ok('first device picks up the change when it comes back', /Ref FROM-B/.test(await text(A, '#list')), await text(A, '#save-msg'));

  // conflict: B saves, then A saves from the older version
  await B.click('#list .ccard button:has-text("Edit contract")');
  await B.fill('#c-ref', 'NEWER-B'); await B.click('#c-submit'); await saved(B);
  await A.click('#tab-c');
  await A.click('#list .ccard button:has-text("Edit contract")');
  await A.fill('#c-ref', 'STALE-A'); await A.click('#c-submit');
  await A.waitForSelector('#conflict', { timeout: 5000 }).catch(() => null);
  ok('stale device is asked to choose, nothing overwritten', await A.isVisible('#conflict') && stored().state.contracts[0].ref === 'NEWER-B', await text(A, '#save-msg'));
  await A.click('#cf-theirs'); await A.waitForTimeout(200);
  ok('"use the saved version" shows it', /Ref NEWER-B/.test(await text(A, '#list')) && !(await A.isVisible('#conflict')));
  await A.click('#list .ccard button:has-text("Edit contract")');
  await A.fill('#c-ref', 'A-AGAIN'); await A.click('#c-submit'); await saved(A);
  ok('after choosing, saving works again', stored().state.contracts[0].ref === 'A-AGAIN');

  await B.click('#list .ccard button:has-text("Edit contract")');
  await B.fill('#c-ref', 'B-WINS'); await B.click('#c-submit');
  await B.waitForSelector('#conflict', { timeout: 5000 }).catch(() => null);
  ok('the other device also gets the choice', await B.isVisible('#conflict'));
  await B.click('#cf-mine'); await saved(B);
  ok('"keep my version" overwrites', stored().state.contracts[0].ref === 'B-WINS');

  /* ---------- Importing what the old page left in a browser ---------- */
  console.log('import');
  const team = stored().state;
  const oldData = { contracts: [team.contracts[0], { id: 'old-c', ref: '', vessel: 'MV Old', party: 'Legacy Ltd', delivery: '2027-02-01', redelivery: '2027-08-01' }],
    notices: [team.notices[0], { id: 'old-n1', cid: 'old-c', title: 'Old notice', type: 'shipping', date: '2027-01-20', done: false, rems: [{ days: 7, to: ['old@x.com'] }] },
      { id: 'old-n2', cid: 'old-c', title: 'Older shape', type: 'contract', date: '2027-01-25', remind: 5 }] };
  const D = await device({ 'deadlineCalendar.v2': oldData });
  await signIn(D);
  ok('offer to import appears', await D.isVisible('#import'));
  ok('offer counts only what is missing', /1 contract and 2 notices are/.test(await text(D, '#import')), await text(D, '#import'));
  await D.click('#imp-go');
  await D.waitForSelector('#import', { state: 'detached', timeout: 5000 }).catch(() => null);
  st = stored();
  ok('import adds the missing data', st.state.contracts.length === 2 && st.state.notices.some((n: any) => n.id === 'old-n1') && st.state.notices.some((n: any) => n.id === 'old-n2'));
  ok('import keeps the older reminder format', st.state.notices.find((n: any) => n.id === 'old-n2').remind === 5);
  ok('import did not change the existing contract', st.state.contracts[0].ref === 'B-WINS');
  ok('imported data shown', /MV Old/.test(await text(D, '#list')));
  ok('old browser data is kept, not deleted', await D.evaluate(() => !!localStorage.getItem('deadlineCalendar.v2')));
  await D.reload(); await D.waitForSelector('#tab-c');
  ok('no second offer after importing', !(await D.isVisible('#import')));

  const E = await device({ 'deadlineCalendar.items.v1': [{ id: 'flat1', title: 'Very old notice', type: 'shipping', date: '2027-03-01', remind: 3 }] });
  await signIn(E);
  ok('the original flat list is offered too', await E.isVisible('#import') && /1 contract and 1 notice are/.test(await text(E, '#import')), await text(E, '#import'));
  await E.click('#imp-later');
  ok('"not now" hides the offer', !(await E.isVisible('#import')));
  await E.reload(); await E.waitForSelector('#tab-c');
  ok('"not now" asks again next time', await E.isVisible('#import'));
  await E.click('#imp-never');
  await E.reload(); await E.waitForSelector('#tab-c');
  ok('"don\'t ask again" is remembered', !(await E.isVisible('#import')) && !stored().state.notices.some((n: any) => n.id === 'flat1'));

  /* ---------- Sign out ---------- */
  console.log('sign out');
  await E.click('#cloud summary'); await E.click('#cl-off');
  await E.waitForSelector('#cl-pw', { timeout: 5000 }).catch(() => null);
  ok('sign out shows the sign-in screen and forgets the password', await E.isVisible('#cl-pw') && await E.evaluate(() => JSON.parse(localStorage.getItem('deadlineCalendar.cloud.v1') || '{}').pw === ''));
  await E.reload(); await E.waitForSelector('#cl-pw');
  ok('still signed out after reload', await E.isVisible('#cl-pw'));

  /* ---------- Phone width ---------- */
  console.log('phone');
  const P = await device(undefined, 390);
  await P.waitForSelector('#cl-pw');
  ok('no sideways scroll on the sign-in screen', await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await signIn(P);
  await P.click('#cloud summary'); await P.click('#tab-n'); await P.click('#ndetails summary').catch(() => null);
  ok('no sideways scroll on the app at 390px', await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), String(await P.evaluate(() => document.documentElement.scrollWidth)));

  ok('no page errors or pop-up dialogs', errs.length === 0, errs.join(' | '));

  await b.close(); s.srv.close();
  console.log(fails.length ? '\nFAILED: ' + fails.join('; ') : '\nAll browser checks passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
