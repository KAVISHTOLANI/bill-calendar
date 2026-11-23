import { addDays, daysBetween, fromISO, isValidISODate } from '../shared/dates';

export const CATEGORIES = ['Housing', 'Utilities', 'Insurance', 'Subscriptions', 'Loans', 'Phone & internet', 'Other'] as const;
export type Category = (typeof CATEGORIES)[number];

export type Repeat =
  | { kind: 'monthly'; day: number; everyMonths: number; startMonth: string }
  | { kind: 'weekly'; everyWeeks: number; start: string }
  | { kind: 'yearly'; month: number; day: number };

export interface Bill {
  id: string;
  name: string;
  payee: string;
  category: Category;
  amount: number;
  /** Variable bills (e.g. electricity) are estimates until paid. */
  variable: boolean;
  autopay: boolean;
  repeat: Repeat;
  active: boolean;
  demo?: boolean;
}

export interface Payment {
  billId: string;
  due: string;
  paidOn: string;
  amount: number;
}

export const round = (n: number) => Math.round(n * 100) / 100;
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
const pad = (n: number) => String(n).padStart(2, '0');

/** All due dates of a bill inside [from, to]. Day 31 falls on the last day of shorter months. */
export function occurrences(b: Bill, from: string, to: string): string[] {
  const out: string[] = [];
  const r = b.repeat;
  if (r.kind === 'weekly') {
    const step = r.everyWeeks * 7;
    let d = r.start;
    if (d < from) d = addDays(d, Math.ceil(daysBetween(d, from) / step) * step);
    for (; d <= to; d = addDays(d, step)) out.push(d);
    return out;
  }
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    if (r.kind === 'yearly' && m !== r.month) continue;
    if (r.kind === 'monthly') {
      const [sy, sm] = r.startMonth.split('-').map(Number);
      const diff = (y - sy) * 12 + (m - sm);
      if (diff < 0 || diff % r.everyMonths !== 0) continue;
    }
    const day = Math.min(r.day, lastDay(y, m));
    const d = `${y}-${pad(m)}-${pad(day)}`;
    if (d >= from && d <= to) out.push(d);
  }
  return out;
}

export function repeatLabel(r: Repeat): string {
  const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
  if (r.kind === 'weekly') return r.everyWeeks === 1 ? 'Weekly' : `Every ${r.everyWeeks} weeks`;
  if (r.kind === 'yearly') return `Yearly on ${fromISO(`2000-${pad(r.month)}-01`).toLocaleDateString(undefined, { month: 'short' })} ${r.day}`;
  const every = r.everyMonths === 1 ? 'Monthly' : r.everyMonths === 3 ? 'Quarterly' : `Every ${r.everyMonths} months`;
  return `${every} on the ${r.day >= 28 && r.day === 31 ? 'last day' : ord(r.day)}`;
}

/** Average cost per year, from how often it repeats. */
export function annualCost(b: Bill): number {
  const r = b.repeat;
  const perYear = r.kind === 'weekly' ? 52 / r.everyWeeks : r.kind === 'yearly' ? 1 : 12 / r.everyMonths;
  return round(b.amount * perYear);
}

export type Status = 'paid' | 'overdue' | 'due-soon' | 'upcoming' | 'autopay';

export interface Occurrence {
  bill: Bill;
  due: string;
  payment?: Payment;
  status: Status;
  amount: number;
}

export function statusOf(due: string, payment: Payment | undefined, autopay: boolean, today: string, soonDays = 7): Status {
  if (payment) return 'paid';
  if (due < today) return autopay ? 'paid' : 'overdue';
  if (autopay) return 'autopay';
  return daysBetween(today, due) <= soonDays ? 'due-soon' : 'upcoming';
}

export function schedule(bills: Bill[], payments: Payment[], from: string, to: string, today: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const bill of bills) {
    if (!bill.active) continue;
    for (const due of occurrences(bill, from, to)) {
      const payment = payments.find((p) => p.billId === bill.id && p.due === due);
      out.push({ bill, due, payment, status: statusOf(due, payment, bill.autopay, today), amount: payment ? payment.amount : bill.amount });
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.bill.name.localeCompare(b.bill.name));
}

export function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return { from: `${ym}-01`, to: `${ym}-${pad(lastDay(y, m))}` };
}

export function monthSummary(occ: Occurrence[]) {
  const total = round(occ.reduce((s, o) => s + o.amount, 0));
  const paid = round(occ.filter((o) => o.status === 'paid').reduce((s, o) => s + o.amount, 0));
  const byCat = CATEGORIES.map((c) => ({ category: c, total: round(occ.filter((o) => o.bill.category === c).reduce((s, o) => s + o.amount, 0)) })).filter((x) => x.total > 0);
  return { total, paid, remaining: round(total - paid), count: occ.length, overdue: occ.filter((o) => o.status === 'overdue').length, byCat };
}

/** Monday-first weeks covering the month, with null padding. */
export function monthGrid(ym: string): (string | null)[][] {
  const { from, to } = monthRange(ym);
  const lead = (fromISO(from).getDay() + 6) % 7;
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = from; d <= to; d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

export interface BillDraft {
  name: string;
  payee: string;
  category: Category;
  amount: string;
  variable: boolean;
  autopay: boolean;
  kind: Repeat['kind'];
  day: string;
  everyMonths: string;
  startMonth: string;
  everyWeeks: string;
  start: string;
  month: string;
}

export function validateBill(d: BillDraft): { errors: Partial<Record<keyof BillDraft, string>>; value?: Omit<Bill, 'id' | 'active'> } {
  const e: Partial<Record<keyof BillDraft, string>> = {};
  if (!d.name.trim()) e.name = 'Name the bill.';
  const amount = Number(d.amount);
  if (!d.amount.trim() || !Number.isFinite(amount) || amount <= 0) e.amount = 'Enter an amount greater than 0.';
  const day = Number(d.day);
  if (d.kind !== 'weekly' && (!Number.isInteger(day) || day < 1 || day > 31)) e.day = 'Day of the month must be 1–31.';
  const every = Number(d.everyMonths);
  if (d.kind === 'monthly' && (!Number.isInteger(every) || every < 1 || every > 24)) e.everyMonths = 'Every 1–24 months.';
  if (d.kind === 'monthly' && !/^\d{4}-\d{2}$/.test(d.startMonth)) e.startMonth = 'Choose the first month.';
  const weeks = Number(d.everyWeeks);
  if (d.kind === 'weekly' && (!Number.isInteger(weeks) || weeks < 1 || weeks > 52)) e.everyWeeks = 'Every 1–52 weeks.';
  if (d.kind === 'weekly' && !isValidISODate(d.start)) e.start = 'Choose the first due date.';
  const month = Number(d.month);
  if (d.kind === 'yearly' && (!Number.isInteger(month) || month < 1 || month > 12)) e.month = 'Choose a month.';
  if (Object.keys(e).length) return { errors: e };
  const repeat: Repeat = d.kind === 'weekly' ? { kind: 'weekly', everyWeeks: weeks, start: d.start } : d.kind === 'yearly' ? { kind: 'yearly', month, day } : { kind: 'monthly', day, everyMonths: every, startMonth: d.startMonth };
  return { errors: e, value: { name: d.name.trim(), payee: d.payee.trim(), category: d.category, amount: round(amount), variable: d.variable, autopay: d.autopay, repeat } };
}
