import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { InstallmentPlan } from '@budjo/shared';
import {
  dateOf, defaultFirstPeriod, formatCents, formatPeriod, parseDollarsToCents, paymentSchedule,
} from '@budjo/shared';
import {
  useAccounts, useCancelPlan, useCreatePlan, useMe, usePlans, useReference,
} from '../lib/hooks';
import {
  Button, Card, Disclosure, Empty, ErrorNote, Field, Hint, Select, Spinner, TextInput,
} from '../components/ui';

const longDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });

const ordinal = (n: number) => {
  const tail = n % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

/**
 * Things bought on financing. Each plan charges its account once a month until
 * it is paid off; this page is where you set one up and see what is still owed.
 */
export function Plans() {
  const plans = usePlans();
  const accounts = useAccounts();
  const [adding, setAdding] = useState(false);

  if (plans.isLoading || accounts.isLoading) return <Spinner />;
  if (plans.isError) return <ErrorNote error={plans.error} />;

  const all = plans.data?.plans ?? [];
  const active = all.filter((p) => p.status === 'active');
  const past = all.filter((p) => p.status !== 'active');
  const owed = active.reduce((t, p) => t + p.remainingCents, 0);
  const accountName = (id: string) =>
    accounts.data?.accounts.find((a) => a.accountId === id)?.account.name ?? '—';

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Payment plans</h1>
        <Link to="/" className="muted text-sm">Back</Link>
      </header>

      {active.length > 0 ? (
        <Card className="p-5">
          <div className="muted text-xs">Still to pay</div>
          <div className="tnum mt-1 text-4xl font-semibold tracking-tight">{formatCents(owed)}</div>
          <div className="muted mt-1 text-xs">
            across {active.length} {active.length === 1 ? 'plan' : 'plans'} ·{' '}
            {formatCents(active.reduce((t, p) => t + (p.next?.amountCents ?? 0), 0))} a month for now
          </div>
        </Card>
      ) : null}

      {adding ? (
        <NewPlan onDone={() => setAdding(false)} />
      ) : (
        <Button onClick={() => setAdding(true)} className="w-full">New payment plan</Button>
      )}

      {active.length === 0 && !adding ? (
        <Empty>
          Nothing on a payment plan. Add one when you buy something on financing and
          Budjo will charge the monthly amount for you.
        </Empty>
      ) : null}

      {active.map((plan) => (
        <PlanCard key={plan.id} plan={plan} accountName={accountName(plan.accountId)} />
      ))}

      {past.length > 0 ? (
        <Disclosure title={`Finished and stopped (${past.length})`}>
          <div className="mt-2 flex flex-col gap-4">
            {past.map((plan) => (
              <PlanCard key={plan.id} plan={plan} accountName={accountName(plan.accountId)} />
            ))}
          </div>
        </Disclosure>
      ) : null}
    </div>
  );
}

function PlanCard({ plan, accountName }: { plan: InstallmentPlan; accountName: string }) {
  const cancel = useCancelPlan();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const fraction = Math.min(1, plan.paidCount / plan.months);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{plan.description}</div>
          <div className="muted text-xs">
            {accountName} · {formatCents(plan.monthlyCents)} a month on the {ordinal(plan.dayOfMonth)}
          </div>
        </div>
        <div className="text-right">
          <div className="tnum font-medium">
            {plan.status === 'active' ? formatCents(plan.remainingCents) : formatCents(plan.paidCents)}
          </div>
          <div className="muted text-xs">
            {plan.status === 'active' ? 'left to pay' : plan.status === 'completed' ? 'paid off' : 'paid, then stopped'}
          </div>
        </div>
      </div>

      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--border)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={plan.months}
        aria-valuenow={plan.paidCount}
        aria-label={`${plan.paidCount} of ${plan.months} payments made`}
      >
        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${fraction * 100}%` }} />
      </div>

      <div className="muted mt-2 flex items-baseline justify-between text-xs">
        <span>
          {plan.paidCount} of {plan.months} paid · {formatCents(plan.paidCents)} of {formatCents(plan.totalCents)}
        </span>
        {plan.next ? <span>next {longDate(plan.next.date)}</span> : null}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <button className="muted text-xs underline decoration-dotted" onClick={() => setOpen(!open)}>
          {open ? 'Hide the schedule' : 'Show the schedule'}
        </button>
        {plan.status === 'active' && plan.canManage && !confirming ? (
          <button className="text-xs text-red-500" onClick={() => setConfirming(true)}>
            Stop this plan
          </button>
        ) : null}
      </div>

      {confirming ? (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-xs">
            No more payments will be charged. The {plan.paidCount} already charged stay
            in History. Use this if you paid it off early or returned it.
          </p>
          <div className="flex gap-2">
            <Button
              variant="danger"
              className="flex-1 !py-2 text-sm"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(plan.id, { onSuccess: () => setConfirming(false) })}
            >
              Stop charging
            </Button>
            <Button variant="secondary" className="flex-1 !py-2 text-sm" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
          <ErrorNote error={cancel.error} />
        </div>
      ) : null}

      {open ? (
        <ol className="mt-3 divide-y divide-[var(--border)] border-t border-[var(--border)] text-xs">
          {plan.payments.map((p) => (
            <li key={p.no} className="flex items-baseline justify-between py-1.5">
              <span className={p.posted ? 'muted' : ''}>
                {p.no}. {longDate(p.date)}
              </span>
              <span className="tnum">
                {formatCents(p.amountCents)}{' '}
                <span className="muted">
                  {p.posted ? '· paid' : plan.status === 'cancelled' ? '· not charged' : '· to come'}
                </span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </Card>
  );
}

function NewPlan({ onDone }: { onDone: () => void }) {
  const me = useMe();
  const accounts = useAccounts();
  const reference = useReference();
  const create = useCreatePlan();

  const timezone = me.data?.family.timezone ?? 'UTC';
  const today = dateOf(new Date(), timezone);
  const spendable = (accounts.data?.accounts ?? []).filter((a) => a.canSpend);
  const mine = spendable.find(
    (a) => a.account.kind === 'personal' && a.account.ownerUserId === me.data?.user.id,
  );

  const [description, setDescription] = useState('');
  const [total, setTotal] = useState('');
  const [months, setMonths] = useState('12');
  const [day, setDay] = useState(String(Number(today.slice(8, 10))));
  const [accountId, setAccountId] = useState(mine?.accountId ?? spendable[0]?.accountId ?? '');
  const [firstPeriod, setFirstPeriod] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [cardId, setCardId] = useState('');

  const totalCents = parseDollarsToCents(total);
  const monthsN = Number(months);
  const dayN = Number(day);
  const termsOk = totalCents !== null && totalCents > 0
    && Number.isInteger(monthsN) && monthsN >= 1 && monthsN <= 60
    && Number.isInteger(dayN) && dayN >= 1 && dayN <= 31
    && totalCents >= monthsN;
  const startPeriod = firstPeriod || (termsOk || (dayN >= 1 && dayN <= 31) ? defaultFirstPeriod(today, dayN || 1) : '');

  const schedule = termsOk
    ? paymentSchedule({ totalCents: totalCents!, months: monthsN, dayOfMonth: dayN, firstPeriod: startPeriod })
    : [];
  const first = schedule[0];
  const last = schedule[schedule.length - 1];
  const alreadyDue = schedule.filter((p) => p.date <= today);
  const valid = termsOk && description.trim().length > 0 && accountId !== '';

  const submit = () => {
    if (!valid) return;
    create.mutate(
      {
        accountId,
        description: description.trim(),
        totalCents: totalCents!,
        months: monthsN,
        dayOfMonth: dayN,
        firstPeriod: startPeriod,
        categoryId: categoryId || null,
        cardId: cardId || null,
      },
      { onSuccess: onDone },
    );
  };

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="font-medium">New payment plan</div>

      <Field label="What is it for">
        <TextInput
          value={description}
          maxLength={80}
          placeholder="e.g. Sofa, laptop"
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Total price">
          <TextInput
            value={total}
            inputMode="decimal"
            placeholder="0.00"
            onChange={(e) => setTotal(e.target.value)}
          />
        </Field>
        <Field label="Months">
          <TextInput
            value={months}
            inputMode="numeric"
            onChange={(e) => setMonths(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Day of the month" hint={dayN > 28 ? 'The last day, in shorter months.' : undefined}>
          <Select value={day} onChange={(e) => setDay(e.target.value)}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{ordinal(d)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Charge to">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {spendable.map((a) => (
              <option key={a.accountId} value={a.accountId}>{a.account.name}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="First payment"
        hint="Pick an earlier month if you have already made some payments."
      >
        <TextInput
          type="month"
          value={startPeriod}
          onChange={(e) => setFirstPeriod(e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">None</option>
            {(reference.data?.categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Card">
          <Select value={cardId} onChange={(e) => setCardId(e.target.value)}>
            <option value="">None</option>
            {(reference.data?.cards ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
      </div>

      {first && last ? (
        <div className="rounded-xl border border-[var(--border)] px-3 py-2.5 text-xs leading-relaxed">
          <strong>
            {schedule.length === 1
              ? `One payment of ${formatCents(first.amountCents)}`
              : `${schedule.length} payments of ${formatCents(first.amountCents)}`}
          </strong>
          {last.amountCents !== first.amountCents
            ? ` (the last is ${formatCents(last.amountCents)})`
            : ''}
          {schedule.length === 1
            ? ` on ${longDate(first.date)}.`
            : `, from ${longDate(first.date)} to ${longDate(last.date)}.`}
          {alreadyDue.length > 0 ? (
            <span className="text-amber-600 dark:text-amber-400">
              {' '}{alreadyDue.length === 1 ? 'The first one is' : `${alreadyDue.length} of them are`} already
              due and will be charged as soon as you save
              {alreadyDue.length > 1 || alreadyDue[0]!.period !== today.slice(0, 7)
                ? `, back to ${formatPeriod(alreadyDue[0]!.period)}`
                : ''}.
            </span>
          ) : null}
        </div>
      ) : null}

      <Hint>
        Each payment is taken from the account on its day, whether or not there is
        enough in it — the lender is owed either way. It shows up in History like any
        other spend.
      </Hint>

      <ErrorNote error={create.error} />

      <div className="flex gap-2">
        <Button className="flex-1" disabled={!valid || create.isPending} onClick={submit}>
          {create.isPending ? 'Saving…' : 'Start plan'}
        </Button>
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
      </div>
    </Card>
  );
}
