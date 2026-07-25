import { loadConfig } from "./src/config/config.ts";
import { initDb, closeDb } from "./src/queue/db.ts";
import { pollOnce } from "./src/poller/poller.ts";
import { startWorker } from "./src/worker/worker.ts";

const configPath = process.cwd() + "/config.json";
const config = await loadConfig(configPath);

const db = initDb(config.dbPath);

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

async function shutdown() {
  console.log("Shutting down gracefully...");
  clearInterval(interval);
  abortController.abort();
  await Promise.race([
    workerPromise,
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  closeDb(db);
  console.log("Shutdown complete");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
