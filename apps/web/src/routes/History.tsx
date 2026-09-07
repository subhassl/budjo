import { useState } from 'react';
import type { LedgerEntry } from '@budjo/shared';
import { formatCents } from '@budjo/shared';
import { useAccounts, useLedger, useReference } from '../lib/hooks';
import { Card, Empty, ErrorNote, Select, Spinner } from '../components/ui';

const TYPE_LABEL: Record<LedgerEntry['type'], string> = {
  allocation: 'Monthly allocation',
  spend: 'Spend',
  refund: 'Refund',
  adjustment: 'Adjustment',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  advance: 'Advance',
  advance_repayment: 'Advance repaid',
  void: 'Correction',
};

export function History() {
  const [accountId, setAccountId] = useState<string>('');
  const accounts = useAccounts();
  const reference = useReference();
  const ledger = useLedger(accountId || undefined);

  if (ledger.isLoading) return <Spinner />;
  if (ledger.isError) return <ErrorNote error={ledger.error} />;

  const entries = ledger.data?.entries ?? [];
  const categoryName = (id: string | null) =>
    reference.data?.categories.find((c) => c.id === id)?.name;
  const cardName = (id: string | null) => reference.data?.cards.find((c) => c.id === id)?.name;
  const accountName = (id: string) =>
    accounts.data?.accounts.find((a) => a.accountId === id)?.account.name ?? '';

  const byDay = entries.reduce<Record<string, LedgerEntry[]>>((acc, entry) => {
    const day = entry.occurredAt.slice(0, 10);
    (acc[day] ??= []).push(entry);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">History</h1>

      <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        <option value="">All accounts I can see</option>
        {(accounts.data?.accounts ?? []).map((a) => (
          <option key={a.accountId} value={a.accountId}>{a.account.name}</option>
        ))}
      </Select>

      {entries.length === 0 ? (
        <Empty>Nothing here yet.</Empty>
      ) : (
        Object.entries(byDay).map(([day, dayEntries]) => (
          <section key={day}>
            <h2 className="muted mb-1.5 px-1 text-xs font-medium">
              {new Date(`${day}T12:00:00Z`).toLocaleDateString([], {
                weekday: 'short', month: 'short', day: 'numeric',
              })}
            </h2>
            <Card className="divide-y divide-[var(--border)] overflow-hidden">
              {dayEntries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm">
                      {entry.note || categoryName(entry.categoryId) || TYPE_LABEL[entry.type]}
                    </div>
                    <div className="muted truncate text-xs">
                      {accountName(entry.accountId)}
                      {entry.type !== 'spend' ? ` · ${TYPE_LABEL[entry.type]}` : ''}
                      {cardName(entry.cardId) ? ` · ${cardName(entry.cardId)}` : ''}
                    </div>
                  </div>
                  <div
                    className={`tnum shrink-0 pl-3 text-sm font-medium ${
                      entry.amountCents > 0 ? 'text-emerald-500' : ''
                    }`}
                  >
                    {formatCents(entry.amountCents, { sign: entry.amountCents > 0 })}
                  </div>
                </div>
              ))}
            </Card>
          </section>
        ))
      )}
    </div>
  );
}
