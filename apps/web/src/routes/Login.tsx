import { useEffect, useState } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { useQueryClient } from '@tanstack/react-query';
import { api, post } from '../lib/api';
import { Button, Card, ErrorNote, Field, TextInput } from '../components/ui';

interface Bootstrap {
  available: boolean;
  users: { id: string; displayName: string; role: string }[];
}

/**
 * Passkeys only. Sign-in is a single tap because credentials are discoverable —
 * the authenticator offers the right one without a username step.
 *
 * The "claim your name" list only appears while nobody in the family has a
 * passkey yet. After the first registration it disappears for good, and new
 * people join with an invite code generated in Admin.
 */
export function Login() {
  const qc = useQueryClient();
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<Bootstrap>('/auth/bootstrap').then(setBootstrap).catch(() => setBootstrap(null));
  }, []);

  const done = () => qc.invalidateQueries({ queryKey: ['me'] });

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const options = await post<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/auth/passkey/login/options');
      const assertion = await startAuthentication({ optionsJSON: options });
      await post('/auth/passkey/login/verify', assertion);
      await done();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function register(body: { code?: string; userId?: string }) {
    setBusy(true);
    setError(null);
    try {
      const options = await post<Parameters<typeof startRegistration>[0]['optionsJSON']>(
        '/auth/passkey/register/options',
        body,
      );
      const attestation = await startRegistration({ optionsJSON: options });
      await post('/auth/passkey/register/verify', attestation);
      await done();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Budjo</h1>
        <p className="muted mt-1 text-sm">Spending limits that sit above the cards.</p>
      </div>

      <ErrorNote error={error} />

      <Button onClick={signIn} disabled={busy} className="w-full">
        {busy ? 'One moment…' : 'Sign in with a passkey'}
      </Button>

      {bootstrap?.available && bootstrap.users.length > 0 ? (
        <Card className="p-4">
          <h2 className="text-sm font-semibold">First time here</h2>
          <p className="muted mt-1 text-xs">
            Nobody has set up a passkey yet. Pick your name to claim it — this option disappears
            once the first passkey exists.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {bootstrap.users.map((user) => (
              <Button
                key={user.id}
                variant="secondary"
                disabled={busy}
                onClick={() => register({ userId: user.id })}
                className="w-full text-left"
              >
                I’m {user.displayName}
              </Button>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="p-4">
        <Field label="Have an invite code?">
          <TextInput
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="4KP2-9WQ7"
            autoCapitalize="characters"
            autoCorrect="off"
          />
        </Field>
        <Button
          variant="secondary"
          className="mt-3 w-full"
          disabled={busy || code.trim().length < 4}
          onClick={() => register({ code: code.trim() })}
        >
          Set up my passkey
        </Button>
      </Card>
    </div>
  );
}
