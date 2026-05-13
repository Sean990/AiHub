import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getConfigPath, getDataDir, getLogPath } from "../../src/config.js";
import { startServer } from "../../src/server.js";
import { readStoreConfig } from "../../src/store.js";

let current = null;

export async function startManagedService({ host, port } = {}) {
  if (current?.server?.listening) {
    return getManagedServiceStatus();
  }

  const configPath = getConfigPath();
  const config = await readStoreConfig(configPath);
  const activeHost = host || config.service.host;
  const activePort = Number(port || config.service.port);

  try {
    const started = await startServer({
      host: activeHost,
      port: activePort,
      configPath
    });
    current = {
      ...started,
      startedAt: new Date().toISOString()
    };
    await appendDesktopLog(`service started at http://${activeHost}:${activePort}`);
    return getManagedServiceStatus();
  } catch (error) {
    await appendDesktopLog(`service failed to start: ${error.message}`);
    throw new Error(`Failed to start service on ${activeHost}:${activePort}: ${error.message}`);
  }
}

export async function stopManagedService() {
  if (!current?.server) {
    return getManagedServiceStatus();
  }

  const server = current.server;
  const { host, port } = current;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  current = null;
  await appendDesktopLog(`service stopped at http://${host}:${port}`);
  return getManagedServiceStatus();
}

export async function getManagedServiceStatus() {
  const config = await readStoreConfig();
  const host = current?.host || config.service.host;
  const port = Number(current?.port || config.service.port);
  return {
    running: Boolean(current?.server?.listening),
    host,
    port,
    url: `http://${host}:${port}`,
    baseUrl: `http://${host}:${port}/v1`,
    startedAt: current?.startedAt || "",
    configPath: getConfigPath(),
    logPath: getLogPath()
  };
}

export async function readDesktopLog({ lines = 120 } = {}) {
  const logPath = getLogPath();
  try {
    const raw = await readFile(logPath, "utf8");
    return raw.trim().split("\n").filter(Boolean).slice(-Number(lines || 120));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function appendDesktopLog(message) {
  const logPath = getLogPath();
  await mkdir(getDataDir(), { recursive: true });
  await appendFile(logPath, `${new Date().toISOString()}\t[desktop]\t${message}\n`, {
    mode: 0o600
  });
}
