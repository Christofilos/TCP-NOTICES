'use client';
// Contracts tab: the add/edit form and the list of contract cards.
import { useEffect, useRef, useState } from 'react';
import type { AppState, Contract } from '../lib/types';
import { byId, fmt, fmtWhen, live, liveC, sortedContracts, status, todayStr, uid } from '../lib/rules';
import { enterPresses, msgClass, runIfValid, type Msg } from './forms';

const BLANK = { vessel: '', party: '', ref: '', delivery: '', deliveryTime: '', redelivery: '', redeliveryTime: '' };

export default function ContractsPane(props: {
  state: AppState;
  hidden: boolean;
  change: (fn: (d: AppState) => void) => void;
  onAddNotice: (cid: string) => void;     // "Add notice" on a card
  onContractAdded: (cid: string) => void; // pre-select the new contract on the Notices tab
  onEditNotice: (nid: string) => void;     // click a notice line to edit it on the Notices tab
  editRequest: { cid: string; seq: number } | null; // double-click a contract date on the calendar
}) {
  const { state } = props;
  const [f, setF] = useState(BLANK);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(function () { return !state.contracts.length; });
  const [msg, setMsg] = useState<Msg>({ text: '' });
  const [armed, setArmed] = useState<string | null>(null);
  const [linesOpen, setLinesOpen] = useState<Record<string, boolean>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const vesselRef = useRef<HTMLInputElement>(null);

  // Stop editing if the contract disappears or is archived (here or on another device).
  useEffect(function () { if (editing && !liveC(byId(state, editing))) endEdit(); });

  // Double-click on a delivery or redelivery date in the calendar opens the contract.
  useEffect(function () {
    const r = props.editRequest;
    if (!r) return;
    const c = byId(state, r.cid);
    if (c && liveC(c)) startEdit(c);
  }, [props.editRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  function set(k: keyof typeof BLANK, v: string) { setF(function (o) { return Object.assign({}, o, { [k]: v }); }); }

  function endEdit() { setEditing(null); setF(BLANK); setMsg({ text: '' }); }

  function startEdit(c: Contract) {
    setEditing(c.id); setOpen(true); setMsg({ text: '' });
    setF({ vessel: c.vessel, party: c.party, ref: c.ref || '', delivery: c.delivery || '', deliveryTime: c.deliveryTime || '', redelivery: c.redelivery || '', redeliveryTime: c.redeliveryTime || '' });
    setTimeout(function () { if (vesselRef.current) vesselRef.current.focus(); }, 0);
  }

  function submit() {
    if (f.redelivery < f.delivery || (f.redelivery === f.delivery && f.redeliveryTime && f.deliveryTime && f.redeliveryTime < f.deliveryTime)) {
      setMsg({ text: 'Redelivery must be on or after the delivery date and time.' }); return;
    }
    const vals = { vessel: f.vessel.trim(), party: f.party.trim(), ref: f.ref.trim(), delivery: f.delivery, redelivery: f.redelivery };
    const times = { deliveryTime: f.deliveryTime || undefined, redeliveryTime: f.redeliveryTime || undefined };
    if (editing) {
      const id = editing;
      props.change(function (d) {
        const cur = byId(d, id);
        if (!cur) return;
        Object.assign(cur, vals);
        if (times.deliveryTime) cur.deliveryTime = times.deliveryTime; else delete cur.deliveryTime;
        if (times.redeliveryTime) cur.redeliveryTime = times.redeliveryTime; else delete cur.redeliveryTime;
      });
      setEditing(null); setF(BLANK); setMsg({ text: 'Changes saved.', good: true });
      return;
    }
    const c: Contract = Object.assign({ id: uid() }, vals);
    if (times.deliveryTime) c.deliveryTime = times.deliveryTime;
    if (times.redeliveryTime) c.redeliveryTime = times.redeliveryTime;
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

  /* Archive the contract with all its notices. Restore or delete it on the Archive tab. */
  function archive(c: Contract) {
    if (editing === c.id) endEdit();
    const day = todayStr();
    props.change(function (d) { const cur = byId(d, c.id); if (cur) { cur.archived = true; cur.archivedAt = day; } });
    setArmed(null);
    setMsg({ text: 'Archived ' + c.vessel + ' / ' + c.party + ' and its notices. You can find them on the Archive tab.', good: true });
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
            <label>Delivery time (optional)<input id="c-del-time" type="time" value={f.deliveryTime} onChange={function (e) { set('deliveryTime', e.target.value); }} /></label>
          </div>
          <div className="row">
            <label>Redelivery date<input id="c-red" type="date" required value={f.redelivery} onChange={function (e) { set('redelivery', e.target.value); }} /></label>
            <label>Redelivery time (optional)<input id="c-red-time" type="time" value={f.redeliveryTime} onChange={function (e) { set('redeliveryTime', e.target.value); }} /></label>
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
        {!state.contracts.filter(liveC).length ? <p className="empty">{state.contracts.length ? 'All contracts are archived. You can restore them on the Archive tab.' : 'No contracts yet. Fill in the form above to add one.'}</p> : null}
        {sortedContracts(state).filter(liveC).map(function (c) {
          const ns = state.notices.filter(function (n) { return n.cid === c.id && live(state, n); });
          const nArch = state.notices.filter(function (n) { return n.cid === c.id && n.archived; }).length;
          const attn = ns.filter(function (n) { return !n.done && status(n).soon; }).length;
          const countText = ns.length + (ns.length === 1 ? ' notice' : ' notices') + (attn ? ', ' + attn + ' need attention' : '') + (nArch ? ' (' + nArch + ' archived)' : '');
          const isOpen = !!linesOpen[c.id];
          const lines = ns.slice().sort(function (a, b) { return (Number(a.done) - Number(b.done)) || a.date.localeCompare(b.date); });
          return (
            <div key={c.id} className="contract ccard">
              <strong>{c.vessel + ' / ' + c.party}</strong>
              {c.ref ? <small>{'Ref ' + c.ref}</small> : null}
              <small>{'Delivery ' + fmtWhen(c.delivery, c.deliveryTime) + ' to redelivery ' + fmtWhen(c.redelivery, c.redeliveryTime)}</small>
              {!ns.length ? <small>{countText}</small> : (
                <details className="lineset" open={isOpen}
                  onToggle={function (e) { const o = (e.currentTarget as HTMLDetailsElement).open; setLinesOpen(function (x) { return Object.assign({}, x, { [c.id]: o }); }); }}>
                  <summary>
                    <span className={attn ? 'alert' : undefined}>{countText}</span>
                    <span className="ddhint">{isOpen ? 'Hide' : 'Show'}</span>
                  </summary>
                  <ul className="lines" aria-label={'Notices for ' + c.vessel}>
                    {lines.map(function (n) {
                      const s = status(n);
                      return (
                        <li key={n.id} className={'line ' + (n.type === 'shipping' ? 'l-ship' : 'l-con') + (n.done ? ' isdone' : '') + (!n.done && s.soon ? ' soon' : '')}>
                          <button type="button" className="lname" title="Edit this notice" aria-label={'Edit notice: ' + n.title}
                            onClick={function () { props.onEditNotice(n.id); }}>{n.title}</button>
                          <span className="ldate">{fmt(n.date)}</span>
                          <span className="lstat">{n.done ? 'Off' : s.text}</span>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
              <div className="actions">
                <button type="button" onClick={function () { props.onAddNotice(c.id); }}>Add notice</button>
                <button type="button" onClick={function () { startEdit(c); }}>Edit contract</button>
                <button type="button" aria-label={'Archive contract ' + c.vessel + ' / ' + c.party} onClick={function () { archive(c); }}>Archive contract</button>
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
