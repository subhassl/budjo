import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { AccountSummary, Remedy } from '@budjo/shared';
import { dateOf, formatCents, parseDollarsToCents } from '@budjo/shared';
import {
  useAccounts, useAdvance, useCreateCheck, useMe, useQuickSpend, useReference, useRepriceCheck,
  useSettleCheck, type CheckResult,
} from '../lib/hooks';
import { Button, Card, ErrorNote, Field, Hint, Spinner, TextInput } from '../components/ui';

type Step = 'amount' | 'details' | 'verdict';

/**
 * The core flow: amount, then account, then category (which suggests the card),
 * then a full-screen verdict. Choosing Mine vs Joint is a deliberate tap — the
 * app never guesses, because only the person in the shop knows.
 */
export function SpendCheck() {
  const [params] = useSearchParams();
  const quickMode = params.get('quick') === '1';
  const navigate = useNavigate();

  const me = useMe();
  const accounts = useAccounts();
  const reference = useReference();
  const createCheck = useCreateCheck();
  const quickSpend = useQuickSpend();

  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [merchant, setMerchant] = useState('');
  const [outcome, setOutcome] = useState<CheckResult | null>(null);
  // Only meaningful when logging after the fact — a pre-approval is by
  // definition about to happen, so the field is hidden there.
  const today = dateOf(new Date(), me.data?.family.timezone ?? 'UTC');
  const [occurredOn, setOccurredOn] = useState(today);

  const spendable = useMemo(
    () => (accounts.data?.accounts ?? []).filter((a) => a.canSpend),
    [accounts.data],
  );

  if (accounts.isLoading || reference.isLoading || me.isLoading) return <Spinner />;

  const cents = parseDollarsToCents(amount) ?? 0;
  const chosenAccount = spendable.find((a) => a.accountId === (accountId ?? spendable[0]?.accountId));
  const categories = reference.data?.categories ?? [];
  const cards = reference.data?.cards ?? [];

  function pickCategory(id: string) {
    setCategoryId(id);
    // The nudge toward the card we meant to use for this category.
    const suggested = reference.data?.cardRules[id];
    if (suggested) setCardId(suggested);
  }

  async function submit() {
    if (!chosenAccount || cents <= 0) return;
    const input = {
      accountId: chosenAccount.accountId,
      estimatedCents: cents,
      categoryId,
      cardId,
      merchant: merchant.trim() || null,
    };
    const result = quickMode
      ? await quickSpend.mutateAsync({ ...input, occurredOn })
      : await createCheck.mutateAsync(input);
    setOutcome(result);
    setStep('verdict');
  }

  if (step === 'verdict' && outcome) {
    return (
      <Verdict
        outcome={outcome}
        accounts={spendable}
        quickMode={quickMode}
        onRetryOutcome={setOutcome}
        onDone={() => navigate('/')}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            {quickMode ? 'Log a spend' : 'Can I spend?'}
          </h1>
          <p className="muted text-xs">
            {quickMode
              ? 'Records money you have already paid.'
              : 'Roughly what you’re about to spend — you’ll confirm the real amount after.'}
          </p>
        </div>
        <Link to="/" className="muted text-sm">Cancel</Link>
      </header>

      <div className="text-center">
        <div className={`tnum text-5xl font-semibold tracking-tight ${cents > 0 ? '' : 'muted'}`}>
          {formatCents(cents)}
        </div>
      </div>

      {step === 'amount' ? (
        <>
          <Keypad value={amount} onChange={setAmount} />
          <Button className="w-full" disabled={cents <= 0} onClick={() => setStep('details')}>
            Next
          </Button>
        </>
      ) : (
        <>
          {spendable.length > 1 ? (
            <section>
              <h2 className="muted mb-2 text-xs font-medium tracking-wide uppercase">From</h2>
              <div className="grid grid-cols-2 gap-2">
                {spendable.map((account) => {
                  const active = account.accountId === chosenAccount?.accountId;
                  return (
                    <button
                      key={account.accountId}
                      onClick={() => setAccountId(account.accountId)}
                      className={`surface rounded-xl px-3 py-3 text-left ${
                        active ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : ''
                      }`}
                    >
                      <div className="text-sm font-medium">{account.account.name}</div>
                      <div className="muted tnum text-xs">{formatCents(account.availableCents)} available</div>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section>
            <h2 className="muted mb-2 text-xs font-medium tracking-wide uppercase">On</h2>
            <div className="grid grid-cols-4 gap-2">
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => pickCategory(category.id)}
                  className={`surface flex flex-col items-center gap-1 rounded-xl px-1 py-3 ${
                    categoryId === category.id ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : ''
                  }`}
                >
                  <span className="text-xl leading-none">{category.icon}</span>
                  <span className="text-[10px] leading-tight">{category.name}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="muted mb-2 text-xs font-medium tracking-wide uppercase">Card</h2>
            <div className="flex flex-wrap gap-2">
              {cards.map((card) => (
                <button
                  key={card.id}
                  onClick={() => setCardId(card.id)}
                  className={`surface rounded-xl px-3 py-2 text-xs ${
                    cardId === card.id ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : ''
                  }`}
                >
                  {card.name}
                  {cardId === card.id && card.rewardNote ? (
                    <span className="muted block text-[10px]">{card.rewardNote}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </section>

          {quickMode ? (
            <Field label="When" hint={occurredOn === today ? undefined : 'Counts towards that month.'}>
              <TextInput
                type="date"
                value={occurredOn}
                max={today}
                onChange={(e) => setOccurredOn(e.target.value || today)}
              />
            </Field>
          ) : null}

          <TextInput
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder="Where? (optional)"
          />

          <ErrorNote error={createCheck.error ?? quickSpend.error} />

          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep('amount')}>Back</Button>
            <Button
              className="flex-1"
              disabled={createCheck.isPending || quickSpend.isPending}
              onClick={submit}
            >
              {createCheck.isPending || quickSpend.isPending
                ? 'Checking…'
                : quickMode ? 'Log it' : 'Check'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Keypad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const press = (key: string) => {
    if (key === '⌫') return onChange(value.slice(0, -1));
    if (key === '.' && value.includes('.')) return;
    const next = value + key;
    if (parseDollarsToCents(next) === null && next !== '.') return;
    onChange(next === '.' ? '0.' : next);
  };

  return (
    <div className="grid grid-cols-3 gap-2">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((key) => (
        <button
          key={key}
          onClick={() => press(key)}
          className="surface tnum rounded-2xl py-5 text-2xl active:scale-[0.97]"
        >
          {key}
        </button>
      ))}
    </div>
  );
}

function Verdict({
  outcome, accounts, quickMode, onRetryOutcome, onDone,
}: {
  outcome: CheckResult;
  accounts: AccountSummary[];
  quickMode: boolean;
  onRetryOutcome: (r: CheckResult) => void;
  onDone: () => void;
}) {
  const settle = useSettleCheck();
  const reprice = useRepriceCheck();
  const advance = useAdvance();
  const createCheck = useCreateCheck();
  const [actual, setActual] = useState('');

  const { check, result, remedies } = outcome;
  const tone = {
    approved: {
      bg: 'bg-emerald-500/15 border-emerald-500/30',
      text: 'text-emerald-500',
      title: 'Go ahead',
      meaning: 'You have room for this with plenty left over.',
    },
    tight: {
      bg: 'bg-amber-500/15 border-amber-500/30',
      text: 'text-amber-500',
      title: 'Yes, but only just',
      meaning: 'You can, but it leaves you near the bottom for the rest of the month.',
    },
    denied: {
      bg: 'bg-red-500/15 border-red-500/30',
      text: 'text-red-500',
      title: 'Not this time',
      meaning: 'More than this account has available right now.',
    },
  }[result.decision];

  async function useRemedy(remedy: Remedy) {
    if (remedy.kind === 'switch_account' && remedy.accountId) {
      onRetryOutcome(await reprice.mutateAsync({ id: check.id, accountId: remedy.accountId }));
      return;
    }
    if (remedy.kind === 'advance' && remedy.accountId) {
      // Borrow exactly what's missing, then re-run the same check.
      await advance.mutateAsync({ accountId: remedy.accountId, amountCents: remedy.shortfallCents });
      onRetryOutcome(
        await createCheck.mutateAsync({
          accountId: remedy.accountId,
          estimatedCents: check.estimatedCents,
          categoryId: check.categoryId,
          cardId: check.cardId,
          merchant: check.merchant,
        }),
      );
    }
  }

  const settled = check.status === 'settled';
  const accountName = accounts.find((a) => a.accountId === check.accountId)?.account.name ?? 'that account';

  return (
    <div className="flex flex-col gap-4">
      <div className={`rounded-2xl border p-6 text-center ${tone.bg}`}>
        <div className={`text-xs font-semibold tracking-widest uppercase ${tone.text}`}>{tone.title}</div>
        <div className="tnum mt-2 text-5xl font-semibold tracking-tight">
          {formatCents(check.actualCents ?? check.estimatedCents)}
        </div>
        <div className="muted mt-2 text-sm">
          {result.decision === 'denied'
            ? `${formatCents(result.shortfallCents)} more than ${accountName} has`
            : `${formatCents(result.remainingCents)} left in ${accountName} afterwards`}
        </div>
        <div className="muted mt-1 text-xs">{tone.meaning}</div>
      </div>

      {result.decision === 'denied' ? (
        <>
          {remedies.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Hint>
                {remedies.some((r) => r.kind === 'switch_account')
                  && remedies.some((r) => r.kind === 'advance')
                  ? 'You could put it on another account, or borrow it from next month.'
                  : remedies.some((r) => r.kind === 'switch_account')
                    ? 'Another account you can spend from has enough for this.'
                    : 'You can borrow this from next month — it comes off your next allowance.'}
              </Hint>
              {remedies.map((remedy) => (
                <Button
                  key={`${remedy.kind}-${remedy.accountId}`}
                  variant="secondary"
                  className="w-full"
                  disabled={reprice.isPending || advance.isPending || createCheck.isPending}
                  onClick={() => void useRemedy(remedy)}
                >
                  {remedy.label}
                  {remedy.availableCents !== undefined ? (
                    <span className="muted tnum block text-xs">
                      {formatCents(remedy.availableCents)} available
                    </span>
                  ) : null}
                </Button>
              ))}
            </div>
          ) : null}

          <Card className="p-4">
            <p className="muted text-xs leading-relaxed">
              There’s no override — that’s the point of the limit.{' '}
              {remedies.length > 0
                ? 'If none of the above works, someone'
                : 'Someone'}{' '}
              else can send you money from their own balance, or it waits until next
              month’s allowance lands.
            </p>
          </Card>
          <ErrorNote error={reprice.error ?? advance.error ?? createCheck.error} />
        </>
      ) : settled || quickMode ? (
        <Card className="p-4">
          <p className="text-sm">Recorded.</p>
          <Hint>
            Your balance has moved and it’s in History. Nothing else to do.
          </Hint>
        </Card>
      ) : (
        <Card className="flex flex-col gap-3 p-4">
          <p className="text-sm">
            <strong>Nothing has been recorded yet.</strong> The amount is held until{' '}
            {new Date(check.expiresAt).toLocaleString([], { weekday: 'short', hour: 'numeric' })},
            so it can’t be spent twice.
          </p>
          <Hint>
            Settle it with what it actually cost — after tax and tip it rarely matches.
            You can do this now or later from the home screen, and if you forget we’ll
            ask you there.
          </Hint>
          <div className="flex gap-2">
            <TextInput
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              inputMode="decimal"
              placeholder={formatCents(check.estimatedCents)}
            />
            <Button
              disabled={settle.isPending}
              onClick={async () => {
                const cents = parseDollarsToCents(actual);
                await settle.mutateAsync({
                  id: check.id,
                  actualCents: cents ?? check.estimatedCents,
                });
                onDone();
              }}
            >
              Settle
            </Button>
          </div>
          <ErrorNote error={settle.error} />
        </Card>
      )}

      <Button variant="ghost" className="w-full" onClick={onDone}>Done</Button>
    </div>
  );
}
