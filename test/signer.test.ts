import { describe, expect, it } from "vitest";
import { sign } from "../src/webhook/signer.ts";

describe("sign", () => {
  it("returns sha256= prefixed HMAC with 64 hex chars", () => {
    const result = sign("secret", "body");
    expect(result).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it("is deterministic for same inputs", () => {
    expect(sign("secret", "body")).toBe(sign("secret", "body"));
  });

  it("differs for different secrets", () => {
    expect(sign("s1", "body")).not.toBe(sign("s2", "body"));
  });

  it("differs for different bodies", () => {
    expect(sign("secret", "b1")).not.toBe(sign("secret", "b2"));
  });

  it("matches known HMAC-SHA256 vector", () => {
    // golden value: node -e "console.log('sha256='+require('crypto').createHmac('sha256','test-secret').update('{\"test\":true}').digest('hex'))"
    expect(sign("test-secret", '{"test":true}')).toBe(
      "sha256=f8c88a6ed522d167365ca5873dcf6f888a243ca21b7a058cce4270b5179c4f88",
    );
  });
});
