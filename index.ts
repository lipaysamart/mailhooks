import { type Config, loadConfig } from "./src/config/config.ts";
import { configureLogger, log } from "./src/log/logger.ts";
import { pollOnce } from "./src/poller/poller.ts";
import { closeDb, initDb } from "./src/queue/db.ts";
import { startWorker } from "./src/worker/worker.ts";

const configPath = `${process.cwd()}/config.json`;

let config: Config;
try {
  config = await loadConfig(configPath);
} catch (err) {
  // Logger is not configured yet; keep startup errors readable.
  console.error(
    err instanceof Error ? err.message : `Failed to load config: ${err}`,
  );
  process.exit(1);
}

// Env vars override config file.
configureLogger({
  level: process.env.LOG_LEVEL ?? config.logLevel,
  format: process.env.LOG_FORMAT ?? config.logFormat,
});
const logger = log.child("app");

logger.info("starting", {
  host: config.host,
  mailbox: config.mailbox,
  routes: config.routes.length,
  pollInterval: `${config.pollIntervalSeconds}s`,
  dbPath: config.dbPath,
});

let db: ReturnType<typeof initDb>;
try {
  db = initDb(config.dbPath);
} catch (err) {
  logger.error("failed to open SQLite database", {
    dbPath: config.dbPath,
    hint:
      "Check that the directory exists and is writable by the current user. " +
      'In Docker, set "dbPath" to a writable path such as "./data/mailhooks.db".',
    err,
  });
  process.exit(1);
}

const abortController = new AbortController();
const workerPromise = startWorker(config, db, abortController.signal);

// Initial poll
try {
  await pollOnce(config, db);
} catch (err) {
  logger.error("initial poll failed", { err });
}

// Periodic polling
const interval = setInterval(async () => {
  try {
    await pollOnce(config, db);
  } catch (err) {
    logger.error("poll cycle failed", { err });
  }
}, config.pollIntervalSeconds * 1000);

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutting down");
  clearInterval(interval);
  abortController.abort();
  try {
    await Promise.race([
      workerPromise,
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch (err) {
    logger.error("worker exited with error", { err });
  }
  closeDb(db);
  logger.info("shutdown complete");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
