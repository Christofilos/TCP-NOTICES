/*
 * Browser-only helpers: localStorage (always wrapped in try/catch), the old data the
 * browser may still hold, and calls to the server.
 *
 * The team data now lives only in Redis. The browser keeps just three small things:
 *   deadlineCalendar.cloud.v1    the team password, so you stay signed in
 *   deadlineCalendar.alerted.v1  which desktop notifications were already shown
 *   deadlineCalendar.imported.v1 that this browser's old data was imported or dismissed
 * The old data keys (deadlineCalendar.v2 and deadlineCalendar.items.v1) are only read,
 * never deleted, so nothing is lost if an import goes wrong.
 */
import type { AppState, Notice } from './types';

export const KEYS = {
  data: 'deadlineCalendar.v2',
  old: 'deadlineCalendar.items.v1',
  seen: 'deadlineCalendar.alerted.v1',
  cloud: 'deadlineCalendar.cloud.v1',
  imported: 'deadlineCalendar.imported.v1'
};

export function read<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
export function write(k: string, v: unknown): void {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage missing or full */ }
}

export function savedPassword(): string {
  const c = read<{ pw?: string } | null>(KEYS.cloud, null);
  return c && typeof c.pw === 'string' ? c.pw : '';
}
export function rememberPassword(pw: string): void { write(KEYS.cloud, { pw: pw }); }

/*
 * Data the old version of the page left in this browser, if any.
 * Same migration as before: the original flat list goes into a contract called "Unassigned".
 */
export function legacyData(): AppState | null {
  const s = read<AppState | null>(KEYS.data, null);
  if (s && Array.isArray(s.contracts) && Array.isArray(s.notices)) {
    if (s.contracts.length || s.notices.length) return { contracts: s.contracts, notices: s.notices };
    return null;
  }
  const old = read<Notice[]>(KEYS.old, []);
  if (Array.isArray(old) && old.length) {
    return {
      contracts: [{ id: 'c0', ref: '', vessel: 'Unassigned', party: 'Earlier notices', delivery: '', redelivery: '' }],
      notices: old.map(function (o) { return Object.assign({}, o, { cid: 'c0' }); })
    };
  }
  return null;
}

/* What an import would add: contracts and notices whose ids the team data does not have yet. */
export function importPlan(team: AppState, local: AppState) {
  const haveC: Record<string, boolean> = {}, haveN: Record<string, boolean> = {};
  team.contracts.forEach(function (c) { haveC[c.id] = true; });
  team.notices.forEach(function (n) { haveN[n.id] = true; });
  return {
    contracts: local.contracts.filter(function (c) { return c && c.id && !haveC[c.id]; }),
    notices: local.notices.filter(function (n) { return n && n.id && !haveN[n.id]; })
  };
}

/* ---------- Server calls ---------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ApiReply = { httpStatus: number; [k: string]: any };

export function api(pw: string, path: string, method?: string, body?: unknown): Promise<ApiReply> {
  const opts: RequestInit = { method: method || 'GET', headers: { 'x-app-password': pw }, cache: 'no-store' };
  if (body !== undefined) {
    (opts.headers as Record<string, string>)['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(path, opts).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) { j.httpStatus = r.status; return j as ApiReply; });
  });
}

export function apiProblem(j: ApiReply | null): string {
  const e = j && j.error;
  if (e === 'wrong-password') return 'That password is not right.';
  if (e === 'too-many-attempts') return 'Too many wrong passwords. Wait 15 minutes and try again.';
  if (e === 'password-not-configured') return 'APP_PASSWORD has not been added in Vercel yet.';
  if (e === 'redis-not-configured') return 'The Redis database is not connected to this Vercel project yet.';
  return 'The server answered with a problem' + (j && j.detail ? ': ' + j.detail : '.');
}
