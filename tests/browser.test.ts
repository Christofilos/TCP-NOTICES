/*
 * Browser tests for the whole page, against the local test server (real React components,
 * real API handlers, stand-in Redis and Brevo). Ported from the old e2e.js, excel.js and
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
  // Editing a contract moves the cursor to the vessel box a moment later; wait for it before typing elsewhere.
  const waitForVessel = (p: Page) => p.waitForFunction(() => document.activeElement && document.activeElement.id === 'c-vessel', null, { timeout: 3000 }).catch(() => null);

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
  ok('the app is called Notices Calendar', (await text(A, 'h1')) === 'Notices Calendar' && (await A.title()) === 'Notices Calendar');
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
  ok('there is no Type field', (await A.locator('#n-type').count()) === 0);
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
  await A.fill('#n-title', 'Hire payment'); await A.fill('#n-date', '2026-12-01'); await A.fill('#n-time', '14:30');
  await A.click('#n-submit'); await saved(A);
  ok('custom notice saved', stored().state.notices.some((n: any) => n.title === 'Hire payment'));
  ok('due time saved and shown', stored().state.notices.some((n: any) => n.title === 'Hire payment' && n.time === '14:30') && /at 14:30/.test(await A.locator('#nlist li').filter({ hasText: 'Hire payment' }).innerText()));
  ok('notices without a time stay date-only', stored().state.notices.filter((n: any) => n.title !== 'Hire payment').every((n: any) => n.time === undefined));

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
  ok('time prefilled', (await A.inputValue('#n-time')) === '14:30');
  await A.fill('#n-title', 'EDITED title'); await A.fill('#n-date', '2026-12-24'); await A.fill('#n-time', '09:15');
  await A.click('#n-submit'); await saved(A);
  st = stored();
  ok('notice edit applied', st.state.notices.some((n: any) => n.title === 'EDITED title' && n.date === '2026-12-24' && n.time === '09:15'));
  ok('count unchanged after edit', st.state.notices.length === 6, 'n=' + st.state.notices.length);
  ok('form reset after edit', (await text(A, '#n-sum')) === 'Add a notice' && (await A.inputValue('#n-what')) === 'Delivery notice');

  // edit contract
  await A.click('#tab-c');
  await A.click('#list .ccard button:has-text("Edit contract")'); await waitForVessel(A);
  ok('contract form prefilled', (await A.inputValue('#c-vessel')) === 'MV Aurora');
  await A.fill('#c-vessel', 'MV Borealis');
  await A.fill('#c-del-time', '08:00'); await A.fill('#c-red-time', '17:30');
  await A.press('#c-vessel', 'Enter'); await saved(A);
  st = stored();
  ok('Enter saves the contract edit', st.state.contracts[0].vessel === 'MV Borealis' && st.state.contracts.length === 1);
  ok('contract times saved and shown', st.state.contracts[0].deliveryTime === '08:00' && st.state.contracts[0].redeliveryTime === '17:30' && /at 08:00.*at 17:30/.test(await A.locator('#list .ccard').first().innerText()));
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

  // on/off switch and delete (after a reload the contract groups start closed)
  await A.click('#tab-n');
  ok('notice groups start closed after a reload', (await A.locator('#nlist details.ngroup[open]').count()) === 0 && /Show/.test(await text(A, '#nlist details.ngroup summary')));
  await A.locator('#nlist details.ngroup summary').first().click(); await A.waitForTimeout(150);
  ok('opening a group shows its notices', await A.locator('#nlist li').first().isVisible() && /Hide/.test(await text(A, '#nlist details.ngroup summary')), String(await A.locator('#nlist li').first().isVisible()) + ' / ' + await text(A, '#nlist details.ngroup summary') + ' / ' + await A.locator('#nlist details.ngroup').first().evaluate(e => String((e as HTMLDetailsElement).open)));
  await A.locator('#nlist li').filter({ hasText: 'Redelivery notice' }).locator('.switch').click(); await saved(A);
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
  ok('every row has 19 columns, ending Comments then Operator', nrows && nrows.every((r: any[]) => r.length === 19) && nrows[0][17] === 'Comments' && nrows[0][18] === 'Operator' && nrows[0][10] === 'Actioned');
  const drow = nrows && nrows.find((r: any[]) => r[5] === 'Delivery notice (10 days)');
  ok('dates are Excel date numbers', drow && drow[7].t === 'n' && drow[7].v === 46336, drow && JSON.stringify(drow[7]));

  /* ---------- Saving fails, then recovers ---------- */
  console.log('failed save');
  await A.route('**/api/state', r => r.request().method() === 'PUT' ? r.abort() : r.continue());
  await A.click('#tab-n');
  await A.locator('#nlist li').filter({ hasText: 'Delivery notice (5 days)' }).locator('.switch').click();
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
  s.fakes.mode.brevo = 'fail';
  await A.click('#cl-test'); await A.waitForTimeout(400);
  ok('Brevo refusal shown with reason', /Brevo refused.*sender/.test(await text(A, '#cl-msg')), await text(A, '#cl-msg'));
  s.fakes.mode.brevo = 'ok';
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
  await B.click('#list .ccard button:has-text("Edit contract")'); await waitForVessel(B);
  await B.fill('#c-ref', 'FROM-B'); await B.click('#c-submit'); await saved(B);
  ok('second device saves', stored().state.contracts[0].ref === 'FROM-B', stored().state.contracts.map((c: any) => c.vessel + ':' + c.ref).join() + ' / ' + await text(B, '#save-msg') + ' / ' + await text(B, '#c-msg'));
  await A.evaluate(() => window.dispatchEvent(new Event('focus'))); await A.waitForTimeout(500);
  ok('first device picks up the change when it comes back', /Ref FROM-B/.test(await text(A, '#list')), await text(A, '#save-msg'));

  // conflict: B saves, then A saves from the older version
  await B.click('#list .ccard button:has-text("Edit contract")'); await waitForVessel(B);
  await B.fill('#c-ref', 'NEWER-B'); await B.click('#c-submit'); await saved(B);
  await A.click('#tab-c');
  await A.click('#list .ccard button:has-text("Edit contract")'); await waitForVessel(A);
  await A.fill('#c-ref', 'STALE-A'); await A.click('#c-submit');
  await A.waitForSelector('#conflict', { timeout: 5000 }).catch(() => null);
  ok('stale device is asked to choose, nothing overwritten', await A.isVisible('#conflict') && stored().state.contracts[0].ref === 'NEWER-B', await text(A, '#save-msg'));
  await A.click('#cf-theirs'); await A.waitForTimeout(200);
  ok('"use the saved version" shows it', /Ref NEWER-B/.test(await text(A, '#list')) && !(await A.isVisible('#conflict')));
  await A.click('#list .ccard button:has-text("Edit contract")'); await waitForVessel(A);
  await A.fill('#c-ref', 'A-AGAIN'); await A.click('#c-submit'); await saved(A);
  ok('after choosing, saving works again', stored().state.contracts[0].ref === 'A-AGAIN');

  await B.click('#list .ccard button:has-text("Edit contract")'); await waitForVessel(B);
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

  /* ---------- Features added 6-8 Nov: switch, calendar colours, drop-downs, archive, comments ---------- */
  console.log('new features');
  const F = await device();
  await signIn(F);
  async function gotoMonth(p: Page, day: string) {
    await p.click('#today');
    for (let i = 0; i < 14 && !(await p.locator('.cell[aria-label^="' + day + '"]').count()); i++) await p.click('#next');
  }
  const chipOn = (p: Page, day: string, label: string) => p.locator('.cell[aria-label^="' + day + '"] .chip').filter({ hasText: label });
  const dDel = plusDays(20), dRed = plusDays(200), dHeel = plusDays(5), dOpt = plusDays(6), dHire = plusDays(4);
  await F.click('#c-sum');
  await F.fill('#c-vessel', 'MV Feature'); await F.fill('#c-party', 'Test Ltd'); await F.fill('#c-del', dDel); await F.fill('#c-red', dRed);
  await F.fill('#c-operator', '  Maria Ops ');
  await F.click('#c-submit'); await saved(F);
  const fcid = stored().state.contracts.find((c: any) => c.vessel === 'MV Feature').id;
  ok('operator saved on the contract, trimmed', stored().state.contracts.find((c: any) => c.id === fcid).operator === 'Maria Ops');
  ok('contract card shows the operator', /Operator: Maria Ops/.test(await F.locator('#list .ccard').filter({ hasText: 'MV Feature' }).innerText()));
  await F.locator('#list .ccard').filter({ hasText: 'MV Feature' }).locator('button:has-text("Add notice")').click();
  await F.click('#n-submit'); await saved(F);   // Delivery notice, 10 days by default
  await F.selectOption('#n-what', 'Heel nomination'); await F.fill('#n-date', dHeel); await F.fill('#n-notes', 'Heel note\nsecond line');
  await F.click('#n-submit'); await saved(F);
  ok('comments box cleared after adding', (await F.inputValue('#n-notes')) === '');
  await F.selectOption('#n-what', 'Option period lifting');
  ok('option lifting asks for a date, not notice periods', await F.isVisible('#n-date') && !(await F.isVisible('#n-days-wrap')));
  await F.fill('#n-date', dOpt); await F.fill('#n-notes', 'Declare option'); await F.click('#n-submit'); await saved(F);
  await F.selectOption('#n-what', ''); await F.fill('#n-title', 'Hire payment F'); await F.fill('#n-date', dHire);
  await F.click('#n-submit'); await saved(F);
  let fn = stored().state.notices.filter((n: any) => n.cid === fcid);
  const fget = (t: string) => fn.find((n: any) => n.title === t);
  ok('four notices on the new contract', fn.length === 4, fn.map((n: any) => n.title).join(' | '));
  ok('types set automatically', fget('Delivery notice (10 days)').type === 'shipping' && fget('Heel nomination').type === 'contract' && fget('Option period lifting').type === 'contract' && fget('Hire payment F').type === 'contract');
  ok('comments saved', fget('Heel nomination').notes === 'Heel note\nsecond line' && fget('Option period lifting').notes === 'Declare option' && fget('Hire payment F').notes === undefined);
  ok('comment shown under the notice', /Heel note/.test(await F.locator('#nlist li').filter({ hasText: 'Heel nomination' }).locator('small.notes').innerText()));
  ok('group opens by itself after adding', await F.locator('#nlist li').filter({ hasText: 'Hire payment F' }).isVisible());
  const fItems = F.locator('#nlist details.ngroup').filter({ hasText: 'MV Feature' }).locator('li.item');
  ok('every notice of the contract shows its operator', (await fItems.count()) === 4 && (await fItems.locator('small.op').allInnerTexts()).every(t => t === 'Operator: Maria Ops'));
  ok('notices do not store their own copy of the operator', stored().state.notices.filter((n: any) => n.cid === fcid).every((n: any) => n.operator === undefined));
  ok('notice form shows the contract operator', /Operator: Maria Ops \(from the contract\)/.test(await text(F, '#n-operator')));
  ok('notices of other contracts do not show it', (await F.locator('#nlist details.ngroup').filter({ hasNotText: 'MV Feature' }).locator('small.op').filter({ hasText: 'Maria Ops' }).count()) === 0);

  // calendar colours and what it leaves out
  await gotoMonth(F, fget('Delivery notice (10 days)').date);
  ok('delivery notice on the calendar in green', await chipOn(F, fget('Delivery notice (10 days)').date, 'Delivery notice (10 days) - MV Feature').getAttribute('class').then(c => /\bdn\b/.test(c || '')));
  await gotoMonth(F, dHeel);
  ok('heel nomination in blue', await chipOn(F, dHeel, 'Heel nomination - MV Feature').getAttribute('class').then(c => /\bhn\b/.test(c || '')));
  await gotoMonth(F, dOpt);
  ok('option lifting in orange', await chipOn(F, dOpt, 'Option period lifting - MV Feature').getAttribute('class').then(c => /\bol\b/.test(c || '')));
  await gotoMonth(F, dHire);
  ok('other notices are not on the calendar', (await chipOn(F, dHire, 'Hire payment F').count()) === 0);
  await gotoMonth(F, dDel);
  ok('delivery date still grey', await chipOn(F, dDel, 'Delivery: MV Feature').getAttribute('class').then(c => /\bleg\b/.test(c || '')));
  ok('legend lists the new colours', /Delivery \/ redelivery notice[\s\S]*Heel nomination[\s\S]*Option lifting/.test(await text(F, '.legend')));
  const legStyle = await F.evaluate(() => ['--dn', '--hn', '--ol'].map(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim()));
  ok('the three colours are set and different', legStyle.every(x => x) && new Set(legStyle).size === 3, legStyle.join(' '));

  // double-click opens
  await chipOn(F, dDel, 'Delivery: MV Feature').dblclick();
  ok('double-click on a delivery date opens its contract', await F.isVisible('#pane-c') && (await F.inputValue('#c-vessel')) === 'MV Feature' && (await text(F, '#c-submit')) === 'Save changes');
  ok('contract form shows the operator when editing', (await F.inputValue('#c-operator')) === 'Maria Ops');
  await F.fill('#c-operator', 'Ops Desk B'); await F.click('#c-submit'); await saved(F);
  await F.click('#tab-n');
  ok('changing the operator on the contract updates all its notices', (await F.locator('#nlist details.ngroup').filter({ hasText: 'MV Feature' }).locator('small.op').allInnerTexts()).every(t => t === 'Operator: Ops Desk B') && stored().state.contracts.find((c: any) => c.id === fcid).operator === 'Ops Desk B');
  await gotoMonth(F, dHeel);
  await chipOn(F, dHeel, 'Heel nomination - MV Feature').dblclick();
  ok('double-click on a notice opens it for editing', await F.isVisible('#pane-n') && (await text(F, '#n-sum')) === 'Edit notice' && (await F.inputValue('#n-title')) === 'Heel nomination' && (await F.inputValue('#n-notes')) === 'Heel note\nsecond line');
  await F.fill('#n-notes', '   '); await F.click('#n-submit'); await saved(F);
  fn = stored().state.notices.filter((n: any) => n.cid === fcid);
  ok('emptying the comment removes it, type kept on edit', fget('Heel nomination').notes === undefined && fget('Heel nomination').type === 'contract');

  // on/off switch
  const hire = F.locator('#nlist li').filter({ hasText: 'Hire payment F' });
  ok('switch starts on', await hire.locator('input[role=switch]').isChecked() && /On/.test(await hire.locator('.switch').innerText()));
  await hire.locator('.switch').click(); await saved(F);
  await F.click('#tab-c');
  const offLine = F.locator('#list .ccard').filter({ hasText: 'MV Feature' }).locator('li.line').filter({ hasText: 'Hire payment F' });
  const offRed = await F.evaluate(() => { const e = document.createElement('span'); e.style.color = 'var(--warn)'; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; });
  ok('a switched-off notice is grey and says Off under the contract', /Off/.test(await offLine.locator('.lstat').textContent() || '') && (await offLine.locator('.lstat').evaluate(e => getComputedStyle(e).color)) !== offRed);
  await F.click('#tab-n');
  fn = stored().state.notices.filter((n: any) => n.cid === fcid);
  ok('switching off saves it as actioned', fget('Hire payment F').done === true && /Off/.test(await F.locator('#nlist li').filter({ hasText: 'Hire payment F' }).locator('.switch').innerText()) && /Actioned/.test(await F.locator('#nlist li').filter({ hasText: 'Hire payment F' }).innerText()));
  await F.locator('#nlist li').filter({ hasText: 'Hire payment F' }).locator('input[role=switch]').focus(); await F.keyboard.press('Space'); await saved(F);
  fn = stored().state.notices.filter((n: any) => n.cid === fcid);
  ok('switch works from the keyboard and turns back on', fget('Hire payment F').done === false);

  // contracts tab: notices as a drop-down of lines
  await F.click('#tab-c');
  const fcard = F.locator('#list .ccard').filter({ hasText: 'MV Feature' });
  ok('notice lines start closed', !(await fcard.locator('details.lineset').evaluate(e => (e as HTMLDetailsElement).open)) && /4 notices/.test(await fcard.locator('details.lineset summary').innerText()));
  await fcard.locator('details.lineset summary').click(); await F.waitForTimeout(150);
  ok('drop-down label changes to Hide', /Hide/.test(await fcard.locator('details.lineset summary').innerText()));
  ok('opening shows the notices as lines', (await fcard.locator('li.line').count()) === 4 && await fcard.locator('li.line').first().isVisible());
  const lineColours = await fcard.locator('li.line').evaluateAll(ls => ls.map(l => [l.querySelector('.lname')!.textContent, getComputedStyle(l.querySelector('.lstat')!).color]));
  const red = await F.evaluate(() => { const e = document.createElement('span'); e.style.color = 'var(--warn)'; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; });
  ok('every active notice status is red under the contract, including heel nomination and option lifting', lineColours.length === 4 && lineColours.every(l => l[1] === red), JSON.stringify(lineColours));
  await fcard.locator('button.lname', { hasText: 'Option period lifting' }).click();
  ok('clicking a line opens that notice', await F.isVisible('#pane-n') && (await F.inputValue('#n-title')) === 'Option period lifting');

  // archive a notice from the edit form
  ok('archive button shown only while editing', await F.isVisible('#n-archive'));
  await F.click('#n-archive'); await saved(F);
  fn = stored().state.notices.filter((n: any) => n.cid === fcid);
  ok('archiving saves the flag and date', fget('Option period lifting').archived === true && /^\d{4}-\d{2}-\d{2}$/.test(fget('Option period lifting').archivedAt));
  ok('archived notice leaves the list and the form closes', (await F.locator('#nlist li').filter({ hasText: 'Option period lifting' }).count()) === 0 && (await text(F, '#n-sum')) === 'Add a notice' && !(await F.isVisible('#n-archive')));
  await gotoMonth(F, dOpt);
  ok('archived notice leaves the calendar', (await chipOn(F, dOpt, 'Option period lifting - MV Feature').count()) === 0);
  ok('archive tab shows a count', /\(1\)/.test(await text(F, '#tab-a')), await text(F, '#tab-a'));
  await F.click('#tab-c');
  ok('contract card counts the archived notice', /3 notices.*\(1 archived\)/.test(await F.locator('#list .ccard').filter({ hasText: 'MV Feature' }).innerText()));
  await F.click('#tab-a');
  ok('archive tab lists the notice', /Option period lifting/.test(await text(F, '#alist')));
  await F.locator('#alist button', { hasText: 'Restore' }).click(); await saved(F);
  fn = stored().state.notices.filter((n: any) => n.cid === fcid);
  ok('restore brings it back', !fget('Option period lifting').archived && /Restored/.test(await text(F, '#a-msg')) && /Nothing archived/.test(await text(F, '#alist')));

  // archive the whole contract
  await F.click('#tab-c');
  await F.locator('#list .ccard').filter({ hasText: 'MV Feature' }).locator('button:has-text("Archive contract")').click(); await saved(F);
  ok('archiving a contract saves the flag', stored().state.contracts.find((c: any) => c.id === fcid).archived === true);
  ok('archived contract leaves the Contracts tab', (await F.locator('#list .ccard').filter({ hasText: 'MV Feature' }).count()) === 0 && /Archived MV Feature/.test(await text(F, '#c-msg')));
  ok('its notices leave the Notices tab', (await F.locator('#nlist li').filter({ hasText: 'Hire payment F' }).count()) === 0);
  ok('it is not offered when adding a notice', !(await F.evaluate((id: string) => Array.from(document.querySelectorAll('#n-contract option')).some(o => (o as HTMLOptionElement).value === id), fcid)));
  await gotoMonth(F, dDel);
  ok('its dates leave the calendar', (await chipOn(F, dDel, 'MV Feature').count()) === 0);
  ok('its notices are not in the alert banner', !/MV Feature/.test(await F.locator('#banner').count() ? await text(F, '#banner') : ''));
  await F.click('#tab-a');
  const acard = F.locator('#alist .acontract').filter({ hasText: 'MV Feature' });
  ok('archive tab lists the contract with its notices', (await acard.count()) === 1 && (await acard.locator('li.line').count()) === 4);
  await acard.locator('button:has-text("Restore contract")').click(); await saved(F);
  ok('restore contract brings it back', !stored().state.contracts.find((c: any) => c.id === fcid).archived && (await F.locator('#alist .acontract').count()) === 0);

  // Excel keeps comments and archived status
  await F.click('#tab-c');
  await F.locator('#list .ccard').filter({ hasText: 'MV Feature' }).locator('button:has-text("Archive contract")').click(); await saved(F);
  await F.click('#xl'); await F.waitForFunction(() => /downloaded|did not load/.test(document.getElementById('xl-msg')?.textContent || ''), null, { timeout: 5000 });
  const fsheets: any = await F.evaluate(() => (window as any).__sheets);
  const optRow = fsheets['Notices by contract'].find((r: any[]) => r[0] === 'MV Feature' && r[5] === 'Option period lifting');
  ok('Excel has the comment, the archived status and the operator', optRow && optRow[17] === 'Declare option' && optRow[9] === 'Archived' && optRow[18] === 'Ops Desk B', JSON.stringify(optRow && [optRow[9], optRow[17], optRow[18]]));
  const fsum = fsheets['Contracts'].find((r: any[]) => r[0] === 'MV Feature');
  ok('Excel contracts sheet has the operator', fsum && fsum[8] === 'Ops Desk B' && fsheets['Contracts'][0][8] === 'Operator');

  // delete the archived contract for good
  await F.click('#tab-a');
  const del = F.locator('#alist .acontract').filter({ hasText: 'MV Feature' }).locator('button.danger');
  await del.click();
  ok('deleting an archived contract asks for a second click', /Click again/.test(await del.innerText()) && !!stored().state.contracts.find((c: any) => c.id === fcid));
  await del.click(); await saved(F);
  ok('second click deletes the contract and its notices', !stored().state.contracts.find((c: any) => c.id === fcid) && !stored().state.notices.some((n: any) => n.cid === fcid));

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
