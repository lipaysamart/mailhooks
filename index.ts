import { loadConfig } from "./src/config/config.ts";
import { connect } from "./src/connector/connect.ts";

const cfgPath = process.cwd() + "/config.json";
console.log(cfgPath);
const config = await loadConfig(cfgPath);
console.log(config);
const client = await connect(config);
client.close();
