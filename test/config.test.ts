import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig } from "../src/config/config.ts";

let tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

async function writeConfigFile(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mailhooks-test-"));
  tempDirs.push(dir);
  const filePath = join(dir, "config.json");
  await writeFile(filePath, content, "utf8");
  return filePath;
}

describe("loadConfig", () => {
  it("loads a complete valid config", async () => {
    const path = await writeConfigFile(JSON.stringify({
      host: "imap.example.com",
      port: 993,
      secure: true,
      username: "user@example.com",
      password: "secret",
      signingSecret: "hmac-secret",
      mailbox: "INBOX",
      pollIntervalSeconds: 60,
      dbPath: "./mailhooks.db",
      routes: [{ address: "alerts@example.com", url: "https://hooks.example.com/alerts" }],
    }));

    const config = await loadConfig(path);
    expect(config.host).toBe("imap.example.com");
    expect(config.port).toBe(993);
    expect(config.secure).toBe(true);
    expect(config.username).toBe("user@example.com");
    expect(config.password).toBe("secret");
    expect(config.signingSecret).toBe("hmac-secret");
    expect(config.mailbox).toBe("INBOX");
    expect(config.pollIntervalSeconds).toBe(60);
    expect(config.dbPath).toBe("./mailhooks.db");
    expect(config.routes).toHaveLength(1);
    expect(config.routes[0]!.address).toBe("alerts@example.com");
  });

  it("applies defaults for mailbox, pollIntervalSeconds, dbPath", async () => {
    const path = await writeConfigFile(JSON.stringify({
      host: "imap.example.com",
      port: 993,
      secure: true,
      username: "user@example.com",
      password: "secret",
      signingSecret: "hmac-secret",
      routes: [{ address: "a@e.com", url: "https://hooks.example.com" }],
    }));

    const config = await loadConfig(path);
    expect(config.mailbox).toBe("INBOX");
    expect(config.pollIntervalSeconds).toBe(60);
    expect(config.dbPath).toBe("./mailhooks.db");
  });

  it("throws when file does not exist", async () => {
    await expect(loadConfig("/nonexistent/path/config.json")).rejects.toThrow(
      /^Config file not found: ".*"$/,
    );
  });

  it("throws when path is empty", async () => {
    await expect(loadConfig("")).rejects.toThrow(
      "Config file path cannot be empty",
    );
  });

  it("throws on invalid JSON", async () => {
    const path = await writeConfigFile("not json");
    await expect(loadConfig(path)).rejects.toThrow(
      /^Config file ".*" is not valid JSON:/,
    );
  });

  it("throws when routes is an empty array", async () => {
    const path = await writeConfigFile(JSON.stringify({
      host: "imap.example.com",
      port: 993,
      secure: true,
      username: "user@example.com",
      password: "secret",
      signingSecret: "hmac-secret",
      routes: [],
    }));

    await expect(loadConfig(path)).rejects.toThrow(
      /routes.*non-empty array/,
    );
  });

  it("throws when routes is missing", async () => {
    const path = await writeConfigFile(JSON.stringify({
      host: "imap.example.com",
      port: 993,
      secure: true,
      username: "user@example.com",
      password: "secret",
      signingSecret: "hmac-secret",
    }));

    await expect(loadConfig(path)).rejects.toThrow(
      /routes.*non-empty array/,
    );
  });

  it("throws when routes is a non-array string", async () => {
    const path = await writeConfigFile(JSON.stringify({
      host: "imap.example.com",
      port: 993,
      secure: true,
      username: "user@example.com",
      password: "secret",
      signingSecret: "hmac-secret",
      routes: "not-an-array",
    }));

    await expect(loadConfig(path)).rejects.toThrow(
      /routes.*non-empty array/,
    );
  });

  it("throws when signingSecret is missing", async () => {
    const path = await writeConfigFile(JSON.stringify({
      host: "imap.example.com",
      port: 993,
      secure: true,
      username: "user@example.com",
      password: "secret",
      routes: [{ address: "a@e.com", url: "https://hooks.example.com" }],
    }));

    await expect(loadConfig(path)).rejects.toThrow(
      /signingSecret/,
    );
  });

  it("throws when signingSecret is empty string", async () => {
    const path = await writeConfigFile(JSON.stringify({
      host: "imap.example.com",
      port: 993,
      secure: true,
      username: "user@example.com",
      password: "secret",
      signingSecret: "",
      routes: [{ address: "a@e.com", url: "https://hooks.example.com" }],
    }));

    await expect(loadConfig(path)).rejects.toThrow(
      /signingSecret/,
    );
  });
});