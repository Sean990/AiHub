import { ipcMain } from "electron";
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

export function registerIpcHandlers() {
  ipcMain.handle("config:read", async () => readDesktopConfig());
  ipcMain.handle("config:path", async () => getDesktopConfigPath());
  ipcMain.handle("config:setService", async (_event, payload) => setDesktopService(payload));
  ipcMain.handle("routing:setFallback", async (_event, enabled) => setDesktopFallback(enabled));
  ipcMain.handle("routing:setTimeout", async (_event, timeoutMs) => setDesktopRequestTimeout(timeoutMs));
  ipcMain.handle("routing:setRetryAttempts", async (_event, retryAttempts) => setDesktopRetryAttempts(retryAttempts));

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
}
