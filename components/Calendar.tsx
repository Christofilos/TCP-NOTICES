'use client';
// Month view. Teal = shipping notice, purple = contract obligation, grey = delivery or redelivery.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { AppState } from '../lib/types';
import { byId, todayStr, ymd } from '../lib/rules';

type Ev = { cls: string; label: string; done?: boolean };

function eventsOn(state: AppState, key: string): Ev[] {
  const out: Ev[] = [];
  state.contracts.forEach(function (c) {
    if (c.delivery === key) out.push({ cls: 'leg', label: 'Delivery: ' + c.vessel });
    if (c.redelivery === key) out.push({ cls: 'leg', label: 'Redelivery: ' + c.vessel });
  });
  state.notices.forEach(function (n) {
    if (n.date === key) { const c = byId(state, n.cid); out.push({ cls: n.type, label: n.title + (c ? ' - ' + c.vessel : ''), done: n.done }); }
  });
  return out;
}

export default function Calendar(props: { state: AppState; selected: string; onSelect: (key: string) => void }) {
  const [view, setView] = useState(function () { const d = new Date(); d.setDate(1); return d; });
  const y = view.getFullYear(), m = view.getMonth();
  const offset = (new Date(y, m, 1).getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const today = todayStr();

  function move(by: number) { setView(new Date(y, m + by, 1)); }
  function goToday() { const d = new Date(); d.setDate(1); setView(d); props.onSelect(todayStr()); }

  const cells: ReactNode[] = [];
  for (let i = 0; i < offset; i++) cells.push(<div key={'b' + i} className="cell blank" />);
  for (let d = 1; d <= days; d++) {
    const key = ymd(new Date(y, m, d));
    const evs = eventsOn(props.state, key);
    cells.push(
      <button key={key} type="button"
        className={'cell' + (key === today ? ' today' : '') + (key === props.selected ? ' sel' : '')}
        aria-label={key + (evs.length ? ': ' + evs.map(function (e) { return e.label; }).join('; ') : '')}
        onClick={function () { props.onSelect(key); }}>
        <span className="n">{d}</span>
        {evs.slice(0, 4).map(function (e, i) {
          return <span key={i} className={'chip ' + e.cls + (e.done ? ' done' : '')} title={e.label}>{e.label}</span>;
        })}
        {evs.length > 4 ? <span className="more">{'+' + (evs.length - 4) + ' more'}</span> : null}
        <span className="dots">{evs.map(function (e, i) { return <span key={i} className={'dot ' + e.cls} />; })}</span>
      </button>
    );
  }

  return (
    <section className="panel" aria-label="Calendar">
      <div className="head">
        <button className="nav" id="prev" type="button" aria-label="Previous month" onClick={function () { move(-1); }}>&lt;</button>
        <h2 id="title">{view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
        <button className="nav" id="today" type="button" onClick={goToday}>Today</button>
        <button className="nav" id="next" type="button" aria-label="Next month" onClick={function () { move(1); }}>&gt;</button>
      </div>
      <div className="grid" id="grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (n) { return <div key={n} className="dow">{n}</div>; })}
        {cells}
      </div>
      <div className="legend">
        <span style={{ '--c': 'var(--ship)' } as CSSProperties}>Shipping notice</span>
        <span style={{ '--c': 'var(--con)' } as CSSProperties}>Contract obligation</span>
        <span style={{ '--c': 'var(--leg)' } as CSSProperties}>Delivery / redelivery</span>
      </div>
    </section>
  );
}
