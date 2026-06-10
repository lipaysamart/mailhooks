import { ImapFlow } from "imapflow";
import type { Config } from "../config/config.ts";

export async function connect(config: Config) {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    proxy: config.proxy,
    logger: false,
    auth: {
      user: config.username,
      pass: config.password,
    },
  });

  try {
    await client.connect();
    console.log("Connected successfully");
    console.log("Server capabilities:", client.capabilities);
    return client;
  } catch (err) {
    client.close();
    throw new Error(
      `Failed to connect: ${err instanceof Error ? err.message : err}`,
    );
  }
}
