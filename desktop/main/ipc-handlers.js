import { ipcMain, dialog, shell } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  checkForUpdates,
  downloadUpdate,
  getUpdaterState,
  initializeUpdater,
  quitAndInstall,
  setUpdaterSettings
} from "./updater-controller.js";
import {
  getManagedServiceStatus,
  getDesktopConfigPath,
  createDesktopPlatformKey,
  deleteDesktopModelAlias,
  deleteDesktopModelRoute,
  deleteDesktopPlatformKey,
  exportDesktopStore,
  fetchDesktopSubscriptionModels,
  importDesktopStore,
  queryDesktopSubscriptionUsage,
  readDesktopConfig,
  readDesktopHistory,
  readDesktopLogs,
  readDesktopMigrationStatus,
  readDesktopModelAliases,
  readDesktopPlatformKeys,
  readDesktopUsage,
  removeDesktopSubscription,
  sendDesktopChat,
  setDesktopModelAliasEnabled,
  setDesktopPlatformKeyEnabled,
  setDesktopFallback,
  setDesktopRequestTimeout,
  setDesktopRetryAttempts,
  setDesktopLogging,
  setDesktopService,
  setDesktopSubscriptionEnabled,
  setDesktopSubscriptionPriority,
  startManagedService,
  stopManagedService,
  testDesktopSubscriptionConnection,
  updateDesktopPlatformKey,
  upsertDesktopModelAlias,
  upsertDesktopModelRoute,
  upsertDesktopSubscription
} from "./desktop-api.js";

export function registerIpcHandlers({ persistTheme } = {}) {
  ipcMain.handle("config:read", async () => readDesktopConfig());
  ipcMain.handle("config:path", async () => getDesktopConfigPath());
  ipcMain.handle("config:setService", async (_event, payload) => setDesktopService(payload));
  ipcMain.handle("routing:setFallback", async (_event, enabled) => setDesktopFallback(enabled));
  ipcMain.handle("routing:setTimeout", async (_event, timeoutMs) => setDesktopRequestTimeout(timeoutMs));
  ipcMain.handle("routing:setRetryAttempts", async (_event, retryAttempts) => setDesktopRetryAttempts(retryAttempts));
  ipcMain.handle("logging:set", async (_event, payload) => setDesktopLogging(payload || {}));
  ipcMain.handle("ui:revealPath", async (_event, targetPath) => {
    if (typeof targetPath !== "string" || !targetPath) {
      return false;
    }
    try {
      const stat = await fs.stat(targetPath);
      if (stat.isDirectory()) {
        await shell.openPath(targetPath);
      } else {
        shell.showItemInFolder(targetPath);
      }
      return true;
    } catch (error) {
      const parent = path.dirname(targetPath);
      if (parent && parent !== targetPath) {
        await shell.openPath(parent);
        return true;
      }
      throw error;
    }
  });
  ipcMain.handle("ui:persistTheme", async (_event, theme) => {
    if (typeof persistTheme === "function") {
      await persistTheme(theme);
    }
    return true;
  });

  ipcMain.handle("subscriptions:upsert", async (_event, subscription) => upsertDesktopSubscription(subscription));
  ipcMain.handle("subscriptions:remove", async (_event, name) => removeDesktopSubscription(name));
  ipcMain.handle("subscriptions:setEnabled", async (_event, payload) => setDesktopSubscriptionEnabled(payload));
  ipcMain.handle("subscriptions:setPriority", async (_event, payload) => setDesktopSubscriptionPriority(payload));
  ipcMain.handle("subscriptions:fetchModels", async (_event, name) => fetchDesktopSubscriptionModels(name));
  ipcMain.handle("subscriptions:testConnection", async (_event, payload) => testDesktopSubscriptionConnection(payload));
  ipcMain.handle("subscriptions:queryUsage", async (_event, payload) => queryDesktopSubscriptionUsage(payload));

  ipcMain.handle("service:start", async (_event, payload) => startManagedService(payload || {}));
  ipcMain.handle("service:stop", async () => stopManagedService());
  ipcMain.handle("service:status", async () => getManagedServiceStatus());

  ipcMain.handle("history:read", async (_event, payload) => readDesktopHistory(payload));
  ipcMain.handle("usage:read", async (_event, payload) => readDesktopUsage(payload));
  ipcMain.handle("logs:read", async (_event, payload) => readDesktopLogs(payload));
  ipcMain.handle("chat:send", async (_event, request) => sendDesktopChat(request));

  ipcMain.handle("platformKeys:list", async () => readDesktopPlatformKeys());
  ipcMain.handle("platformKeys:create", async (_event, payload) => createDesktopPlatformKey(payload));
  ipcMain.handle("platformKeys:update", async (_event, payload) => updateDesktopPlatformKey(payload));
  ipcMain.handle("platformKeys:setEnabled", async (_event, payload) => setDesktopPlatformKeyEnabled(payload));
  ipcMain.handle("platformKeys:delete", async (_event, id) => deleteDesktopPlatformKey(id));

  ipcMain.handle("modelAliases:list", async () => readDesktopModelAliases());
  ipcMain.handle("modelAliases:upsert", async (_event, payload) => upsertDesktopModelAlias(payload));
  ipcMain.handle("modelAliases:setEnabled", async (_event, payload) => setDesktopModelAliasEnabled(payload));
  ipcMain.handle("modelAliases:delete", async (_event, alias) => deleteDesktopModelAlias(alias));
  ipcMain.handle("modelRoutes:upsert", async (_event, payload) => upsertDesktopModelRoute(payload));
  ipcMain.handle("modelRoutes:delete", async (_event, id) => deleteDesktopModelRoute(id));

  ipcMain.handle("store:export", async (_event, payload) => exportDesktopStore(payload));
  ipcMain.handle("store:import", async (_event, payload) => importDesktopStore(payload));
  ipcMain.handle("migration:status", async () => readDesktopMigrationStatus());

  ipcMain.handle("ui:saveExport", async (_event, payload = {}) => {
    const { content, suggestedName } = payload || {};
    if (typeof content !== "string") {
      throw new Error("Export content must be a string.");
    }
    const result = await dialog.showSaveDialog({
      title: "保存 AiHub 配置",
      defaultPath: suggestedName || `aihub-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    await fs.writeFile(result.filePath, content, "utf8");
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle("ui:openImport", async () => {
    const result = await dialog.showOpenDialog({
      title: "导入 AiHub 配置",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    const [filePath] = result.filePaths;
    const content = await fs.readFile(filePath, "utf8");
    return { canceled: false, filePath, content };
  });

  ipcMain.handle("updater:state", async () => {
    await initializeUpdater();
    return getUpdaterState();
  });
  ipcMain.handle("updater:check", async (_event, payload) => checkForUpdates({ silent: Boolean(payload?.silent) }));
  ipcMain.handle("updater:download", async () => downloadUpdate());
  ipcMain.handle("updater:install", async () => {
    quitAndInstall();
    return true;
  });
  ipcMain.handle("updater:setSettings", async (_event, payload) => setUpdaterSettings(payload || {}));
}
