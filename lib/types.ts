// The shape of the data. Shared by the page and the server.
// Dates are always 'YYYY-MM-DD' strings. An optional time of day is a separate 'HH:MM' string.

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
  deliveryTime?: string;    // optional 'HH:MM', shown only
  redeliveryTime?: string;  // optional 'HH:MM', shown only
  archived?: boolean;       // archived contracts (and all their notices) are hidden everywhere except the Archive tab
  archivedAt?: string;      // 'YYYY-MM-DD'
}

export interface Notice {
  id: string;
  cid: string;          // id of the owning contract
  title: string;
  type: NoticeType;
  date: string;         // due date
  time?: string;        // optional 'HH:MM', shown only
  done: boolean;        // the on/off switch shows this the other way round: off = done (actioned)
  notes?: string;       // optional free-text comments, max 1000 characters
  archived?: boolean;   // archived notices are hidden everywhere except the Archive tab
  archivedAt?: string;  // 'YYYY-MM-DD'
  rems?: Reminder[];    // up to 3, largest days first
  remind?: number;      // older notices only
  reminds?: number[];   // older notices only
}

export interface AppState {
  contracts: Contract[];
  notices: Notice[];
}
