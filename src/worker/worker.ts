import type Database from "better-sqlite3";
import type { Config } from "../config/config.ts";
import { log } from "../log/logger.ts";
import {
  dequeue,
  markDone,
  markFailed,
  retryDelayMs,
  scheduleRetry,
} from "../queue/queue.ts";
import type { QueueJob } from "../types.ts";
import { sendWebhook } from "../webhook/sender.ts";

const logger = log.child("worker");

export const MAX_RETRIES = 5;

function humanizeMs(ms: number): string {
  return ms < 60_000
    ? `${Math.round(ms / 1000)}s`
    : `${Math.round(ms / 60_000)}m`;
}

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

export async function processJob(
  db: Database.Database,
  job: QueueJob,
): Promise<void> {
  const startedAt = Date.now();
  const result = await sendWebhook(job.webhook_url, job.payload);
  const latencyMs = Date.now() - startedAt;

  if (result.ok) {
    try {
      markDone(db, job.id);
    } catch (err) {
      logger.error("delivered but markDone failed", { jobId: job.id, err });
    }
    logger.info("delivered", {
      jobId: job.id,
      url: job.webhook_url,
      status: result.status,
      latencyMs,
    });
    return;
  }

  const newAttempts = job.attempts + 1;
  const cause =
    result.status > 0 ? `HTTP ${result.status}` : (result.error ?? "unknown");
  if (newAttempts > MAX_RETRIES) {
    markFailed(db, job.id);
    logger.error("delivery permanently failed", {
      jobId: job.id,
      url: job.webhook_url,
      attempts: newAttempts,
      cause,
    });
  } else {
    scheduleRetry(db, job.id, newAttempts);
    logger.warn("delivery failed", {
      jobId: job.id,
      url: job.webhook_url,
      attempt: `${newAttempts}/${MAX_RETRIES}`,
      cause,
      nextRetryIn: humanizeMs(retryDelayMs(newAttempts)),
    });
  }
}

export async function startWorker(
  _config: Config,
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

      await processJob(db, job);
    } catch (err) {
      logger.error("unexpected error", { err });
      await sleep(5_000, signal);
    }
  }
}
