import { useState, type ReactNode } from 'react';
import { DemoTag, EmptyState, Field, Landing, NotFound, Notice, PageHead, Shell, uid, useFlash, usePersistentState, useRoute } from './shared/ui';
import { DataTable, useTable, type Column } from './shared/table';
import { addDays, addMonths, daysBetween, formatDay, fromISO, relativeDays, todayISO } from './shared/dates';
import {
  CATEGORIES,
  annualCost,
  monthGrid,
  monthRange,
  monthSummary,
  repeatLabel,
  round,
  schedule,
  validateBill,
  type Bill,
  type BillDraft,
  type Category,
  type Occurrence,
  type Payment,
} from './lib/bills';

const KEY = 'dueboard:store';
const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/bills', label: 'Bills' },
  { to: '/year', label: 'Year ahead' },
];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STATUS_LABEL = { paid: 'Paid', overdue: 'Overdue', 'due-soon': 'Due soon', upcoming: 'Upcoming', autopay: 'Autopay' } as const;
const money = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ymOf = (d: string) => d.slice(0, 7);
const monthName = (ym: string, opts: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' }) => fromISO(`${ym}-01`).toLocaleDateString(undefined, opts);

interface Store {
  bills: Bill[];
  payments: Payment[];
}

export function demoStore(today: string): Store {
  const ym = ymOf(today);
  const start = addMonths(`${ym}-01`, -3).slice(0, 7);
  const b = (id: string, name: string, payee: string, category: Category, amount: number, repeat: Bill['repeat'], extra: Partial<Bill> = {}): Bill => ({ id: `demo-${id}`, name, payee, category, amount, repeat, variable: false, autopay: false, active: true, demo: true, ...extra });
  const bills: Bill[] = [
    b('rent', 'Rent', 'Demo Lettings', 'Housing', 1150, { kind: 'monthly', day: 1, everyMonths: 1, startMonth: start }),
    b('power', 'Electricity', 'Demo Energy', 'Utilities', 85, { kind: 'monthly', day: 12, everyMonths: 1, startMonth: start }, { variable: true }),
    b('water', 'Water and sewer (quarterly, estimated from last bill)', 'Demo Water Board', 'Utilities', 96, { kind: 'monthly', day: 20, everyMonths: 3, startMonth: start }, { variable: true }),
    b('net', 'Home internet', 'Demo Fibre', 'Phone & internet', 45, { kind: 'monthly', day: 18, everyMonths: 1, startMonth: start }, { autopay: true }),
    b('phone', 'Mobile phone', 'Demo Mobile', 'Phone & internet', 25, { kind: 'monthly', day: 27, everyMonths: 1, startMonth: start }, { autopay: true }),
    b('stream', 'Video streaming', 'Demo Streams', 'Subscriptions', 11.99, { kind: 'monthly', day: 9, everyMonths: 1, startMonth: start }, { autopay: true }),
    b('gym', 'Gym membership', 'Demo Fitness', 'Subscriptions', 19.5, { kind: 'weekly', everyWeeks: 2, start: addDays(today, -40) }, { autopay: true }),
    b('car', 'Car insurance', 'Demo Insure', 'Insurance', 640, { kind: 'yearly', month: Number(addMonths(today, 1).slice(5, 7)), day: 5 }),
    b('loan', 'Student loan', 'Demo Loans', 'Loans', 180, { kind: 'monthly', day: 28, everyMonths: 1, startMonth: start }),
    b('council', 'Council tax', 'Demo Council', 'Housing', 132, { kind: 'monthly', day: 15, everyMonths: 1, startMonth: start }),
  ];
  const payments: Payment[] = [];
  const past = schedule(bills, [], `${start}-01`, addDays(today, -1), today);
  for (const o of past) {
    if (o.bill.autopay) continue;
    if (o.bill.id === 'demo-council' && ymOf(o.due) === ym) continue; // left overdue on purpose
    const amt = o.bill.variable ? round(o.bill.amount * (0.85 + ((o.due.charCodeAt(6) + o.due.charCodeAt(9)) % 30) / 100)) : o.bill.amount;
    payments.push({ billId: o.bill.id, due: o.due, paidOn: addDays(o.due, -1), amount: amt });
  }
  return { bills, payments };
}

export default function App() {
  const [route, navigate] = useRoute();
  const today = todayISO();
  const [store, setStore] = usePersistentState<Store>(KEY, () => demoStore(today));
  const ctx = { store, setStore, today, navigate };
  const edit = route.match(/^\/bill\/(.+)$/);
  let page: ReactNode;
  if (route === '/') page = <Home />;
  else if (route === '/calendar') page = <Calendar {...ctx} />;
  else if (route === '/bills') page = <Bills {...ctx} />;
  else if (edit) page = <Editor {...ctx} id={edit[1] === 'new' ? undefined : edit[1]} />;
  else if (route === '/year') page = <Year {...ctx} />;
  else page = <NotFound />;
  return (
    <Shell name="Dueboard" wordmark={['Due', 'board']} nav={NAV} route={route} cta={{ to: '/calendar', label: 'This month' }} footerNote="Dueboard is a planner. It doesn’t pay bills or connect to your bank.">
      {page}
    </Shell>
  );
}

type Ctx = { store: Store; setStore: (s: Store) => void; today: string; navigate: (to: string) => void };

function MonthGrid({ ym, occ, today, selected, onSelect, compact }: { ym: string; occ: Occurrence[]; today: string; selected?: string; onSelect?: (d: string) => void; compact?: boolean }) {
  return (
    <div className={`cal ${compact ? 'is-compact' : ''}`} role="grid" aria-label={`Bills in ${monthName(ym)}`}>
      <div role="row" className="cal-row cal-head">{DOW.map((d) => <span role="columnheader" key={d}>{compact ? d[0] : d}</span>)}</div>
      {monthGrid(ym).map((week, w) => (
        <div role="row" className="cal-row" key={w}>
          {week.map((d, i) => {
            if (!d) return <span role="gridcell" key={i} className="cal-cell is-pad" />;
            const items = occ.filter((o) => o.due === d);
            const total = round(items.reduce((s, o) => s + o.amount, 0));
            const worst = items.some((o) => o.status === 'overdue') ? 'overdue' : items.some((o) => o.status === 'due-soon') ? 'due-soon' : items.length && items.every((o) => o.status === 'paid') ? 'paid' : items.length ? 'upcoming' : '';
            const label = `${formatDay(d, { weekday: 'long', day: 'numeric', month: 'long' })}: ${items.length ? `${items.length} bill${items.length > 1 ? 's' : ''}, ${money(total)}` : 'no bills'}`;
            const content = (
              <>
                <span className="cal-day">{Number(d.slice(8))}</span>
                {items.length > 0 && (compact
                  ? <span className={`cal-dot s-${worst}`} />
                  : <span className="cal-items">{items.slice(0, 2).map((o) => <span key={o.bill.id} className={`cal-chip s-${o.status}`}>{o.bill.name}</span>)}{items.length > 2 && <span className="small muted">+{items.length - 2}</span>}</span>)}
              </>
            );
            return (
              <span role="gridcell" key={d} className={`cal-cell ${d === today ? 'is-today' : ''} ${selected === d ? 'is-selected' : ''}`} aria-selected={selected === d || undefined}>
                {onSelect ? <button type="button" className="cal-btn" aria-label={label} onClick={() => onSelect(d)}>{content}</button> : <span className="cal-btn" aria-label={label}>{content}</span>}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function HeroPreview() {
  const today = todayISO();
  const s = demoStore(today);
  const { from, to } = monthRange(ymOf(today));
  const occ = schedule(s.bills, s.payments, from, to, today);
  const sum = monthSummary(occ);
  return (
    <div className="hero-db">
      <div className="hero-db-sum">
        <div><span>Due in {monthName(ymOf(today), { month: 'long' })}</span><b>{money(sum.total)}</b></div>
        <div><span>Paid</span><b>{money(sum.paid)}</b></div>
        <div><span>Left to pay</span><b>{money(sum.remaining)}</b></div>
      </div>
      <MonthGrid ym={ymOf(today)} occ={occ} today={today} compact />
      <Legend />
    </div>
  );
}

function Legend() {
  return <p className="legend"><span><i className="s-paid" />Paid</span><span><i className="s-due-soon" />Due within 7 days</span><span><i className="s-overdue" />Overdue</span><span><i className="s-upcoming" />Upcoming</span></p>;
}

function Home() {
  return (
    <Landing
      eyebrow="Bill calendar"
      title={<>Every bill, <em>on the day it’s due.</em></>}
      lead="Add your recurring bills once — monthly, quarterly, every other week or yearly. Dueboard lays them out on a calendar, shows what’s left to pay this month, and flags anything overdue."
      primary={{ href: '#/calendar', label: 'Open this month' }}
      secondary={{ href: '#/year', label: 'See the year ahead' }}
      previewLabel="This month — demo bills"
      preview={<HeroPreview />}
      steps={[
        { title: 'Add a bill', body: 'Amount, category, how it repeats, and whether it’s on autopay or varies month to month.' },
        { title: 'Check the month', body: 'The calendar shows each due date. Select a day to see the bills and mark them paid.' },
        { title: 'Record what you paid', body: 'For variable bills, enter the real amount — totals update straight away.' },
      ]}
      stepsIntro="Dueboard opens with ten labelled demo bills and three months of payment history. Clear them when you’re ready."
      features={[
        { title: 'Awkward dates handled', body: 'A bill due on the 31st falls on the last day of shorter months; 29 February works in leap years.' },
        { title: 'Autopay aware', body: 'Autopay bills count as paid once their date passes, so only manual bills can go overdue.' },
        { title: 'Real totals', body: 'Paid, remaining and per-category totals for the month, using actual amounts once paid.' },
        { title: 'The year ahead', body: 'What each bill costs per year and how much is due in each of the next 12 months.' },
      ]}
      note="Dueboard is a planner. It doesn’t move money or connect to your bank."
      closing={{ title: <>Nothing due <em>by surprise.</em></>, action: { href: '#/bill/new', label: 'Add a bill' } }}
    />
  );
}

/* ---------- Calendar ---------- */
function Calendar({ store, setStore, today }: Ctx) {
  const [ym, setYm] = useState(ymOf(today));
  const [sel, setSel] = useState<string | undefined>(undefined);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [flash, setFlash] = useFlash();
  const { from, to } = monthRange(ym);
  const occ = schedule(store.bills, store.payments, from, to, today);
  const sum = monthSummary(occ);
  if (store.bills.length === 0)
    return <EmptyState title="No bills yet" actions={<><a className="btn btn-primary" href="#/bill/new">Add a bill</a><button type="button" className="btn" onClick={() => setStore(demoStore(today))}>Load demo bills</button></>}>Add the bills you pay regularly to see them on the calendar.</EmptyState>;
  const list = sel ? occ.filter((o) => o.due === sel) : occ.filter((o) => o.status !== 'paid');
  const key = (o: Occurrence) => `${o.bill.id}@${o.due}`;
  function pay(o: Occurrence) {
    const text = amounts[key(o)] ?? o.bill.amount.toFixed(2);
    const n = Number(text);
    if (!Number.isFinite(n) || n <= 0) return setFlash({ kind: 'error', text: `Enter the amount paid for ${o.bill.name}.` });
    setStore({ ...store, payments: [...store.payments.filter((p) => !(p.billId === o.bill.id && p.due === o.due)), { billId: o.bill.id, due: o.due, paidOn: today, amount: round(n) }] });
    setFlash({ kind: 'success', text: `${o.bill.name} marked paid (${money(n)}).` });
  }
  function unpay(o: Occurrence) {
    setStore({ ...store, payments: store.payments.filter((p) => !(p.billId === o.bill.id && p.due === o.due)) });
  }
  return (
    <div className="stack">
      <PageHead eyebrow="Calendar" title={<>{monthName(ym, { month: 'long' })} <em>{ym.slice(0, 4)}</em></>}
        actions={<div className="row nowrap">
          <button type="button" className="btn btn-sm" aria-label="Previous month" onClick={() => { setYm(addMonths(`${ym}-01`, -1).slice(0, 7)); setSel(undefined); }}>←</button>
          <button type="button" className="btn btn-sm" disabled={ym === ymOf(today)} onClick={() => { setYm(ymOf(today)); setSel(undefined); }}>Today</button>
          <button type="button" className="btn btn-sm" aria-label="Next month" onClick={() => { setYm(addMonths(`${ym}-01`, 1).slice(0, 7)); setSel(undefined); }}>→</button>
        </div>} />
      {flash && <Notice kind={flash.kind} onDismiss={() => setFlash(null)}>{flash.text}</Notice>}
      <div className="stats" data-testid="month-summary">
        <div className="stat"><span className="stat-label">Due this month</span><span className="stat-value">{money(sum.total)}</span></div>
        <div className="stat"><span className="stat-label">Paid</span><span className="stat-value">{money(sum.paid)}</span></div>
        <div className="stat"><span className="stat-label">Left to pay</span><span className="stat-value">{money(sum.remaining)}</span></div>
        <div className="stat"><span className="stat-label">Overdue</span><span className="stat-value">{sum.overdue}</span></div>
      </div>
      <div className="layout-main">
        <section className="card stack" aria-label="Month calendar">
          <MonthGrid ym={ym} occ={occ} today={today} selected={sel} onSelect={(d) => setSel(sel === d ? undefined : d)} />
          <Legend />
        </section>
        <aside className="card stack" aria-labelledby="list-title">
          <div className="card-title-row"><h2 id="list-title" className="h3">{sel ? formatDay(sel, { weekday: 'long', day: 'numeric', month: 'long' }) : 'Still to pay'}</h2>{sel && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSel(undefined)}>Show all</button>}</div>
          {list.length === 0 ? <p className="muted">{sel ? 'No bills due this day.' : 'Everything this month is paid.'}</p> : (
            <ul className="pay-list">
              {list.map((o) => (
                <li key={key(o)} className={`pay s-${o.status}-b`}>
                  <div className="row-between"><strong>{o.bill.name}</strong><span className={`badge ${o.status === 'paid' ? 'badge-ok' : o.status === 'overdue' ? 'badge-err' : o.status === 'due-soon' ? 'badge-warn' : ''}`}>{STATUS_LABEL[o.status]}</span></div>
                  <span className="small muted">{formatDay(o.due, { weekday: 'short', day: 'numeric', month: 'short' })} · {relativeDays(daysBetween(today, o.due))}{o.bill.variable && !o.payment ? ' · estimate' : ''}</span>
                  {o.status === 'paid' ? (
                    <div className="row-between small"><span>{o.payment ? `Paid ${money(o.payment.amount)} on ${formatDay(o.payment.paidOn, { day: 'numeric', month: 'short' })}` : 'Paid by autopay'}</span>{o.payment && <button type="button" className="btn btn-sm btn-ghost" onClick={() => unpay(o)}>Undo</button>}</div>
                  ) : o.status === 'autopay' ? <span className="small">Autopay · {money(o.amount)}</span> : (
                    <div className="pay-row">
                      <label className="sr-only" htmlFor={`amt-${key(o)}`}>Amount paid for {o.bill.name}</label>
                      <input id={`amt-${key(o)}`} className="amt" inputMode="decimal" value={amounts[key(o)] ?? o.bill.amount.toFixed(2)} onChange={(e) => setAmounts({ ...amounts, [key(o)]: e.target.value })} />
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => pay(o)}>Mark paid</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ---------- Bills ---------- */
function Bills({ store, setStore, today }: Ctx) {
  const [flash, setFlash] = useFlash();
  const [cat, setCat] = useState('');
  const rows = store.bills.filter((b) => !cat || b.category === cat);
  const next = (b: Bill) => schedule([{ ...b, active: true }], store.payments, today, addMonths(today, 13), today)[0]?.due ?? '';
  const columns: Column<Bill>[] = [
    { key: 'name', label: 'Bill', sort: (b) => b.name, render: (b) => <><a href={`#/bill/${b.id}`}>{b.name}</a>{b.demo && <> <DemoTag /></>}<div className="small muted">{[b.payee, b.autopay && 'Autopay', b.variable && 'Varies', !b.active && 'Paused'].filter(Boolean).join(' · ')}</div></> },
    { key: 'cat', label: 'Category', sort: (b) => b.category, render: (b) => b.category },
    { key: 'rep', label: 'Repeats', render: (b) => repeatLabel(b.repeat) },
    { key: 'next', label: 'Next due', sort: (b) => (b.active ? next(b) : ''), render: (b) => (b.active && next(b) ? formatDay(next(b), { day: 'numeric', month: 'short' }) : '—') },
    { key: 'amt', label: 'Amount', num: true, sort: (b) => b.amount, render: (b) => money(b.amount) },
    { key: 'year', label: 'Per year', num: true, sort: (b) => annualCost(b), render: (b) => money(annualCost(b)) },
  ];
  const table = useTable(rows, columns, { initialSort: 'next' });
  return (
    <div className="stack">
      <PageHead eyebrow="Bills" title={<>What you <em>pay regularly.</em></>} actions={<a className="btn btn-primary" href="#/bill/new">Add bill</a>} />
      {flash && <Notice kind={flash.kind} onDismiss={() => setFlash(null)}>{flash.text}</Notice>}
      {store.bills.length === 0 ? (
        <EmptyState title="No bills yet" actions={<><a className="btn btn-primary" href="#/bill/new">Add a bill</a><button type="button" className="btn" onClick={() => setStore(demoStore(today))}>Load demo bills</button></>}>Start with rent or your largest bill.</EmptyState>
      ) : (
        <div className="card stack">
          <div className="filters"><Field label="Category">{(p) => <select {...p} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>}</Field></div>
          <DataTable caption="Recurring bills" columns={columns} table={table} rowKey={(b) => b.id} empty="No bills in this category." />
          <p className="small"><strong>Active bills per year: {money(round(store.bills.filter((b) => b.active).reduce((s, b) => s + annualCost(b), 0)))}</strong></p>
          {store.bills.some((b) => b.demo) && <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => { const ids = new Set(store.bills.filter((b) => b.demo).map((b) => b.id)); setStore({ bills: store.bills.filter((b) => !b.demo), payments: store.payments.filter((p) => !ids.has(p.billId)) }); setFlash({ kind: 'success', text: 'Demo bills removed.' }); }}>Clear demo bills</button></div>}
        </div>
      )}
    </div>
  );
}

function Editor({ store, setStore, today, navigate, id }: Ctx & { id?: string }) {
  const ex = id ? store.bills.find((b) => b.id === id) : undefined;
  const r = ex?.repeat;
  const [d, setD] = useState<BillDraft>({
    name: ex?.name ?? '', payee: ex?.payee ?? '', category: ex?.category ?? 'Utilities', amount: ex ? ex.amount.toFixed(2) : '', variable: ex?.variable ?? false, autopay: ex?.autopay ?? false,
    kind: r?.kind ?? 'monthly', day: r && r.kind !== 'weekly' ? String(r.day) : String(Number(today.slice(8))), everyMonths: r?.kind === 'monthly' ? String(r.everyMonths) : '1', startMonth: r?.kind === 'monthly' ? r.startMonth : ymOf(today),
    everyWeeks: r?.kind === 'weekly' ? String(r.everyWeeks) : '1', start: r?.kind === 'weekly' ? r.start : today, month: r?.kind === 'yearly' ? String(r.month) : String(Number(today.slice(5, 7))),
  });
  const [submitted, setSubmitted] = useState(false);
  if (id && !ex) return <EmptyState title="Bill not found" actions={<a className="btn btn-primary" href="#/bills">Back to bills</a>} />;
  const errors = submitted ? validateBill(d).errors : {};
  const set = <K extends keyof BillDraft>(k: K, v: BillDraft[K]) => setD({ ...d, [k]: v });
  const preview = validateBill(d).value;
  function save(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const v = validateBill(d).value;
    if (!v) return;
    if (ex) setStore({ ...store, bills: store.bills.map((b) => (b.id === ex.id ? { ...ex, ...v, demo: false } : b)) });
    else setStore({ ...store, bills: [...store.bills, { ...v, id: uid('bill'), active: true }] });
    navigate('/bills');
  }
  return (
    <div className="stack">
      <PageHead eyebrow={ex ? 'Edit bill' : 'New bill'} title={ex ? <>Edit <em>{ex.name}</em></> : <>Add a <em>bill.</em></>} />
      <form className="layout-main" onSubmit={save} noValidate>
        <div className="card stack">
          {Object.keys(errors).length > 0 && <Notice kind="error">Please fix the highlighted fields.</Notice>}
          <div className="form-grid">
            <Field label="Bill name" error={errors.name}>{(p) => <input {...p} value={d.name} onChange={(e) => set('name', e.target.value)} />}</Field>
            <Field label="Paid to">{(p) => <input {...p} value={d.payee} onChange={(e) => set('payee', e.target.value)} />}</Field>
            <Field label="Category">{(p) => <select {...p} value={d.category} onChange={(e) => set('category', e.target.value as Category)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>}</Field>
            <Field label="Amount (USD)" hint={d.variable ? 'Your best estimate' : undefined} error={errors.amount}>{(p) => <input {...p} inputMode="decimal" value={d.amount} onChange={(e) => set('amount', e.target.value)} />}</Field>
          </div>
          <div className="row">
            <label className="check"><input type="checkbox" checked={d.variable} onChange={(e) => set('variable', e.target.checked)} /> Amount varies</label>
            <label className="check"><input type="checkbox" checked={d.autopay} onChange={(e) => set('autopay', e.target.checked)} /> Paid automatically</label>
          </div>
          <fieldset className="stack">
            <legend className="label">Repeats</legend>
            <div className="tabs" role="radiogroup" aria-label="Repeats">
              {([['monthly', 'Monthly'], ['weekly', 'Weekly'], ['yearly', 'Yearly']] as const).map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={d.kind === v} onClick={() => set('kind', v)}>{l}</button>)}
            </div>
            <div className="form-grid">
              {d.kind === 'monthly' && <>
                <Field label="Day of month" hint="31 = last day" error={errors.day}>{(p) => <input {...p} inputMode="numeric" value={d.day} onChange={(e) => set('day', e.target.value)} />}</Field>
                <Field label="Every (months)" hint="3 = quarterly" error={errors.everyMonths}>{(p) => <input {...p} inputMode="numeric" value={d.everyMonths} onChange={(e) => set('everyMonths', e.target.value)} />}</Field>
                <Field label="First month" error={errors.startMonth}>{(p) => <input {...p} type="month" value={d.startMonth} onChange={(e) => set('startMonth', e.target.value)} />}</Field>
              </>}
              {d.kind === 'weekly' && <>
                <Field label="Every (weeks)" error={errors.everyWeeks}>{(p) => <input {...p} inputMode="numeric" value={d.everyWeeks} onChange={(e) => set('everyWeeks', e.target.value)} />}</Field>
                <Field label="First due date" error={errors.start}>{(p) => <input {...p} type="date" value={d.start} onChange={(e) => set('start', e.target.value)} />}</Field>
              </>}
              {d.kind === 'yearly' && <>
                <Field label="Month" error={errors.month}>{(p) => <select {...p} value={d.month} onChange={(e) => set('month', e.target.value)}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{monthName(`2000-${String(i + 1).padStart(2, '0')}`, { month: 'long' })}</option>)}</select>}</Field>
                <Field label="Day" error={errors.day}>{(p) => <input {...p} inputMode="numeric" value={d.day} onChange={(e) => set('day', e.target.value)} />}</Field>
              </>}
            </div>
          </fieldset>
          <div className="row">
            <button className="btn btn-primary" type="submit">{ex ? 'Save changes' : 'Save bill'}</button>
            <a className="btn btn-ghost" href="#/bills">Cancel</a>
            {ex && <button type="button" className="btn" onClick={() => { setStore({ ...store, bills: store.bills.map((b) => (b.id === ex.id ? { ...b, active: !b.active } : b)) }); navigate('/bills'); }}>{ex.active ? 'Pause bill' : 'Resume bill'}</button>}
            {ex && <button type="button" className="btn btn-danger" onClick={() => { if (window.confirm(`Delete ${ex.name} and its payment history?`)) { setStore({ bills: store.bills.filter((b) => b.id !== ex.id), payments: store.payments.filter((p) => p.billId !== ex.id) }); navigate('/bills'); } }}>Delete</button>}
          </div>
        </div>
        <aside className="card stack" aria-live="polite">
          <p className="eyebrow">Preview</p>
          {preview ? <>
            <p className="display-num">{money(annualCost({ ...preview, id: 'p', active: true }))}<span className="small muted"> / year</span></p>
            <p className="small">{repeatLabel(preview.repeat)}</p>
            <p className="small muted">Next dates: {schedule([{ ...preview, id: 'p', active: true }], [], today, addMonths(today, 24), today).slice(0, 3).map((o) => formatDay(o.due, { day: 'numeric', month: 'short', year: 'numeric' })).join(', ')}</p>
          </> : <p className="muted small">Fill in the name, amount and schedule to see the next dates.</p>}
        </aside>
      </form>
    </div>
  );
}

/* ---------- Year ahead ---------- */
function Year({ store, today }: Ctx) {
  const [tip, setTip] = useState<string | null>(null);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(`${ymOf(today)}-01`, i).slice(0, 7));
  const data = months.map((m) => { const { from, to } = monthRange(m); const occ = schedule(store.bills, store.payments, from, to, today); return { m, total: monthSummary(occ).total, occ }; });
  const max = Math.max(100, ...data.map((d) => d.total));
  const nice = Math.ceil(max / 500) * 500;
  const annual = store.bills.filter((b) => b.active).map((b) => ({ b, a: annualCost(b) })).sort((x, y) => y.a - x.a);
  const amax = Math.max(1, ...annual.map((x) => x.a));
  if (!store.bills.length) return <EmptyState title="No bills yet" actions={<a className="btn btn-primary" href="#/bill/new">Add a bill</a>} />;
  return (
    <div className="stack">
      <PageHead eyebrow="Year ahead" title={<>The next <em>twelve months.</em></>} description={`${money(round(data.reduce((s, d) => s + d.total, 0)))} due between ${monthName(months[0], { month: 'short', year: 'numeric' })} and ${monthName(months[11], { month: 'short', year: 'numeric' })}.`} />
      <section className="card stack" aria-labelledby="ym-title">
        <h2 id="ym-title" className="h3">Due per month</h2>
        <div className="bars-wrap" onMouseLeave={() => setTip(null)}>
          <div className="bars-axis" aria-hidden="true">{[nice, nice / 2, 0].map((t) => <span key={t}>${t.toLocaleString()}</span>)}</div>
          <div className="bars" role="img" aria-label={data.map((d) => `${monthName(d.m, { month: 'short' })} ${money(d.total)}`).join(', ')}>
            {data.map((d, i) => {
              const big = d.occ.filter((o) => o.amount >= 300 && o.bill.repeat.kind === 'yearly').map((o) => o.bill.name);
              const text = `${monthName(d.m)}: ${money(d.total)}${big.length ? ` (includes ${big.join(', ')})` : ''}`;
              return (
                <div key={d.m} className="bar-col" style={{ ['--i' as string]: i }} tabIndex={0} aria-label={text} onMouseEnter={() => setTip(text)} onFocus={() => setTip(text)} onBlur={() => setTip(null)}>
                  <div className="bar-stack" style={{ height: `${(d.total / nice) * 100}%` }}><span style={{ flexGrow: 1, background: big.length ? 'var(--warn)' : 'var(--accent)' }} /></div>
                  <span className="bar-label mono">{monthName(d.m, { month: 'short' })}</span>
                </div>
              );
            })}
          </div>
        </div>
        <p className="small" aria-live="polite">{tip ?? 'Hover or focus a month for the exact total.'}</p>
        <p className="legend"><span><i style={{ background: 'var(--accent)' }} />Regular month</span><span><i style={{ background: 'var(--warn)' }} />Includes a large yearly bill</span><span className="muted">· USD due per month</span></p>
      </section>
      <section className="card stack" aria-labelledby="ann-title">
        <h2 id="ann-title" className="h3">Cost per year, by bill</h2>
        <ul className="ann-list">
          {annual.map(({ b, a }, i) => (
            <li key={b.id} style={{ ['--i' as string]: i }}>
              <span className="ann-name">{b.name}</span>
              <span className="ann-track"><span style={{ width: `${(a / amax) * 100}%` }} /></span>
              <span className="mono small">{money(a)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
