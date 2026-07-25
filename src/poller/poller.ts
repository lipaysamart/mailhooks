import { connect } from "../connector/connect.ts";
import { enqueue } from "../queue/queue.ts";
import { buildPayload } from "../webhook/payload.ts";
import type { Config } from "../config/config.ts";
import type Database from "better-sqlite3";

async function parseMail(source: Buffer): Promise<Record<string, unknown>> {
  const { simpleParser } = await import("mailparser");
  return simpleParser(source);
}

export async function pollOnce(
  config: Config,
  db: Database.Database,
): Promise<number> {
  const client = await connect(config);
  const mailbox = config.mailbox;

  let lock;
  try {
    lock = await client.getMailboxLock(mailbox);
  } catch (err) {
    console.error("Failed to acquire mailbox lock:", err);
    await client.close();
    throw err;
  }

  let enqueued = 0;

  try {
    const uids = (await client.search({ seen: false }, { uid: true })) as number[];

    for (const uid of uids) {
      try {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!msg) continue;

        const mail = await parseMail((msg as { source: Buffer }).source);

        const toAddresses = extractAddresses(mail.to as { value?: Array<{ address: string }> } | undefined);
        const matched = findMatchingRoute(toAddresses, config.routes);

        if (!matched) {
          console.warn(`No route for any recipient: ${toAddresses.join(", ")}`);
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
          continue;
        }

        const payloadObj = buildPayload(mail, matched.address);
        enqueue(db, matched.address, matched.url, JSON.stringify(payloadObj));
        enqueued++;

        await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      } catch (err) {
        console.error(`Error processing message UID ${uid}:`, err);
        try {
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
        } catch {
          // ignore flag error, message will be re-processed next cycle
        }
      }
    }
  } finally {
    lock.release();
    await client.close();
  }

  return enqueued;
}

function extractAddresses(
  to: { value?: Array<{ address: string }> } | undefined,
): string[] {
  if (!to?.value) return [];
  return to.value
    .map((v) => v.address?.toLowerCase())
    .filter(Boolean) as string[];
}

function findMatchingRoute(
  addresses: string[],
  routes: Array<{ address: string; url: string }>,
): { address: string; url: string } | null {
  for (const addr of addresses) {
    const route = routes.find(
      (r) => r.address.toLowerCase() === addr,
    );
    if (route) return route;
  }
  return null;
}
