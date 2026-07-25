import { createHmac } from "node:crypto";

export function sign(secret: string, body: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(body, "utf-8");
  return "sha256=" + hmac.digest("hex");
}
