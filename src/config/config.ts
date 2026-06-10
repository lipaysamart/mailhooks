import { readFile } from "fs/promises";

export interface Config {
  host: string;
  port: number;
  secure: boolean;
  proxy?: string;
  username: string;
  password: string;
}

export async function loadConfig(path: string): Promise<Config> {
  if (path === "") {
    throw new Error("Config file path cannot be empty");
  }

  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(
        `Config file "${path}" is not valid JSON: ${err.message}`,
      );
    }
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new Error(`Config file not found: "${path}"`);
    }
    throw err;
  }
}
