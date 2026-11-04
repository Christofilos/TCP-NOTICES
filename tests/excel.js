// Tests what the page hands to the Excel library. The real SheetJS library is replaced by a stand-in,
// so this works without internet. It cannot prove the real .xlsx opens in Excel.
const { chromium } = require('playwright');
const PAGE = 'file://' + require('path').resolve(__dirname, '../index.html');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1200, height: 1000 } })).newPage();
  const errs = [], fails = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.dismiss());
  const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' -> ' + x : '')); if (!c) fails.push(n); };
  await p.route('**/xlsx.full.min.js', r => r.fulfill({ contentType: 'application/javascript', body: `
    window.__sheets = {};
    window.XLSX = { utils: {
      book_new: () => ({}),
      aoa_to_sheet: (aoa) => ({ aoa }),
      book_append_sheet: (wb, ws, name) => { window.__sheets[name] = ws.aoa; }
    }, write: () => new ArrayBuffer(8) };` }));
  await p.goto(PAGE);
  await p.waitForTimeout(400);
  await p.click('#xl');
  ok('empty export is refused with a message', /Add a contract first/.test(await p.textContent('#xl-msg')));
  await p.fill('#c-vessel', 'MV Aurora'); await p.fill('#c-party', 'Nordic'); await p.fill('#c-del', '2026-11-20'); await p.fill('#c-red', '2027-05-20');
  await p.click('#c-submit');
  await p.fill('#c-vessel', 'MV Empty'); await p.fill('#c-party', 'NoNotices'); await p.fill('#c-del', '2026-12-01'); await p.fill('#c-red', '2027-01-01');
  await p.click('#c-submit');
  await p.click('#tab-n');
  await p.selectOption('#n-contract', { index: 0 });
  await p.fill('#n-to1', 'a@x.com, b@x.com');
  await p.click('#n-submit');
  await p.click('#xl'); await p.waitForTimeout(400);
  const s = await p.evaluate(() => window.__sheets);
  ok('two sheets built', Object.keys(s).join() === 'Contracts,Notices by contract', Object.keys(s).join());
  const c = s['Contracts'], n = s['Notices by contract'];
  ok('contracts sheet has header + 2 rows', c && c.length === 3);
  ok('notices sheet has header + notice row + empty-contract row', n && n.length === 3, n && n.length);
  ok('header has 17 columns', n && n[0].length === 17);
  ok('every row has 17 columns', n && n.every(r => r.length === 17));
  const noticeRow = n && n.find(r => /Delivery notice/.test(String(r[5])));
  ok('notice row has its recipients', noticeRow && noticeRow[12] === 'a@x.com, b@x.com', noticeRow && noticeRow[12]);
  ok('dates are Excel date numbers', noticeRow && noticeRow[3] && noticeRow[3].t === 'n' && noticeRow[3].v === 46346, noticeRow && JSON.stringify(noticeRow[3]));
  ok('contract with no notices still listed', n && n.some(r => r[0] === 'MV Empty' && r[5] === '(no notices)'));
  console.log('ERRORS:', errs.join('\n') || 'none');
  console.log('FAILED:', fails.length ? fails.join('; ') : 'none');
  if (fails.length || errs.length) process.exitCode = 1;
  await b.close();
})();
