import { useState } from 'react';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { formatCents } from '@budjo/shared';
import { api, del, post } from '../lib/api';
import { useAccounts, useMe } from '../lib/hooks';
import { Button, Card, ErrorNote, Hint, Spinner } from '../components/ui';

interface Passkey {
  id: string;
  nickname: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export function Settings() {
  const me = useMe();
  const accounts = useAccounts();
  const qc = useQueryClient();

  if (me.isLoading) return <Spinner />;
  const user = me.data?.user;
  const family = me.data?.family;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">You</h1>

      <Card className="p-4">
        <div className="text-sm font-medium">{user?.displayName}</div>
        <div className="muted text-xs">
          {user?.role === 'admin' ? 'Admin' : 'Member'} · {family?.timezone}
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">Your accounts</h2>
        <div className="mt-2 flex flex-col gap-1.5">
          {(accounts.data?.accounts ?? [])
            .filter((a) => a.canSpend)
            .map((a) => (
              <div key={a.accountId} className="flex justify-between text-sm">
                <span>{a.account.name}</span>
                <span className="tnum">{formatCents(a.availableCents)}</span>
              </div>
            ))}
        </div>
      </Card>

      <Passkeys />

      <Card className="p-4">
        <h2 className="text-sm font-semibold">Install Budjo</h2>
        <p className="muted mt-1 text-xs">
          On iPhone: Share → Add to Home Screen. On Android: menu → Install app.
          Installing is also what lets notifications work later.
        </p>
      </Card>

      <Button
        variant="danger"
        className="w-full"
        onClick={async () => {
          await post('/auth/logout');
          await qc.invalidateQueries();
        }}
      >
        Sign out
      </Button>
    </div>
  );
}

/**
 * The keys to your own account. Visible here rather than under Admin because
 * they are yours — and because there was previously no way to see what could
 * sign in as you, or to revoke a device you no longer have.
 */
function Passkeys() {
  const qc = useQueryClient();
  const [note, setNote] = useState<string | null>(null);

  const passkeys = useQuery({
    queryKey: ['passkeys'],
    queryFn: () => api<{ passkeys: Passkey[]; activeSessions: number }>('/me/passkeys'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => del(`/me/passkeys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['passkeys'] }),
  });

  const revokeOthers = useMutation({
    mutationFn: () => post<{ revoked: number }>('/me/sessions/revoke-others'),
    onSuccess: (res) => {
      setNote(res.revoked === 0
        ? 'No other devices were signed in.'
        : `Signed out ${res.revoked} other ${res.revoked === 1 ? 'device' : 'devices'}.`);
      void qc.invalidateQueries({ queryKey: ['passkeys'] });
    },
  });

  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'never';

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Passkeys</h2>
        <p className="muted mt-1 text-xs">
          Anything listed here can sign in as you. Remove one you no longer have.
        </p>
      </div>

      {passkeys.isLoading ? (
        <p className="muted text-xs">Loading…</p>
      ) : (
        <div className="flex flex-col gap-2">
          {(passkeys.data?.passkeys ?? []).map((key) => (
            <div key={key.id} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm">{key.nickname ?? 'Unnamed device'}</div>
                <div className="muted text-xs">
                  Added {when(key.createdAt)} · last used {when(key.lastUsedAt)}
                </div>
              </div>
              <Button
                variant="ghost"
                className="muted shrink-0 px-2 py-1 text-xs"
                disabled={remove.isPending || (passkeys.data?.passkeys.length ?? 0) <= 1}
                onClick={() => remove.mutate(key.id)}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      {(passkeys.data?.passkeys.length ?? 0) <= 1 ? (
        <Hint>
          This is your only passkey, so it can’t be removed — that would lock you out.
          Ask an admin for an invite code to add another device first.
        </Hint>
      ) : null}

      <ErrorNote error={remove.error ?? revokeOthers.error} />

      <div className="border-t border-[var(--border)] pt-3">
        <div className="muted mb-2 text-xs">
          Signed in on {passkeys.data?.activeSessions ?? 0}{' '}
          {passkeys.data?.activeSessions === 1 ? 'device' : 'devices'}.
        </div>
        <Button
          variant="secondary"
          className="w-full px-3 py-2 text-xs"
          disabled={revokeOthers.isPending}
          onClick={() => revokeOthers.mutate()}
        >
          Sign out my other devices
        </Button>
        {note ? <p className="muted mt-2 text-xs">{note}</p> : null}
      </div>
    </Card>
  );
}
