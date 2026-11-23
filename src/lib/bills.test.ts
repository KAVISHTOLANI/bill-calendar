import { describe, expect, it } from 'vitest';
import { annualCost, monthGrid, monthRange, monthSummary, occurrences, repeatLabel, schedule, statusOf, validateBill, type Bill, type BillDraft } from './bills';

const bill = (p: Partial<Bill>): Bill => ({ id: 'b', name: 'Rent', payee: '', category: 'Housing', amount: 1000, variable: false, autopay: false, active: true, repeat: { kind: 'monthly', day: 1, everyMonths: 1, startMonth: '2026-01' }, ...p });

describe('occurrences', () => {
  it('clamps day 31 to the end of short months', () => {
    const b = bill({ repeat: { kind: 'monthly', day: 31, everyMonths: 1, startMonth: '2026-01' } });
    expect(occurrences(b, '2026-02-01', '2026-04-30')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('respects every-N-months from the start month', () => {
    const b = bill({ repeat: { kind: 'monthly', day: 15, everyMonths: 3, startMonth: '2026-02' } });
    expect(occurrences(b, '2026-01-01', '2026-12-31')).toEqual(['2026-02-15', '2026-05-15', '2026-08-15', '2026-11-15']);
    expect(occurrences(b, '2025-01-01', '2025-12-31')).toEqual([]);
  });
  it('handles weekly bills from their start and across years', () => {
    const b = bill({ repeat: { kind: 'weekly', everyWeeks: 2, start: '2026-12-21' } });
    expect(occurrences(b, '2026-12-01', '2027-01-31')).toEqual(['2026-12-21', '2027-01-04', '2027-01-18']);
    expect(occurrences(b, '2027-01-05', '2027-01-20')).toEqual(['2027-01-18']);
  });
  it('handles yearly bills including 29 February', () => {
    const b = bill({ repeat: { kind: 'yearly', month: 2, day: 29 } });
    expect(occurrences(b, '2027-01-01', '2028-12-31')).toEqual(['2027-02-28', '2028-02-29']);
  });
});

describe('labels and costs', () => {
  it('describes repeats', () => {
    expect(repeatLabel({ kind: 'monthly', day: 1, everyMonths: 1, startMonth: '2026-01' })).toBe('Monthly on the 1st');
    expect(repeatLabel({ kind: 'monthly', day: 22, everyMonths: 3, startMonth: '2026-01' })).toBe('Quarterly on the 22nd');
    expect(repeatLabel({ kind: 'monthly', day: 31, everyMonths: 1, startMonth: '2026-01' })).toBe('Monthly on the last day');
    expect(repeatLabel({ kind: 'weekly', everyWeeks: 2, start: '2026-01-01' })).toBe('Every 2 weeks');
  });
  it('annualises costs', () => {
    expect(annualCost(bill({}))).toBe(12000);
    expect(annualCost(bill({ amount: 30, repeat: { kind: 'weekly', everyWeeks: 2, start: '2026-01-01' } }))).toBe(780);
    expect(annualCost(bill({ amount: 600, repeat: { kind: 'yearly', month: 3, day: 1 } }))).toBe(600);
  });
});

describe('status and summaries', () => {
  const today = '2026-11-23';
  it('treats past autopay as paid and flags manual overdue', () => {
    expect(statusOf('2026-11-01', undefined, true, today)).toBe('paid');
    expect(statusOf('2026-11-01', undefined, false, today)).toBe('overdue');
    expect(statusOf('2026-11-28', undefined, false, today)).toBe('due-soon');
    expect(statusOf('2026-12-15', undefined, false, today)).toBe('upcoming');
    expect(statusOf('2026-12-15', undefined, true, today)).toBe('autopay');
  });
  it('uses the amount actually paid', () => {
    const elec = bill({ id: 'e', name: 'Electric', amount: 90, variable: true, repeat: { kind: 'monthly', day: 10, everyMonths: 1, startMonth: '2026-01' } });
    const { from, to } = monthRange('2026-11');
    const occ = schedule([bill({}), elec, bill({ id: 'off', active: false })], [{ billId: 'e', due: '2026-11-10', paidOn: '2026-11-09', amount: 104.37 }], from, to, today);
    expect(occ.map((o) => [o.bill.id, o.status, o.amount])).toEqual([['b', 'overdue', 1000], ['e', 'paid', 104.37]]);
    expect(monthSummary(occ)).toMatchObject({ total: 1104.37, paid: 104.37, remaining: 1000, overdue: 1 });
  });
  it('builds a Monday-first month grid', () => {
    const g = monthGrid('2026-11');
    expect(g[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(g.flat().filter(Boolean)).toHaveLength(30);
    expect(g.every((w) => w.length === 7)).toBe(true);
  });
});

describe('validation', () => {
  const d: BillDraft = { name: '', payee: '', category: 'Utilities', amount: '0', variable: false, autopay: false, kind: 'monthly', day: '32', everyMonths: '1', startMonth: '2026-11', everyWeeks: '1', start: '2026-11-23', month: '1' };
  it('reports errors for the chosen repeat kind only', () => {
    expect(Object.keys(validateBill(d).errors).sort()).toEqual(['amount', 'day', 'name']);
    expect(Object.keys(validateBill({ ...d, kind: 'weekly', everyWeeks: '0' }).errors).sort()).toEqual(['amount', 'everyWeeks', 'name']);
  });
  it('builds a bill', () => {
    expect(validateBill({ ...d, name: ' Water ', amount: '45.555', day: '5' }).value).toMatchObject({ name: 'Water', amount: 45.56, repeat: { kind: 'monthly', day: 5 } });
  });
});
