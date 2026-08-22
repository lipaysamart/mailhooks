import { describe, expect, it } from "vitest";
import { createLogger } from "../src/log/logger.ts";

function capture(): { lines: string[]; sink: (line: string) => void } {
  const lines: string[] = [];
  return { lines, sink: (line) => lines.push(line) };
}

function lineAt(lines: string[], index = 0): string {
  const line = lines[index];
  if (line === undefined) throw new Error(`no output line at index ${index}`);
  return line;
}

describe("level filtering", () => {
  it("filters messages below the configured level", () => {
    const { lines, sink } = capture();
    const logger = createLogger({ level: "warn", format: "json", sink });

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lineAt(lines, 0)).msg).toBe("w");
    expect(JSON.parse(lineAt(lines, 1)).msg).toBe("e");
  });

  it("falls back to info for an unknown level", () => {
    const { lines, sink } = capture();
    const logger = createLogger({ level: "verbose", format: "json", sink });

    logger.debug("d");
    logger.info("i");

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lineAt(lines)).msg).toBe("i");
  });
});

describe("json format", () => {
  it("emits time, level, component, msg and fields", () => {
    const { lines, sink } = capture();
    const logger = createLogger({ format: "json", sink }).child("worker");

    logger.info("delivered", { jobId: 12, status: 200, url: "https://x" });

    const record = JSON.parse(lineAt(lines));
    expect(record.level).toBe("info");
    expect(record.component).toBe("worker");
    expect(record.msg).toBe("delivered");
    expect(record.jobId).toBe(12);
    expect(record.status).toBe(200);
    expect(record.url).toBe("https://x");
    expect(new Date(record.time).toISOString()).toBe(record.time);
  });

  it("serializes Error fields to name/message/stack", () => {
    const { lines, sink } = capture();
    const logger = createLogger({ format: "json", sink });
    const err = new Error("boom");

    logger.error("failed", { err });

    const record = JSON.parse(lineAt(lines));
    expect(record.err).toMatchObject({ name: "Error", message: "boom" });
    expect(record.err.stack).toContain("boom");
  });

  it("skips undefined field values", () => {
    const { lines, sink } = capture();
    const logger = createLogger({ format: "json", sink });

    logger.info("msg", { a: 1, b: undefined });

    expect(JSON.parse(lineAt(lines))).not.toHaveProperty("b");
  });
});

describe("pretty format", () => {
  it("renders time, level, component, msg and key=value fields", () => {
    const { lines, sink } = capture();
    const logger = createLogger({ format: "pretty", sink }).child("poller");

    logger.info("poll complete", { found: 3, enqueued: 2 });

    expect(lineAt(lines)).toMatch(
      /^\d{2}:\d{2}:\d{2}\.\d{3} INFO\s+\[poller\] poll complete found=3 enqueued=2$/,
    );
  });

  it("pads level labels and appends Error stacks indented", () => {
    const { lines, sink } = capture();
    const logger = createLogger({ format: "pretty", sink }).child("poller");
    const err = new Error("boom");

    logger.error("failed", { uid: 7, err });

    const output = lineAt(lines);
    expect(output).toMatch(/ERROR\s+\[poller\] failed uid=7 err=Error: boom/);
    const [firstLine, ...stackLines] = output.split("\n");
    expect(firstLine).toMatch(/ERROR/);
    expect(stackLines.length).toBeGreaterThan(0);
    for (const line of stackLines) {
      expect(line.startsWith("    ")).toBe(true);
    }
    expect(stackLines.some((line) => line.includes("at "))).toBe(true);
  });

  it("stringifies object fields", () => {
    const { lines, sink } = capture();
    const logger = createLogger({ format: "pretty", sink });

    logger.info("msg", { route: { address: "a@b.c", url: "https://x" } });

    expect(lineAt(lines)).toContain(
      'route={"address":"a@b.c","url":"https://x"}',
    );
  });
});

describe("child loggers", () => {
  it("nested child replaces the component", () => {
    const { lines, sink } = capture();
    const logger = createLogger({ format: "json", sink })
      .child("imap")
      .child("worker");

    logger.info("msg");

    expect(JSON.parse(lineAt(lines)).component).toBe("worker");
  });

  it("omits component when none is set", () => {
    const { lines, sink } = capture();
    const logger = createLogger({ format: "json", sink });

    logger.info("msg");

    expect(JSON.parse(lineAt(lines))).not.toHaveProperty("component");
  });
});
