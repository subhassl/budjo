import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCents, formatPeriod, periodOf, prevPeriod } from '@budjo/shared';
import { useAccounts, useAnalytics, useMe, useReference } from '../lib/hooks';
import { ErrorNote, Spinner } from '../components/ui';
import {
  BalanceLine, CategoryBars, ChartFrame, EmptyPlot, Legend, MonthlyColumns, TableTwin,
} from '../components/charts';

type Range = '3' | '6' | '12' | 'all';

const RANGE_LABELS: Record<Range, string> = {
  '3': 'Last 3 months',
  '6': 'Last 6 months',
  '12': 'Last 12 months',
  all: 'All time',
};

/**
 * The analytics page.
 *
 * Ranges are whole months, not arbitrary days: every chart here buckets by
 * month, and a half-month bucket would misstate a trend rather than narrow it.
 * The filter row scopes everything below it, so no two figures on the page can
 * disagree about the same slice.
 */
export function Analytics() {
  const [range, setRange] = useState<Range>('6');
  const [accountId, setAccountId] = useState('');

  const me = useMe();
  const accounts = useAccounts();
  const reference = useReference();

  const timezone = me.data?.family.timezone ?? 'UTC';
  const thisPeriod = periodOf(new Date(), timezone);
  const monthsBack = range === 'all' ? null : Number(range) - 1;
  const periodFrom = monthsBack === null
    ? undefined
    : Array.from({ length: monthsBack }).reduce<string>((p) => prevPeriod(p), thisPeriod);

  const filters = {
    accountId: accountId || undefined,
    ...(periodFrom ? { periodFrom, periodTo: thisPeriod } : {}),
  };
  const summary = useAnalytics(filters);

  if (summary.isLoading && !summary.data) return <Spinner />;
  if (summary.isError) return <ErrorNote error={summary.error} />;

  const data = summary.data!;
  const refreshing = summary.isFetching;

  const totals = data.byPeriod.reduce(
    (acc, row) => ({
      allocated: acc.allocated + row.allocatedCents,
      spent: acc.spent + row.spentCents,
      other: acc.other + row.otherCents,
    }),
    { allocated: 0, spent: 0, other: 0 },
  );
  const saved = totals.allocated - totals.spent;

  // The balance at the end of each month, carried forward from what came before
  // the range — the point of the whole app, so it gets its own chart.
  let running = data.openingBalanceCents;
  const balancePoints = data.byPeriod.map((row) => {
    running += row.netCents;
    return { period: row.period, cents: running };
  });

  const nameOf = (id: string | null, kind: 'category' | 'card' | 'account') => {
    if (id === null) return kind === 'card' ? 'No card recorded' : 'Uncategorised';
    if (kind === 'category') return reference.data?.categories.find((c) => c.id === id)?.name ?? '—';
    if (kind === 'card') return reference.data?.cards.find((c) => c.id === id)?.name ?? '—';
    return accounts.data?.accounts.find((a) => a.accountId === id)?.account.name ?? '—';
  };

  const categoryRows = data.byCategory
    .filter((r) => r.spentCents > 0)
    .map((r) => ({ label: nameOf(r.id, 'category'), cents: r.spentCents, entries: r.entries }));
  const cardRows = data.byCard
    .filter((r) => r.spentCents > 0)
    .map((r) => ({ label: nameOf(r.id, 'card'), cents: r.spentCents, entries: r.entries }));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Analytics</h1>
          <p className="muted text-xs">
            {accountId ? nameOf(accountId, 'account') : 'All accounts you can see'} ·{' '}
            {range === 'all' ? 'all time' : `${RANGE_LABELS[range].toLowerCase()}`}
          </p>
        </div>
        <Link to="/history" className="muted text-sm">Back</Link>
      </header>

      {/* One filter row, above everything it scopes. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
        <Pills
          options={[
            { value: '', label: 'All' },
            ...(accounts.data?.accounts ?? []).map((a) => ({
              value: a.accountId, label: a.account.name,
            })),
          ]}
          value={accountId}
          onChange={setAccountId}
        />
        <Pills
          options={(['3', '6', '12', 'all'] as Range[]).map((r) => ({
            value: r, label: r === 'all' ? 'All time' : `${r}m`,
          }))}
          value={range}
          onChange={(v) => setRange(v as Range)}
        />
      </div>

      <div className={`flex flex-col gap-4 transition-opacity ${refreshing ? 'opacity-50' : ''}`}>
        {/* The hero: the one number this app exists to move. Exactly one per view. */}
        <section className="surface rounded-2xl p-5">
          <div className="muted text-xs">
            Put aside {range === 'all' ? 'so far' : `over ${RANGE_LABELS[range].toLowerCase()}`}
          </div>
          <div className={`mt-1 text-5xl font-semibold tracking-tight ${saved < 0 ? 'text-red-500' : ''}`}>
            {formatCents(saved)}
          </div>
          <div className="muted mt-1 text-xs">
            {formatCents(totals.allocated)} allocated less {formatCents(totals.spent)} spent
            {totals.other !== 0 ? (
              <>
                {' '}· the balance below also carries {formatCents(totals.other)} of
                transfers, advances and corrections
              </>
            ) : null}
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
            <Stat label="Allocated" value={totals.allocated} />
            <Stat label="Spent" value={totals.spent} />
            <Stat
              label="Kept"
              value={saved}
              hint={totals.allocated > 0
                ? `${Math.round((saved / totals.allocated) * 100)}% of it`
                : undefined}
            />
          </div>
        </section>

        <ChartFrame
          title="Balance at each month end"
          subtitle="Carried forward — this is the line that shows whether you are saving."
          note={balancePoints.length === 1
            ? 'One month in. This becomes a trend once there are a few more.'
            : undefined}
        >
          {balancePoints.length === 0 ? (
            <EmptyPlot>Nothing in this range yet.</EmptyPlot>
          ) : (
            <BalanceLine points={balancePoints} />
          )}
          <TableTwin
            columns={['Month', 'Balance']}
            rows={balancePoints.map((p) => [formatPeriod(p.period), formatCents(p.cents)])}
          />
        </ChartFrame>

        <ChartFrame
          title="Allocated against spent"
          subtitle="Bars above each other's month; the gap is what stayed put."
          legend={
            <Legend
              items={[
                { label: 'Allocated', color: 'var(--series-1)' },
                { label: 'Spent', color: 'var(--series-2)' },
              ]}
            />
          }
        >
          {data.byPeriod.length === 0 ? (
            <EmptyPlot>Nothing in this range yet.</EmptyPlot>
          ) : (
            <MonthlyColumns rows={data.byPeriod} />
          )}
          <TableTwin
            columns={['Month', 'Allocated', 'Spent', 'Other', 'Net']}
            rows={data.byPeriod.map((r) => [
              formatPeriod(r.period),
              formatCents(r.allocatedCents),
              formatCents(r.spentCents),
              formatCents(r.otherCents),
              formatCents(r.netCents),
            ])}
          />
        </ChartFrame>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartFrame title="Where it went" subtitle="By category, across the range.">
            {categoryRows.length === 0 ? (
              <EmptyPlot>No spending in this range.</EmptyPlot>
            ) : (
              <CategoryBars rows={categoryRows} />
            )}
            <TableTwin
              columns={['Category', 'Spent', 'Entries']}
              rows={categoryRows.map((r) => [r.label, formatCents(r.cents), r.entries])}
            />
          </ChartFrame>

          <ChartFrame
            title="Which card"
            subtitle="For checking a statement against what you logged."
          >
            {cardRows.length === 0 ? (
              <EmptyPlot>No spending in this range.</EmptyPlot>
            ) : (
              <CategoryBars rows={cardRows} />
            )}
            <TableTwin
              columns={['Card', 'Spent', 'Entries']}
              rows={cardRows.map((r) => [r.label, formatCents(r.cents), r.entries])}
            />
          </ChartFrame>
        </div>

        {!accountId && data.byAccount.length > 1 ? (
          <ChartFrame title="By account" subtitle="Allocated and spent per account.">
            <CategoryBars
              rows={data.byAccount
                .filter((a) => a.spentCents > 0)
                .sort((a, b) => b.spentCents - a.spentCents)
                .map((a) => ({ label: nameOf(a.id, 'account'), cents: a.spentCents }))}
            />
            <TableTwin
              columns={['Account', 'Allocated', 'Spent', 'Kept']}
              rows={data.byAccount.map((a) => [
                nameOf(a.id, 'account'),
                formatCents(a.allocatedCents),
                formatCents(a.spentCents),
                formatCents(a.allocatedCents - a.spentCents),
              ])}
            />
          </ChartFrame>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div>
      <div className="muted text-xs">{label}</div>
      <div className="mt-0.5 font-medium">{formatCents(value)}</div>
      {hint ? <div className="muted text-xs">{hint}</div> : null}
    </div>
  );
}

function Pills({
  options, value, onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: 'none' }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap transition ${
              active ? 'bg-[var(--accent)] font-medium text-black' : 'surface muted'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
