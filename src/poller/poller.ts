import type Database from "better-sqlite3";
import type { MailboxLockObject } from "imapflow";
import type { ParsedMail } from "mailparser";
import type { Config } from "../config/config.ts";
import { connect } from "../connector/connect.ts";
import { log } from "../log/logger.ts";
import { enqueue } from "../queue/queue.ts";
import { buildPayload } from "../webhook/payload.ts";

const logger = log.child("poller");

async function parseMail(source: Buffer): Promise<ParsedMail> {
  const { simpleParser } = await import("mailparser");
  return simpleParser(source);
}

export async function pollOnce(
  config: Config,
  db: Database.Database,
): Promise<number> {
  const startedAt = Date.now();
  logger.debug("poll starting", { mailbox: config.mailbox });

  const client = await connect(config);
  const mailbox = config.mailbox;

  let lock: MailboxLockObject;
  try {
    lock = await client.getMailboxLock(mailbox);
  } catch (err) {
    await client.close();
    throw err;
  }

  let enqueued = 0;
  let noRoute = 0;

  try {
    const uids = (await client.search(
      { seen: false },
      { uid: true },
    )) as number[];

    for (const uid of uids) {
      try {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!msg) continue;

        const mail = await parseMail((msg as { source: Buffer }).source);

        const toAddresses = extractAddresses(
          mail.to as { value?: Array<{ address: string }> } | undefined,
        );
        const matched = findMatchingRoute(toAddresses, config.routes);

        if (!matched) {
          noRoute++;
          logger.warn("no route matched", {
            uid,
            recipients: toAddresses.join(","),
          });
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
          continue;
        }

        const payloadObj = buildPayload(mail, matched.address);
        enqueue(db, matched.address, matched.url, JSON.stringify(payloadObj));
        enqueued++;
        logger.debug("enqueued", { uid, to: matched.address });

        await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      } catch (err) {
        logger.error("failed to process message", { uid, err });
        try {
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
        } catch {
          // ignore flag error, message will be re-processed next cycle
        }
      }
    }

    logger.info("poll complete", {
      found: uids.length,
      enqueued,
      noRoute,
      durationMs: Date.now() - startedAt,
    });

    return enqueued;
  } finally {
    lock.release();
    await client.close();
  }
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
    const route = routes.find((r) => r.address.toLowerCase() === addr);
    if (route) return route;
  }
  return null;
}
