import { useState } from 'react';
import type { AccountSummary, LedgerEntry, LedgerType } from '@budjo/shared';
import {
  dateOf, formatCents, formatPeriod, nextPeriod, parseDollarsToCents, periodOf, prevPeriod,
} from '@budjo/shared';
import {
  useAccounts, useDeleteLedgerEntry, useEditLedgerEntry, useLedger, useMe, useReference,
  useVoidLedgerEntry,
} from '../lib/hooks';
import { Button, Card, Empty, ErrorNote, Field, Select, Spinner, TextInput } from '../components/ui';

type DateFilter = 'this' | 'last' | 'three' | 'all' | 'custom';

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
  const [range, setRange] = useState<DateFilter>('this');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [editing, setEditing] = useState<LedgerEntry | null>(null);

  const me = useMe();
  const accounts = useAccounts();
  const reference = useReference();

  const timezone = me.data?.family.timezone ?? 'UTC';
  const thisPeriod = periodOf(new Date(), timezone);

  // Month filters go through `period`, not timestamps: period is the month an
  // entry belongs to in our timezone, and an evening spend here is already the
  // next day in UTC.
  const filters =
    range === 'this' ? { periodFrom: thisPeriod, periodTo: thisPeriod }
    : range === 'last' ? { periodFrom: prevPeriod(thisPeriod), periodTo: prevPeriod(thisPeriod) }
    : range === 'three' ? { periodFrom: prevPeriod(prevPeriod(thisPeriod)), periodTo: thisPeriod }
    : range === 'custom' ? { from: customFrom || undefined, to: customTo || undefined }
    : {};

  const ledger = useLedger({ ...filters, accountId: accountId || undefined });

  // Only take over the page on the very first load; afterwards the previous
  // results stay put and we just dim them while the new filter arrives.
  if (ledger.isLoading && !ledger.data) return <Spinner />;
  if (ledger.isError) return <ErrorNote error={ledger.error} />;

  const refreshing = ledger.isFetching && !ledger.isFetchingNextPage;

  const entries = ledger.data?.pages.flatMap((p) => p.entries) ?? [];
  const loadedEverything = !ledger.hasNextPage;
  const net = entries.reduce((sum, e) => sum + e.amountCents, 0);
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
        options={[
          { value: 'this', label: formatPeriod(thisPeriod).split(' ')[0]! },
          { value: 'last', label: formatPeriod(prevPeriod(thisPeriod)).split(' ')[0]! },
          { value: 'three', label: 'Last 3 months' },
          { value: 'all', label: 'All time' },
          { value: 'custom', label: 'Custom' },
        ]}
        value={range}
        onChange={(v) => setRange(v as DateFilter)}
      />

      {range === 'custom' ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="From">
            <TextInput type="date" value={customFrom} max={dateOf(new Date(), timezone)}
                       onChange={(e) => setCustomFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <TextInput type="date" value={customTo} max={dateOf(new Date(), timezone)}
                       onChange={(e) => setCustomTo(e.target.value)} />
          </Field>
        </div>
      ) : null}

      {entries.length > 0 ? (
        <div className="flex items-baseline justify-between px-1">
          <span className="muted text-xs">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
            {loadedEverything ? '' : ' so far'}
          </span>
          {loadedEverything ? (
            <span className={`tnum text-xs font-medium ${net < 0 ? '' : 'text-emerald-500'}`}>
              net {formatCents(net, { sign: net > 0 })}
            </span>
          ) : null}
        </div>
      ) : null}

      {isAdmin ? (
        <p className="muted px-1 text-xs">Tap an entry to edit or correct it.</p>
      ) : null}

      <div className={refreshing ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
      {entries.length === 0 ? (
        <Empty>
          {range === 'all' ? 'Nothing here yet.' : 'Nothing in this range.'}
        </Empty>
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

      </div>

      {ledger.hasNextPage ? (
        <Button
          variant="secondary"
          className="w-full"
          disabled={ledger.isFetchingNextPage}
          onClick={() => void ledger.fetchNextPage()}
        >
          {ledger.isFetchingNextPage ? 'Loading…' : 'Load older entries'}
        </Button>
      ) : null}

      {editing ? (
        <EditSheet
          entry={editing}
          accounts={accounts.data?.accounts ?? []}
          categories={reference.data?.categories ?? []}
          cards={reference.data?.cards ?? []}
          timezone={me.data?.family.timezone ?? 'UTC'}
          editWindowHours={me.data?.family.editWindowHours ?? 48}
          alreadyReversed={reversed.has(editing.id)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * A row of pills instead of a dropdown. With a handful of accounts every option
 * is visible and one tap away, and the current filter is readable without
 * opening anything — a dropdown hides both.
 */
function Pills({
  options, value, onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
         style={{ scrollbarWidth: 'none' }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap transition ${
              active
                ? 'bg-[var(--accent)] font-medium text-black'
                : 'surface muted'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function EditSheet({
  entry, accounts, categories, cards, timezone, editWindowHours, alreadyReversed, onClose,
}: {
  entry: LedgerEntry;
  accounts: AccountSummary[];
  categories: { id: string; name: string; icon: string }[];
  cards: { id: string; name: string }[];
  timezone: string;
  editWindowHours: number;
  alreadyReversed: boolean;
  onClose: () => void;
}) {
  const edit = useEditLedgerEntry();
  const voidEntry = useVoidLedgerEntry();
  const deleteEntry = useDeleteLedgerEntry();

  const negative = entry.amountCents < 0;
  const [amount, setAmount] = useState((Math.abs(entry.amountCents) / 100).toFixed(2));
  const [accountId, setAccountId] = useState(entry.accountId);
  const [categoryId, setCategoryId] = useState(entry.categoryId ?? '');
  const [cardId, setCardId] = useState(entry.cardId ?? '');
  const [note, setNote] = useState(entry.note ?? '');
  const [occurredOn, setOccurredOn] = useState(entry.occurredAt.slice(0, 10));
  const [reason, setReason] = useState('');
  const [forceCorrection, setForceCorrection] = useState(false);

  const today = dateOf(new Date(), timezone);
  const editable = EDITABLE.includes(entry.type);
  const cents = parseDollarsToCents(amount);

  // Measured from when the row was created, not the date it carries, so
  // backdating a spend never pushes it out of its own window.
  const msLeft = Date.parse(entry.createdAt) + editWindowHours * 3_600_000 - Date.now();
  const withinWindow = msLeft > 0;
  const asCorrection = forceCorrection || !withinWindow;
  const hoursLeft = Math.max(0, Math.round(msLeft / 3_600_000));

  const canSave = editable && !alreadyReversed && cents !== null && cents > 0
    && (!asCorrection || reason.trim().length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={onClose}>
      <div
        className="surface max-h-[90vh] w-full overflow-y-auto rounded-t-2xl p-4"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">
            {editable && !alreadyReversed && withinWindow && !forceCorrection
              ? 'Edit this entry'
              : 'Correct this entry'}
          </h2>
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
            <Field
              label={asCorrection ? 'Why?' : 'Why? (optional)'}
              hint={asCorrection
                ? 'Required — it stays in history beside the original.'
                : 'Kept in the admin log, not shown in history.'}
            >
              <TextInput value={reason} onChange={(e) => setReason(e.target.value)}
                         placeholder="Wrong amount" />
            </Field>

            {withinWindow ? (
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={forceCorrection} className="mt-0.5"
                       onChange={(e) => setForceCorrection(e.target.checked)} />
                <span className="muted">
                  Leave a correction in history instead of editing in place.
                  Worth it when the change is more than a typo.
                </span>
              </label>
            ) : null}

            <ErrorNote error={edit.error ?? voidEntry.error ?? deleteEntry.error} />

            <div className="flex gap-2">
              <Button
                variant="danger"
                disabled={(asCorrection && !reason.trim()) || voidEntry.isPending || deleteEntry.isPending}
                onClick={async () => {
                  if (asCorrection) {
                    await voidEntry.mutateAsync({ id: entry.id, reason: reason.trim() });
                  } else {
                    await deleteEntry.mutateAsync(entry.id);
                  }
                  onClose();
                }}
              >
                {asCorrection ? 'Remove' : 'Delete'}
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
                    ...(reason.trim() ? { reason: reason.trim() } : {}),
                    ...(forceCorrection ? { forceCorrection: true } : {}),
                  });
                  onClose();
                }}
              >
                {asCorrection ? 'Save correction' : 'Save changes'}
              </Button>
            </div>
            <p className="muted text-xs">
              {asCorrection
                ? 'Nothing is overwritten: the original stays, with the correction recorded beside it.'
                : `Editable in place for another ${hoursLeft}h. After that, changes are kept as corrections.`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
