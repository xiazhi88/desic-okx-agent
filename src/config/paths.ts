import envPaths from "env-paths";
import path from "node:path";

const paths = envPaths("desic-okx-agent", { suffix: "" });

export const CONFIG_DIR = paths.config;
export const DATA_DIR = paths.data;
export const RUNTIME_DIR = path.join(paths.data, "run");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
export const DATABASE_PATH = path.join(DATA_DIR, "runtime.sqlite");
export const RUNTIME_STATE_PATH = path.join(RUNTIME_DIR, "runtime.json");
export const RUNTIME_LOCK_PATH = path.join(RUNTIME_DIR, "runtime.lock");
