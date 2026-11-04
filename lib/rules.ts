/*
 * Date helpers and the notice rules used by the page.
 * Ported from the old index.html. status() and currentRem() must stay in step
 * with pickDue() in lib/server/core.ts.
 *
 * Dates are 'YYYY-MM-DD' strings. Parse them with parse() (local midnight),
 * never with new Date('2026-11-20'), which is UTC and can shift the day.
 */
import type { AppState, Contract, Notice, Reminder } from './types';

export const MAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* The time is only shown. Reminders are still decided by the date. */
export function fmtWhen(date: string, time?: string): string {
  return fmt(date) + (date && time ? ' at ' + time : '');
}

export function ymd(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function parse(s: string): Date { return new Date(s + 'T00:00:00'); }
export function fmt(s: string): string {
  return s ? parse(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'not set';
}
export function todayStr(): string { return ymd(new Date()); }
export function daysUntil(s: string): number {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((parse(s).getTime() - t.getTime()) / 86400000);
}
export function uid(): string { return String(Date.now()) + Math.random().toString(16).slice(2, 6); }

export function byId(state: AppState, id: string): Contract | undefined {
  return state.contracts.filter(function (c) { return c.id === id; })[0];
}
export function sortedContracts(state: AppState): Contract[] {
  return state.contracts.slice().sort(function (a, b) { return (a.delivery || '').localeCompare(b.delivery || ''); });
}

/* Older notices may have `remind` (one number) or `reminds` (numbers) instead of `rems`. */
export function remindsOf(n: Notice): number[] {
  if (n.rems && n.rems.length) return n.rems.map(function (r) { return r.days; });
  if (n.reminds && n.reminds.length) return n.reminds;
  return [typeof n.remind === 'number' ? n.remind : 0];
}

/* The reminder you have reached: the smallest `days` that is at least the days remaining. */
export function currentRem(n: Notice): Reminder | null {
  if (!n.rems) return null;
  const d = daysUntil(n.date);
  return n.rems.filter(function (r) { return r.days >= d; }).sort(function (a, b) { return a.days - b.days; })[0] || null;
}

/* A notice is "soon" if overdue or due within its largest reminder window. */
export function status(n: Notice): { soon: boolean; text: string } {
  if (n.done) return { soon: false, text: 'Done' };
  const d = daysUntil(n.date);
  if (d < 0) return { soon: true, text: 'Overdue by ' + (-d) + (d === -1 ? ' day' : ' days') };
  if (d === 0) return { soon: true, text: 'Due today' };
  if (d <= Math.max.apply(null, remindsOf(n))) return { soon: true, text: 'Due in ' + d + (d === 1 ? ' day' : ' days') };
  return { soon: false, text: 'Due in ' + d + ' days' };
}

/*
 * "What is due?" presets. Delivery and redelivery notices are counted back from a contract date.
 * The default 10 and 30 days are placeholders, not contractual facts.
 */
export interface Preset { anchor: 'delivery' | 'redelivery'; days: number; type: 'shipping' | 'contract' }
export const PRESETS: Record<string, Preset> = {
  'Delivery notice': { anchor: 'delivery', days: 10, type: 'shipping' },
  'Redelivery notice': { anchor: 'redelivery', days: 30, type: 'shipping' }
};
export const DAY_CHOICES: number[] = (function () {
  const list: number[] = [];
  for (let i = 1; i <= 30; i++) list.push(i);
  return list.concat([35, 40, 45, 50, 55, 60, 75, 90, 120, 150, 180]);
})();
export function dueFor(c: Contract, p: Preset, k: number): string {
  const d = parse(c[p.anchor]); d.setDate(d.getDate() - k); return ymd(d);
}

/* Email links for a notice that needs attention. */
function mailText(state: AppState, n: Notice) {
  const c = byId(state, n.cid);
  const subj = 'Reminder: ' + n.title + (c ? ' - ' + c.vessel : '');
  const body = n.title + (c ? ' for ' + c.vessel + ' (' + c.party + ')' : '') + ' is due on ' + fmtWhen(n.date, n.time) + '. ' + status(n).text + '.';
  return { subj, body };
}
export function outlookWebFor(state: AppState, n: Notice, r: Reminder): string {
  const m = mailText(state, n);
  return 'https://outlook.office.com/mail/deeplink/compose?to=' + encodeURIComponent(r.to.join(';')) + '&subject=' + encodeURIComponent(m.subj) + '&body=' + encodeURIComponent(m.body);
}
export function mailtoFor(state: AppState, n: Notice, r: Reminder): string {
  const m = mailText(state, n);
  return 'mailto:' + r.to.join(',') + '?subject=' + encodeURIComponent(m.subj) + '&body=' + encodeURIComponent(m.body);
}

export function isEmpty(s: AppState | null): boolean { return !s || (!s.contracts.length && !s.notices.length); }
