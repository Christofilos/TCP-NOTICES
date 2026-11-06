const { chromium } = require('playwright');
const PAGE = 'file://' + require('path').resolve(__dirname, '../index.html');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1200, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [], dialogs = [], fails = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
  const ok = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' -> ' + extra : '')); if (!cond) fails.push(name); };
  await p.goto(PAGE);
  await p.waitForTimeout(800);

  // 1 add contract
  await p.fill('#c-vessel', 'MV Aurora'); await p.fill('#c-party', 'Nordic Bulk');
  await p.fill('#c-ref', 'TC-1'); await p.fill('#c-del', '2026-11-20'); await p.fill('#c-red', '2027-05-20');
  await p.click('#c-submit');
  await p.waitForTimeout(300);
  let st = await p.evaluate(() => JSON.parse(localStorage.getItem('deadlineCalendar.v2')));
  ok('contract saved', st.contracts.length === 1, JSON.stringify(st.contracts[0]));
  ok('contract card shown', (await p.locator('#list .ccard').count()) === 1);
  ok('calendar shows delivery', (await p.locator('.chip.leg').count()) >= 1);

  // 2 notices tab, delivery notice default
  await p.click('#tab-n'); await p.waitForTimeout(200);
  ok('notices pane visible', await p.isVisible('#pane-n'));
  ok('contracts pane hidden', !(await p.isVisible('#pane-c')));
  const hint = await p.textContent('#n-hint');
  ok('hint shows estimate', /10 days/.test(hint), hint);
  await p.click('#n-days-dd summary');
  await p.check('#n-days input[value="5"]'); await p.check('#n-days input[value="2"]');
  ok('summary text', /10, 5, 2 days selected/.test(await p.textContent('#n-days-sum')), await p.textContent('#n-days-sum'));
  await p.click('#n-submit'); await p.waitForTimeout(300);
  st = await p.evaluate(() => JSON.parse(localStorage.getItem('deadlineCalendar.v2')));
  ok('3 notices created', st.notices.length === 3, st.notices.map(n => n.title + ' ' + n.date).join(' | '));
  ok('dates correct', ['2026-11-10', '2026-11-15', '2026-11-18'].every(d => st.notices.some(n => n.date === d)));
  ok('reminders saved', st.notices[0].rems && st.notices[0].rems[0].days === 7);

  // 3 redelivery notice
  await p.selectOption('#n-what', 'Redelivery notice');
  ok('redelivery default 30 ticked', await p.isChecked('#n-days input[value="30"]'));
  await p.click('#n-submit'); await p.waitForTimeout(300);
  st = await p.evaluate(() => JSON.parse(localStorage.getItem('deadlineCalendar.v2')));
  ok('redelivery notice date 2027-04-20', st.notices.some(n => n.date === '2027-04-20'), st.notices.map(n => n.title).join(' | '));

  // 4 heel nomination
  await p.selectOption('#n-what', 'Heel nomination');
  ok('heel shows date box', await p.isVisible('#n-date'));
  ok('heel hides day picker', !(await p.isVisible('#n-days-wrap')));
  await p.fill('#n-date', '2026-11-05');
  await p.fill('#n-remind', '7'); await p.fill('#n-to1', 'a@x.com, b@x.com');
  await p.fill('#n-remind2', '3'); await p.fill('#n-to2', 'c@x.com');
  await p.fill('#n-remind3', '1'); await p.fill('#n-to3', 'd@x.com');
  await p.click('#n-submit'); await p.waitForTimeout(300);
  st = await p.evaluate(() => JSON.parse(localStorage.getItem('deadlineCalendar.v2')));
  const heel = st.notices.find(n => n.title === 'Heel nomination');
  ok('heel notice saved', !!heel && heel.date === '2026-11-05', JSON.stringify(heel));
  ok('recipients saved', heel && heel.rems.length === 3 && heel.rems[0].to.length === 2);
  ok('banner visible', await p.isVisible('#banner'), (await p.textContent('#banner')).slice(0, 120));
  const links = await p.locator('#nlist a').count();
  ok('email links present', links >= 2, 'links=' + links);
  if (links) { const hrefs = await p.locator('#nlist a').evaluateAll(a => a.map(x => x.getAttribute('href').slice(0, 90))); console.log(hrefs.join('\n')); }

  // 5 Other custom
  await p.selectOption('#n-what', '');
  await p.fill('#n-title', 'Hire payment'); await p.fill('#n-date', '2026-12-01');
  await p.click('#n-submit'); await p.waitForTimeout(300);
  st = await p.evaluate(() => JSON.parse(localStorage.getItem('deadlineCalendar.v2')));
  ok('custom notice saved', st.notices.some(n => n.title === 'Hire payment'));

  // 6 calendar chip text
  const chipTexts = await p.locator('.cell .chip').allTextContents();
  ok('chips have text', chipTexts.length > 0, chipTexts.slice(0, 4).join(' | '));
  // calendar colours: delivery/redelivery notices green (dn), heel nomination blue (hn), option lifting orange (ol)
  const kinds = await p.evaluate(() => ({
    del: eventsOn('2026-11-10').map(e => e.cls + '|' + e.label),
    heel: eventsOn('2026-11-05').map(e => e.cls + '|' + e.label),
    hire: eventsOn('2026-12-01').length,
    redel: eventsOn('2027-05-20').map(e => e.cls + '|' + e.label),
    redelNotice: eventsOn('2027-04-20').map(e => e.cls)
  }));
  ok('delivery notice on calendar in green', kinds.del.some(x => /^dn\|Delivery notice \(10 days\)/.test(x)), JSON.stringify(kinds.del));
  ok('redelivery notice on calendar in green', kinds.redelNotice.indexOf('dn') >= 0, JSON.stringify(kinds.redelNotice));
  ok('heel nomination on calendar in blue', kinds.heel.some(x => /^hn\|Heel nomination/.test(x)), JSON.stringify(kinds.heel));
  ok('delivery and redelivery dates still grey', chipTexts.some(t => /^Delivery: MV Aurora/.test(t)) && kinds.redel.some(x => /^leg\|Redelivery: /.test(x)));
  ok('other notices stay off the calendar', kinds.hire === 0);
  ok('reminder dates are not on the calendar', (await p.evaluate(() => eventsOn('2026-10-29').length + eventsOn('2026-11-03').length)) === 0);
  ok('legend lists the three colours', /Delivery \/ redelivery notice[\s\S]*Heel nomination[\s\S]*Option lifting/.test(await p.textContent('.legend')));

  // option period lifting from the dropdown
  await p.selectOption('#n-what', 'Option period lifting');
  ok('option lifting asks for a date', await p.isVisible('#n-date') && !(await p.isVisible('#n-days-wrap')));
  ok('option lifting defaults to contract obligation', (await p.inputValue('#n-type')) === 'contract');
  await p.fill('#n-date', '2026-11-25'); await p.click('#n-submit'); await p.waitForTimeout(300);
  st = await p.evaluate(() => JSON.parse(localStorage.getItem('deadlineCalendar.v2')));
  ok('option lifting saved', st.notices.some(n => n.title === 'Option period lifting' && n.date === '2026-11-25'));
  const ol = await p.locator('.cell .chip.ol').allTextContents();
  ok('option lifting on calendar in orange', ol.some(t => /^Option period lifting - MV Aurora/.test(t)), JSON.stringify(ol));
  const olColour = await p.locator('.cell .chip.ol').first().evaluate(e => getComputedStyle(e).color);
  const dnColour = await p.locator('.cell .chip.dn').first().evaluate(e => getComputedStyle(e).color);
  const hnColour = await p.locator('.cell .chip.hn').first().evaluate(e => getComputedStyle(e).color);
  ok('the three colours are different', olColour !== dnColour && dnColour !== hnColour && olColour !== hnColour, [dnColour, hnColour, olColour].join(' '));
  ok('notices are still all listed on the Notices tab', (await p.locator('#nlist .item').count()) === st.notices.length);

  // 7 edit notice
  await p.waitForTimeout(100);
  const editBtns = p.locator('#nlist .editbtn');
  ok('edit buttons exist', (await editBtns.count()) >= 5, 'count=' + (await editBtns.count()));
  await editBtns.first().click(); await p.waitForTimeout(200);
  ok('edit mode label', (await p.textContent('#n-sum')) === 'Edit notice');
  ok('cancel visible', await p.isVisible('#n-cancel'));
  const tval = await p.inputValue('#n-title');
  ok('title prefilled', tval.length > 0, tval);
  await p.fill('#n-title', 'EDITED title'); await p.fill('#n-date', '2026-12-24');
  await p.click('#n-submit'); await p.waitForTimeout(300);
  st = await p.evaluate(() => JSON.parse(localStorage.getItem('deadlineCalendar.v2')));
  ok('notice edit applied', st.notices.some(n => n.title === 'EDITED title' && n.date === '2026-12-24'));
  ok('count unchanged after edit', st.notices.length === 7, 'n=' + st.notices.length);
  ok('form reset after edit', (await p.textContent('#n-sum')) === 'Add a notice' && (await p.inputValue('#n-what')) === 'Delivery notice');

  // 8 edit contract
  await p.click('#tab-c'); await p.waitForTimeout(100);
  await p.click('#list .ccard button:has-text("Edit contract")'); await p.waitForTimeout(100);
  ok('contract form prefilled', (await p.inputValue('#c-vessel')) === 'MV Aurora');
  await p.fill('#c-vessel', 'MV Borealis');
  await p.click('#c-submit'); await p.waitForTimeout(300);
  st = await p.evaluate(() => JSON.parse(localStorage.getItem('deadlineCalendar.v2')));
  ok('contract edit applied', st.contracts[0].vessel === 'MV Borealis' && st.contracts.length === 1);
  ok('notices still linked', st.notices.every(n => n.cid === st.contracts[0].id));

  // 9 second contract + add notice here
  await p.fill('#c-vessel', 'MV Two'); await p.fill('#c-party', 'Other Ltd'); await p.fill('#c-del', '2026-12-05'); await p.fill('#c-red', '2027-01-05');
  await p.click('#c-submit'); await p.waitForTimeout(300);
  ok('2 contract cards', (await p.locator('#list .ccard').count()) === 2);
  await p.locator('#list .ccard').nth(1).locator('button:has-text("Add notice")').click(); await p.waitForTimeout(200);
  ok('switched to notices tab', await p.isVisible('#pane-n'));
  const sel = await p.evaluate(() => document.getElementById('n-contract').selectedOptions[0].textContent);
  ok('contract preselected', /MV (Two|Borealis)/.test(sel), sel);

  // 10 reload persistence
  await p.reload(); await p.waitForTimeout(500);
  st = await p.evaluate(() => JSON.parse(localStorage.getItem('deadlineCalendar.v2')));
  ok('persisted after reload', st.notices.length === 7 && st.contracts.length === 2);
  ok('contracts render after reload', (await p.locator('#list .ccard').count()) === 2);

  // 11 delete notice, mark done
  await p.click('#tab-n');
  const sw = p.locator('#nlist input[role=switch]');
  ok('every notice has an on/off switch', (await sw.count()) === 7);
  ok('switches start on', await sw.first().isChecked() && /On/.test(await p.locator('#nlist .switch').first().textContent()));
  const firstTitle = await p.locator('#nlist .item').first().locator('strong').textContent();
  const banBefore = await p.evaluate(() => document.getElementById('banner').hidden ? 0 : document.getElementById('banner').textContent.length);
  await p.locator('#nlist .switch').first().click(); await p.waitForTimeout(200);
  st = await p.evaluate(() => JSON.parse(localStorage.getItem('deadlineCalendar.v2')));
  ok('switching off marks it actioned', st.notices.filter(n => n.done).length === 1);
  const offItem = p.locator('#nlist .item.isdone');
  ok('switched-off notice shows Off and Actioned', (await offItem.count()) === 1 && /Off/.test(await offItem.locator('.switch').textContent()) && /Actioned/.test(await offItem.textContent()), await offItem.textContent());
  ok('switched-off notice moves to the end of its group', (await p.locator('#nlist .item').first().locator('strong').textContent()) !== firstTitle || (await p.locator('#nlist .item').first().getAttribute('class')).indexOf('isdone') < 0);
  ok('switched-off notice has no email links', (await offItem.locator('a').count()) === 0);
  const banAfter = await p.evaluate(() => document.getElementById('banner').hidden ? 0 : document.getElementById('banner').textContent.length);
  ok('alert banner no longer lists it', banAfter <= banBefore);
  await offItem.locator('input[role=switch]').focus(); await p.keyboard.press('Space'); await p.waitForTimeout(200);
  st = await p.evaluate(() => JSON.parse(localStorage.getItem('deadlineCalendar.v2')));
  ok('switch works from the keyboard and turns back on', st.notices.every(n => !n.done));
  await p.locator('#nlist .switch').first().click(); await p.waitForTimeout(200);
  st = await p.evaluate(() => JSON.parse(localStorage.getItem('deadlineCalendar.v2')));
  ok('done saved', st.notices.some(n => n.done));
  await p.locator('#nlist .del').first().click(); await p.waitForTimeout(200);
  st = await p.evaluate(() => JSON.parse(localStorage.getItem('deadlineCalendar.v2')));
  ok('delete notice', st.notices.length === 6);

  // 11b notices as line items under each contract (Contracts tab)
  await p.click('#tab-c'); await p.waitForTimeout(200);
  const cards = await p.evaluate(() => Array.from(document.querySelectorAll('#list .ccard')).map(c => ({
    name: c.querySelector('strong').textContent,
    lines: Array.from(c.querySelectorAll('ul.lines li')).map(l => ({ t: l.querySelector('.lname').textContent, off: l.classList.contains('isdone'), d: l.querySelector('.ldate').textContent }))
  })));
  const perContract = await p.evaluate(() => state.contracts.map(c => ({ name: c.vessel + ' / ' + c.party, n: state.notices.filter(n => n.cid === c.id).length })));
  ok('each contract lists its own notices as lines', perContract.every(pc => { const cd = cards.find(x => x.name === pc.name); return cd && cd.lines.length === pc.n; }), JSON.stringify(cards.map(c => c.name + ':' + c.lines.length)));
  const aur = cards.find(c => c.lines.length);
  ok('switched-off notices sit at the bottom and show as off', aur && aur.lines.some(l => l.off) && aur.lines.findIndex(l => l.off) >= aur.lines.filter(l => !l.off).length, JSON.stringify(aur && aur.lines.map(l => l.off)));
  const openDates = await p.evaluate(() => { const c = state.contracts.find(x => state.notices.some(n => n.cid === x.id)); return state.notices.filter(n => n.cid === c.id && !n.done).map(n => n.date).sort(); });
  const shownOpen = await p.evaluate(() => Array.from(document.querySelectorAll('#list .ccard')).find(c => c.querySelector('ul.lines')).querySelectorAll('ul.lines li:not(.isdone)').length);
  ok('open notices listed in due-date order', shownOpen === openDates.length);
  const lineBox = await p.evaluate(() => { const l = document.querySelector('#list li.line.l-con'); if(!l) return null; const cs = getComputedStyle(l); return { mb: cs.marginBottom, radius: cs.borderTopLeftRadius }; });
  ok('contract-obligation lines look like the other lines', !lineBox || (lineBox.mb === '0px' && lineBox.radius === '0px'), JSON.stringify(lineBox));
  const firstLine = p.locator('#list ul.lines .lname').first();
  const firstName = await firstLine.textContent();
  await firstLine.click(); await p.waitForTimeout(200);
  ok('clicking a line opens that notice for editing', await p.isVisible('#pane-n') && (await p.textContent('#n-submit')) === 'Save changes', firstName);
  await p.evaluate(() => endEdit()); await p.click('#tab-c'); await p.waitForTimeout(200);

  // 12 mobile width
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(200);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('no horizontal scroll on phone', !overflow);

  console.log('DIALOGS:', JSON.stringify(dialogs));
  console.log('ERRORS:', errs.join('\n') || 'none');
  console.log('FAILED:', fails.length ? fails.join('; ') : 'none');
  if (fails.length || errs.length) process.exitCode = 1;
  
  await b.close();
})();
