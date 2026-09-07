import { useState } from 'react';
import type { AccountSummary, SpendCheck } from '@budjo/shared';
import { formatCents, parseDollarsToCents } from '@budjo/shared';
import { useCancelCheck, useSettleCheck } from '../lib/hooks';
import { Button, Card, ErrorNote, TextInput } from './ui';

/**
 * Held checks waiting for their real amount.
 *
 * Only checks on accounts you can actually spend from appear: settling needs
 * spend access, so anyone else's would be a row of buttons that 403. Their
 * holds are still visible as the "on hold" figure on the balance card.
 */
export function PendingList({
  checks, accounts, spendableAccountIds,
}: {
  checks: SpendCheck[];
  accounts: AccountSummary[];
  spendableAccountIds: string[];
}) {
  const mine = checks.filter((c) => spendableAccountIds.includes(c.accountId));
  if (mine.length === 0) return null;

  const nameFor = (accountId: string) =>
    accounts.find((a) => a.accountId === accountId)?.account.name ?? '';

  return (
    <section className="flex flex-col gap-2">
      <h2 className="muted px-1 text-xs font-medium tracking-wide uppercase">
        Waiting to be settled
      </h2>
      {mine.map((check) => (
        <PendingRow key={check.id} check={check} accountName={nameFor(check.accountId)} />
      ))}
    </section>
  );
}

function PendingRow({ check, accountName }: { check: SpendCheck; accountName: string }) {
  const settle = useSettleCheck();
  const cancel = useCancelCheck();
  const [actual, setActual] = useState('');

  const hoursLeft = Math.max(
    0,
    Math.round((Date.parse(check.expiresAt) - Date.now()) / 3_600_000),
  );

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="tnum text-lg font-semibold">{formatCents(check.estimatedCents)}</div>
          <div className="muted truncate text-xs">
            {accountName}
            {check.merchant ? ` · ${check.merchant}` : ''} · {hoursLeft}h left
          </div>
        </div>
        <button
          onClick={() => cancel.mutate(check.id)}
          disabled={cancel.isPending}
          className="muted shrink-0 px-1 py-0.5 text-xs"
        >
          Didn’t spend it
        </button>
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
              // Blank means it cost what you thought it would.
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
