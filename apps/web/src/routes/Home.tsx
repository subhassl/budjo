import { Link } from 'react-router-dom';
import type { AccountSummary } from '@budjo/shared';
import { formatCents, formatPeriod } from '@budjo/shared';
import { useAccounts, useMe, usePendingChecks } from '../lib/hooks';
import { Button, Card, ErrorNote, Spinner } from '../components/ui';
import { PendingList } from '../components/PendingList';

export function Home() {
  const me = useMe();
  const accounts = useAccounts();
  const pending = usePendingChecks();

  if (accounts.isLoading || me.isLoading) return <Spinner />;
  if (accounts.isError) return <ErrorNote error={accounts.error} />;

  const summaries = accounts.data?.accounts ?? [];
  const userId = me.data?.user.id;

  // Yours first, then the joint pot, then everyone else's.
  const mine = summaries.find((s) => s.account.kind === 'personal' && s.account.ownerUserId === userId);
  const joint = summaries.filter((s) => s.account.kind === 'joint');
  const others = summaries.filter((s) => s !== mine && s.account.kind !== 'joint');

  return (
    <div className="flex flex-col gap-4">
      {mine ? <PrimaryAccount summary={mine} /> : null}

      {joint.length > 0 || others.length > 0 ? (
        <Card className="divide-y divide-[var(--border)] overflow-hidden">
          {[...joint, ...others].map((summary) => (
            <AccountRow key={summary.accountId} summary={summary} />
          ))}
        </Card>
      ) : null}

      <div className="mt-2 flex flex-col gap-2">
        <Link to="/check">
          <Button className="w-full text-lg">Can I spend?</Button>
        </Link>
        <Link to="/check?quick=1">
          <Button variant="secondary" className="w-full">Log a spend I already made</Button>
        </Link>
      </div>

      <PendingList
        checks={pending.data?.checks ?? []}
        accounts={summaries}
        spendableAccountIds={me.data?.spendableAccountIds ?? []}
      />
    </div>
  );
}

function PrimaryAccount({ summary }: { summary: AccountSummary }) {
  const negative = summary.availableCents < 0;

  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between">
        <span className="muted text-sm">{summary.account.name}</span>
        <span className="muted text-xs">{formatPeriod(summary.period)}</span>
      </div>

      <div className={`tnum mt-1 text-5xl font-semibold tracking-tight ${negative ? 'text-red-500' : ''}`}>
        {formatCents(summary.availableCents)}
      </div>
      <div className="muted tnum mt-1 text-sm">
        {formatCents(summary.balanceCents)} balance
        {summary.holdCents > 0 ? ` · ${formatCents(summary.holdCents)} on hold` : ''}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
        <Stat label="Carried in" value={summary.carriedInCents} />
        <Stat label="Allocated" value={summary.allocatedCents} />
        <Stat label="Spent" value={summary.spentCents} />
      </div>

      {summary.outstandingAdvanceCents > 0 ? (
        <p className="muted mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          You borrowed {formatCents(summary.outstandingAdvanceCents)} against next month —
          it opens at {formatCents(summary.nextPeriodOpeningCents)}.
        </p>
      ) : null}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="muted text-xs">{label}</div>
      <div className="tnum mt-0.5 font-medium">{formatCents(value)}</div>
    </div>
  );
}

function AccountRow({ summary }: { summary: AccountSummary }) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5">
      <div>
        <div className="text-sm font-medium">{summary.account.name}</div>
        <div className="muted text-xs">
          {summary.canSpend ? 'You can spend from this' : 'View only'}
          {summary.holdCents > 0 ? ` · ${formatCents(summary.holdCents)} held` : ''}
        </div>
      </div>
      <div className={`tnum font-medium ${summary.availableCents < 0 ? 'text-red-500' : ''}`}>
        {formatCents(summary.availableCents)}
      </div>
    </div>
  );
}
