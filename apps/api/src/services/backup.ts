/**
 * Weekly snapshot of the whole database to R2.
 *
 * This is a financial record with no other copy: a bad migration or a mistaken
 * bulk delete would otherwise be unrecoverable. R2's free tier is 10GB and a
 * snapshot here is measured in kilobytes, so retention is generous.
 *
 * Credentials are included — they are WebAuthn *public* keys, useless to an
 * attacker on their own, and omitting them would make a restore leave both of
 * you locked out of the app.
 */
const TABLES = [
  'family', 'users', 'accounts', 'account_access', 'credentials', 'invites',
  'allocation_rules', 'categories', 'cards', 'category_card_rules',
  'spend_checks', 'ledger_entries', 'advances', 'transfer_requests',
  'balance_snapshots', 'audit_log',
];

const RETAIN_WEEKS = 12;

export interface BackupResult {
  key: string;
  bytes: number;
  rows: number;
  pruned: number;
}

export async function runBackup(
  db: D1Database,
  bucket: R2Bucket,
  now = new Date(),
): Promise<BackupResult> {
  const data: Record<string, unknown[]> = {};
  let rows = 0;

  for (const table of TABLES) {
    // Table names come from the constant above, never from input.
    const { results } = await db.prepare(`SELECT * FROM ${table}`).all();
    data[table] = results;
    rows += results.length;
  }

  const body = JSON.stringify(
    { takenAt: now.toISOString(), schemaVersion: 3, rows, tables: data },
    null,
    2,
  );
  const key = `snapshots/${now.toISOString().slice(0, 10)}.json`;

  await bucket.put(key, body, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { rows: String(rows), takenAt: now.toISOString() },
  });

  return { key, bytes: body.length, rows, pruned: await prune(bucket, now) };
}

/** Keep the most recent snapshots; drop anything older than the retention window. */
async function prune(bucket: R2Bucket, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RETAIN_WEEKS * 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  let pruned = 0;
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix: 'snapshots/', cursor });
    const stale = listed.objects
      .map((o) => o.key)
      .filter((key) => (key.slice('snapshots/'.length, -'.json'.length)) < cutoff);
    if (stale.length > 0) {
      await bucket.delete(stale);
      pruned += stale.length;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return pruned;
}
