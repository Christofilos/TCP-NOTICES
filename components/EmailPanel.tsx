'use client';
// Email reminders panel: test email, preview, send now, sent list, sign out.
import { useState } from 'react';
import { api, apiProblem, type ApiReply } from '../lib/browser';
import { MAIL_RE, fmt } from '../lib/rules';
import { msgClass, type Msg } from './forms';

type DueLine = { title: string; vessel: string; date: string; daysLeft: number; stage: number; to: string[] };

function runLine(it: DueLine): string {
  return it.title + ' (' + (it.vessel || 'no vessel') + '), due ' + fmt(it.date) + ', ' + it.daysLeft + ' days left, ' + it.stage + '-day reminder to ' + it.to.join(', ');
}

export default function EmailPanel(props: { pw: string; flush: () => Promise<boolean>; onSignOut: () => void }) {
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState<Msg>({ text: '' });
  const [out, setOut] = useState<{ items: string[]; empty: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const say = function (text: string, good?: boolean) { setMsg({ text: text, good: good }); };
  const down = function () { say('Could not reach the server. Check your connection and try again.'); };

  function call(p: Promise<ApiReply>, then: (j: ApiReply) => void) {
    setBusy(true);
    p.then(then).catch(down).then(function () { setBusy(false); });
  }

  function testEmail() {
    const addr = to.trim();
    if (!MAIL_RE.test(addr)) { say('Type a valid email address to send the test to.'); return; }
    say('Sending test email...', true);
    call(api(props.pw, '/api/test-email', 'POST', { to: addr }), function (j) {
      if (j.httpStatus === 200) say('Test email sent to ' + addr + '. Check the inbox (and junk folder).', true);
      else if (j.error === 'send-failed') say('Brevo refused the email: ' + (j.detail || 'unknown reason'));
      else if (j.error === 'daily-test-limit') say('Daily limit of test emails reached.');
      else say(apiProblem(j));
    });
  }

  function reminderRun(dry: boolean) {
    say(dry ? 'Checking...' : 'Sending...', true);
    // Make sure the latest change is saved first, so the server sees it.
    call(props.flush().then(function () { return api(props.pw, '/api/reminders', 'POST', { dryRun: dry }); }), function (j) {
      if (j.httpStatus !== 200) { say(apiProblem(j)); return; }
      if (j.note && !j.due.length) { say(j.note); setOut(null); return; }
      if (dry) {
        say(j.due.length + ' reminder email(s) would go out today (' + j.today + ').', true);
        setOut({ items: j.due.map(runLine), empty: 'Nothing is due for an email today.' });
      } else {
        say(j.sent + ' sent, ' + j.failed + ' failed.' + (j.failed ? ' Press Show sent emails for the reason.' : ''), !j.failed);
        setOut({ items: j.due.map(runLine), empty: 'Nothing was due for an email today.' });
      }
    });
  }

  function showSent() {
    call(api(props.pw, '/api/status'), function (j) {
      if (j.httpStatus !== 200) { say(apiProblem(j)); return; }
      say(j.last ? 'Last run ' + new Date(j.last.at).toLocaleString() + ': ' + j.last.result.sent + ' sent, ' + j.last.result.failed + ' failed.' : 'The reminder job has not run yet.', true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setOut({ items: j.log.map(function (x: any) {
        return new Date(x.t).toLocaleString() + ' - ' + (x.ok ? 'sent' : 'FAILED (' + (x.error || 'unknown') + ')') + ': ' + x.title + ' (' + (x.vessel || 'no vessel') + '), ' + x.stage + '-day reminder, ' + x.to + ' recipient(s)';
      }), empty: 'No emails have been sent yet.' });
    });
  }

  return (
    <details className="cloudbox" id="cloud">
      <summary>Email reminders</summary>
      <p className="hint">The server emails each reminder to its recipients on the right day (about 08:00 UK time), even when nobody has this page open.</p>
      <label htmlFor="cl-to">Send a test email to</label>
      <input id="cl-to" type="email" autoComplete="off" placeholder="you@company.com" value={to}
        onChange={function (e) { setTo(e.target.value); }}
        onKeyDown={function (e) { if (e.key === 'Enter') { e.preventDefault(); testEmail(); } }} />
      <div className="btns actions"><button type="button" className="ghost" id="cl-test" disabled={busy} onClick={testEmail}>Send test email</button></div>
      <div className="btns actions">
        <button type="button" className="ghost" id="cl-prev" disabled={busy} onClick={function () { reminderRun(true); }}>Preview today&apos;s reminders</button>
        <button type="button" className="ghost" id="cl-run" disabled={busy} onClick={function () { reminderRun(false); }}>Send due reminders now</button>
        <button type="button" className="ghost" id="cl-stat" disabled={busy} onClick={showSent}>Show sent emails</button>
      </div>
      <div id="cl-out">
        {out && !out.items.length ? <p className="hint">{out.empty}</p> : null}
        {out && out.items.length ? <ul>{out.items.map(function (t, i) { return <li key={i}>{t}</li>; })}</ul> : null}
      </div>
      <small className={msgClass(msg)} id="cl-msg" role="status">{msg.text}</small>
      <div className="btns actions"><button type="button" className="ghost" id="cl-off" onClick={props.onSignOut}>Sign out on this device</button></div>
    </details>
  );
}
