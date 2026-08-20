import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, initDb } from "../src/queue/db.ts";
import { enqueue } from "../src/queue/queue.ts";
import type { QueueJob } from "../src/types.ts";
import { MAX_RETRIES, processJob } from "../src/worker/worker.ts";

vi.mock("../src/webhook/sender.ts", () => ({
  sendWebhook: vi.fn(),
}));

import { sendWebhook } from "../src/webhook/sender.ts";

const sendMock = vi.mocked(sendWebhook);

function jobStatus(db: Database.Database, id: number) {
  return db.prepare("SELECT * FROM queue WHERE id = ?").get(id) as QueueJob;
}

let db: Database.Database;

beforeEach(() => {
  db = initDb(":memory:");
  sendMock.mockReset();
});

afterEach(() => {
  closeDb(db);
});

describe("processJob", () => {
  it("marks the job done when the webhook succeeds", async () => {
    const job = enqueueJob("alerts@example.com");
    sendMock.mockResolvedValue({ ok: true, status: 200 });

    await processJob(db, job);

    expect(jobStatus(db, job.id).status).toBe("done");
    expect(sendMock).toHaveBeenCalledWith(job.webhook_url, job.payload);
  });

  it("schedules a retry when the webhook returns non-2xx", async () => {
    const job = enqueueJob("alerts@example.com");
    sendMock.mockResolvedValue({ ok: false, status: 500 });

    await processJob(db, job);

    const row = jobStatus(db, job.id);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.next_retry_at).not.toBeNull();
  });

  it("marks the job failed after MAX_RETRIES attempts", async () => {
    const job = enqueueJob("alerts@example.com", MAX_RETRIES);
    sendMock.mockResolvedValue({ ok: false, status: 500 });

    await processJob(db, job);

    expect(jobStatus(db, job.id).status).toBe("failed");
  });

  it("keeps retrying at exactly MAX_RETRIES attempts (boundary)", async () => {
    const job = enqueueJob("alerts@example.com", MAX_RETRIES - 1);
    sendMock.mockResolvedValue({ ok: false, status: 500 });

    await processJob(db, job);

    const row = jobStatus(db, job.id);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(MAX_RETRIES);
  });
});

function enqueueJob(toAddress: string, attempts = 0): QueueJob {
  enqueue(db, toAddress, "https://hooks.example.com/x", "{}");
  const row = db
    .prepare("SELECT * FROM queue WHERE id = (SELECT MAX(id) FROM queue)")
    .get() as QueueJob;
  if (attempts > 0) {
    db.prepare("UPDATE queue SET attempts = ? WHERE id = ?").run(
      attempts,
      row.id,
    );
    return jobStatus(db, row.id);
  }
  return row;
}
