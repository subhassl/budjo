import { useQueryClient } from '@tanstack/react-query';
import { formatCents } from '@budjo/shared';
import { post } from '../lib/api';
import { useAccounts, useMe } from '../lib/hooks';
import { Button, Card, Spinner } from '../components/ui';

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
