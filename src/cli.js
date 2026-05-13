import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  getDataDir,
  getConfigPath,
  getLogPath,
  getPidPath,
  redactSubscription,
  removeSubscription,
  setRoutingFallback,
  setRoutingRetryAttempts,
  setRoutingTimeout,
  setServiceAddress,
  setSubscriptionEnabled,
  setSubscriptionPriority,
  upsertSubscription
} from "./config.js";
import { readHistory } from "./history.js";
import { providers } from "./providers/index.js";
import { routeChat } from "./router.js";
import { startServer } from "./server.js";
import {
  createPlatformKey,
  deleteModelAlias,
  deletePlatformKey,
  exportStore,
  importStore,
  listModelAliases,
  listPlatformKeys,
  migrationStatus,
  readStoreConfig,
  setModelAliasEnabled,
  setPlatformKeyEnabled,
  updateStoreConfig,
  upsertModelAlias,
  upsertModelRoute
} from "./store.js";

const CLI_BIN = fileURLToPath(new URL("../bin/aihub.js", import.meta.url));

export async function main(argv) {
  const [command, ...rest] = argv;

  switch (command) {
    case "add":
      return addCommand(rest);
    case "list":
      return listCommand();
    case "remove":
      return removeCommand(rest);
    case "enable":
      return enabledCommand(rest, true);
    case "disable":
      return enabledCommand(rest, false);
    case "priority":
      return priorityCommand(rest);
    case "ask":
      return askCommand(rest);
    case "service":
      return serviceCommand(rest);
    case "start":
      return startCommand(rest);
    case "stop":
      return stopCommand(rest);
    case "status":
      return statusCommand(rest);
    case "logs":
      return logsCommand(rest);
    case "history":
      return historyCommand(rest);
    case "doctor":
      return doctorCommand(rest);
    case "routing":
      return routingCommand(rest);
    case "run":
      return runCommand(rest);
    case "terminal":
      return terminalCommand(rest);
    case "config":
      return configCommand(rest);
    case "env":
      return envCommand(rest);
    case "key":
      return keyCommand(rest);
    case "model":
      return modelCommand(rest);
    case "export":
      return exportCommand(rest);
    case "import":
      return importCommand(rest);
    case "migrate":
      return migrateCommand(rest);
    case "-h":
    case "--help":
    case undefined:
      return helpCommand();
    default:
      throw new Error(`Unknown command "${command}". Run "aihub --help".`);
  }
}

async function addCommand(argv) {
  const args = parseArgs(argv);
  const name = args._[0] || args.name;
  const provider = args.provider;
  const apiKey = args.key || args.apiKey || process.env.AIHUB_API_KEY;

  if (!name) {
    throw new Error("Usage: aihub add <name> --provider gemini|claude|codex|openai-compatible --key <api-key> --model <model>");
  }
  if (!provider) {
    throw new Error("--provider is required.");
  }
  if (!apiKey) {
    throw new Error("--key is required, or set AIHUB_API_KEY.");
  }

  await updateStoreConfig((config) =>
    upsertSubscription(config, {
      name,
      provider,
      apiKey,
      model: args.model || "",
      models: args.models ? String(args.models).split(",").map((item) => item.trim()).filter(Boolean) : [],
      priority: args.priority || 100,
      enabled: args.enabled !== "false",
      baseUrl: args.baseUrl || args["base-url"] || "",
      apiVersion: args.apiVersion || args["api-version"] || "",
      timeoutMs: args.timeoutMs || args["timeout-ms"] || 0
    })
  );

  console.log(`Added subscription "${name}".`);
}

async function listCommand() {
  const config = await readStoreConfig();
  if (config.subscriptions.length === 0) {
    console.log("No subscriptions yet. Add one with: aihub add <name> --provider gemini --key <key> --model <model>");
    return;
  }

  for (const subscription of config.subscriptions.map(redactSubscription)) {
    const state = subscription.enabled ? "on" : "off";
    console.log(
      `${subscription.priority}\t${state}\t${subscription.name}\t${subscription.provider}\tdefault=${subscription.model || "-"}\tmodels=${subscription.models?.length || 0}\t${subscription.apiKey}`
    );
  }
}

async function removeCommand(argv) {
  const name = argv[0];
  if (!name) {
    throw new Error("Usage: aihub remove <name>");
  }
  await updateStoreConfig((config) => removeSubscription(config, name));
  console.log(`Removed subscription "${name}".`);
}

async function enabledCommand(argv, enabled) {
  const name = argv[0];
  if (!name) {
    throw new Error(`Usage: aihub ${enabled ? "enable" : "disable"} <name>`);
  }
  await updateStoreConfig((config) => setSubscriptionEnabled(config, name, enabled));
  console.log(`${enabled ? "Enabled" : "Disabled"} subscription "${name}".`);
}

async function priorityCommand(argv) {
  const [name, priority] = argv;
  if (!name || priority == null) {
    throw new Error("Usage: aihub priority <name> <number>. Lower number wins.");
  }
  await updateStoreConfig((config) => setSubscriptionPriority(config, name, Number(priority)));
  console.log(`Set "${name}" priority to ${priority}.`);
}

async function askCommand(argv) {
  const args = parseArgs(argv);
  const prompt = args._.join(" ") || (await readStdinIfPresent());
  if (!prompt) {
    throw new Error("Usage: aihub ask \"your prompt\"");
  }

  const result = await routeChat({
    prompt,
    provider: args.provider || "auto",
    subscription: args.subscription,
    model: args.model,
    includeRaw: Boolean(args.raw),
    options: {
      temperature: args.temperature,
      maxTokens: args.maxTokens || args["max-tokens"]
    }
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.text);
    console.error(`[${result.provider}/${result.subscription}/${result.model}]`);
  }
}

async function serviceCommand(argv) {
  const args = parseArgs(argv);
  const { host, port } = await startServer({
    host: args.host,
    port: args.port
  });
  console.log(`AiHub service listening at http://${host}:${port}`);
  console.log(`OpenAI-compatible base URL: http://${host}:${port}/v1`);
}

async function startCommand(argv) {
  const args = parseArgs(argv);
  const configPath = getConfigPath();
  const config = await readStoreConfig(configPath);
  const host = args.host || config.service.host;
  const port = Number(args.port || config.service.port);
  const status = await getServiceStatus({ configPath, host, port });

  if (status.running) {
    if (!args.quiet) {
      console.log(`AiHub service already running at ${status.baseUrl} (pid ${status.pid}).`);
    }
    return status;
  }

  await mkdir(getDataDir(configPath), { recursive: true });
  const logPath = getLogPath(configPath);
  const logFd = openSync(logPath, "a", 0o600);
  const child = spawn(process.execPath, [CLI_BIN, "service", "--host", host, "--port", String(port)], {
    detached: true,
    env: {
      ...process.env,
      AIHUB_CONFIG: configPath
    },
    stdio: ["ignore", logFd, logFd]
  });
  child.unref();
  closeSync(logFd);

  try {
    await waitForHealth({ host, port, timeoutMs: Number(args.timeout || 5000) });
  } catch (error) {
    try {
      process.kill(child.pid);
    } catch {
      // The child may already have exited.
    }
    throw new Error(`Service did not become healthy: ${error.message}. Check ${logPath}.`);
  }

  const pidInfo = {
    pid: child.pid,
    host,
    port,
    baseUrl: `http://${host}:${port}/v1`,
    startedAt: new Date().toISOString(),
    configPath,
    logPath
  };
  await writePidInfo(pidInfo, configPath);

  if (!args.quiet) {
    console.log(`AiHub service started at http://${host}:${port} (pid ${child.pid}).`);
    console.log(`OpenAI-compatible base URL: ${pidInfo.baseUrl}`);
    console.log(`Log file: ${logPath}`);
  }
  return pidInfo;
}

async function stopCommand(argv) {
  const args = parseArgs(argv);
  const configPath = getConfigPath();
  const pidInfo = await readPidInfo(configPath);
  if (!pidInfo?.pid) {
    console.log("AiHub service is not tracked as running.");
    return;
  }

  if (!isProcessRunning(pidInfo.pid)) {
    await removePidInfo(configPath);
    console.log("Removed stale AiHub pid file.");
    return;
  }

  process.kill(pidInfo.pid, args.force ? "SIGKILL" : "SIGTERM");
  await waitForProcessExit(pidInfo.pid, Number(args.timeout || 5000));
  await removePidInfo(configPath);
  console.log(`Stopped AiHub service pid ${pidInfo.pid}.`);
}

async function statusCommand(argv) {
  const args = parseArgs(argv);
  const status = await getServiceStatus({ configPath: getConfigPath() });
  if (args.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  if (status.running) {
    console.log(`running\tpid=${status.pid || "-"}\turl=${status.url}\tbase=${status.baseUrl}`);
    return;
  }
  if (status.pid && status.processRunning) {
    console.log(`unhealthy\tpid=${status.pid}\turl=${status.url}`);
    return;
  }
  if (status.pid) {
    console.log(`stale\tpid=${status.pid}\turl=${status.url}`);
    return;
  }
  console.log(`stopped\turl=${status.url}`);
}

async function logsCommand(argv) {
  const args = parseArgs(argv);
  const lines = Number(args.lines || args.n || 80);
  const logPath = getLogPath();
  let raw = "";
  try {
    raw = await readFile(logPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log(`No log file yet: ${logPath}`);
      return;
    }
    throw error;
  }
  console.log(raw.trim().split("\n").slice(-lines).join("\n"));
}

async function historyCommand(argv) {
  const args = parseArgs(argv);
  const entries = await readHistory({ limit: Number(args.limit || args.n || 20) });
  if (args.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  if (entries.length === 0) {
    console.log("No request history yet.");
    return;
  }
  for (const entry of entries) {
    const state = entry.ok ? "ok" : "fail";
    const route = `${entry.provider || "auto"}/${entry.subscription || "-"}/${entry.model || "-"}`;
    const error = entry.error ? `\t${entry.error}` : "";
    console.log(`${entry.ts}\t${state}\t${route}\tattempts=${entry.attempts?.length || 0}${error}`);
  }
}

async function doctorCommand(argv) {
  const args = parseArgs(argv);
  const configPath = getConfigPath();
  const config = await readStoreConfig(configPath);
  const status = await getServiceStatus({ configPath });
  const enabled = config.subscriptions.filter((subscription) => subscription.enabled);
  const report = {
    node: process.version,
    configPath,
    logPath: getLogPath(configPath),
    historyPath: getHistoryPathForReport(configPath),
    subscriptions: {
      total: config.subscriptions.length,
      enabled: enabled.length,
      providers: enabled.reduce((acc, subscription) => {
        acc[subscription.provider] = (acc[subscription.provider] || 0) + 1;
        return acc;
      }, {})
    },
    routing: config.routing,
    service: {
      running: status.running,
      reachable: status.reachable,
      pid: status.pid,
      url: status.url,
      baseUrl: status.baseUrl
    },
    env: {
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || "",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : ""
    }
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`node\t${report.node}`);
  console.log(`config\t${report.configPath}`);
  console.log(`subscriptions\ttotal=${report.subscriptions.total}\tenabled=${report.subscriptions.enabled}`);
  console.log(`providers\t${JSON.stringify(report.subscriptions.providers)}`);
  console.log(`fallback\t${report.routing.fallback ? "on" : "off"}`);
  console.log(`service\t${report.service.running ? "running" : "stopped"}\t${report.service.baseUrl}`);
  console.log(`logs\t${report.logPath}`);

  if (report.subscriptions.enabled === 0) {
    console.log("action\tadd at least one enabled subscription");
  }
  if (!report.service.running) {
    console.log("action\trun `aihub start` before using OpenAI-compatible clients");
  }
}

async function routingCommand(argv) {
  const [subcommand, value] = argv;
  if (subcommand === "fallback") {
    if (!value || value === "status") {
      const config = await readStoreConfig();
      console.log(`fallback=${config.routing.fallback ? "on" : "off"}`);
      return;
    }
    if (!["on", "off", "true", "false"].includes(value)) {
      throw new Error("Usage: aihub routing fallback on|off");
    }
    const enabled = value === "on" || value === "true";
    await updateStoreConfig((config) => setRoutingFallback(config, enabled));
    console.log(`Set fallback=${enabled ? "on" : "off"}.`);
    return;
  }
  if (subcommand === "timeout") {
    if (!value || value === "status") {
      const config = await readStoreConfig();
      console.log(`timeoutMs=${config.routing.requestTimeoutMs}`);
      return;
    }
    await updateStoreConfig((config) => setRoutingTimeout(config, Number(value)));
    console.log(`Set timeoutMs=${Number(value)}.`);
    return;
  }
  if (subcommand === "retries") {
    if (!value || value === "status") {
      const config = await readStoreConfig();
      console.log(`retryAttempts=${config.routing.retryAttempts}`);
      return;
    }
    await updateStoreConfig((config) => setRoutingRetryAttempts(config, Number(value)));
    console.log(`Set retryAttempts=${Number(value)}.`);
    return;
  }
  throw new Error("Usage: aihub routing fallback [on|off|status] | timeout [ms|status] | retries [count|status]");
}

async function runCommand(argv) {
  const { args, command } = parseRunArgs(argv);
  if (command.length === 0) {
    throw new Error("Usage: aihub run [--start] -- <command> [args...]");
  }
  if (args.start) {
    await startCommand(["--quiet"]);
  }

  const status = await getServiceStatus({ configPath: getConfigPath() });
  if (!status.running) {
    throw new Error("AiHub service is not running. Run `aihub start` first, or use `aihub run --start -- <command>`.");
  }

  const child = spawn(command[0], command.slice(1), {
    stdio: "inherit",
    env: {
      ...process.env,
      OPENAI_BASE_URL: status.baseUrl,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || "aihub-local"
    }
  });

  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        process.exitCode = 1;
      } else {
        process.exitCode = code || 0;
      }
      resolve();
    });
  });
}

async function terminalCommand(argv) {
  const args = parseArgs(argv);
  const cwd = args.cwd || process.cwd();
  const app = args.app || "Terminal";

  if (process.platform === "darwin") {
    spawn("open", ["-a", app, cwd], {
      detached: true,
      stdio: "ignore"
    }).unref();
    console.log(`Opened ${app} at ${cwd}.`);
    return;
  }

  const candidates = process.platform === "win32" ? ["cmd.exe"] : ["x-terminal-emulator", "gnome-terminal", "konsole"];
  for (const command of candidates) {
    try {
      spawn(command, [], { cwd, detached: true, stdio: "ignore" }).unref();
      console.log(`Opened terminal at ${cwd}.`);
      return;
    } catch {
      // Try the next terminal command.
    }
  }
  throw new Error("Could not open a terminal on this platform.");
}

async function configCommand(argv) {
  const [subcommand] = argv;
  if (subcommand === "path") {
    console.log(getConfigPath());
    return;
  }
  if (subcommand === "show") {
    const config = await readStoreConfig();
    console.log(JSON.stringify({ ...config, subscriptions: config.subscriptions.map(redactSubscription) }, null, 2));
    return;
  }
  if (subcommand === "service") {
    const args = parseArgs(argv.slice(1));
    if (!args.host && args.port == null) {
      const config = await readStoreConfig();
      console.log(`host=${config.service.host}`);
      console.log(`port=${config.service.port}`);
      return;
    }
    await updateStoreConfig((config) =>
      setServiceAddress(config, {
        host: args.host,
        port: args.port
      })
    );
    const config = await readStoreConfig();
    console.log(`Set service address to ${config.service.host}:${config.service.port}.`);
    return;
  }
  throw new Error("Usage: aihub config path|show|service [--host host] [--port port]");
}

async function envCommand(argv) {
  const args = parseArgs(argv);
  const config = await readStoreConfig();
  const host = args.host || config.service.host;
  const port = args.port || config.service.port;
  const keys = await listPlatformKeys();
  console.log(`export OPENAI_BASE_URL=http://${host}:${port}/v1`);
  console.log("export OPENAI_API_KEY=aihub-local");
  if (keys.length > 0) {
    console.error("A platform key exists; replace OPENAI_API_KEY with a full key from `aihub key create`.");
  }
}

async function keyCommand(argv) {
  const [subcommand, ...rest] = argv;
  const args = parseArgs(rest);
  if (subcommand === "create") {
    const created = await createPlatformKey({
      name: args._[0] || args.name,
      monthlyRequestQuota: args.requests || args["request-quota"] || args.monthlyRequestQuota || 0,
      monthlyTokenQuota: args.tokens || args["token-quota"] || args.monthlyTokenQuota || 0
    });
    console.log(`Created platform key "${created.item.name}".`);
    console.log(created.key);
    console.log("Save this key now; AiHub will not show the full key again.");
    return;
  }
  if (subcommand === "fetch") {
    const name = rest[0];
    if (!name) {
      throw new Error("Usage: aihub model fetch <subscription>");
    }
    const config = await readStoreConfig();
    const subscription = config.subscriptions.find((item) => item.name === name);
    if (!subscription) {
      throw new Error(`Subscription "${name}" was not found.`);
    }
    const provider = providers[subscription.provider];
    if (!provider?.listModels) {
      throw new Error(`Provider "${subscription.provider}" does not support model discovery.`);
    }
    const models = await provider.listModels(subscription, {
      timeoutMs: subscription.timeoutMs || config.routing.requestTimeoutMs
    });
    await updateStoreConfig((current) => {
      const existing = current.subscriptions.find((item) => item.name === name);
      return upsertSubscription(current, {
        ...existing,
        models,
        model: existing?.model || models[0] || "",
        apiKey: existing?.apiKey || ""
      });
    });
    if (args.json) {
      console.log(JSON.stringify(models, null, 2));
    } else {
      console.log(`Fetched ${models.length} models for "${name}".`);
      for (const model of models) {
        console.log(model);
      }
    }
    return;
  }
  if (subcommand === "list" || !subcommand) {
    const keys = await listPlatformKeys();
    if (args.json) {
      console.log(JSON.stringify(keys, null, 2));
      return;
    }
    if (keys.length === 0) {
      console.log("No platform keys yet. Legacy aihub-local is accepted until one is created.");
      return;
    }
    for (const key of keys) {
      console.log(
        `${key.id}\t${key.enabled ? "on" : "off"}\t${key.name}\t${key.keyPrefix}\trequests=${key.monthRequests}/${key.monthlyRequestQuota || "∞"}\ttokens=${key.monthTokens}/${key.monthlyTokenQuota || "∞"}\tcache=${formatCliPercent(key.cacheHitRate)}`
      );
    }
    return;
  }
  if (subcommand === "disable" || subcommand === "enable") {
    const id = rest[0];
    if (!id) {
      throw new Error(`Usage: aihub key ${subcommand} <id>`);
    }
    await setPlatformKeyEnabled(id, subcommand === "enable");
    console.log(`${subcommand === "enable" ? "Enabled" : "Disabled"} platform key ${id}.`);
    return;
  }
  if (subcommand === "delete") {
    const id = rest[0];
    if (!id) {
      throw new Error("Usage: aihub key delete <id>");
    }
    await deletePlatformKey(id);
    console.log(`Deleted platform key ${id}.`);
    return;
  }
  throw new Error("Usage: aihub key create|list|enable|disable|delete");
}

async function modelCommand(argv) {
  const [subcommand, ...rest] = argv;
  const args = parseArgs(rest);
  if (subcommand === "create") {
    const alias = args._[0] || args.alias;
    if (!alias) {
      throw new Error("Usage: aihub model create <alias> [--description text]");
    }
    await upsertModelAlias({
      alias,
      description: args.description || "",
      enabled: args.enabled !== "false"
    });
    console.log(`Saved model alias "${alias}".`);
    return;
  }
  if (subcommand === "list" || !subcommand) {
    const aliases = await listModelAliases();
    if (args.json) {
      console.log(JSON.stringify(aliases, null, 2));
      return;
    }
    if (aliases.length === 0) {
      console.log("No model aliases yet. Create one with: aihub model create gpt-4o");
      return;
    }
    for (const alias of aliases) {
      const routes = alias.routes.map((route) => `${route.priority}:${route.subscriptionName}/${route.providerModel || "-"}`).join(",");
      console.log(`${alias.enabled ? "on" : "off"}\t${alias.alias}\troutes=${routes || "-"}`);
    }
    return;
  }
  if (subcommand === "route") {
    const [alias, subscriptionName] = args._;
    if (!alias || !subscriptionName) {
      throw new Error("Usage: aihub model route <alias> <subscription> [--model provider-model] [--priority 100]");
    }
    await upsertModelRoute({
      alias,
      subscriptionName,
      providerModel: args.model || args["provider-model"] || "",
      priority: args.priority || 100,
      enabled: args.enabled !== "false"
    });
    console.log(`Added route ${alias} -> ${subscriptionName}.`);
    return;
  }
  if (subcommand === "disable" || subcommand === "enable") {
    const alias = rest[0];
    if (!alias) {
      throw new Error(`Usage: aihub model ${subcommand} <alias>`);
    }
    await setModelAliasEnabled(alias, subcommand === "enable");
    console.log(`${subcommand === "enable" ? "Enabled" : "Disabled"} model alias "${alias}".`);
    return;
  }
  if (subcommand === "delete") {
    const alias = rest[0];
    if (!alias) {
      throw new Error("Usage: aihub model delete <alias>");
    }
    await deleteModelAlias(alias);
    console.log(`Deleted model alias "${alias}".`);
    return;
  }
  throw new Error("Usage: aihub model create|list|route|fetch|enable|disable|delete");
}

async function exportCommand(argv) {
  const args = parseArgs(argv);
  const payload = await exportStore({
    includeProviderKeys: Boolean(args["include-provider-keys"])
  });
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  if (args.out) {
    await writeFile(path.resolve(args.out), json, { mode: 0o600 });
    console.log(`Exported AiHub data to ${path.resolve(args.out)}.`);
    return;
  }
  console.log(json.trimEnd());
}

async function importCommand(argv) {
  const file = argv[0];
  if (!file) {
    throw new Error("Usage: aihub import <file>");
  }
  const payload = JSON.parse(await readFile(path.resolve(file), "utf8"));
  const config = await importStore(payload);
  console.log(`Imported AiHub data. subscriptions=${config.subscriptions.length} aliases=${config.modelAliases?.length || 0}`);
}

async function migrateCommand(argv) {
  const [subcommand = "status"] = argv;
  if (subcommand === "status" || subcommand === "run") {
    if (subcommand === "run") {
      await readStoreConfig();
    }
    console.log(JSON.stringify(await migrationStatus(), null, 2));
    return;
  }
  throw new Error("Usage: aihub migrate status|run");
}

function helpCommand() {
  console.log(`AiHub

Usage:
  aihub add <name> --provider gemini|claude|codex|openai-compatible --key <api-key> --model <model> [--priority 1]
  aihub list
  aihub priority <name> <number>
  aihub enable <name>
  aihub disable <name>
  aihub remove <name>
  aihub service [--host 127.0.0.1] [--port 8787]
  aihub start|stop|status
  aihub logs [--lines 80]
  aihub history [--limit 20] [--json]
  aihub doctor [--json]
  aihub routing fallback on|off|status
  aihub routing timeout [ms|status]
  aihub routing retries [count|status]
  aihub ask "prompt" [--provider gemini|claude|codex|openai-compatible] [--subscription name]
  aihub run [--start] -- <command> [args...]
  aihub terminal [--app Terminal] [--cwd path]
  aihub key create|list|enable|disable|delete
  aihub model create|list|route|fetch|enable|disable|delete
  aihub export [--safe] [--include-provider-keys] [--out file]
  aihub import <file>
  aihub migrate status|run
  aihub env
  aihub config path|show|service

Priority: lower number is used first. When fallback is on, failed requests automatically try the next matching subscription.
`);
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      result._.push(value);
      continue;
    }

    const [rawKey, inlineValue] = value.slice(2).split("=");
    const nextValue = argv[index + 1];
    if (inlineValue != null) {
      result[rawKey] = inlineValue;
    } else if (nextValue && !nextValue.startsWith("--")) {
      result[rawKey] = nextValue;
      index += 1;
    } else {
      result[rawKey] = true;
    }
  }
  return result;
}

function parseRunArgs(argv) {
  const separator = argv.indexOf("--");
  const optionTokens = separator >= 0 ? argv.slice(0, separator) : [];
  const command = separator >= 0 ? argv.slice(separator + 1) : argv;
  return {
    args: parseArgs(optionTokens),
    command
  };
}

async function readStdinIfPresent() {
  if (input.isTTY) {
    return "";
  }
  const chunks = [];
  const rl = readline.createInterface({ input, output });
  for await (const line of rl) {
    chunks.push(line);
  }
  return chunks.join("\n").trim();
}

export async function readPromptFile(filePath) {
  return readFile(filePath, "utf8");
}

function getHistoryPathForReport(configPath) {
  return process.env.AIHUB_HISTORY || path.join(getDataDir(configPath), "history.jsonl");
}

async function getServiceStatus({ configPath, host, port } = {}) {
  const config = await readStoreConfig(configPath);
  const pidInfo = await readPidInfo(configPath);
  const activeHost = host || pidInfo?.host || config.service.host;
  const activePort = Number(port || pidInfo?.port || config.service.port);
  const processRunning = pidInfo?.pid ? isProcessRunning(pidInfo.pid) : false;
  const health = await fetchHealth(activeHost, activePort);

  return {
    running: Boolean(health.ok && (!pidInfo?.pid || processRunning)),
    reachable: health.ok,
    processRunning,
    pid: pidInfo?.pid,
    url: `http://${activeHost}:${activePort}`,
    baseUrl: `http://${activeHost}:${activePort}/v1`,
    host: activeHost,
    port: activePort,
    configPath: configPath || getConfigPath(),
    logPath: getLogPath(configPath),
    health: health.body
  };
}

async function readPidInfo(configPath = getConfigPath()) {
  try {
    return JSON.parse(await readFile(getPidPath(configPath), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writePidInfo(pidInfo, configPath = getConfigPath()) {
  await mkdir(path.dirname(getPidPath(configPath)), { recursive: true });
  await writeFile(getPidPath(configPath), `${JSON.stringify(pidInfo, null, 2)}\n`, { mode: 0o600 });
}

async function removePidInfo(configPath = getConfigPath()) {
  await rm(getPidPath(configPath), { force: true });
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function fetchHealth(host, port) {
  try {
    const response = await fetch(`http://${host}:${port}/health`, {
      signal: AbortSignal.timeout(1000)
    });
    const text = await response.text();
    return {
      ok: response.ok,
      body: text ? JSON.parse(text) : {}
    };
  } catch {
    return { ok: false, body: null };
  }
}

async function waitForHealth({ host, port, timeoutMs }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const health = await fetchHealth(host, port);
    if (health.ok) {
      return health;
    }
    await delay(100);
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

async function waitForProcessExit(pid, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessRunning(pid)) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for pid ${pid} to stop.`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatCliPercent(value) {
  return `${Math.round(Number(value || 0) * 1000) / 10}%`;
}
