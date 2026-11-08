/*
 * Excel export. The SheetJS library is loaded from cdnjs only when the button is pressed.
 * Same two sheets and columns as before: "Contracts" and "Notices by contract".
 */
import type { AppState } from './types';
import { daysUntil, live, remindsOf, sortedContracts, status, ymd } from './rules';

type Cell = string | number | { t: 'n'; v: number; z: string };

function xlDate(s: string): Cell {
  if (!s) return '';
  const p = s.split('-');
  return { t: 'n', v: Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000 + 25569, z: 'dd-mmm-yyyy' };
}

export function buildSheets(state: AppState): { sum: Cell[][]; rows: Cell[][] } {
  const sum: Cell[][] = [['Vessel', 'Counterparty', 'Contract reference', 'Delivery date', 'Redelivery date', 'Notices', 'Open notices', 'Needing attention', 'Operator']];
  const rows: Cell[][] = [['Vessel', 'Counterparty', 'Contract reference', 'Delivery date', 'Redelivery date', 'Notice', 'Type', 'Due date', 'Days until due', 'Status', 'Actioned',
    '1st reminder (days before)', '1st reminder sent to', '2nd reminder (days before)', '2nd reminder sent to', '3rd reminder (days before)', '3rd reminder sent to', 'Comments', 'Operator']];
  sortedContracts(state).forEach(function (c) {
    const ns = state.notices.filter(function (n) { return n.cid === c.id; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
    const open = ns.filter(function (n) { return !n.done && live(state, n); }).length;
    const attn = ns.filter(function (n) { return !n.done && live(state, n) && status(n).soon; }).length;
    sum.push([c.vessel, c.party, c.ref || '', xlDate(c.delivery), xlDate(c.redelivery), ns.length, open, attn, c.operator || '']);
    const head: Cell[] = [c.vessel, c.party, c.ref || '', xlDate(c.delivery), xlDate(c.redelivery)];
    if (!ns.length) { rows.push(head.concat(['(no notices)', '', '', '', '', '', '', '', '', '', '', '', '', c.operator || ''])); return; }
    ns.forEach(function (n) {
      // Archived notices, and notices of archived contracts, stay in the file with the status "Archived".
      const r: Cell[] = [n.title, n.type === 'shipping' ? 'Shipping notice' : 'Contract obligation', xlDate(n.date), daysUntil(n.date), live(state, n) ? status(n).text : 'Archived', n.done ? 'Yes' : 'No'];
      const days = remindsOf(n);
      for (let i = 0; i < 3; i++) {
        const to = (n.rems && n.rems[i]) ? n.rems[i].to : [];
        r.push(days[i] === undefined ? '' : days[i], to.join(', '));
      }
      r.push(n.notes || '');
      r.push(c.operator || '');   // each notice takes its contract's operator
      rows.push(head.concat(r));
    });
  });
  return { sum, rows };
}

const SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let loading: Promise<boolean> | null = null;

function loadSheetJS(): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).XLSX) return Promise.resolve(true);
  if (loading) return loading;
  loading = new Promise(function (resolve) {
    const s = document.createElement('script');
    s.src = SHEETJS;
    s.onload = function () { resolve(true); };
    s.onerror = function () { loading = null; s.remove(); resolve(false); };
    document.head.appendChild(s);
  });
  return loading;
}

/* Returns the message to show under the button. */
export async function exportExcel(state: AppState): Promise<string> {
  if (!state.contracts.length) return 'Add a contract first.';
  const ok = await loadSheetJS();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const XLSX = (window as any).XLSX;
  if (!ok || !XLSX) return 'The Excel library did not load. Check your connection and try again.';
  const s = buildSheets(state);
  const wb = XLSX.utils.book_new();
  const w1 = XLSX.utils.aoa_to_sheet(s.sum);
  w1['!cols'] = [{ wch: 22 }, { wch: 24 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 9 }, { wch: 13 }, { wch: 17 }, { wch: 22 }];
  const w2 = XLSX.utils.aoa_to_sheet(s.rows);
  w2['!cols'] = [{ wch: 22 }, { wch: 24 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 7 }, { wch: 14 }, { wch: 34 }, { wch: 14 }, { wch: 34 }, { wch: 14 }, { wch: 34 }, { wch: 40 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, w1, 'Contracts');
  XLSX.utils.book_append_sheet(wb, w2, 'Notices by contract');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'deadline-calendar-' + ymd(new Date()) + '.xlsx';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
  return 'Excel file downloaded.';
}
