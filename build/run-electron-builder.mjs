import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builderCli = path.join(projectRoot, "node_modules", "electron-builder", "cli.js");
const cacheDir = path.join(projectRoot, "build", "electron-builder-cache");
const electronCacheDir = path.join(projectRoot, "build", "electron-cache");
const electronMirror = "https://npmmirror.com/mirrors/electron/";

const child = spawn(process.execPath, [builderCli, ...process.argv.slice(2)], {
  cwd: projectRoot,
  env: {
    ...process.env,
    ELECTRON_BUILDER_CACHE: cacheDir,
    ELECTRON_CACHE: electronCacheDir,
    ELECTRON_MIRROR: electronMirror,
    npm_config_electron_mirror: electronMirror,
    npm_config_disturl: electronMirror
  },
  stdio: "inherit",
  windowsHide: false
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
