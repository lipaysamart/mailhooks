export interface SendResult {
  ok: boolean;
  status: number;
  error?: string;
}

export async function sendWebhook(
  url: string,
  body: string,
): Promise<SendResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      return { ok: true, status: res.status };
    }
    return { ok: false, status: res.status };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
