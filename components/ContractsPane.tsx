'use client';
// Contracts tab: the add/edit form and the list of contract cards.
import { useEffect, useRef, useState } from 'react';
import type { AppState, Contract } from '../lib/types';
import { byId, fmt, sortedContracts, status, uid } from '../lib/rules';
import { enterPresses, msgClass, runIfValid, type Msg } from './forms';

const BLANK = { vessel: '', party: '', ref: '', delivery: '', redelivery: '' };

export default function ContractsPane(props: {
  state: AppState;
  hidden: boolean;
  change: (fn: (d: AppState) => void) => void;
  onAddNotice: (cid: string) => void;     // "Add notice" on a card
  onContractAdded: (cid: string) => void; // pre-select the new contract on the Notices tab
}) {
  const { state } = props;
  const [f, setF] = useState(BLANK);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(function () { return !state.contracts.length; });
  const [msg, setMsg] = useState<Msg>({ text: '' });
  const [armed, setArmed] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const vesselRef = useRef<HTMLInputElement>(null);

  // Stop editing if the contract disappears (deleted here or on another device).
  useEffect(function () { if (editing && !byId(state, editing)) endEdit(); });

  function set(k: keyof typeof BLANK, v: string) { setF(function (o) { return Object.assign({}, o, { [k]: v }); }); }

  function endEdit() { setEditing(null); setF(BLANK); setMsg({ text: '' }); }

  function startEdit(c: Contract) {
    setEditing(c.id); setOpen(true); setMsg({ text: '' });
    setF({ vessel: c.vessel, party: c.party, ref: c.ref || '', delivery: c.delivery || '', redelivery: c.redelivery || '' });
    setTimeout(function () { if (vesselRef.current) vesselRef.current.focus(); }, 0);
  }

  function submit() {
    if (f.redelivery < f.delivery) { setMsg({ text: 'Redelivery date must be on or after the delivery date.' }); return; }
    const vals = { vessel: f.vessel.trim(), party: f.party.trim(), ref: f.ref.trim(), delivery: f.delivery, redelivery: f.redelivery };
    if (editing) {
      const id = editing;
      props.change(function (d) { const cur = byId(d, id); if (cur) Object.assign(cur, vals); });
      setEditing(null); setF(BLANK); setMsg({ text: 'Changes saved.', good: true });
      return;
    }
    const c: Contract = Object.assign({ id: uid() }, vals);
    props.change(function (d) { d.contracts.push(c); });
    setF(BLANK);
    setMsg({ text: 'Contract saved: ' + c.vessel + ' / ' + c.party + '. You can now add its notices on the Notices tab.', good: true });
    props.onContractAdded(c.id);
  }

  function remove(c: Contract) {
    if (armed !== c.id) { setArmed(c.id); return; }
    props.change(function (d) {
      d.contracts = d.contracts.filter(function (x) { return x.id !== c.id; });
      d.notices = d.notices.filter(function (x) { return x.cid !== c.id; });
    });
    setArmed(null);
  }

  return (
    <div id="pane-c" role="tabpanel" aria-labelledby="tab-c" hidden={props.hidden}>
      <details className="block" id="cdetails" open={open} onToggle={function (e) { setOpen((e.currentTarget as HTMLDetailsElement).open); }}>
        <summary id="c-sum">{editing ? 'Edit contract' : 'Add a contract'}</summary>
        <form id="cform" ref={formRef} onSubmit={function (e) { e.preventDefault(); }} onKeyDown={enterPresses(saveRef)}>
          <div className="row">
            <label>Vessel name<input id="c-vessel" ref={vesselRef} required maxLength={60} placeholder="e.g. MV Aurora" value={f.vessel} onChange={function (e) { set('vessel', e.target.value); }} /></label>
            <label>Counterparty<input id="c-party" required maxLength={60} placeholder="e.g. Nordic Bulk Ltd" value={f.party} onChange={function (e) { set('party', e.target.value); }} /></label>
          </div>
          <label>Contract reference (optional)<input id="c-ref" maxLength={40} placeholder="e.g. TC-2026-014" value={f.ref} onChange={function (e) { set('ref', e.target.value); }} /></label>
          <div className="row">
            <label>Delivery date<input id="c-del" type="date" required value={f.delivery} onChange={function (e) { set('delivery', e.target.value); }} /></label>
            <label>Redelivery date<input id="c-red" type="date" required value={f.redelivery} onChange={function (e) { set('redelivery', e.target.value); }} /></label>
          </div>
          <button className="primary" type="button" id="c-submit" ref={saveRef}
            onClick={function () { runIfValid(formRef, submit, function (t) { setMsg({ text: t }); }); }}>
            {editing ? 'Save changes' : 'Save contract'}
          </button>
          <button className="ghost" type="button" id="c-cancel" hidden={!editing} onClick={endEdit}>Cancel editing</button>
          <small className={msgClass(msg)} id="c-msg" role="alert">{msg.text}</small>
        </form>
      </details>
      <h3>Your contracts</h3>
      <div id="list">
        {!state.contracts.length ? <p className="empty">No contracts yet. Fill in the form above to add one.</p> : null}
        {sortedContracts(state).map(function (c) {
          const ns = state.notices.filter(function (n) { return n.cid === c.id; });
          const attn = ns.filter(function (n) { return !n.done && status(n).soon; }).length;
          return (
            <div key={c.id} className="contract ccard">
              <strong>{c.vessel + ' / ' + c.party}</strong>
              {c.ref ? <small>{'Ref ' + c.ref}</small> : null}
              <small>{'Delivery ' + fmt(c.delivery) + ' to redelivery ' + fmt(c.redelivery)}</small>
              <small className={attn ? 'alert' : undefined}>{ns.length + (ns.length === 1 ? ' notice' : ' notices') + (attn ? ', ' + attn + ' need attention' : '')}</small>
              <div className="actions">
                <button type="button" onClick={function () { props.onAddNotice(c.id); }}>Add notice</button>
                <button type="button" onClick={function () { startEdit(c); }}>Edit contract</button>
                <button type="button" className={'danger' + (armed === c.id ? ' armed' : '')} onClick={function () { remove(c); }}>
                  {armed === c.id ? 'Click again to delete' : 'Delete contract'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
