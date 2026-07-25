import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { initDb, closeDb } from "../src/queue/db.ts";
import {
  enqueue,
  dequeue,
  markDone,
  scheduleRetry,
  markFailed,
} from "../src/queue/queue.ts";

let db: Database.Database;

beforeEach(() => {
  db = initDb(":memory:");
});

afterEach(() => {
  closeDb(db);
});

describe("enqueue + dequeue", () => {
  it("inserts and retrieves a job with correct fields", () => {
    enqueue(db, "alerts@example.com", "https://hooks.example.com/alerts", '{"test":true}');

    const job = dequeue(db);
    expect(job).not.toBeNull();
    expect(job!.to_address).toBe("alerts@example.com");
    expect(job!.webhook_url).toBe("https://hooks.example.com/alerts");
    expect(job!.payload).toBe('{"test":true}');
    expect(job!.status).toBe("pending");
    expect(job!.attempts).toBe(0);
    expect(job!.next_retry_at).toBeNull();
  });

  it("returns null on empty queue", () => {
    expect(dequeue(db)).toBeNull();
  });

  it("returns jobs in id ASC order", () => {
    enqueue(db, "first@example.com", "https://hooks.example.com/1", "1");
    enqueue(db, "second@example.com", "https://hooks.example.com/2", "2");
    enqueue(db, "third@example.com", "https://hooks.example.com/3", "3");

    // dequeue is non-atomic (no state change), so mark each as done after consuming
    const job1 = dequeue(db)!;
    expect(job1.to_address).toBe("first@example.com");
    markDone(db, job1.id);

    const job2 = dequeue(db)!;
    expect(job2.to_address).toBe("second@example.com");
    markDone(db, job2.id);

    const job3 = dequeue(db)!;
    expect(job3.to_address).toBe("third@example.com");
  });

  it("skips jobs with future next_retry_at", () => {
    enqueue(db, "a@e.com", "https://h.example.com", "{}");

    // Manually set next_retry_at far in the future
    db.prepare("UPDATE queue SET next_retry_at = ? WHERE id = 1").run(
      Date.now() + 3600_000,
    );

    expect(dequeue(db)).toBeNull();
  });

  it("returns jobs with past next_retry_at", () => {
    enqueue(db, "a@e.com", "https://h.example.com", "{}");

    // Manually set next_retry_at in the past
    db.prepare("UPDATE queue SET next_retry_at = ? WHERE id = 1").run(
      Date.now() - 1000,
    );

    const job = dequeue(db);
    expect(job).not.toBeNull();
    expect(job!.to_address).toBe("a@e.com");
  });
});

describe("dequeue non-atomicity", () => {
  it("dequeue does not change job status; same job is returned twice", () => {
    enqueue(db, "a@e.com", "https://h.example.com", "{}");

    const job1 = dequeue(db);
    const job2 = dequeue(db);

    expect(job1).not.toBeNull();
    expect(job2).not.toBeNull();
    expect(job1!.id).toBe(job2!.id);
    // Status should still be "pending" after dequeue
    expect(job1!.status).toBe("pending");
  });
});

describe("markDone", () => {
  it("sets status to done and dequeue no longer returns it", () => {
    enqueue(db, "a@e.com", "https://h.example.com", "{}");
    const job = dequeue(db)!;
    markDone(db, job.id);

    expect(dequeue(db)).toBeNull();

    // Verify status in DB
    const row = db.prepare("SELECT status FROM queue WHERE id = ?").get(job.id) as {
      status: string;
    };
    expect(row.status).toBe("done");
  });
});

describe("scheduleRetry", () => {
  it("increments attempts and sets future next_retry_at", () => {
    enqueue(db, "a@e.com", "https://h.example.com", "{}");
    const job = dequeue(db)!;

    const before = Date.now();
    scheduleRetry(db, job.id, 1);
    const after = Date.now();

    const row = db.prepare(
      "SELECT status, attempts, next_retry_at FROM queue WHERE id = ?",
    ).get(job.id) as { status: string; attempts: number; next_retry_at: number };

    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.next_retry_at).toBeGreaterThanOrEqual(before + 60_000);
    expect(row.next_retry_at).toBeLessThanOrEqual(after + 60_000 + 2_000);
  });

  it("exponential backoff: attempts=1 → 60s", () => {
    enqueue(db, "a@e.com", "https://h.example.com", "{}");
    const job = dequeue(db)!;
    const before = Date.now();
    scheduleRetry(db, job.id, 1);

    const row = db.prepare("SELECT next_retry_at FROM queue WHERE id = ?").get(job.id) as {
      next_retry_at: number;
    };

    const delay = row.next_retry_at - before;
    expect(delay).toBeGreaterThanOrEqual(58_000);
    expect(delay).toBeLessThanOrEqual(62_000);
  });

  it("exponential backoff: attempts=2 → 120s", () => {
    enqueue(db, "a@e.com", "https://h.example.com", "{}");
    const job = dequeue(db)!;
    const before = Date.now();
    scheduleRetry(db, job.id, 2);

    const row = db.prepare("SELECT next_retry_at FROM queue WHERE id = ?").get(job.id) as {
      next_retry_at: number;
    };

    const delay = row.next_retry_at - before;
    expect(delay).toBeGreaterThanOrEqual(118_000);
    expect(delay).toBeLessThanOrEqual(122_000);
  });

  it("exponential backoff: attempts=3 → 240s", () => {
    enqueue(db, "a@e.com", "https://h.example.com", "{}");
    const job = dequeue(db)!;
    const before = Date.now();
    scheduleRetry(db, job.id, 3);

    const row = db.prepare("SELECT next_retry_at FROM queue WHERE id = ?").get(job.id) as {
      next_retry_at: number;
    };

    const delay = row.next_retry_at - before;
    expect(delay).toBeGreaterThanOrEqual(238_000);
    expect(delay).toBeLessThanOrEqual(242_000);
  });
});

describe("markFailed", () => {
  it("sets status to failed and dequeue no longer returns it", () => {
    enqueue(db, "a@e.com", "https://h.example.com", "{}");
    const job = dequeue(db)!;
    markFailed(db, job.id);

    expect(dequeue(db)).toBeNull();

    const row = db.prepare("SELECT status FROM queue WHERE id = ?").get(job.id) as {
      status: string;
    };
    expect(row.status).toBe("failed");
  });
});