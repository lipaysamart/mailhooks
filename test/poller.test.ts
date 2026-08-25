import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config/config.ts";
import { pollOnce } from "../src/poller/poller.ts";
import { closeDb, initDb } from "../src/queue/db.ts";
import type { QueueJob } from "../src/types.ts";

vi.mock("../src/connector/connect.ts", () => ({
  connect: vi.fn(),
}));

import { connect } from "../src/connector/connect.ts";

const connectMock = vi.mocked(connect);

const RAW_MAIL = [
  "From: Sender <sender@example.com>",
  "To: alerts@example.com",
  "Subject: Server alert",
  "Date: Wed, 15 Jan 2025 08:30:00 +0000",
  "",
  "CPU usage over 90%",
].join("\n");

function makeFakeClient(messages: Array<{ uid: number; source: string }>) {
  const seenFlags: number[] = [];
  const client = {
    getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
    search: vi.fn().mockResolvedValue(messages.map((m) => m.uid)),
    fetchOne: vi.fn(async (uid: number) => {
      const message = messages.find((m) => m.uid === uid);
      return message ? { source: Buffer.from(message.source) } : null;
    }),
    messageFlagsAdd: vi.fn(async (uid: number) => {
      seenFlags.push(uid);
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { client, seenFlags };
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    host: "imap.example.com",
    port: 993,
    secure: true,
    username: "user@example.com",
    password: "secret",
    mailbox: "INBOX",
    pollIntervalSeconds: 60,
    dbPath: ":memory:",
    logLevel: "info",
    logFormat: "auto",
    routes: [
      {
        address: "alerts@example.com",
        url: "https://hooks.example.com/alerts",
      },
    ],
    ...overrides,
  };
}

function queueRows(db: Database.Database): QueueJob[] {
  return db.prepare("SELECT * FROM queue ORDER BY id").all() as QueueJob[];
}

let db: Database.Database;

beforeEach(() => {
  db = initDb(":memory:");
  connectMock.mockReset();
});

afterEach(() => {
  closeDb(db);
});

describe("pollOnce", () => {
  it("enqueues matched mail and marks it as seen", async () => {
    const { client, seenFlags } = makeFakeClient([
      { uid: 1, source: RAW_MAIL },
    ]);
    connectMock.mockResolvedValue(client as never);

    const count = await pollOnce(makeConfig(), db);

    expect(count).toBe(1);
    expect(client.getMailboxLock).toHaveBeenCalledWith("INBOX");
    expect(seenFlags).toEqual([1]);

    const rows = queueRows(db);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("expected a queue row");
    expect(row.to_address).toBe("alerts@example.com");
    expect(row.webhook_url).toBe("https://hooks.example.com/alerts");
    expect(row.status).toBe("pending");

    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    expect(payload.from).toContain("sender@example.com");
    expect(payload.to).toBe("alerts@example.com");
    expect(payload.subject).toBe("Server alert");
    expect(payload.text_body).toContain("CPU usage over 90%");
    expect(payload.html_body).toBe("");
  });

  it("marks unmatched mail as seen without enqueuing", async () => {
    const unmatched = RAW_MAIL.replace(
      "To: alerts@example.com",
      "To: nobody@example.com",
    );
    const { client, seenFlags } = makeFakeClient([
      { uid: 7, source: unmatched },
    ]);
    connectMock.mockResolvedValue(client as never);

    const count = await pollOnce(makeConfig(), db);

    expect(count).toBe(0);
    expect(seenFlags).toEqual([7]);
    expect(queueRows(db)).toHaveLength(0);
  });

  it("handles a mix of matched and unmatched mail", async () => {
    const unmatched = RAW_MAIL.replace(
      "To: alerts@example.com",
      "To: nobody@example.com",
    );
    const { client, seenFlags } = makeFakeClient([
      { uid: 2, source: RAW_MAIL },
      { uid: 3, source: unmatched },
    ]);
    connectMock.mockResolvedValue(client as never);

    const count = await pollOnce(makeConfig(), db);

    expect(count).toBe(1);
    expect(seenFlags.sort()).toEqual([2, 3]);
    expect(queueRows(db)).toHaveLength(1);
  });

  it("matches routes case-insensitively", async () => {
    const upper = RAW_MAIL.replace(
      "To: alerts@example.com",
      "To: ALERTS@EXAMPLE.COM",
    );
    const { client } = makeFakeClient([{ uid: 4, source: upper }]);
    connectMock.mockResolvedValue(client as never);

    const count = await pollOnce(makeConfig(), db);

    expect(count).toBe(1);
    expect(queueRows(db)[0]?.to_address).toBe("alerts@example.com");
  });

  it("uses the configured mailbox for locking", async () => {
    const { client } = makeFakeClient([{ uid: 5, source: RAW_MAIL }]);
    connectMock.mockResolvedValue(client as never);

    await pollOnce(makeConfig({ mailbox: "Archive" }), db);

    expect(client.getMailboxLock).toHaveBeenCalledWith("Archive");
  });
});
