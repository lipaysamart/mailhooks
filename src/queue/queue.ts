import type Database from "better-sqlite3";
import type { QueueJob } from "../types.ts";

export function enqueue(
  db: Database.Database,
  toAddress: string,
  webhookUrl: string,
  payload: string,
): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO queue (to_address, webhook_url, payload, status, attempts, next_retry_at, created_at, updated_at)
     VALUES (@to_address, @webhook_url, @payload, 'pending', 0, NULL, @now, @now)`,
  ).run({ to_address: toAddress, webhook_url: webhookUrl, payload, now });
}

export function dequeue(db: Database.Database): QueueJob | null {
  const row = db
    .prepare(
      `SELECT * FROM queue
       WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= @now)
       ORDER BY id ASC LIMIT 1`,
    )
    .get({ now: Date.now() }) as QueueJob | undefined;
  return row ?? null;
}

export function markDone(db: Database.Database, id: number): void {
  db.prepare(
    `UPDATE queue SET status = 'done', updated_at = @now WHERE id = @id`,
  ).run({
    id,
    now: Date.now(),
  });
}

export function scheduleRetry(
  db: Database.Database,
  id: number,
  attempts: number,
): void {
  const now = Date.now();
  const baseDelayMs = 60_000;
  const delayMs = baseDelayMs * 2 ** (attempts - 1);
  db.prepare(
    `UPDATE queue SET status = 'pending', attempts = @attempts, next_retry_at = @next_retry_at, updated_at = @now WHERE id = @id`,
  ).run({ id, attempts, next_retry_at: now + delayMs, now });
}

export function markFailed(db: Database.Database, id: number): void {
  db.prepare(
    `UPDATE queue SET status = 'failed', updated_at = @now WHERE id = @id`,
  ).run({
    id,
    now: Date.now(),
  });
}
