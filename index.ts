import { loadConfig } from "./src/config/config.ts";
import { pollOnce } from "./src/poller/poller.ts";
import { closeDb, initDb } from "./src/queue/db.ts";
import { startWorker } from "./src/worker/worker.ts";

const configPath = `${process.cwd()}/config.json`;
const config = await loadConfig(configPath);

let db: ReturnType<typeof initDb>;
try {
  db = initDb(config.dbPath);
} catch (err) {
  console.error(
    `Failed to open SQLite database at "${config.dbPath}": ${(err as Error).message}`,
  );
  console.error(
    "Check that the directory exists and is writable by the current user. " +
      'In Docker, set "dbPath" to a writable path such as "./data/mailhooks.db".',
  );
  process.exit(1);
}

const abortController = new AbortController();
const workerPromise = startWorker(config, db, abortController.signal);

// Initial poll
try {
  const count = await pollOnce(config, db);
  console.log(`Initial poll complete: ${count} enqueued`);
} catch (err) {
  console.error("Initial poll failed:", err);
}

// Periodic polling
const interval = setInterval(async () => {
  try {
    const count = await pollOnce(config, db);
    if (count > 0) {
      console.log(`Poll: ${count} new email(s) enqueued`);
    }
  } catch (err) {
    console.error("Poll cycle failed:", err);
  }
}, config.pollIntervalSeconds * 1000);

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("Shutting down gracefully...");
  clearInterval(interval);
  abortController.abort();
  try {
    await Promise.race([
      workerPromise,
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch (err) {
    console.error("Worker exited with error:", err);
  }
  closeDb(db);
  console.log("Shutdown complete");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
