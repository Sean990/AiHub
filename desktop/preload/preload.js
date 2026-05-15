import { contextBridge, ipcRenderer } from "electron";

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

function readInitialTheme() {
  const args = (typeof process !== "undefined" && Array.isArray(process.argv)) ? process.argv : [];
  for (const arg of args) {
    if (typeof arg === "string" && arg.startsWith("--aihub-initial-theme=")) {
      const value = arg.slice("--aihub-initial-theme=".length);
      if (value === "light" || value === "dark") {
        return value;
      }
    }
  }
  return null;
}

contextBridge.exposeInMainWorld("aihub", {
  initialTheme: readInitialTheme(),
  readConfig: () => invoke("config:read"),
  configPath: () => invoke("config:path"),
  setService: (payload) => invoke("config:setService", payload),
  setFallback: (enabled) => invoke("routing:setFallback", enabled),
  setRequestTimeout: (timeoutMs) => invoke("routing:setTimeout", timeoutMs),
  setRetryAttempts: (retryAttempts) => invoke("routing:setRetryAttempts", retryAttempts),
  setLogging: (payload) => invoke("logging:set", payload),
  revealPath: (targetPath) => invoke("ui:revealPath", targetPath),
  persistTheme: (theme) => invoke("ui:persistTheme", theme),
  upsertSubscription: (subscription) => invoke("subscriptions:upsert", subscription),
  removeSubscription: (name) => invoke("subscriptions:remove", name),
  setSubscriptionEnabled: (payload) => invoke("subscriptions:setEnabled", payload),
  setSubscriptionPriority: (payload) => invoke("subscriptions:setPriority", payload),
  fetchSubscriptionModels: (name) => invoke("subscriptions:fetchModels", name),
  testSubscriptionConnection: (payload) => invoke("subscriptions:testConnection", payload),
  querySubscriptionUsage: (payload) => invoke("subscriptions:queryUsage", payload),
  startService: (payload) => invoke("service:start", payload),
  stopService: () => invoke("service:stop"),
  serviceStatus: () => invoke("service:status"),
  readHistory: (payload) => invoke("history:read", payload),
  readUsage: (payload) => invoke("usage:read", payload),
  readLogs: (payload) => invoke("logs:read", payload),
  sendChat: (request) => invoke("chat:send", request),
  listPlatformKeys: () => invoke("platformKeys:list"),
  createPlatformKey: (payload) => invoke("platformKeys:create", payload),
  updatePlatformKey: (payload) => invoke("platformKeys:update", payload),
  setPlatformKeyEnabled: (payload) => invoke("platformKeys:setEnabled", payload),
  deletePlatformKey: (id) => invoke("platformKeys:delete", id),
  listModelAliases: () => invoke("modelAliases:list"),
  upsertModelAlias: (payload) => invoke("modelAliases:upsert", payload),
  setModelAliasEnabled: (payload) => invoke("modelAliases:setEnabled", payload),
  deleteModelAlias: (alias) => invoke("modelAliases:delete", alias),
  upsertModelRoute: (payload) => invoke("modelRoutes:upsert", payload),
  deleteModelRoute: (id) => invoke("modelRoutes:delete", id),
  exportStore: (payload) => invoke("store:export", payload),
  importStore: (payload) => invoke("store:import", payload),
  saveExportToFile: (payload) => invoke("ui:saveExport", payload),
  openImportFromFile: () => invoke("ui:openImport"),
  migrationStatus: () => invoke("migration:status")
});
