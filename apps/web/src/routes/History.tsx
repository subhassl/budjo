import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AccountSummary, LedgerEntry, LedgerType } from '@budjo/shared';
import {
  dateOf, formatCents, formatPeriod, nextPeriod, parseDollarsToCents, periodOf, prevPeriod,
} from '@budjo/shared';
import {
  useAccounts, useCardTotals, useCreateRefund, useDeleteLedgerEntry, useEditLedgerEntry,
  useLedger, useMe, useReference, useVoidLedgerEntry,
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
  const [view, setView] = useState<'entries' | 'cards'>('entries');

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

  const scoped = { ...filters, accountId: accountId || undefined };
  const ledger = useLedger(scoped);
  const cardTotals = useCardTotals(scoped, view === 'cards');

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
    const day = dateOf(new Date(entry.occurredAt), timezone);
    (acc[day] ??= []).push(entry);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">History</h1>
        <Link to="/analytics" className="text-sm text-[var(--accent)]">Analytics →</Link>
      </div>

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

      <Pills
        options={[
          { value: 'entries', label: 'Entries' },
          { value: 'cards', label: 'By card' },
        ]}
        value={view}
        onChange={(v) => setView(v as 'entries' | 'cards')}
      />
      </div>

      {range === 'custom' ? (
        <div className="grid grid-cols-2 gap-2 sm:max-w-md">
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

      {view === 'cards' ? (
        <ByCard
          totals={cardTotals.data?.totals ?? []}
          cards={reference.data?.cards ?? []}
          loading={cardTotals.isLoading}
        />
      ) : (
      <>
      <p className="muted px-1 text-xs">
        {isAdmin ? 'Tap an entry to record a return, edit or correct it.' : 'Tap a purchase to record a return.'}
      </p>

      <div
        className={`flex flex-col gap-5 transition-opacity ${refreshing ? 'opacity-50' : ''}`}
      >
      {entries.length === 0 ? (
        <Empty>
          {range === 'all' ? 'Nothing here yet.' : 'Nothing in this range.'}
        </Empty>
      ) : (
        Object.entries(byDay).map(([day, dayEntries]) => (
          <section key={day}>
            <h2 className="muted mb-2 px-1 text-xs font-medium">
              {new Date(`${day}T12:00:00Z`).toLocaleDateString([], {
                weekday: 'short', month: 'short', day: 'numeric',
              })}
            </h2>
            <Card className="divide-y divide-[var(--border)] overflow-hidden">
              {dayEntries.map((entry) => {
                const isReversed = reversed.has(entry.id);
                const flags = [
                  isReversed ? 'corrected' : null,
                  entry.refundedCents ? `${formatCents(entry.refundedCents)} returned` : null,
                ].filter(Boolean).join(' · ');
                const meta = [
                  categoryName(entry.categoryId),
                  cardName(entry.cardId),
                ].filter(Boolean).join(' · ');
                const dim = isReversed ? 'line-through opacity-50' : '';

                const row = (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-sm ${dim}`}>
                        {entry.note || categoryName(entry.categoryId) || TYPE_LABEL[entry.type]}
                      </div>
                      {/* One dense subtitle on a phone; the same facts get their
                          own columns once the screen can hold them. */}
                      <div className="muted truncate text-xs md:hidden">
                        {[accountName(entry.accountId),
                          entry.type !== 'spend' ? TYPE_LABEL[entry.type] : null,
                          cardName(entry.cardId), flags].filter(Boolean).join(' · ')}
                      </div>
                    </div>

                    <div className="muted hidden w-28 shrink-0 truncate text-xs md:block">
                      {accountName(entry.accountId)}
                    </div>
                    <div className="muted hidden w-44 shrink-0 truncate text-xs md:block">
                      {entry.type === 'spend' ? meta : TYPE_LABEL[entry.type]}
                    </div>
                    <div className="muted hidden w-36 shrink-0 truncate text-xs md:block">
                      {flags}
                    </div>

                    <div
                      className={`tnum w-28 shrink-0 pl-3 text-right text-sm font-medium ${
                        entry.amountCents > 0 ? 'text-emerald-500' : ''
                      } ${dim}`}
                    >
                      {formatCents(entry.amountCents, { sign: entry.amountCents > 0 })}
                    </div>
                  </>
                );

                return (
                  <button
                    key={entry.id}
                    onClick={() => setEditing(entry)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition active:opacity-60 md:hover:bg-black/[0.03] md:dark:hover:bg-white/[0.03]"
                  >
                    {row}
                  </button>
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
      </>
      )}

      {editing ? (
        <EditSheet
          entry={editing}
          accounts={accounts.data?.accounts ?? []}
          categories={reference.data?.categories ?? []}
          cards={reference.data?.cards ?? []}
          timezone={me.data?.family.timezone ?? 'UTC'}
          editWindowHours={me.data?.family.editWindowHours ?? 48}
          isAdmin={isAdmin}
          canSpendHere={(me.data?.spendableAccountIds ?? []).includes(editing.accountId)}
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
/**
 * What went on each card under the current filters — the number to hold up
 * against a statement. Includes the close and due days, since the question is
 * usually "does this month's Amex match?" rather than "what did I spend".
 */
function ByCard({
  totals, cards, loading,
}: {
  totals: { cardId: string | null; spentCents: number; entries: number }[];
  cards: { id: string; name: string; last4: string | null; statementCloseDay: number | null; dueDay: number | null }[];
  loading: boolean;
}) {
  if (loading) return <Spinner />;

  const withSpend = totals.filter((t) => t.spentCents !== 0);
  if (withSpend.length === 0) return <Empty>Nothing on any card in this range.</Empty>;

  const total = withSpend.reduce((sum, t) => sum + t.spentCents, 0);
  const ordinal = (day: number) => {
    const suffix = day % 10 === 1 && day !== 11 ? 'st'
      : day % 10 === 2 && day !== 12 ? 'nd'
      : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
    return `${day}${suffix}`;
  };

  return (
    <div className="flex flex-col gap-3">
      <Card className="divide-y divide-[var(--border)] overflow-hidden">
        {withSpend.map((row) => {
          const card = cards.find((c) => c.id === row.cardId);
          const detail = [
            card?.last4 ? `••${card.last4}` : null,
            card?.statementCloseDay ? `closes ${ordinal(card.statementCloseDay)}` : null,
            card?.dueDay ? `due ${ordinal(card.dueDay)}` : null,
          ].filter(Boolean).join(' · ');

          return (
            <div key={row.cardId ?? 'none'} className="flex items-center justify-between px-4 py-3.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {card?.name ?? 'No card recorded'}
                </div>
                <div className="muted truncate text-xs">
                  {row.entries} {row.entries === 1 ? 'entry' : 'entries'}
                  {detail ? ` · ${detail}` : ''}
                </div>
              </div>
              <div className="tnum shrink-0 pl-3 font-medium">{formatCents(row.spentCents)}</div>
            </div>
          );
        })}
      </Card>

      <div className="flex items-baseline justify-between px-1">
        <span className="muted text-xs">Total across cards</span>
        <span className="tnum text-sm font-semibold">{formatCents(total)}</span>
      </div>
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
  entry, accounts, categories, cards, timezone, editWindowHours, alreadyReversed,
  isAdmin, canSpendHere, onClose,
}: {
  entry: LedgerEntry;
  accounts: AccountSummary[];
  categories: { id: string; name: string; icon: string }[];
  cards: { id: string; name: string }[];
  timezone: string;
  editWindowHours: number;
  alreadyReversed: boolean;
  isAdmin: boolean;
  canSpendHere: boolean;
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
  const [occurredOn, setOccurredOn] = useState(dateOf(new Date(entry.occurredAt), timezone));
  const [reason, setReason] = useState('');
  const [forceCorrection, setForceCorrection] = useState(false);

  const refund = useCreateRefund();
  const refundedSoFar = entry.refundedCents ?? 0;
  const refundable = entry.type === 'spend' && !alreadyReversed
    ? Math.max(0, Math.abs(entry.amountCents) - refundedSoFar)
    : 0;
  const canRefund = canSpendHere && refundable > 0;
  const [refundAmount, setRefundAmount] = useState((refundable / 100).toFixed(2));
  const [refundOn, setRefundOn] = useState(dateOf(new Date(), timezone));
  const refundCents = parseDollarsToCents(refundAmount);

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
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:p-6"
      onClick={onClose}
    >
      <div
        className="surface max-h-[90vh] w-full overflow-y-auto rounded-t-2xl p-4 md:max-w-lg md:rounded-2xl"
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

        {canRefund ? (
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-[var(--border)] p-3">
            <div>
              <h3 className="text-sm font-medium">Record a return</h3>
              <p className="muted mt-0.5 text-xs">
                {formatCents(refundable)} of this purchase can still come back
                {refundedSoFar > 0 ? ` · ${formatCents(refundedSoFar)} already returned` : ''}.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Amount back">
                <TextInput value={refundAmount} inputMode="decimal"
                           onChange={(e) => setRefundAmount(e.target.value)} />
              </Field>
              <Field label="When">
                <TextInput type="date" value={refundOn} max={dateOf(new Date(), timezone)}
                           onChange={(e) => setRefundOn(e.target.value || dateOf(new Date(), timezone))} />
              </Field>
            </div>
            <ErrorNote error={refund.error} />
            <Button
              disabled={refund.isPending || refundCents === null || refundCents <= 0 || refundCents > refundable}
              onClick={async () => {
                await refund.mutateAsync({
                  ledgerEntryId: entry.id,
                  amountCents: refundCents ?? 0,
                  occurredOn: refundOn,
                });
                onClose();
              }}
            >
              {refund.isPending ? 'Recording…' : 'Record return'}
            </Button>
          </div>
        ) : null}

        {!isAdmin ? (
          canRefund ? null : (
            <p className="muted rounded-xl border border-[var(--border)] p-3 text-xs">
              {entry.type !== 'spend'
                ? 'Only a purchase can be returned.'
                : refundable === 0
                  ? 'This purchase has already been fully returned.'
                  : 'You can only record returns on your own accounts.'}
            </p>
          )
        ) : alreadyReversed ? (
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
            {refundedSoFar > 0 ? (
              <p className="muted text-xs">
                A return is recorded against this purchase, so its amount is locked. Remove the
                return first if the purchase itself was wrong.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
