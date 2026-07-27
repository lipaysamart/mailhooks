import type Database from "better-sqlite3";
import type { Config } from "../config/config.ts";
import {
  dequeue,
  markDone,
  markFailed,
  scheduleRetry,
} from "../queue/queue.ts";
import { sendWebhook } from "../webhook/sender.ts";

export const MAX_RETRIES = 5;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function startWorker(
  config: Config,
  db: Database.Database,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    try {
      const job = dequeue(db);

      if (!job) {
        await sleep(5_000, signal);
        continue;
      }

      const result = await sendWebhook(
        job.webhook_url,
        job.payload,
      );

      if (result.ok) {
        try {
          markDone(db, job.id);
        } catch (err) {
          console.error(
            `[worker] Job ${job.id} delivered but markDone failed:`,
            err,
          );
        }
        console.log(
          `[worker] Job ${job.id} → ${job.webhook_url} delivered (${result.status})`,
        );
      } else {
        const newAttempts = job.attempts + 1;
        if (newAttempts > MAX_RETRIES) {
          markFailed(db, job.id);
          console.error(
            `[worker] Job ${job.id} failed after ${newAttempts} attempts, marking failed`,
          );
        } else {
          scheduleRetry(db, job.id, newAttempts);
          console.warn(
            `[worker] Job ${job.id} failed (attempt ${newAttempts}/${MAX_RETRIES}), retrying later`,
          );
        }
      }
    } catch (err) {
      console.error("[worker] Unexpected error:", err);
      await sleep(5_000, signal);
    }
  }
}
