// The shape of the data. Shared by the page and the server.
// Dates are always 'YYYY-MM-DD' strings.

export type NoticeType = 'shipping' | 'contract';

export interface Reminder {
  days: number;   // days before the due date
  to: string[];   // email recipients
}

export interface Contract {
  id: string;
  ref: string;
  vessel: string;
  party: string;
  delivery: string;
  redelivery: string;
}

export interface Notice {
  id: string;
  cid: string;          // id of the owning contract
  title: string;
  type: NoticeType;
  date: string;         // due date
  done: boolean;
  rems?: Reminder[];    // up to 3, largest days first
  remind?: number;      // older notices only
  reminds?: number[];   // older notices only
}

export interface AppState {
  contracts: Contract[];
  notices: Notice[];
}
