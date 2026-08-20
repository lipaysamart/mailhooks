import { afterEach, describe, expect, it, vi } from "vitest";
import { sendWebhook } from "../src/webhook/sender.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendWebhook", () => {
  it("returns ok with status when the webhook responds 2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWebhook("https://hooks.example.com/x", "{}");

    expect(result).toEqual({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.example.com/x",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });

  it("returns not ok with status when the webhook responds non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );

    const result = await sendWebhook("https://hooks.example.com/x", "{}");

    expect(result).toEqual({ ok: false, status: 500 });
  });

  it("returns not ok with error message on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );

    const result = await sendWebhook("https://hooks.example.com/x", "{}");

    expect(result).toEqual({
      ok: false,
      status: 0,
      error: "ECONNREFUSED",
    });
  });
});
