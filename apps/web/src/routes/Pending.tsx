import { useState } from 'react';
import type { SpendCheck } from '@budjo/shared';
import { formatCents, parseDollarsToCents } from '@budjo/shared';
import { useAccounts, useCancelCheck, usePendingChecks, useSettleCheck } from '../lib/hooks';
import { Button, Card, Empty, ErrorNote, Spinner, TextInput } from '../components/ui';

export function Pending() {
  const pending = usePendingChecks();
  const accounts = useAccounts();

  if (pending.isLoading) return <Spinner />;
  if (pending.isError) return <ErrorNote error={pending.error} />;

  const checks = pending.data?.checks ?? [];
  const nameFor = (accountId: string) =>
    accounts.data?.accounts.find((a) => a.accountId === accountId)?.account.name ?? '';

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Pending</h1>
      {checks.length === 0 ? (
        <Empty>Nothing waiting to be settled.</Empty>
      ) : (
        checks.map((check) => (
          <PendingRow key={check.id} check={check} accountName={nameFor(check.accountId)} />
        ))
      )}
    </div>
  );
}

function PendingRow({ check, accountName }: { check: SpendCheck; accountName: string }) {
  const settle = useSettleCheck();
  const cancel = useCancelCheck();
  const [actual, setActual] = useState('');

  const expires = new Date(check.expiresAt);
  const hoursLeft = Math.max(0, Math.round((expires.getTime() - Date.now()) / 3_600_000));

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="tnum text-lg font-semibold">{formatCents(check.estimatedCents)}</div>
          <div className="muted text-xs">
            {accountName}
            {check.merchant ? ` · ${check.merchant}` : ''} · held {hoursLeft}h more
          </div>
        </div>
        <Button variant="ghost" onClick={() => cancel.mutate(check.id)} className="muted px-2 py-1 text-xs">
          Cancel
        </Button>
      </div>

      <div className="flex gap-2">
        <TextInput
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          inputMode="decimal"
          placeholder={`Actual (${formatCents(check.estimatedCents)})`}
        />
        <Button
          disabled={settle.isPending}
          onClick={() =>
            settle.mutate({
              id: check.id,
              actualCents: parseDollarsToCents(actual) ?? check.estimatedCents,
            })
          }
        >
          Settle
        </Button>
      </div>
      <ErrorNote error={settle.error ?? cancel.error} />
    </Card>
  );
}
