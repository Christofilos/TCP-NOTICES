'use client';
// Notices tab: the add/edit form ("What is due?", notice periods, three reminders) and
// the notices grouped by contract. Lists are deliberately compact.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { AppState, Notice, NoticeType, Reminder } from '../lib/types';
import {
  DAY_CHOICES, MAIL_RE, PRESETS, byId, currentRem, dueFor, fmt, mailtoFor, outlookWebFor,
  remindsOf, sortedContracts, status, uid
} from '../lib/rules';
import { enterPresses, msgClass, runIfValid, type Msg } from './forms';

type Fields = {
  what: string; title: string; days: number[]; type: NoticeType; date: string;
  r1: string; r2: string; r3: string; to1: string; to2: string; to3: string;
};

function defaults(date: string): Fields {
  return { what: 'Delivery notice', title: '', days: [PRESETS['Delivery notice'].days], type: 'shipping', date: date,
    r1: '7', r2: '3', r3: '1', to1: '', to2: '', to3: '' };
}
function wholeNumbersOnly(e: KeyboardEvent<HTMLInputElement>) {
  if (['e', 'E', '+', '-', '.', ','].indexOf(e.key) !== -1) e.preventDefault();
}

export type NoticeRequest = { kind: 'add' | 'select'; cid: string; seq: number };

export default function NoticesPane(props: {
  state: AppState;
  hidden: boolean;
  selected: string;
  selectedSeq: number;
  change: (fn: (d: AppState) => void) => void;
  request: NoticeRequest | null;
}) {
  const { state } = props;
  const [f, setF] = useState<Fields>(function () { return defaults(props.selected); });
  const [cidPick, setCidPick] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(function () { return !state.notices.length; });
  const [daysOpen, setDaysOpen] = useState(false);
  const [msg, setMsg] = useState<Msg>({ text: '' });
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const whatRef = useRef<HTMLSelectElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const cid = byId(state, cidPick) ? cidPick : (state.contracts[0] ? state.contracts[0].id : '');
  const preset = PRESETS[f.what];
  const ticked = f.days.slice().sort(function (a, b) { return b - a; });

  function set<K extends keyof Fields>(k: K, v: Fields[K]) { setF(function (o) { return Object.assign({}, o, { [k]: v }); }); }

  // Clicking a calendar day fills in the due date.
  useEffect(function () { set('date', props.selected); }, [props.selected, props.selectedSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Add notice" on a contract card, or a contract that was just added.
  useEffect(function () {
    const r = props.request;
    if (!r) return;
    setCidPick(r.cid);
    if (r.kind === 'add') {
      setOpen(true);
      setTimeout(function () { if (whatRef.current) whatRef.current.focus(); }, 0);
    }
  }, [props.request]);

  // Stop editing if the notice disappears (deleted here or on another device).
  useEffect(function () {
    if (editing && !state.notices.some(function (x) { return x.id === editing; })) endEdit();
  });

  function applyWhat(what: string) {
    setF(function (o) {
      const p = PRESETS[what];
      const n = Object.assign({}, o, { what: what });
      if (what === 'Heel nomination') n.type = 'contract';
      if (p) { n.days = [p.days]; n.type = p.type; }
      return n;
    });
  }
  function toggleDay(k: number, on: boolean) {
    setF(function (o) {
      const days = o.days.filter(function (x) { return x !== k; });
      if (on) days.push(k);
      return Object.assign({}, o, { days: days });
    });
  }

  function endEdit() {
    setEditing(null); setMsg({ text: '' });
    setF(defaults(props.selected));
  }

  function startEdit(n: Notice) {
    setEditing(n.id); setOpen(true); setMsg({ text: '' }); setCidPick(n.cid);
    const days = remindsOf(n);
    const pair = function (i: number): [string, string] {
      const r = n.rems && n.rems[i];
      if (r) return [String(r.days), r.to.join(', ')];
      return [n.rems ? '' : (days[i] === undefined ? '' : String(days[i])), ''];
    };
    const p1 = pair(0), p2 = pair(1), p3 = pair(2);
    setF({ what: '', title: n.title, days: [], type: n.type, date: n.date, r1: p1[0], to1: p1[1], r2: p2[0], to2: p2[1], r3: p3[0], to3: p3[1] });
    setTimeout(function () { if (titleRef.current) titleRef.current.focus(); }, 0);
  }

  function readRems(): Reminder[] | null {
    const pairs: [string, string][] = [[f.r1, f.to1], [f.r2, f.to2], [f.r3, f.to3]];
    const out: Reminder[] = [], bad: string[] = [];
    pairs.forEach(function (p, i) {
      const v = parseInt(p[0], 10);
      const to = p[1].split(/[,;\s]+/).filter(Boolean);
      to.forEach(function (a) { if (!MAIL_RE.test(a)) bad.push(a); });
      if (!isNaN(v) && v >= 0) out.push({ days: v, to: to });
      else if (to.length) bad.push('reminder ' + (i + 1) + ' has recipients but no number of days');
    });
    if (bad.length) { setMsg({ text: 'Please fix: ' + bad.join(', ') }); return null; }
    return out.length ? out : [{ days: 0, to: [] }];
  }

  function submit() {
    if (!cid) return;
    setMsg({ text: '' });
    const rems = readRems(); if (!rems) return;
    if (editing) {
      const title = f.title.trim();
      if (!title || !f.date) { setMsg({ text: 'Enter a name and a due date.' }); return; }
      const id = editing;
      props.change(function (d) {
        const cur = d.notices.filter(function (x) { return x.id === id; })[0];
        if (cur) { cur.cid = cid; cur.title = title; cur.type = f.type; cur.date = f.date; cur.rems = rems; delete cur.remind; delete cur.reminds; }
      });
      setEditing(null); setF(defaults(props.selected)); setMsg({ text: 'Changes saved.', good: true });
      return;
    }
    const toAdd: { title: string; date: string }[] = [];
    if (preset) {
      const c = byId(state, cid);
      if (!c || !c[preset.anchor]) { setMsg({ text: 'This contract has no ' + preset.anchor + ' date, so these notices cannot be calculated.' }); return; }
      if (!ticked.length) { setMsg({ text: 'Tick at least one notice period.' }); return; }
      ticked.forEach(function (k) { toAdd.push({ title: f.what + ' (' + k + (k === 1 ? ' day)' : ' days)'), date: dueFor(c, preset, k) }); });
    } else {
      toAdd.push({ title: f.what || f.title.trim(), date: f.date });
    }
    let skipped = 0;
    const fresh: Notice[] = [];
    toAdd.forEach(function (t, i) {
      const dup = state.notices.some(function (x) { return x.cid === cid && x.title === t.title && x.date === t.date; });
      if (dup) { skipped++; return; }
      fresh.push({ id: uid() + '-' + i, cid: cid, title: t.title, type: f.type, date: t.date, rems: JSON.parse(JSON.stringify(rems)), done: false });
    });
    if (fresh.length) props.change(function (d) { d.notices = d.notices.concat(fresh); });
    const added = fresh.length;
    if (skipped) setMsg({ text: skipped + (skipped === 1 ? ' notice was' : ' notices were') + ' already on this contract, so not added again.' + (added ? ' ' + added + ' added.' : '') });
    else setMsg({ text: added + (added === 1 ? ' notice added.' : ' notices added.'), good: true });
    set('title', '');
  }

  let hint = '';
  if (preset) {
    const c = byId(state, cid);
    if (!c || !c[preset.anchor]) hint = 'This contract has no ' + preset.anchor + ' date, so these notices cannot be calculated.';
    else if (!ticked.length) hint = 'Tick at least one notice period.';
    else hint = 'Will add ' + ticked.length + (ticked.length === 1 ? ' notice' : ' notices') + ', counted back from the ' + preset.anchor + ' date (' + fmt(c[preset.anchor]) + '): '
      + ticked.map(function (k) { return k + (k === 1 ? ' day' : ' days') + ' = ' + fmt(dueFor(c, preset, k)); }).join('; ') + '.';
  }

  const remRows: [keyof Fields, keyof Fields, string, string, boolean][] = [
    ['r1', 'to1', 'n-remind', 'n-to1', true], ['r2', 'to2', 'n-remind2', 'n-to2', false], ['r3', 'to3', 'n-remind3', 'n-to3', false]
  ];
  const ordinal = ['1st', '2nd', '3rd'];

  return (
    <div id="pane-n" role="tabpanel" aria-labelledby="tab-n" hidden={props.hidden}>
      <details className="block" id="ndetails" open={open} onToggle={function (e) { setOpen((e.currentTarget as HTMLDetailsElement).open); }}>
        <summary id="n-sum">{editing ? 'Edit notice' : 'Add a notice'}</summary>
        <form id="nform" ref={formRef} onSubmit={function (e) { e.preventDefault(); }} onKeyDown={enterPresses(saveRef)}>
          <label>Contract
            <select id="n-contract" required value={cid} onChange={function (e) { setCidPick(e.target.value); }}>
              {!state.contracts.length ? <option value="">Add a contract first</option> : null}
              {state.contracts.map(function (c) {
                return <option key={c.id} value={c.id}>{c.vessel + ' / ' + c.party + (c.ref ? ' (' + c.ref + ')' : '')}</option>;
              })}
            </select>
          </label>
          <label id="n-what-wrap" hidden={!!editing}>What is due?
            <select id="n-what" ref={whatRef} value={f.what} onChange={function (e) { applyWhat(e.target.value); }}>
              <option value="Delivery notice">Delivery notice</option>
              <option value="Redelivery notice">Redelivery notice</option>
              <option value="Heel nomination">Heel nomination</option>
              <option value="">Other (type your own)</option>
            </select>
          </label>
          <label id="n-other-wrap" hidden={f.what !== ''}>Describe it
            <input id="n-title" ref={titleRef} maxLength={80} placeholder="e.g. Hire payment" required={f.what === ''}
              value={f.title} onChange={function (e) { set('title', e.target.value); }} />
          </label>
          <div id="n-days-wrap" role="group" aria-labelledby="n-days-label" hidden={!preset}>
            <span className="gl" id="n-days-label">Notice periods (days before the contract date)</span>
            <details className="dd" id="n-days-dd" open={daysOpen} onToggle={function (e) { setDaysOpen((e.currentTarget as HTMLDetailsElement).open); }}>
              <summary id="n-days-sum">{ticked.length ? ticked.join(', ') + (ticked.length === 1 ? ' day' : ' days') + ' selected' : 'Choose days'}</summary>
              <div className="days" id="n-days">
                {DAY_CHOICES.map(function (k) {
                  return (
                    <label key={k}>
                      <input type="checkbox" value={String(k)} checked={f.days.indexOf(k) !== -1}
                        onChange={function (e) { toggleDay(k, e.target.checked); }} />
                      {String(k)}
                    </label>
                  );
                })}
              </div>
            </details>
          </div>
          <div className="row">
            <label>Type
              <select id="n-type" value={f.type} onChange={function (e) { set('type', e.target.value as NoticeType); }}>
                <option value="shipping">Shipping notice</option>
                <option value="contract">Contract obligation</option>
              </select>
            </label>
            <label id="n-date-wrap" hidden={!!preset}>Due date
              <input id="n-date" type="date" required={!preset} value={f.date} onChange={function (e) { set('date', e.target.value); }} />
            </label>
          </div>
          <small className="hint" id="n-hint" hidden={!preset}>{hint}</small>
          {remRows.map(function (r, i) {
            return (
              <div className="remrow" key={r[2]}>
                <label>{ordinal[i] + ' reminder (days before)'}
                  <input id={r[2]} type="number" min={0} step={1} inputMode="numeric" required={r[4]}
                    value={f[r[0]] as string} onKeyDown={wholeNumbersOnly}
                    onChange={function (e) { set(r[0], e.target.value as never); }} />
                </label>
                <label>{ordinal[i] + ' reminder sent to'}
                  <input id={r[3]} type="text" placeholder="a@company.com, b@company.com"
                    value={f[r[1]] as string} onChange={function (e) { set(r[1], e.target.value as never); }} />
                </label>
              </div>
            );
          })}
          <small className="hint">Whole days before the due date. Separate several email addresses with commas. Leave a reminder empty if you don&apos;t need it.</small>
          <button className="primary" type="button" id="n-submit" ref={saveRef} disabled={!state.contracts.length}
            onClick={function () { runIfValid(formRef, submit, function (t) { setMsg({ text: t }); }); }}>
            {editing ? 'Save changes' : 'Add notice'}
          </button>
          <button className="ghost" type="button" id="n-cancel" hidden={!editing} onClick={endEdit}>Cancel editing</button>
          <small className={msgClass(msg)} id="n-msg" role="alert">{msg.text}</small>
        </form>
      </details>
      <h3>Your notices, by contract</h3>
      <div id="nlist">
        {!state.notices.length ? <p className="empty">No notices yet. Use the form above to add one.</p> : null}
        {sortedContracts(state).map(function (c) {
          const ns = state.notices.filter(function (n) { return n.cid === c.id; })
            .sort(function (a, b) { return (Number(a.done) - Number(b.done)) || a.date.localeCompare(b.date); });
          if (!ns.length) return null;
          const attn = ns.filter(function (n) { return status(n).soon; }).length;
          return (
            <details key={c.id} className="contract" open={!closed[c.id]}
              onToggle={function (e) { const isOpen = (e.currentTarget as HTMLDetailsElement).open; setClosed(function (o) { return Object.assign({}, o, { [c.id]: !isOpen }); }); }}>
              <summary>
                <strong>{c.vessel + ' / ' + c.party}</strong>
                <small className={attn ? 'alert' : undefined}>{ns.length + (ns.length === 1 ? ' notice' : ' notices') + (attn ? ', ' + attn + ' need attention' : '')}</small>
              </summary>
              <div className="cbody">
                <ul className="list">
                  {ns.map(function (n) { return <NoticeItem key={n.id} n={n} state={state} change={props.change} onEdit={startEdit} />; })}
                </ul>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function NoticeItem(props: { n: Notice; state: AppState; change: (fn: (d: AppState) => void) => void; onEdit: (n: Notice) => void }) {
  const { n } = props;
  const s = status(n);
  const anyTo = !n.rems || n.rems.some(function (r) { return r.to.length; });
  const cr = (!n.done && s.soon) ? currentRem(n) : null;
  return (
    <li className={'item ' + n.type + (s.soon ? ' soon' : '') + (n.done ? ' isdone' : '')}>
      <input type="checkbox" checked={!!n.done} aria-label="Mark done"
        onChange={function (e) {
          const on = e.target.checked;
          props.change(function (d) { d.notices.forEach(function (x) { if (x.id === n.id) x.done = on; }); });
        }} />
      <div>
        <strong>{n.title}</strong>
        <small className="st">{fmt(n.date) + ' - ' + s.text}</small>
        <small>{'Reminders: ' + remindsOf(n).join(', ') + ' days before' + (anyTo ? '' : ' (no recipients)')}</small>
        {cr && cr.to.length ? (
          <small>Email: <a href={outlookWebFor(props.state, n, cr)} target="_blank" rel="noopener noreferrer">Outlook web</a>
            {' | '}<a href={mailtoFor(props.state, n, cr)}>Outlook app</a></small>
        ) : null}
      </div>
      <div className="btns">
        <button type="button" className="editbtn" aria-label={'Edit ' + n.title} onClick={function () { props.onEdit(n); }}>Edit</button>
        <button type="button" className="del" aria-label={'Delete ' + n.title}
          onClick={function () { props.change(function (d) { d.notices = d.notices.filter(function (x) { return x.id !== n.id; }); }); }}>✕</button>
      </div>
    </li>
  );
}
