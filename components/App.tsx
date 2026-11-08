'use client';
/*
 * The whole page. All contracts and notices live in Redis on the server; this component
 * holds a working copy in memory and saves every change straight back (after a short pause
 * so a burst of edits becomes one save).
 *
 * Two people saving at once: the server refuses a save made on an older revision (409),
 * and the page asks which version to keep. Nothing is overwritten silently.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState } from '../lib/types';
import { byId, live, remindsOf, status, todayStr, daysUntil } from '../lib/rules';
import {
  KEYS, api, apiProblem, importPlan, legacyData, read, rememberPassword, savedPassword, write
} from '../lib/browser';
import { exportExcel } from '../lib/excel';
import Calendar from './Calendar';
import ContractsPane from './ContractsPane';
import NoticesPane, { type NoticeRequest } from './NoticesPane';
import EmailPanel from './EmailPanel';
import ArchivePane, { archiveCount } from './ArchivePane';
import { msgClass, type Msg } from './forms';

const EMPTY: AppState = { contracts: [], notices: [] };
const SAVE_PAUSE_MS = 500;
const REFRESH_MS = 60000;

type Phase = 'starting' | 'login' | 'ready';
type SaveInfo = { text: string; bad?: boolean; retry?: boolean };
type Conflict = { theirs: AppState; rev: number; updatedAt: string | null };
type Offer = { contracts: number; notices: number; plan: AppState };

function clone(s: AppState): AppState { return JSON.parse(JSON.stringify(s)); }

export default function App() {
  const [phase, setPhase] = useState<Phase>('starting');
  const [pw, setPw] = useState('');
  const [pwInput, setPwInput] = useState('');
  const [loginMsg, setLoginMsg] = useState<Msg>({ text: '' });
  const [data, setData] = useState<AppState>(EMPTY);
  const [save, setSave] = useState<SaveInfo>({ text: '' });
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [offerMsg, setOfferMsg] = useState<Msg>({ text: '' });
  const [tab, setTab] = useState<'c' | 'n' | 'a'>('c');
  // seq changes on every click, so clicking the same day again still fills in the due date.
  const [pick, setPick] = useState({ date: todayStr(), seq: 0 });
  const [noticeReq, setNoticeReq] = useState<NoticeRequest | null>(null);
  const [contractReq, setContractReq] = useState<{ cid: string; seq: number } | null>(null);
  const [notifText, setNotifText] = useState('Turn on desktop alerts');
  const [xlMsg, setXlMsg] = useState('');

  const pwRef = useRef('');
  const dataRef = useRef<AppState>(EMPTY);
  const revRef = useRef(0);
  const dirtyRef = useRef(false);
  const conflictRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<Promise<boolean> | null>(null);

  function adopt(s: AppState, rev: number) {
    dataRef.current = s; revRef.current = rev; dirtyRef.current = false;
    setData(s);
  }

  /* ---------- Saving ---------- */

  const flush = useCallback(function flushNow(force?: boolean): Promise<boolean> {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (inflightRef.current) return inflightRef.current.then(function () { return flushNow(force); });
    if (!force && (!dirtyRef.current || conflictRef.current)) return Promise.resolve(!dirtyRef.current);
    dirtyRef.current = false;
    setSave({ text: 'Saving...' });
    const p = api(pwRef.current, '/api/state', 'PUT', { state: dataRef.current, baseRev: revRef.current, force: force === true })
      .then(function (j) {
        if (j.httpStatus === 200) {
          revRef.current = j.rev;
          if (!dirtyRef.current) setSave({ text: 'All changes saved at ' + new Date().toLocaleTimeString() + '.' });
          return true;
        }
        dirtyRef.current = true;
        if (j.httpStatus === 409) {
          return api(pwRef.current, '/api/state').then(function (c) {
            if (c.httpStatus === 200 && c.state) {
              conflictRef.current = true;
              setConflict({ theirs: c.state, rev: c.rev, updatedAt: c.updatedAt || null });
              setSave({ text: 'Not saved yet: someone else saved changes first.', bad: true });
            } else {
              setSave({ text: 'Not saved: ' + apiProblem(c), bad: true, retry: true });
            }
            return false;
          });
        }
        setSave({ text: 'Not saved: ' + apiProblem(j), bad: true, retry: true });
        return false;
      })
      .catch(function () {
        dirtyRef.current = true;
        setSave({ text: 'Not saved: could not reach the server. Your changes are kept on this page until it saves.', bad: true, retry: true });
        return false;
      })
      .then(function (r) { inflightRef.current = null; return r; });
    inflightRef.current = p;
    return p;
  }, []);

  /* Every edit goes through here: copy, change, show, then save after a short pause. */
  const change = useCallback(function (fn: (d: AppState) => void) {
    const next = clone(dataRef.current);
    fn(next);
    dataRef.current = next;
    dirtyRef.current = true;
    setData(next);
    if (conflictRef.current) return;
    setSave({ text: 'Saving...' });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(function () { flush(); }, SAVE_PAUSE_MS);
  }, [flush]);

  function useTheirs() {
    if (!conflict) return;
    conflictRef.current = false;
    adopt(conflict.theirs, conflict.rev);
    setConflict(null);
    setSave({ text: 'Now showing the latest saved version.' });
  }
  function keepMine() {
    conflictRef.current = false;
    setConflict(null);
    dirtyRef.current = true;
    flush(true);
  }

  /* ---------- Signing in and loading ---------- */

  function offerImport(team: AppState) {
    const local = legacyData();
    if (!local || read(KEYS.imported, null)) { setOffer(null); return; }
    const plan = importPlan(team, local);
    if (!plan.contracts.length && !plan.notices.length) { setOffer(null); return; }
    setOffer({ contracts: plan.contracts.length, notices: plan.notices.length, plan: plan });
  }

  function connect(password: string, silent: boolean) {
    if (!password) { setPhase('login'); if (!silent) setLoginMsg({ text: 'Type the team password first.' }); return; }
    if (!silent) setLoginMsg({ text: 'Signing in...', good: true });
    api(password, '/api/state').then(function (j) {
      if (j.httpStatus !== 200) {
        setPhase('login');
        if (silent && j.error === 'wrong-password') { rememberPassword(''); setLoginMsg({ text: '' }); }
        else setLoginMsg({ text: apiProblem(j) });
        return;
      }
      pwRef.current = password; setPw(password);
      rememberPassword(password);
      setPwInput(''); setLoginMsg({ text: '' });
      const team: AppState = j.state || EMPTY;
      adopt(team, j.rev || 0);
      setSave({ text: '' });
      offerImport(team);
      setPhase('ready');
    }).catch(function () {
      setPhase('login');
      setLoginMsg({ text: 'Could not reach the server. Check your connection and try again.' });
      if (silent) setPwInput(password);
    });
  }

  function signOut() {
    flush().then(function () {
      rememberPassword('');
      pwRef.current = ''; setPw('');
      adopt(EMPTY, 0);
      setConflict(null); conflictRef.current = false; setOffer(null);
      setSave({ text: '' });
      setLoginMsg({ text: 'Signed out on this device.', good: true });
      setPhase('login');
    });
  }

  useEffect(function () { connect(savedPassword(), true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Pick up changes saved from other devices: on returning to the page, and every minute. */
  useEffect(function () {
    if (phase !== 'ready') return;
    function refresh() {
      if (document.hidden || dirtyRef.current || inflightRef.current || conflictRef.current || timerRef.current) return;
      api(pwRef.current, '/api/state').then(function (j) {
        if (j.httpStatus !== 200 || !j.state) return;
        if (dirtyRef.current || inflightRef.current || conflictRef.current || timerRef.current) return;
        if (j.rev !== revRef.current) { adopt(j.state, j.rev); setSave({ text: 'Updated with changes saved from another device.' }); }
      }).catch(function () { /* try again later */ });
    }
    const t = setInterval(refresh, REFRESH_MS);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return function () { clearInterval(t); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [phase]);

  /* Warn before closing the page while a change is still unsaved. */
  useEffect(function () {
    function warn(e: BeforeUnloadEvent) {
      if (dirtyRef.current || inflightRef.current) { e.preventDefault(); e.returnValue = ''; }
    }
    window.addEventListener('beforeunload', warn);
    return function () { window.removeEventListener('beforeunload', warn); };
  }, []);

  /* ---------- Importing data the old page left in this browser ---------- */

  function doImport() {
    if (!offer) return;
    const plan = offer.plan;
    setOfferMsg({ text: 'Importing...', good: true });
    change(function (d) {
      const haveC: Record<string, boolean> = {}, haveN: Record<string, boolean> = {};
      d.contracts.forEach(function (c) { haveC[c.id] = true; });
      d.notices.forEach(function (n) { haveN[n.id] = true; });
      plan.contracts.forEach(function (c) { if (!haveC[c.id]) d.contracts.push(c); });
      plan.notices.forEach(function (n) { if (!haveN[n.id]) d.notices.push(n); });
    });
    flush().then(function (ok) {
      if (!ok) { setOfferMsg({ text: 'The import is not saved yet. See the message at the top of the page.' }); return; }
      write(KEYS.imported, { at: new Date().toISOString(), contracts: plan.contracts.length, notices: plan.notices.length });
      // Reload what the server stored (it tidies the data), then close the offer.
      api(pwRef.current, '/api/state').then(function (j) { if (j.httpStatus === 200 && j.state && !dirtyRef.current) adopt(j.state, j.rev); }).catch(function () { /* fine */ });
      setOffer(null);
      setSave({ text: 'Imported ' + plan.contracts.length + ' contracts and ' + plan.notices.length + ' notices from this browser.' });
    });
  }
  function neverImport() {
    write(KEYS.imported, { at: new Date().toISOString(), dismissed: true });
    setOffer(null);
  }

  /* ---------- Alerts ---------- */

  // Switched-off (done) and archived notices never alert.
  const due = data.notices.filter(function (n) { return !n.done && live(data, n) && status(n).soon; });

  function notifyDue() {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const seen = read<Record<string, string>>(KEYS.seen, {}); const today = todayStr();
      due.forEach(function (n) {
        const d = daysUntil(n.date);
        const stage = remindsOf(n).filter(function (t) { return t >= d; }).sort(function (a, b) { return a - b; })[0];
        const k = n.id + ':' + stage + (d <= 0 ? ':' + today : '');
        if (seen[k]) return;
        const c = byId(dataRef.current, n.cid);
        try { new Notification(n.title + (c ? ' - ' + c.vessel : ''), { body: status(n).text }); seen[k] = today; } catch (e) { /* not allowed here */ }
      });
      write(KEYS.seen, seen);
    } catch (e) { /* notifications not available */ }
  }

  const notifiedRef = useRef(false);
  useEffect(function () {
    try { if ('Notification' in window && Notification.permission === 'granted') setNotifText('Desktop alerts are on'); } catch (e) { /* ignore */ }
  }, []);
  useEffect(function () {
    if (phase === 'ready' && !notifiedRef.current) { notifiedRef.current = true; notifyDue(); }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  /* Open a notice or a contract in its edit form (calendar double-click, contract lines). */
  function openNotice(nid: string) {
    const n = dataRef.current.notices.filter(function (x) { return x.id === nid; })[0];
    if (!n) return;
    setTab('n'); setNoticeReq({ kind: 'edit', cid: n.cid, nid: nid, seq: Date.now() });
  }
  function openContract(cid: string) { setTab('c'); setContractReq({ cid: cid, seq: Date.now() }); }

  function askNotify() {
    try {
      if (!('Notification' in window)) { setNotifText('Alerts not supported in this browser'); return; }
      Notification.requestPermission().then(function (p) {
        setNotifText(p === 'granted' ? 'Desktop alerts are on' : 'Alerts blocked in browser settings');
        notifyDue();
      });
    } catch (e) { setNotifText('Alerts not available here'); }
  }

  /* ---------- Page ---------- */

  if (phase !== 'ready') {
    return (
      <div className="wrap">
        <div className="panel login">
          <h1>Deadline Calendar</h1>
          <p className="sub">Shipping notices and contract obligations for your time charter contracts, shared by your team.</p>
          {phase === 'starting' ? <p className="hint" role="status">Loading...</p> : (
            <form id="login" onSubmit={function (e) { e.preventDefault(); connect(pwInput || pw, false); }}>
              <label htmlFor="cl-pw">Team password</label>
              <input id="cl-pw" type="password" autoComplete="current-password" placeholder="The team password" value={pwInput}
                onChange={function (e) { setPwInput(e.target.value); }} />
              <button className="primary" type="button" id="cl-go" onClick={function () { connect(pwInput || pw, false); }}>Sign in</button>
              <small className={msgClass(loginMsg)} id="login-msg" role="status">{loginMsg.text}</small>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <h1>Deadline Calendar</h1>
      <p className="sub">Add a contract once, then add its shipping notices and obligations. Everything is grouped by contract, and delivery and redelivery dates show on the calendar. Changes are saved for the whole team.</p>
      <div className={'savebar' + (save.bad ? ' bad' : '')} id="save-msg" role="status">
        <span>{save.text}</span>
        {save.retry ? <button type="button" className="editbtn" id="save-retry" onClick={function () { flush(); }}>Try again</button> : null}
      </div>

      {conflict ? (
        <div className="banner" id="conflict" role="alert">
          {'Someone else saved changes' + (conflict.updatedAt ? ' at ' + new Date(conflict.updatedAt).toLocaleTimeString() : '') + ' while you were editing. Saved version: '
            + conflict.theirs.contracts.length + ' contracts, ' + conflict.theirs.notices.length + ' notices. Yours: '
            + data.contracts.length + ' and ' + data.notices.length + '. Choose which to keep.'}
          <div className="actions choice">
            <button type="button" id="cf-theirs" onClick={useTheirs}>Use the saved version</button>
            <button type="button" id="cf-mine" onClick={keepMine}>Keep my version</button>
          </div>
        </div>
      ) : null}

      {offer ? (
        <div className="offer" id="import" role="region" aria-label="Import data from this browser">
          <strong>This browser still holds data from the old version of the page.</strong>
          <p>{offer.contracts + (offer.contracts === 1 ? ' contract' : ' contracts') + ' and ' + offer.notices + (offer.notices === 1 ? ' notice are' : ' notices are') + ' not in the team data yet. Importing adds them; nothing already saved is changed.'}</p>
          <div className="actions">
            <button type="button" id="imp-go" onClick={doImport}>Import into team data</button>
            <button type="button" id="imp-later" onClick={function () { setOffer(null); }}>Not now</button>
            <button type="button" id="imp-never" onClick={neverImport}>Don&apos;t ask again here</button>
          </div>
          <small className={msgClass(offerMsg)} id="imp-msg" role="status">{offerMsg.text}</small>
        </div>
      ) : null}

      {due.length ? (
        <div className="banner" id="banner" role="status">
          {due.length + (due.length === 1 ? ' notice needs' : ' notices need') + ' your attention:'}
          <ul>
            {due.map(function (n) {
              const c = byId(data, n.cid);
              return <li key={n.id}>{n.title + (c ? ' - ' + c.vessel : '') + ' (' + status(n).text.toLowerCase() + ')'}</li>;
            })}
          </ul>
        </div>
      ) : null}

      <div className="layout">
        <Calendar state={data} selected={pick.date} onSelect={function (key) { setPick({ date: key, seq: Date.now() }); }}
          onOpenNotice={openNotice} onOpenContract={openContract} />
        <aside className="panel">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" id="tab-c" aria-selected={tab === 'c'} aria-controls="pane-c" onClick={function () { setTab('c'); }}>Contracts</button>
            <button type="button" role="tab" id="tab-n" aria-selected={tab === 'n'} aria-controls="pane-n" onClick={function () { setTab('n'); }}>Notices</button>
            <button type="button" role="tab" id="tab-a" aria-selected={tab === 'a'} aria-controls="pane-a" onClick={function () { setTab('a'); }}>
              Archive <span id="a-count">{archiveCount(data) ? '(' + archiveCount(data) + ')' : ''}</span>
            </button>
          </div>
          <ContractsPane state={data} hidden={tab !== 'c'} change={change}
            onAddNotice={function (cid) { setTab('n'); setNoticeReq({ kind: 'add', cid: cid, seq: Date.now() }); }}
            onContractAdded={function (cid) { setNoticeReq({ kind: 'select', cid: cid, seq: Date.now() }); }}
            onEditNotice={openNotice} editRequest={contractReq} />
          <NoticesPane state={data} hidden={tab !== 'n'} selected={pick.date} selectedSeq={pick.seq} change={change} request={noticeReq} />
          <ArchivePane state={data} hidden={tab !== 'a'} change={change} />
          <button className="ghost" id="notif" type="button" style={{ marginTop: 12 }} onClick={askNotify}>{notifText}</button>
        </aside>
      </div>
      <div className="foot">
        <button className="ghost" id="xl" type="button" onClick={function () { setXlMsg('Preparing...'); exportExcel(dataRef.current).then(setXlMsg); }}>Download contracts and notices (Excel)</button>
        <small className="hint" id="xl-msg" role="status">{xlMsg}</small>
      </div>
      <EmailPanel pw={pw} flush={flush} onSignOut={signOut} />
    </div>
  );
}
