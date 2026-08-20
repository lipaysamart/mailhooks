import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
    const path = await writeConfigFile(
      JSON.stringify({
        host: "imap.example.com",
        port: 993,
        secure: true,
        username: "user@example.com",
        password: "secret",
        mailbox: "INBOX",
        pollIntervalSeconds: 60,
        dbPath: "./mailhooks.db",
        routes: [
          {
            address: "alerts@example.com",
            url: "https://hooks.example.com/alerts",
          },
        ],
      }),
    );

    const config = await loadConfig(path);
    expect(config.host).toBe("imap.example.com");
    expect(config.port).toBe(993);
    expect(config.secure).toBe(true);
    expect(config.username).toBe("user@example.com");
    expect(config.password).toBe("secret");
    expect(config.mailbox).toBe("INBOX");
    expect(config.pollIntervalSeconds).toBe(60);
    expect(config.dbPath).toBe("./mailhooks.db");
    expect(config.routes).toHaveLength(1);
    expect(config.routes[0]?.address).toBe("alerts@example.com");
  });

  it("applies defaults for mailbox, pollIntervalSeconds, dbPath", async () => {
    const path = await writeConfigFile(
      JSON.stringify({
        host: "imap.example.com",
        port: 993,
        secure: true,
        username: "user@example.com",
        password: "secret",
        routes: [{ address: "a@e.com", url: "https://hooks.example.com" }],
      }),
    );

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
    const path = await writeConfigFile(
      JSON.stringify({
        host: "imap.example.com",
        port: 993,
        secure: true,
        username: "user@example.com",
        password: "secret",
        routes: [],
      }),
    );

    await expect(loadConfig(path)).rejects.toThrow(/routes.*non-empty array/);
  });

  it("throws when routes is missing", async () => {
    const path = await writeConfigFile(
      JSON.stringify({
        host: "imap.example.com",
        port: 993,
        secure: true,
        username: "user@example.com",
        password: "secret",
      }),
    );

    await expect(loadConfig(path)).rejects.toThrow(/routes.*non-empty array/);
  });

  it("throws when routes is a non-array string", async () => {
    const path = await writeConfigFile(
      JSON.stringify({
        host: "imap.example.com",
        port: 993,
        secure: true,
        username: "user@example.com",
        password: "secret",
        routes: "not-an-array",
      }),
    );

    await expect(loadConfig(path)).rejects.toThrow(/routes.*non-empty array/);
  });

  it("throws when host is missing", async () => {
    const path = await writeConfigFile(
      JSON.stringify({
        port: 993,
        secure: true,
        username: "user@example.com",
        password: "secret",
        routes: [{ address: "a@e.com", url: "https://hooks.example.com" }],
      }),
    );

    await expect(loadConfig(path)).rejects.toThrow(/"host".*non-empty string/);
  });

  it("throws when port is not a positive integer", async () => {
    for (const port of ["993", 0, -1, 993.5]) {
      const path = await writeConfigFile(
        JSON.stringify({
          host: "imap.example.com",
          port,
          secure: true,
          username: "user@example.com",
          password: "secret",
          routes: [{ address: "a@e.com", url: "https://hooks.example.com" }],
        }),
      );

      await expect(loadConfig(path)).rejects.toThrow(
        /"port".*positive integer/,
      );
    }
  });

  it("throws when secure is not a boolean", async () => {
    const path = await writeConfigFile(
      JSON.stringify({
        host: "imap.example.com",
        port: 993,
        secure: "yes",
        username: "user@example.com",
        password: "secret",
        routes: [{ address: "a@e.com", url: "https://hooks.example.com" }],
      }),
    );

    await expect(loadConfig(path)).rejects.toThrow(/"secure".*boolean/);
  });

  it("throws when username or password is missing", async () => {
    const base = {
      host: "imap.example.com",
      port: 993,
      secure: true,
      routes: [{ address: "a@e.com", url: "https://hooks.example.com" }],
    };

    const noUsername = await writeConfigFile(
      JSON.stringify({ ...base, password: "secret" }),
    );
    await expect(loadConfig(noUsername)).rejects.toThrow(
      /"username".*non-empty string/,
    );

    const noPassword = await writeConfigFile(
      JSON.stringify({ ...base, username: "user@example.com" }),
    );
    await expect(loadConfig(noPassword)).rejects.toThrow(
      /"password".*non-empty string/,
    );
  });

  it("throws when route address or url is missing", async () => {
    const base = {
      host: "imap.example.com",
      port: 993,
      secure: true,
      username: "user@example.com",
      password: "secret",
    };

    const noAddress = await writeConfigFile(
      JSON.stringify({
        ...base,
        routes: [{ url: "https://hooks.example.com" }],
      }),
    );
    await expect(loadConfig(noAddress)).rejects.toThrow(
      /routes\[0\]\.address.*non-empty string/,
    );

    const noUrl = await writeConfigFile(
      JSON.stringify({ ...base, routes: [{ address: "a@e.com" }] }),
    );
    await expect(loadConfig(noUrl)).rejects.toThrow(
      /routes\[0\]\.url.*non-empty string/,
    );
  });

  it("throws when a route is not an object", async () => {
    const path = await writeConfigFile(
      JSON.stringify({
        host: "imap.example.com",
        port: 993,
        secure: true,
        username: "user@example.com",
        password: "secret",
        routes: ["not-an-object"],
      }),
    );

    await expect(loadConfig(path)).rejects.toThrow(
      /routes\[0\].*must be an object/,
    );
  });

  it("passes through optional proxy and ignores unknown fields", async () => {
    const path = await writeConfigFile(
      JSON.stringify({
        host: "imap.example.com",
        port: 993,
        secure: true,
        username: "user@example.com",
        password: "secret",
        proxy: "socks5://127.0.0.1:1080",
        unknownField: "ignored",
        routes: [{ address: "a@e.com", url: "https://hooks.example.com" }],
      }),
    );

    const config = await loadConfig(path);
    expect(config.proxy).toBe("socks5://127.0.0.1:1080");
  });
});
