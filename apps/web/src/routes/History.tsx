import { useState } from 'react';
import type { AccountSummary, LedgerEntry, LedgerType } from '@budjo/shared';
import { dateOf, formatCents, parseDollarsToCents } from '@budjo/shared';
import {
  useAccounts, useEditLedgerEntry, useLedger, useMe, useReference, useVoidLedgerEntry,
} from '../lib/hooks';
import { Button, Card, Empty, ErrorNote, Field, Select, Spinner, TextInput } from '../components/ui';

const TYPE_LABEL: Record<LedgerType, string> = {
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

/**
 * Only entries that stand alone can be corrected by hand. A transfer has two
 * legs, and advances are bound to a schedule the monthly job reads — those are
 * reversed by their own mechanisms. Mirrors domain/ledgerEdits.ts on the server,
 * which is what actually enforces it.
 */
const EDITABLE: LedgerType[] = ['spend', 'refund', 'adjustment'];

export function History() {
  const [accountId, setAccountId] = useState<string>('');
  const [editing, setEditing] = useState<LedgerEntry | null>(null);
  const me = useMe();
  const accounts = useAccounts();
  const reference = useReference();
  const ledger = useLedger(accountId || undefined);

  if (ledger.isLoading) return <Spinner />;
  if (ledger.isError) return <ErrorNote error={ledger.error} />;

  const entries = ledger.data?.entries ?? [];
  const isAdmin = me.data?.user.role === 'admin';
  const categoryName = (id: string | null) => reference.data?.categories.find((c) => c.id === id)?.name;
  const cardName = (id: string | null) => reference.data?.cards.find((c) => c.id === id)?.name;
  const accountName = (id: string) =>
    accounts.data?.accounts.find((a) => a.accountId === id)?.account.name ?? '';

  // An entry that has been corrected is shown struck through rather than
  // hidden, so the trail stays readable.
  const reversed = new Set(entries.filter((e) => e.voidsEntryId).map((e) => e.voidsEntryId!));

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

      {isAdmin ? (
        <p className="muted text-xs">Tap an entry to correct it.</p>
      ) : null}

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
              {dayEntries.map((entry) => {
                const isReversed = reversed.has(entry.id);
                const row = (
                  <>
                    <div className="min-w-0">
                      <div className={`truncate text-sm ${isReversed ? 'line-through opacity-50' : ''}`}>
                        {entry.note || categoryName(entry.categoryId) || TYPE_LABEL[entry.type]}
                      </div>
                      <div className="muted truncate text-xs">
                        {accountName(entry.accountId)}
                        {entry.type !== 'spend' ? ` · ${TYPE_LABEL[entry.type]}` : ''}
                        {cardName(entry.cardId) ? ` · ${cardName(entry.cardId)}` : ''}
                        {isReversed ? ' · corrected' : ''}
                      </div>
                    </div>
                    <div
                      className={`tnum shrink-0 pl-3 text-sm font-medium ${
                        entry.amountCents > 0 ? 'text-emerald-500' : ''
                      } ${isReversed ? 'line-through opacity-50' : ''}`}
                    >
                      {formatCents(entry.amountCents, { sign: entry.amountCents > 0 })}
                    </div>
                  </>
                );

                return isAdmin ? (
                  <button
                    key={entry.id}
                    onClick={() => setEditing(entry)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left active:opacity-60"
                  >
                    {row}
                  </button>
                ) : (
                  <div key={entry.id} className="flex items-center justify-between px-4 py-3">
                    {row}
                  </div>
                );
              })}
            </Card>
          </section>
        ))
      )}

      {editing ? (
        <EditSheet
          entry={editing}
          accounts={accounts.data?.accounts ?? []}
          categories={reference.data?.categories ?? []}
          cards={reference.data?.cards ?? []}
          timezone={me.data?.family.timezone ?? 'UTC'}
          alreadyReversed={reversed.has(editing.id)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function EditSheet({
  entry, accounts, categories, cards, timezone, alreadyReversed, onClose,
}: {
  entry: LedgerEntry;
  accounts: AccountSummary[];
  categories: { id: string; name: string; icon: string }[];
  cards: { id: string; name: string }[];
  timezone: string;
  alreadyReversed: boolean;
  onClose: () => void;
}) {
  const edit = useEditLedgerEntry();
  const voidEntry = useVoidLedgerEntry();

  const negative = entry.amountCents < 0;
  const [amount, setAmount] = useState((Math.abs(entry.amountCents) / 100).toFixed(2));
  const [accountId, setAccountId] = useState(entry.accountId);
  const [categoryId, setCategoryId] = useState(entry.categoryId ?? '');
  const [cardId, setCardId] = useState(entry.cardId ?? '');
  const [note, setNote] = useState(entry.note ?? '');
  const [occurredOn, setOccurredOn] = useState(entry.occurredAt.slice(0, 10));
  const [reason, setReason] = useState('');

  const today = dateOf(new Date(), timezone);
  const editable = EDITABLE.includes(entry.type);
  const cents = parseDollarsToCents(amount);
  const canSave = editable && !alreadyReversed && cents !== null && cents > 0 && reason.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={onClose}>
      <div
        className="surface max-h-[90vh] w-full overflow-y-auto rounded-t-2xl p-4"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Correct this entry</h2>
          <button onClick={onClose} className="muted text-sm">Close</button>
        </div>

        {alreadyReversed ? (
          <p className="muted mb-3 rounded-xl border border-[var(--border)] p-3 text-xs">
            This entry has already been corrected. Edit the replacement instead.
          </p>
        ) : !editable ? (
          <p className="muted mb-3 rounded-xl border border-[var(--border)] p-3 text-xs">
            {entry.type === 'transfer_in' || entry.type === 'transfer_out'
              ? 'A transfer has two sides. Reverse it with a transfer the other way.'
              : entry.type === 'allocation'
                ? 'Change the monthly amount under Accounts — that posts its own correction.'
                : entry.type === 'void'
                  ? 'This entry is already a correction.'
                  : 'Advances are settled by the monthly job, not edited by hand.'}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="Amount">
              <TextInput value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Date" hint="Moves it into that month's totals.">
              <TextInput type="date" value={occurredOn} max={today}
                         onChange={(e) => setOccurredOn(e.target.value || today)} />
            </Field>
            <Field label="Account">
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.accountId} value={a.accountId}>{a.account.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Category">
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">None</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Card">
              <Select value={cardId} onChange={(e) => setCardId(e.target.value)}>
                <option value="">None</option>
                {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Description">
              <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <Field label="Why?" hint="Required — it stays in history beside the original.">
              <TextInput value={reason} onChange={(e) => setReason(e.target.value)}
                         placeholder="Wrong amount" />
            </Field>

            <ErrorNote error={edit.error ?? voidEntry.error} />

            <div className="flex gap-2">
              <Button
                variant="danger"
                disabled={!reason.trim() || voidEntry.isPending}
                onClick={async () => {
                  await voidEntry.mutateAsync({ id: entry.id, reason: reason.trim() });
                  onClose();
                }}
              >
                Remove
              </Button>
              <Button
                className="flex-1"
                disabled={!canSave || edit.isPending}
                onClick={async () => {
                  await edit.mutateAsync({
                    id: entry.id,
                    amountCents: negative ? -(cents ?? 0) : cents ?? 0,
                    accountId,
                    categoryId: categoryId || null,
                    cardId: cardId || null,
                    note: note.trim() || null,
                    occurredOn,
                    reason: reason.trim(),
                  });
                  onClose();
                }}
              >
                Save correction
              </Button>
            </div>
            <p className="muted text-xs">
              Nothing is overwritten: the original stays, with the correction recorded beside it.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
