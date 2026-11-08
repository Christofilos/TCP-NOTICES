'use client';
/*
 * Archive tab. Archived contracts (with all their notices) and archived notices of active
 * contracts are kept here, out of the calendar, the lists, the alerts and the reminder emails.
 * Restore brings them back. Delete removes them for good and needs a second click.
 */
import { useState } from 'react';
import type { AppState, Contract, Notice } from '../lib/types';
import { byId, fmt, liveC, sortedContracts } from '../lib/rules';
import { msgClass, type Msg } from './forms';

export function archiveCount(state: AppState): number {
  return state.contracts.filter(function (c) { return c.archived; }).length +
    state.notices.filter(function (n) { return n.archived && liveC(byId(state, n.cid)); }).length;
}

export default function ArchivePane(props: { state: AppState; hidden: boolean; change: (fn: (d: AppState) => void) => void }) {
  const { state } = props;
  const [armed, setArmed] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>({ text: '' });

  const archC = sortedContracts(state).filter(function (c) { return c.archived; });
  const archN = state.notices.filter(function (n) { return n.archived && liveC(byId(state, n.cid)); });
  const byDate = function (a: Notice, b: Notice) { return a.date.localeCompare(b.date); };

  function restoreContract(c: Contract) {
    props.change(function (d) { const cur = byId(d, c.id); if (cur) { delete cur.archived; delete cur.archivedAt; } });
    setArmed(null); setMsg({ text: 'Restored ' + c.vessel + ' / ' + c.party + '. It is back on the Contracts tab with its notices.', good: true });
  }
  function deleteContract(c: Contract) {
    if (armed !== 'c:' + c.id) { setArmed('c:' + c.id); return; }
    props.change(function (d) {
      d.contracts = d.contracts.filter(function (x) { return x.id !== c.id; });
      d.notices = d.notices.filter(function (x) { return x.cid !== c.id; });
    });
    setArmed(null); setMsg({ text: 'Contract and its notices deleted for good.', good: true });
  }
  function restoreNotice(n: Notice) {
    props.change(function (d) { d.notices.forEach(function (x) { if (x.id === n.id) { delete x.archived; delete x.archivedAt; } }); });
    setArmed(null); setMsg({ text: 'Restored "' + n.title + '". It is back on the Notices tab.', good: true });
  }
  function deleteNotice(n: Notice) {
    if (armed !== n.id) { setArmed(n.id); return; }
    props.change(function (d) { d.notices = d.notices.filter(function (x) { return x.id !== n.id; }); });
    setArmed(null); setMsg({ text: 'Deleted for good.', good: true });
  }

  return (
    <div id="pane-a" role="tabpanel" aria-labelledby="tab-a" hidden={props.hidden}>
      <p className="hint">Archived contracts and notices are kept here. They are not shown on the calendar or in the lists, and get no alerts or reminder emails. Restore one to bring it back.</p>
      <small className={msgClass(msg)} id="a-msg" role="status">{msg.text}</small>
      <div id="alist">
        {!archC.length && !archN.length ? <p className="empty">Nothing archived. To archive a notice, open it with Edit and press Archive notice. To archive a whole contract, press Archive contract on the Contracts tab.</p> : null}
        {archC.length ? <h3 className="ahead">Archived contracts</h3> : null}
        {archC.map(function (c) {
          const ns = state.notices.filter(function (n) { return n.cid === c.id; }).sort(byDate);
          return (
            <div key={c.id} className="contract ccard agroup acontract">
              <strong>{c.vessel + ' / ' + c.party}</strong>
              {c.ref ? <small>{'Ref ' + c.ref}</small> : null}
              {c.operator ? <small>{'Operator: ' + c.operator}</small> : null}
              <small>{'Delivery ' + fmt(c.delivery) + ' to redelivery ' + fmt(c.redelivery)}</small>
              <small>{ns.length + (ns.length === 1 ? ' notice' : ' notices') + (c.archivedAt ? ' · archived ' + fmt(c.archivedAt) : '')}</small>
              {ns.length ? (
                <ul className="lines">
                  {ns.map(function (n) {
                    return (
                      <li key={n.id} className={'line ' + (n.type === 'shipping' ? 'l-ship' : 'l-con')}>
                        <span className="lname">{n.title}</span>
                        <span className="ldate">{fmt(n.date)}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <div className="actions">
                <button type="button" aria-label={'Restore contract ' + c.vessel + ' / ' + c.party} onClick={function () { restoreContract(c); }}>Restore contract</button>
                <button type="button" className={'danger' + (armed === 'c:' + c.id ? ' armed' : '')}
                  aria-label={'Delete contract ' + c.vessel + ' / ' + c.party + ' and its notices for good'}
                  onClick={function () { deleteContract(c); }}>{armed === 'c:' + c.id ? 'Click again to delete' : 'Delete contract'}</button>
              </div>
            </div>
          );
        })}
        {archN.length ? <h3 className="ahead">Archived notices</h3> : null}
        {sortedContracts(state).filter(liveC).map(function (c) {
          const ns = archN.filter(function (n) { return n.cid === c.id; }).sort(byDate);
          if (!ns.length) return null;
          return (
            <div key={c.id} className="contract ccard agroup">
              <strong>{c.vessel + ' / ' + c.party}</strong>
              <ul className="lines">
                {ns.map(function (n) {
                  return (
                    <li key={n.id} className={'line aline ' + (n.type === 'shipping' ? 'l-ship' : 'l-con')}>
                      <div className="ainfo">
                        <span className="lname">{n.title}</span>
                        <small>{'Due ' + fmt(n.date) + (n.archivedAt ? ' · archived ' + fmt(n.archivedAt) : '')}</small>
                      </div>
                      <div className="btns">
                        <button type="button" aria-label={'Restore ' + n.title} onClick={function () { restoreNotice(n); }}>Restore</button>
                        <button type="button" className={'danger' + (armed === n.id ? ' armed' : '')} aria-label={'Delete ' + n.title + ' for good'}
                          onClick={function () { deleteNotice(n); }}>{armed === n.id ? 'Click again to delete' : 'Delete'}</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
