import { useState } from 'react';
import type { Account, Card as CardType, User } from '@budjo/shared';
import { formatCents, formatPeriod, parseDollarsToCents, periodOf } from '@budjo/shared';
import { api, del, patch, post } from '../lib/api';
import { useAdminMutation, useAdminOverview, type AdminOverview } from '../lib/hooks';
import { Button, Card, ErrorNote, Field, Select, Spinner, TextInput } from '../components/ui';

export function Admin() {
  const overview = useAdminOverview(true);
  if (overview.isLoading) return <Spinner />;
  if (overview.isError) return <ErrorNote error={overview.error} />;
  const data = overview.data!;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Admin</h1>
      <Section title="People">
        <People data={data} />
      </Section>
      <Section title="Accounts &amp; allocations">
        <Accounts data={data} />
      </Section>
      <Section title="Family settings">
        <FamilySettings data={data} />
      </Section>
      <Section title="Corrections">
        <Adjustments data={data} />
      </Section>
      <Section title="Cards">
        <Cards data={data} />
      </Section>
      <Section title="Categories">
        <Reference data={data} />
      </Section>
      <Section title="Data">
        <DataTools timezone={data.family.timezone} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-3.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="muted">{open ? '−' : '+'}</span>
      </button>
      {open ? <div className="border-t border-[var(--border)] p-4">{children}</div> : null}
    </Card>
  );
}

function People({ data }: { data: AdminOverview }) {
  const [invite, setInvite] = useState<{ name: string; code: string } | null>(null);
  const [adding, setAdding] = useState(false);

  const updateUser = useAdminMutation((input: { id: string; body: Partial<User> }) =>
    patch(`/admin/users/${input.id}`, input.body));
  const createInvite = useAdminMutation((userId: string) =>
    post<{ inviteCode: string }>('/admin/invites', { userId }));

  return (
    <div className="flex flex-col gap-3">
      {data.users.map((user) => (
        <UserRow
          key={user.id}
          user={user}
          onRename={(displayName) => updateUser.mutate({ id: user.id, body: { displayName } })}
          onToggleRole={() =>
            updateUser.mutate({
              id: user.id,
              body: { role: user.role === 'admin' ? 'member' : 'admin' },
            })
          }
          onInvite={async () => {
            const res = await createInvite.mutateAsync(user.id);
            setInvite({ name: user.displayName, code: res.inviteCode });
          }}
        />
      ))}

      <ErrorNote error={updateUser.error ?? createInvite.error} />

      {invite ? (
        <div className="rounded-xl border border-[var(--accent)] bg-[var(--accent)]/10 p-3">
          <div className="text-xs">Invite code for {invite.name} — shown once, valid 14 days:</div>
          <div className="tnum mt-1 text-2xl font-semibold tracking-widest">{invite.code}</div>
        </div>
      ) : null}

      {adding ? (
        <AddMember accounts={data.accounts} onDone={() => setAdding(false)} onInvite={setInvite} />
      ) : (
        <Button variant="secondary" className="w-full" onClick={() => setAdding(true)}>
          Add a family member
        </Button>
      )}
    </div>
  );
}

function UserRow({
  user, onRename, onToggleRole, onInvite,
}: {
  user: User;
  onRename: (displayName: string) => void;
  onToggleRole: () => void;
  onInvite: () => void;
}) {
  const [name, setName] = useState(user.displayName);
  const dirty = name.trim() !== user.displayName && name.trim().length > 0;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] p-3">
      <div className="flex items-center gap-2">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        <Button
          variant="secondary"
          className="px-3 py-2 text-xs"
          disabled={!dirty}
          onClick={() => onRename(name.trim())}
        >
          Rename
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="muted text-xs">{user.role} · {user.status}</span>
        <div className="flex shrink-0 gap-1.5">
          <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={onInvite}>
            Invite code
          </Button>
          <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={onToggleRole}>
            Make {user.role === 'admin' ? 'member' : 'admin'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Creates the user, their personal account, their allocation, joint access and
 * an invite code in one go — doing these separately is how someone ends up
 * with an account and no way to sign in.
 */
function AddMember({
  accounts, onDone, onInvite,
}: {
  accounts: Account[];
  onDone: () => void;
  onInvite: (i: { name: string; code: string }) => void;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [amount, setAmount] = useState('50');
  const [jointIds, setJointIds] = useState<string[]>([]);
  const [allowAdvance, setAllowAdvance] = useState(false);

  const create = useAdminMutation((body: unknown) =>
    post<{ inviteCode: string }>('/admin/members', body));

  const jointAccounts = accounts.filter((a) => a.kind === 'joint');

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] p-3">
      <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Role">
        <Select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member')}>
          <option value="member">Member — spends their own allowance only</option>
          <option value="admin">Admin — can change settings</option>
        </Select>
      </Field>
      <Field label="Monthly allowance" hint="Dollars. Editable later.">
        <TextInput value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} />
      </Field>

      {jointAccounts.length > 0 ? (
        <Field label="Joint access" hint="Off by default for kids.">
          <div className="flex flex-col gap-1">
            {jointAccounts.map((account) => (
              <label key={account.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={jointIds.includes(account.id)}
                  onChange={(e) =>
                    setJointIds(
                      e.target.checked
                        ? [...jointIds, account.id]
                        : jointIds.filter((id) => id !== account.id),
                    )
                  }
                />
                Can spend from {account.name}
              </label>
            ))}
          </div>
        </Field>
      ) : null}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={allowAdvance} onChange={(e) => setAllowAdvance(e.target.checked)} />
        Allow borrowing against next month
      </label>

      <ErrorNote error={create.error} />

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
        <Button
          className="flex-1"
          disabled={!name.trim() || create.isPending}
          onClick={async () => {
            const res = await create.mutateAsync({
              displayName: name.trim(),
              role,
              monthlyAllocationCents: parseDollarsToCents(amount) ?? 0,
              joinJointAccountIds: jointIds,
              allowAdvance,
            });
            onInvite({ name: name.trim(), code: res.inviteCode });
            onDone();
          }}
        >
          Create
        </Button>
      </div>
    </div>
  );
}

function Accounts({ data }: { data: AdminOverview }) {
  const period = periodOf(new Date(), data.family.timezone);
  const setAllocation = useAdminMutation((body: unknown) => post('/admin/allocations', body));
  const updateAccount = useAdminMutation((input: { id: string; body: unknown }) =>
    patch(`/admin/accounts/${input.id}`, input.body));
  const setAccess = useAdminMutation((body: unknown) => post('/admin/account-access', body));

  const currentAmount = (accountId: string) =>
    data.allocationRules.find((r) => r.accountId === accountId)?.amountCents ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <p className="muted text-xs">
        A new amount applies from {formatPeriod(period)} onward. Past months keep the amount
        they were given, so history stays explainable.
      </p>

      {data.accounts.map((account) => (
        <AccountEditor
          key={account.id}
          account={account}
          users={data.users}
          access={data.access}
          period={period}
          currentAmountCents={currentAmount(account.id)}
          onSaveAllocation={(cents) =>
            setAllocation.mutate({ accountId: account.id, amountCents: cents, effectiveFrom: period })
          }
          onSaveAccount={(body) => updateAccount.mutate({ id: account.id, body })}
          onSaveAccess={(userIds) => setAccess.mutate({ accountId: account.id, userIds })}
        />
      ))}

      <ErrorNote error={setAllocation.error ?? updateAccount.error ?? setAccess.error} />
    </div>
  );
}

function AccountEditor({
  account, users, access, period, currentAmountCents, onSaveAllocation, onSaveAccount, onSaveAccess,
}: {
  account: Account;
  users: User[];
  access: { accountId: string; userId: string }[];
  period: string;
  currentAmountCents: number;
  onSaveAllocation: (cents: number) => void;
  onSaveAccount: (body: unknown) => void;
  onSaveAccess: (userIds: string[]) => void;
}) {
  const [name, setName] = useState(account.name);
  const [amount, setAmount] = useState((currentAmountCents / 100).toFixed(2));
  const [cap, setCap] = useState(
    account.maxAdvanceCents === null ? '' : (account.maxAdvanceCents / 100).toFixed(2),
  );
  const allowed = access.filter((a) => a.accountId === account.id).map((a) => a.userId);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{account.name}</span>
        <span className="muted text-xs">{account.kind}</span>
      </div>

      <div className="flex items-end gap-2">
        <Field label="Shown on the home screen">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button
          variant="secondary"
          disabled={name.trim() === account.name || name.trim().length === 0}
          onClick={() => onSaveAccount({ name: name.trim() })}
        >
          Save
        </Button>
      </div>

      <div className="flex items-end gap-2">
        <Field label={`Monthly from ${period}`}>
          <TextInput value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Button
          variant="secondary"
          onClick={() => onSaveAllocation(parseDollarsToCents(amount) ?? 0)}
        >
          Save
        </Button>
      </div>

      <label className="mt-1 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={account.allowAdvance}
          onChange={(e) => onSaveAccount({ allowAdvance: e.target.checked })}
        />
        Allow advances
      </label>

      {account.allowAdvance ? (
        <div className="flex items-end gap-2">
          <Field label="Advance cap" hint="Blank means one month's allowance.">
            <TextInput value={cap} inputMode="decimal" onChange={(e) => setCap(e.target.value)} />
          </Field>
          <Button
            variant="secondary"
            onClick={() => onSaveAccount({ maxAdvanceCents: cap === '' ? null : parseDollarsToCents(cap) ?? 0 })}
          >
            Save
          </Button>
        </div>
      ) : null}

      {account.kind === 'joint' ? (
        <div className="mt-1">
          <div className="muted mb-1 text-xs font-medium tracking-wide uppercase">Who can spend</div>
          {users.map((user) => (
            <label key={user.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allowed.includes(user.id)}
                onChange={(e) =>
                  onSaveAccess(
                    e.target.checked
                      ? [...allowed, user.id]
                      : allowed.filter((id) => id !== user.id),
                  )
                }
              />
              {user.displayName}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FamilySettings({ data }: { data: AdminOverview }) {
  const [reserve, setReserve] = useState((data.family.reserveThresholdCents / 100).toFixed(2));
  const [hold, setHold] = useState(String(data.family.holdTtlHours));
  const [tz, setTz] = useState(data.family.timezone);
  const [editWindow, setEditWindow] = useState(String(data.family.editWindowHours));
  const save = useAdminMutation((body: unknown) => patch('/admin/family', body));

  return (
    <div className="flex flex-col gap-3">
      <Field label="Warn when a purchase leaves under" hint="The amber &ldquo;yes, but only just&rdquo; line.">
        <TextInput value={reserve} inputMode="decimal" onChange={(e) => setReserve(e.target.value)} />
      </Field>
      <Field label="Hold expires after (hours)">
        <TextInput value={hold} inputMode="numeric" onChange={(e) => setHold(e.target.value)} />
      </Field>
      <Field label="Edit entries in place for (hours)"
             hint="After this, changes to history are kept as corrections. 0 means always.">
        <TextInput value={editWindow} inputMode="numeric"
                   onChange={(e) => setEditWindow(e.target.value)} />
      </Field>
      <Field label="Timezone" hint="Decides when the 1st of the month happens.">
        <TextInput value={tz} onChange={(e) => setTz(e.target.value)} />
      </Field>
      <ErrorNote error={save.error} />
      <Button
        onClick={() =>
          save.mutate({
            reserveThresholdCents: parseDollarsToCents(reserve) ?? 0,
            holdTtlHours: Number(hold) || 48,
            editWindowHours: Number(editWindow) || 0,
            timezone: tz.trim(),
          })
        }
      >
        Save settings
      </Button>
    </div>
  );
}

function Adjustments({ data }: { data: AdminOverview }) {
  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const adjust = useAdminMutation((body: unknown) => post('/admin/adjustments', body));

  return (
    <div className="flex flex-col gap-3">
      <p className="muted text-xs">
        A correction is a new entry, never an edit — the original stays in history with the
        adjustment beside it.
      </p>
      <Field label="Account">
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </Field>
      <Field label="Direction">
        <Select value={direction} onChange={(e) => setDirection(e.target.value as 'add' | 'remove')}>
          <option value="add">Add to balance</option>
          <option value="remove">Take off balance</option>
        </Select>
      </Field>
      <Field label="Amount">
        <TextInput value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Reason" hint="Required — it shows up in history.">
        <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorNote error={adjust.error} />
      <Button
        disabled={!note.trim() || !amount.trim() || adjust.isPending}
        onClick={() => {
          const cents = parseDollarsToCents(amount) ?? 0;
          adjust.mutate({
            accountId,
            amountCents: direction === 'add' ? cents : -cents,
            note: note.trim(),
          });
          setAmount('');
          setNote('');
        }}
      >
        Post adjustment
      </Button>
    </div>
  );
}

/**
 * Full card management. The reward note is what the spend flow shows when it
 * suggests a card, and the statement close day is the number you actually want
 * when reconciling a bill against what you logged.
 */
function Cards({ data }: { data: AdminOverview }) {
  const [adding, setAdding] = useState(false);
  const update = useAdminMutation((input: { id: string; body: unknown }) =>
    patch(`/admin/cards/${input.id}`, input.body));
  const archive = useAdminMutation((id: string) => del(`/admin/cards/${id}`));
  const create = useAdminMutation((body: unknown) => post('/admin/cards', body));

  return (
    <div className="flex flex-col gap-3">
      {data.cards.map((card) => (
        <CardEditor
          key={card.id}
          card={card}
          onSave={(body) => update.mutate({ id: card.id, body })}
          onArchive={() => archive.mutate(card.id)}
        />
      ))}

      <ErrorNote error={update.error ?? archive.error ?? create.error} />

      {adding ? (
        <CardEditor
          key="new"
          card={{ id: '', name: '', issuer: null, last4: null, rewardNote: null,
                  statementCloseDay: null, dueDay: null }}
          isNew
          onSave={(body) => { create.mutate(body); setAdding(false); }}
          onArchive={() => setAdding(false)}
        />
      ) : (
        <Button variant="secondary" className="w-full" onClick={() => setAdding(true)}>
          Add a card
        </Button>
      )}
    </div>
  );
}

function CardEditor({
  card, onSave, onArchive, isNew = false,
}: {
  card: CardType;
  onSave: (body: unknown) => void;
  onArchive: () => void;
  isNew?: boolean;
}) {
  const [name, setName] = useState(card.name);
  const [issuer, setIssuer] = useState(card.issuer ?? '');
  const [last4, setLast4] = useState(card.last4 ?? '');
  const [reward, setReward] = useState(card.rewardNote ?? '');
  const [close, setClose] = useState(card.statementCloseDay?.toString() ?? '');
  const [due, setDue] = useState(card.dueDay?.toString() ?? '');
  const [open, setOpen] = useState(isNew);

  // Empty inputs must go back as null, not '' — last4 is validated as four
  // digits, and an empty string would be rejected rather than cleared.
  const blankToNull = (v: string) => (v.trim() === '' ? null : v.trim());
  const dayOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

  const body = {
    name: name.trim(),
    issuer: blankToNull(issuer),
    last4: blankToNull(last4),
    rewardNote: blankToNull(reward),
    statementCloseDay: dayOrNull(close),
    dueDay: dayOrNull(due),
  };

  const last4Invalid = last4.trim() !== '' && !/^\d{4}$/.test(last4.trim());
  const dayInvalid = (v: string) => v.trim() !== '' && !(Number(v) >= 1 && Number(v) <= 31);
  const invalid = name.trim() === '' || last4Invalid || dayInvalid(close) || dayInvalid(due);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-xl border border-[var(--border)] px-3 py-2.5 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm">{card.name}</span>
          <span className="muted block truncate text-xs">
            {[card.issuer, card.last4 ? `••${card.last4}` : null, card.rewardNote]
              .filter(Boolean).join(' · ') || 'No details yet'}
          </span>
        </span>
        <span className="muted shrink-0 pl-2">Edit</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] p-3">
      <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Issuer"><TextInput value={issuer} onChange={(e) => setIssuer(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Last 4" hint={last4Invalid ? 'Four digits, or blank' : undefined}>
          <TextInput value={last4} inputMode="numeric" maxLength={4}
                     onChange={(e) => setLast4(e.target.value)} />
        </Field>
        <Field label="Reward">
          <TextInput value={reward} placeholder="4x dining"
                     onChange={(e) => setReward(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Statement closes" hint="Day of month">
          <TextInput value={close} inputMode="numeric"
                     onChange={(e) => setClose(e.target.value)} />
        </Field>
        <Field label="Payment due" hint="Day of month">
          <TextInput value={due} inputMode="numeric"
                     onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button variant="danger" className="px-3 py-2 text-xs" onClick={onArchive}>
          {isNew ? 'Cancel' : 'Archive'}
        </Button>
        <Button className="flex-1" disabled={invalid} onClick={() => { onSave(body); setOpen(isNew); }}>
          {isNew ? 'Add card' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

function Reference({ data }: { data: AdminOverview }) {
  const [categoryName, setCategoryName] = useState('');
  const addCategory = useAdminMutation((body: unknown) => post('/admin/categories', body));
  const setRule = useAdminMutation((body: unknown) => post('/admin/card-rules', body));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="muted mb-2 text-xs font-medium tracking-wide uppercase">
          Category → card we mean to use
        </div>
        {data.categories.map((category) => (
          <div key={category.id} className="mb-1.5 flex items-center gap-2">
            <span className="w-28 shrink-0 truncate text-sm">{category.icon} {category.name}</span>
            <Select
              defaultValue=""
              onChange={(e) => setRule.mutate({ categoryId: category.id, cardId: e.target.value })}
            >
              <option value="" disabled>Pick a card…</option>
              {data.cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
            </Select>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <TextInput value={categoryName} placeholder="New category" onChange={(e) => setCategoryName(e.target.value)} />
        <Button
          variant="secondary"
          disabled={!categoryName.trim()}
          onClick={() => { addCategory.mutate({ name: categoryName.trim(), icon: '•', sortOrder: 99 }); setCategoryName(''); }}
        >
          Add
        </Button>
      </div>

      <ErrorNote error={addCategory.error ?? setRule.error} />
    </div>
  );
}

interface Snapshot { key: string; size: number; uploadedAt: string }

function DataTools({ timezone }: { timezone: string }) {
  const thisPeriod = periodOf(new Date(), timezone);
  const [audit, setAudit] = useState<Record<string, unknown>[] | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [backupsOn, setBackupsOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const loadSnapshots = async () => {
    const res = await api<{ enabled: boolean; snapshots: Snapshot[] }>('/admin/backups');
    setBackupsOn(res.enabled);
    setSnapshots(res.snapshots);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-[var(--border)] p-3">
        <h3 className="text-sm font-medium">Backups</h3>
        <p className="muted mt-1 text-xs">
          Every table is snapshotted to R2 each Sunday, keeping 12 weeks. This is
          the only copy of the ledger outside the live database.
        </p>
        <div className="mt-3 flex gap-2">
          <Button
            variant="secondary"
            className="flex-1 px-3 py-2 text-xs"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const res = await post<{ key: string; rows: number; bytes: number; pruned: number }>(
                  '/admin/backup',
                );
                setResult(
                  `Saved ${res.key} — ${res.rows} rows, ${(res.bytes / 1024).toFixed(1)} KB` +
                    (res.pruned ? `, ${res.pruned} old snapshot(s) removed` : ''),
                );
                await loadSnapshots();
              } catch (err) {
                setError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Backing up…' : 'Back up now'}
          </Button>
          <Button variant="secondary" className="flex-1 px-3 py-2 text-xs"
                  onClick={() => void loadSnapshots()}>
            Show snapshots
          </Button>
        </div>

        <ErrorNote error={error} />

        {backupsOn === false ? (
          <p className="muted mt-2 text-xs">Not switched on: no R2 bucket is bound.</p>
        ) : null}

        {snapshots ? (
          snapshots.length === 0 ? (
            <p className="muted mt-2 text-xs">No snapshots yet.</p>
          ) : (
            <div className="mt-2 max-h-40 overflow-y-auto text-xs">
              {snapshots.map((snap) => (
                <div key={snap.key} className="flex justify-between border-b border-[var(--border)] py-1.5">
                  <span>{snap.key.replace('snapshots/', '').replace('.json', '')}</span>
                  <span className="muted tnum">{(snap.size / 1024).toFixed(1)} KB</span>
                </div>
              ))}
            </div>
          )
        ) : null}
      </div>

      <a href="/api/admin/export?format=csv" download>
        <Button variant="secondary" className="w-full">Export everything as CSV</Button>
      </a>
      <a href={`/api/admin/export?format=csv&periodFrom=${thisPeriod}&periodTo=${thisPeriod}`} download>
        <Button variant="secondary" className="w-full">
          Export {formatPeriod(thisPeriod)} as CSV
        </Button>
      </a>
      <a href="/api/admin/export" target="_blank" rel="noreferrer">
        <Button variant="secondary" className="w-full">Export everything as JSON</Button>
      </a>
      <Button
        variant="secondary"
        onClick={async () => {
          const res = await post<{ allocationsPosted: number; advancesRepaid: number; checksExpired: number }>(
            '/admin/maintenance',
          );
          setResult(
            `Posted ${res.allocationsPosted} allocation(s), repaid ${res.advancesRepaid} advance(s), expired ${res.checksExpired} hold(s).`,
          );
        }}
      >
        Run the monthly job now
      </Button>
      {result ? <p className="muted text-xs">{result}</p> : null}

      <Button
        variant="secondary"
        onClick={async () => {
          const res = await api<{ entries: Record<string, unknown>[] }>('/admin/audit');
          setAudit(res.entries);
        }}
      >
        Show audit log
      </Button>

      {audit ? (
        <div className="max-h-72 overflow-y-auto text-xs">
          {audit.map((entry) => (
            <div key={String(entry.id)} className="border-b border-[var(--border)] py-1.5">
              <span className="muted">{String(entry.created_at).slice(0, 16).replace('T', ' ')}</span>{' '}
              {String(entry.actor_name ?? 'system')} · {String(entry.action)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
