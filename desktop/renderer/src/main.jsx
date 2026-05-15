import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  Clipboard,
  Database,
  FileText,
  Gauge,
  History,
  Info,
  Keyboard,
  KeyRound,
  Layers,
  LayoutDashboard,
  Loader2,
  MessageSquareText,
  Moon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Square,
  Sun,
  Terminal,
  Trash2,
  Wifi,
  X,
  XCircle
} from "lucide-react";
import "./styles.css";

const providers = [
  { value: "gemini", label: "Gemini" },
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "openai-compatible", label: "OpenAI 兼容" }
];

const providerPresets = [
  { id: "gemini-official", provider: "gemini", label: "Gemini 官方", model: "gemini-2.5-flash", baseUrl: "" },
  { id: "claude-official", provider: "claude", label: "Claude 官方", model: "claude-sonnet-4-5", baseUrl: "" },
  { id: "codex-official", provider: "codex", label: "OpenAI / Codex", model: "gpt-5.1", baseUrl: "" },
  { id: "openai-compatible", provider: "openai-compatible", label: "OpenAI 兼容网关", model: "gpt-4o", baseUrl: "" }
];

const navItems = [
  { id: "dashboard", label: "仪表盘", icon: LayoutDashboard },
  { id: "subscriptions", label: "订阅管理", icon: KeyRound },
  { id: "platformKeys", label: "平台 Key", icon: Clipboard },
  { id: "models", label: "模型管理", icon: SlidersHorizontal },
  { id: "usage", label: "用量统计", icon: BarChart3 },
  { id: "chat", label: "对话测试", icon: MessageSquareText },
  { id: "history", label: "请求历史", icon: History },
  { id: "logs", label: "运行日志", icon: FileText },
  { id: "importExport", label: "导入导出", icon: Database },
  { id: "settings", label: "设置", icon: Settings }
];

const navGroups = [
  { label: "概览", items: ["dashboard"] },
  { label: "路由配置", items: ["subscriptions", "models", "platformKeys"] },
  { label: "观测", items: ["usage", "chat", "history", "logs"] },
  { label: "维护", items: ["importExport", "settings"] }
];

const THEME_STORAGE_KEY = "aihub-theme";
const ACTIVE_VIEW_STORAGE_KEY = "aihub-active-view";
const BROWSER_BRIDGE_STORAGE_KEY = "aihub-browser-bridge-state";
const TOAST_DEFAULT_TIMEOUT = 3600;
const TOAST_ERROR_TIMEOUT = 6500;
const SearchFocusContext = React.createContext(() => {});
const defaultBridge = createBrowserBridge();
const bridge = window.aihub || defaultBridge;
const isDemoBridge = bridge === defaultBridge;

function App() {
  const [activeView, setActiveView] = useState(() => getInitialView());
  const [theme, setTheme] = useState(() => getInitialTheme());
  const [config, setConfig] = useState(null);
  const [service, setService] = useState(null);
  const [history, setHistory] = useState([]);
  const [logs, setLogs] = useState([]);
  const [usage, setUsage] = useState(emptyUsageStats());
  const [platformKeys, setPlatformKeys] = useState([]);
  const [modelAliases, setModelAliases] = useState([]);
  const [migration, setMigration] = useState(null);
  const [providerUsage, setProviderUsage] = useState({});
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const searchFocusRef = useRef(null);

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((toast) => {
    if (!toast || (!toast.message && !toast.title)) {
      return;
    }
    const id = toast.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tone = toast.tone || "info";
    const timeout = toast.timeout != null
      ? toast.timeout
      : tone === "error"
        ? TOAST_ERROR_TIMEOUT
        : TOAST_DEFAULT_TIMEOUT;
    const next = { ...toast, id, tone, timeout };
    setToasts((current) => [...current.filter((item) => item.id !== id).slice(-4), next]);
    if (timeout > 0) {
      window.setTimeout(() => dismissToast(id), timeout);
    }
  }, [dismissToast]);

  const notify = useCallback((message, options = {}) => {
    if (!message) {
      return;
    }
    pushToast({ tone: "success", ...options, message });
  }, [pushToast]);

  const reportError = useCallback((errorOrMessage, options = {}) => {
    const message = errorOrMessage?.message || (typeof errorOrMessage === "string" ? errorOrMessage : String(errorOrMessage));
    if (!message) {
      return;
    }
    pushToast({ tone: "error", ...options, message });
  }, [pushToast]);

  const refreshAll = useCallback(async () => {
    const tasks = [
      ["config", () => bridge.readConfig(), setConfig],
      ["service", () => bridge.serviceStatus(), setService],
      ["history", () => bridge.readHistory({ limit: 80 }), setHistory],
      ["logs", () => bridge.readLogs({ lines: 180 }), setLogs],
      ["usage", () => bridge.readUsage({ limit: 10000 }), setUsage],
      ["platformKeys", () => bridge.listPlatformKeys(), setPlatformKeys],
      ["modelAliases", () => bridge.listModelAliases(), setModelAliases],
      ["migration", () => bridge.migrationStatus(), setMigration]
    ];
    setRefreshing(true);
    try {
      const results = await Promise.allSettled(tasks.map(([, run]) => run()));
      const failures = [];
      results.forEach((entry, index) => {
        const [name, , apply] = tasks[index];
        if (entry.status === "fulfilled") {
          apply(entry.value);
        } else {
          failures.push({ name, reason: entry.reason });
        }
      });
      if (failures.length > 0) {
        const detail = failures
          .map(({ name, reason }) => `${name}: ${reason?.message || String(reason)}`)
          .join("；");
        reportError(`部分数据刷新失败 — ${detail}`);
      }
    } finally {
      setRefreshing(false);
    }
  }, [reportError]);

  const refreshLogs = useCallback(async () => {
    try {
      const nextLogs = await bridge.readLogs({ lines: 180 });
      setLogs(nextLogs);
    } catch (nextError) {
      reportError(nextError);
    }
  }, [reportError]);

  const refreshSecondary = useCallback(async () => {
    const tasks = [
      ["service", () => bridge.serviceStatus(), setService],
      ["history", () => bridge.readHistory({ limit: 80 }), setHistory],
      ["usage", () => bridge.readUsage({ limit: 10000 }), setUsage],
      ["platformKeys", () => bridge.listPlatformKeys(), setPlatformKeys],
      ["modelAliases", () => bridge.listModelAliases(), setModelAliases],
      ["migration", () => bridge.migrationStatus(), setMigration]
    ];
    const results = await Promise.allSettled(tasks.map(([, run]) => run()));
    results.forEach((entry, index) => {
      const [, , apply] = tasks[index];
      if (entry.status === "fulfilled") {
        apply(entry.value);
      }
    });
  }, []);

  const runAction = useCallback(async (action, successMessage) => {
    setBusy(true);
    try {
      const result = await action();
      const nextConfig = configFromActionResult(result);
      if (nextConfig) {
        setConfig(nextConfig);
        await refreshSecondary();
      } else {
        await refreshAll();
      }
      if (successMessage) {
        notify(successMessage);
      }
      return result;
    } catch (nextError) {
      reportError(nextError);
      throw nextError;
    } finally {
      setBusy(false);
    }
  }, [refreshAll, refreshSecondary, reportError, notify]);

  async function copyText(text, successMessage = "已复制到剪贴板") {
    if (!text) {
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.inset = "0 auto auto 0";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      notify(successMessage);
    } catch (nextError) {
      reportError(`复制失败：${nextError.message || String(nextError)}`);
    }
  }

  function runConfirmed(options) {
    setConfirm({
      tone: "danger",
      confirmLabel: "确认",
      cancelLabel: "取消",
      ...options
    });
  }

  async function handleConfirm() {
    if (!confirm) {
      return;
    }
    const current = confirm;
    setConfirm(null);
    try {
      const result = await runAction(current.action, current.successMessage);
      if (current.onResolved) {
        current.onResolved(result);
      }
    } catch {
      // runAction already surfaces the error in the global message strip.
    }
  }

  useEffect(() => {
    refreshAll().catch((nextError) => reportError(nextError));
  }, [refreshAll, reportError]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage?.setItem(THEME_STORAGE_KEY, theme);
    if (typeof bridge.persistTheme === "function") {
      Promise.resolve(bridge.persistTheme(theme)).catch(() => {});
    }
  }, [theme]);

  useEffect(() => {
    if (!activeView) {
      return;
    }
    try {
      window.localStorage?.setItem(ACTIVE_VIEW_STORAGE_KEY, activeView);
    } catch {
      // ignore quota errors
    }
  }, [activeView]);

  useEffect(() => {
    function isTextEditingTarget(target) {
      if (!target) {
        return false;
      }
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return true;
      }
      return Boolean(target.isContentEditable);
    }

    function handleShortcut(event) {
      if (event.defaultPrevented) {
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const focusFn = searchFocusRef.current;
        if (typeof focusFn === "function") {
          focusFn();
        } else {
          pushToast({
            tone: "info",
            message: "当前页没有可搜索内容",
            timeout: 1800
          });
        }
        return;
      }
      if (meta && event.key.toLowerCase() === "r") {
        event.preventDefault();
        runAction(refreshAll).catch(() => {});
        return;
      }
      if (meta && /^[1-9]$/.test(event.key)) {
        const targetIndex = Number(event.key) - 1;
        const target = navItems[targetIndex];
        if (target) {
          event.preventDefault();
          setActiveView(target.id);
        }
        return;
      }
      if (meta && event.key === "0") {
        const target = navItems[navItems.length - 1];
        if (target) {
          event.preventDefault();
          setActiveView(target.id);
        }
        return;
      }
      if (event.key === "?" && !isTextEditingTarget(event.target)) {
        event.preventDefault();
        setShortcutsOpen((current) => !current);
      }
    }

    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [runAction, refreshAll, pushToast]);

  const enabledSubscriptions = useMemo(
    () => (config?.subscriptions || []).filter((subscription) => subscription.enabled),
    [config]
  );
  const recent = useMemo(() => {
    if (!history || history.length === 0) {
      return null;
    }
    let latest = null;
    let latestTime = -Infinity;
    for (const entry of history) {
      const time = new Date(entry?.ts || 0).getTime();
      if (Number.isFinite(time) && time >= latestTime) {
        latest = entry;
        latestTime = time;
      }
    }
    return latest || history[history.length - 1];
  }, [history]);

  useEffect(() => {
    if (!config) {
      return;
    }
    setProviderUsage((current) => {
      const known = new Set((config.subscriptions || []).map((subscription) => subscription.name));
      const next = {};
      let changed = false;
      for (const [name, value] of Object.entries(current)) {
        if (known.has(name)) {
          next[name] = value;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [config]);

  return (
    <SearchFocusContext.Provider value={searchFocusRef}>
      <div className="app-shell">
        <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Bot size={18} />
          </div>
          <div>
            <div className="brand-title">AiHub</div>
            <div className="brand-subtitle">Local Gateway</div>
          </div>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((id) => {
                const item = navItems.find((entry) => entry.id === id);
                const Icon = item.icon;
                const shortcutIndex = navItems.findIndex((entry) => entry.id === id);
                const shortcutLabel = shortcutIndex >= 0 && shortcutIndex < 9
                  ? `${getMetaKeyLabel()}+${shortcutIndex + 1}`
                  : "";
                return (
                  <button
                    className={`nav-button ${activeView === item.id ? "active" : ""}`}
                    key={item.id}
                    onClick={() => setActiveView(item.id)}
                    aria-label={item.label}
                    aria-current={activeView === item.id ? "page" : undefined}
                    title={shortcutLabel ? `${item.label} · ${shortcutLabel}` : item.label}
                    type="button"
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                    {shortcutLabel ? <kbd className="nav-shortcut">{shortcutLabel}</kbd> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{navItems.find((item) => item.id === activeView)?.label}</h1>
            <p>{viewSubtitle(activeView)}</p>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button"
              onClick={() => setShortcutsOpen(true)}
              aria-label="键盘快捷键"
              title="键盘快捷键 · ?"
              type="button"
            >
              <Keyboard size={16} />
            </button>
            <button
              className="icon-button theme-toggle"
              onClick={(event) => toggleThemeWithReveal(event.currentTarget, theme, setTheme)}
              aria-label={theme === "dark" ? "切换浅色模式" : "切换深色模式"}
              title={theme === "dark" ? "切换浅色模式" : "切换深色模式"}
              type="button"
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button
              className={`icon-button ${refreshing ? "is-busy" : ""}`}
              onClick={() => runAction(refreshAll)}
              aria-label="刷新全部状态"
              title={`刷新 · ${getMetaKeyLabel()}+R`}
              disabled={refreshing}
              type="button"
            >
              <RefreshCw className={refreshing ? "spin" : ""} size={16} />
            </button>
            {service?.running ? (
              <button
                className="danger-button"
                onClick={() =>
                  runConfirmed({
                    title: "停止本地网关",
                    body: `外部工具将无法继续访问 ${service.baseUrl}，直到服务重新启动。`,
                    confirmLabel: "停止服务",
                    action: () => bridge.stopService(),
                    successMessage: "服务已停止"
                  })
                }
                type="button"
              >
                <Square size={14} />
                停止
              </button>
            ) : (
              <button className="primary-button" onClick={() => runAction(() => bridge.startService(), "服务已启动")} type="button">
                <Play size={14} />
                启动
              </button>
            )}
          </div>
        </header>

        <div className="workspace-content">
          {isDemoBridge ? (
            <div className="message-strip warn demo-bridge-banner" role="status" aria-live="polite">
              <AlertTriangle size={16} />
              <div>
                <div className="strong">桌面 API 桥接未启用</div>
                <p className="muted">当前显示的是浏览器演示数据，未连接到本地服务。如果你在 Electron 中看到此提示，说明 preload 加载失败，请重新启动客户端。</p>
              </div>
            </div>
          ) : null}
          {config && service ? (
            <WorkspaceStatusBar
              config={config}
              enabledSubscriptions={enabledSubscriptions}
              modelAliases={modelAliases}
              platformKeys={platformKeys}
              service={service}
              usage={usage}
              providerUsage={providerUsage}
              copyText={copyText}
            />
          ) : null}

          {!config || !service ? (
            <LoadingState />
          ) : (
            <ViewRouter
              activeView={activeView}
              config={config}
              service={service}
              enabledSubscriptions={enabledSubscriptions}
              history={history}
              logs={logs}
              usage={usage}
              platformKeys={platformKeys}
              modelAliases={modelAliases}
              migration={migration}
              recent={recent}
              runAction={runAction}
              refreshAll={refreshAll}
              refreshLogs={refreshLogs}
              providerUsage={providerUsage}
              setProviderUsage={setProviderUsage}
              setActiveView={setActiveView}
              runConfirmed={runConfirmed}
              copyText={copyText}
              notify={notify}
              reportError={reportError}
            />
          )}
        </div>
      </main>
        <ConfirmDialog confirm={confirm} onCancel={() => setConfirm(null)} onConfirm={handleConfirm} />
        <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        <ToastStack toasts={toasts} onDismiss={dismissToast} busy={busy} />
      </div>
    </SearchFocusContext.Provider>
  );
}

function configFromActionResult(result) {
  if (isConfigPayload(result)) {
    return result;
  }
  if (isConfigPayload(result?.config)) {
    return result.config;
  }
  return null;
}

function isConfigPayload(value) {
  return Boolean(value?.service && value?.routing && Array.isArray(value?.subscriptions));
}

function ViewRouter(props) {
  switch (props.activeView) {
    case "subscriptions":
      return <SubscriptionsView {...props} />;
    case "platformKeys":
      return <PlatformKeysView {...props} />;
    case "models":
      return <ModelsView {...props} />;
    case "usage":
      return <UsageView {...props} />;
    case "chat":
      return <ChatView {...props} />;
    case "history":
      return <HistoryView {...props} />;
    case "logs":
      return <LogsView {...props} />;
    case "importExport":
      return <ImportExportView {...props} />;
    case "settings":
      return <SettingsView {...props} />;
    default:
      return <DashboardView {...props} />;
  }
}

function WorkspaceStatusBar({ config, enabledSubscriptions, modelAliases, platformKeys, service, usage, copyText }) {
  const totalSubscriptions = config.subscriptions?.length || 0;
  const activeKeys = (platformKeys || []).filter((key) => key.enabled).length;
  const activeModels = (modelAliases || []).filter((alias) => alias.enabled).length;
  const retryAttempts = config.routing?.retryAttempts ?? 5;

  return (
    <section className="workspace-statusbar" aria-label="当前服务概览">
      <StatusPill running={service.running} />
      <div className="statusbar-item statusbar-base-url">
        <span>Base URL</span>
        <code title={service.baseUrl}>{service.baseUrl}</code>
        <button
          className="inline-copy-button"
          onClick={() => copyText(service.baseUrl, "Base URL 已复制")}
          aria-label="复制 Base URL"
          title="复制 Base URL"
          type="button"
        >
          <Clipboard size={14} />
        </button>
        <button
          className="inline-copy-button"
          onClick={() => copyText(buildOpenAiEnvSnippet(service, platformKeys), "OpenAI 环境变量已复制")}
          aria-label="复制 OpenAI 环境变量"
          title="复制 export OPENAI_BASE_URL / OPENAI_API_KEY"
          type="button"
        >
          <Terminal size={14} />
        </button>
      </div>
      <div className="statusbar-item">
        <span>订阅</span>
        <strong>{enabledSubscriptions.length}/{totalSubscriptions}</strong>
      </div>
      <div className="statusbar-item">
        <span>平台 Key</span>
        <strong>{activeKeys}</strong>
      </div>
      <div className="statusbar-item">
        <span>公开模型</span>
        <strong>{activeModels}</strong>
      </div>
      <div className="statusbar-item">
        <span>切换策略</span>
        <strong>{config.routing?.fallback ? `开启 · ${retryAttempts} 次` : "关闭"}</strong>
      </div>
      <div className="statusbar-item">
        <span>请求</span>
        <strong>{formatNumber(usage.total.requests)}</strong>
      </div>
    </section>
  );
}

function DashboardView({ config, service, enabledSubscriptions, logs, usage, recent, runAction, setActiveView, runConfirmed }) {
  const providerSummaries = buildProviderSummaries(config.subscriptions || []);
  const routingLanes = [...enabledSubscriptions]
    .sort((a, b) => Number(a.priority || 9999) - Number(b.priority || 9999))
    .slice(0, 4);
  const primaryRoute = routingLanes[0];

  return (
    <div className="stack dashboard-view">
      <section className="service-hero">
        <div className={`service-hero-card ${service.running ? "running" : "stopped"}`}>
          <div className="service-hero-head">
            <div>
              <p className="eyebrow">Gateway Control</p>
              <h2>{service.running ? "网关正在接管本机 AI 请求" : "网关待启动"}</h2>
              <p className="muted">统一接入订阅池、平台 Key 和公开模型别名，外部工具只需要指向本地 API。</p>
            </div>
          </div>
          <div className="hero-route-summary">
            <div>
              <span>首选路由</span>
              <strong>{primaryRoute ? primaryRoute.name : "暂无启用订阅"}</strong>
            </div>
            <div>
              <span>首选模型</span>
              <strong>{primaryRoute?.model || primaryRoute?.models?.[0] || "—"}</strong>
            </div>
            <div>
              <span>最近响应</span>
              <strong>
                {recent
                  ? recent.ok
                    ? `成功 · ${formatTokenLabel(recent.usage?.totalTokens)}`
                    : "失败"
                  : "暂无"}
              </strong>
            </div>
          </div>
          <div className="service-hero-actions">
            {service.running ? (
              <button
                className="danger-button"
                onClick={() =>
                  runConfirmed({
                    title: "停止本地网关",
                    body: `外部工具将无法继续访问 ${service.baseUrl}，直到服务重新启动。`,
                    confirmLabel: "停止网关",
                    action: () => bridge.stopService(),
                    successMessage: "服务已停止"
                  })
                }
                type="button"
              >
                <Square size={14} />
                停止网关
              </button>
            ) : (
              <button className="primary-button" onClick={() => runAction(() => bridge.startService(), "服务已启动")} type="button">
                <Play size={14} />
                启动网关
              </button>
            )}
            <button className="secondary-button" onClick={() => setActiveView("chat")} type="button">
              <MessageSquareText size={14} />
              对话测试
            </button>
            <button className="secondary-button" onClick={() => setActiveView("settings")} type="button">
              <Settings size={14} />
              策略设置
            </button>
          </div>
        </div>

        <div className="provider-rail">
          <div className="provider-rail-head">
            <div>
              <p className="eyebrow">Provider Switch</p>
              <h2>订阅切换池</h2>
            </div>
            <button className="secondary-button" onClick={() => setActiveView("subscriptions")} type="button">
              <KeyRound size={14} />
              管理
            </button>
          </div>
          <div className="provider-lane-grid">
            {providerSummaries.map((summary) => (
              <button
                className={`provider-lane ${summary.enabled > 0 ? "ready" : ""}`}
                key={summary.value}
                onClick={() => setActiveView("subscriptions")}
                type="button"
                title={`查看 ${summary.label} 订阅`}
              >
                <ProviderBadge provider={summary.value} />
                <strong>{summary.label}</strong>
                <span>{summary.enabled}/{summary.total} 启用 · {summary.models} 模型</span>
              </button>
            ))}
          </div>
          <div className="routing-ladder" aria-label="当前路由优先级">
            {routingLanes.length > 0 ? routingLanes.map((subscription, index) => (
              <div className={`routing-step ${index === 0 ? "primary" : ""}`} key={subscription.name}>
                <span>{index + 1}</span>
                <div>
                  <strong>{subscription.name}</strong>
                  <code>{subscription.model || subscription.models?.[0] || "model"}</code>
                </div>
              </div>
            )) : (
              <EmptyState title="暂无启用订阅" body="启用订阅后会在这里显示路由优先级。" />
            )}
          </div>
        </div>
      </section>

      <section className="metrics-grid hero-metrics">
        <Metric label="成功率" value={formatPercent(usage.total.successRate)} icon={CheckCircle2} tone="good" />
        <Metric label="总 Token" value={formatNumber(usage.total.totalTokens)} icon={Activity} />
        <Metric label="缓存命中率" value={formatPercent(usage.total.cacheHitRate)} icon={Gauge} tone="good" />
        <Metric label="平均延迟" value={`${formatNumber(usage.total.averageLatencyMs)} ms`} icon={Terminal} />
      </section>

      <section className="two-column">
        <div className="panel">
          <h2><Layers size={18} /> 最近路由</h2>
          {recent ? (
            <div className="detail-list">
              <Row label="时间" value={recent.ts} />
              <Row label="结果" value={recent.ok ? "成功" : "失败"} />
              <Row label="路由" value={`${recent.provider || "auto"} / ${recent.subscription || "-"} / ${recent.model || "-"}`} />
              <Row label="Token" value={formatTokenLabel(recent.usage?.totalTokens)} />
              <Row label="缓存命中" value={formatPercentOrDash(cacheHitRate(recent.usage), recent.usage?.inputTokens)} />
              {recent.error ? <Row label="错误" value={recent.error} /> : null}
            </div>
          ) : (
            <EmptyState title="暂无请求" body="可以在对话测试页发送请求，或让外部 CLI 指向本地 API。" />
          )}
        </div>
        <div className="panel">
          <h2><FileText size={18} /> 最新日志</h2>
          {logs.length > 0 ? (
            <pre className="log-preview">{logs.slice(-8).join("\n")}</pre>
          ) : (
            <EmptyState title="暂无日志" body="服务启动、停止和异常信息会显示在这里。" />
          )}
        </div>
      </section>
    </div>
  );
}

function buildProviderSummaries(subscriptions = []) {
  return providers.map((provider) => {
    const items = subscriptions.filter((subscription) => subscription.provider === provider.value);
    return {
      ...provider,
      total: items.length,
      enabled: items.filter((subscription) => subscription.enabled).length,
      models: items.reduce((sum, item) => sum + (item.models?.length || (item.model ? 1 : 0)), 0)
    };
  });
}

function SubscriptionsView({ config, service, usage, runAction, providerUsage, setProviderUsage, runConfirmed, notify }) {
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const usageByName = useMemo(() => new Map((usage.subscriptions || []).map((item) => [item.name, item])), [usage]);
  const normalizedFilter = filter.trim().toLowerCase();
  const subscriptions = (config.subscriptions || []).filter((item) => {
    const providerMatched = providerFilter === "all" || item.provider === providerFilter;
    const textMatched = `${item.name} ${item.provider} ${item.model} ${(item.models || []).join(" ")} ${item.notes || ""} ${item.website || ""}`
      .toLowerCase()
      .includes(normalizedFilter);
    return providerMatched && textMatched;
  });
  const grouped = providers.map((provider) => ({
    ...provider,
    items: subscriptions.filter((subscription) => subscription.provider === provider.value)
  })).filter((group) => group.items.length > 0);
  const allSubscriptions = config.subscriptions || [];
  const allGroups = providers.map((provider) => {
    const items = allSubscriptions.filter((subscription) => subscription.provider === provider.value);
    return {
      ...provider,
      total: items.length,
      enabled: items.filter((subscription) => subscription.enabled).length,
      models: items.reduce((sum, item) => sum + (item.models?.length || (item.model ? 1 : 0)), 0)
    };
  });

  async function queryUsage(subscription) {
    const result = await runAction(() => bridge.querySubscriptionUsage(subscription.name), "供应商用量已更新");
    setProviderUsage((current) => ({ ...current, [subscription.name]: result }));
    return result;
  }

  const totalEnabled = allSubscriptions.filter((subscription) => subscription.enabled).length;
  const totalModels = allSubscriptions.reduce((sum, item) => sum + (item.models?.length || (item.model ? 1 : 0)), 0);
  const providerTabValues = ["all", ...providers.map((provider) => provider.value)];

  function handleProviderTabKey(event, currentValue) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const currentIndex = providerTabValues.indexOf(currentValue);
    const lastIndex = providerTabValues.length - 1;
    const nextIndex = {
      ArrowLeft: currentIndex <= 0 ? lastIndex : currentIndex - 1,
      ArrowRight: currentIndex >= lastIndex ? 0 : currentIndex + 1,
      Home: 0,
      End: lastIndex
    }[event.key];
    const nextValue = providerTabValues[nextIndex];
    setProviderFilter(nextValue);
    event.currentTarget.parentElement
      ?.querySelector(`[data-provider-tab="${nextValue}"]`)
      ?.focus();
  }

  return (
    <div className="stack subscriptions-view">
      {service && !service.running && (config.subscriptions || []).some((subscription) => subscription.enabled) ? (
        <div className="message-strip warn">
          <AlertTriangle size={16} />
          <div>
            <div className="strong">本地网关未启动</div>
            <p className="muted">订阅已启用，但外部 CLI 还无法访问。点击右上角"启动"或下方按钮开启网关。</p>
          </div>
          <button
            className="primary-button"
            onClick={() => runAction(() => bridge.startService(), "服务已启动")}
            type="button"
          >
            <Play size={14} />
            启动网关
          </button>
        </div>
      ) : null}

      <section className="provider-tabs" role="tablist" aria-label="按供应商筛选">
        <button
          className={`provider-tab all ${providerFilter === "all" ? "active" : ""}`}
          data-provider-tab="all"
          onClick={() => setProviderFilter("all")}
          onKeyDown={(event) => handleProviderTabKey(event, "all")}
          role="tab"
          aria-selected={providerFilter === "all"}
          type="button"
        >
          <span className="provider-tab-mark">
            <Layers size={14} />
          </span>
          <span className="provider-tab-label">全部</span>
          <span className="provider-tab-meta">{totalEnabled}/{allSubscriptions.length}</span>
        </button>
        {allGroups.map((group) => (
          <button
            className={`provider-tab ${group.value} ${providerFilter === group.value ? "active" : ""}`}
            data-provider-tab={group.value}
            key={group.value}
            onClick={() => setProviderFilter(group.value)}
            onKeyDown={(event) => handleProviderTabKey(event, group.value)}
            role="tab"
            aria-selected={providerFilter === group.value}
            type="button"
          >
            <ProviderMark provider={group.value} size={14} />
            <span className="provider-tab-label">{group.label}</span>
            <span className="provider-tab-meta">{group.enabled}/{group.total}</span>
          </button>
        ))}
        <div className="provider-tabs-spacer" />
        <div className="provider-tabs-summary">
          <span>{totalModels}</span>
          <small>模型</small>
        </div>
      </section>

      <SearchBar
        value={filter}
        onChange={setFilter}
        ariaLabel="按名称、供应商或模型筛选订阅"
        placeholder="搜索名称、模型或备注…"
        matchLabel={
          <>
            匹配 <strong>{subscriptions.length}</strong> 个订阅
          </>
        }
      />

      {grouped.map((group) => {
        const groupModels = group.items.reduce((sum, item) => sum + (item.models?.length || (item.model ? 1 : 0)), 0);
        const groupEnabled = group.items.filter((item) => item.enabled).length;
        return (
          <section className="sub-section" key={group.value}>
            <header className="sub-section-head">
              <div className="sub-section-title">
                <ProviderMark provider={group.value} size={16} />
                <h2>{group.label}</h2>
                <span className="sub-section-count">{group.items.length}</span>
              </div>
              <span className="sub-section-meta">
                {groupEnabled} 启用 · {groupModels} 模型
              </span>
            </header>
            <div className="sub-row-list">
              {group.items.map((subscription) => (
                <SubscriptionRow
                  key={subscription.name}
                  subscription={subscription}
                  stats={usageByName.get(subscription.name) || emptyUsageBucket(subscription)}
                  providerUsage={providerUsage[subscription.name]}
                  onEdit={() => setEditing(subscription)}
                  onToggle={(enabled) =>
                    runAction(() => bridge.setSubscriptionEnabled({ name: subscription.name, enabled }))
                  }
                  onPriorityChange={(priority) =>
                    runAction(() => bridge.setSubscriptionPriority({ name: subscription.name, priority }))
                  }
                  onFetchModels={() =>
                    runAction(() => bridge.fetchSubscriptionModels(subscription.name), "模型列表已更新")
                  }
                  onQueryUsage={() => queryUsage(subscription)}
                  onTestConnection={async () => {
                    try {
                      const result = await runAction(
                        () => bridge.testSubscriptionConnection(subscription.name)
                      );
                      if (result?.ok) {
                        notify?.(`连接成功 · ${result.modelCount} 个模型 · ${result.latencyMs} ms`);
                      }
                    } catch {
                      // already surfaced
                    }
                  }}
                  onDelete={() =>
                    runConfirmed({
                      title: "删除订阅",
                      body: `将删除订阅 "${subscription.name}"。相关路由和外部调用可能受到影响，此操作不可撤销。`,
                      confirmLabel: "删除订阅",
                      action: () => bridge.removeSubscription(subscription.name),
                      successMessage: "订阅已删除"
                    })
                  }
                />
              ))}
            </div>
          </section>
        );
      })}
      {subscriptions.length === 0 ? (
        <section className="panel sub-empty-panel">
          <EmptyState
            title={filter || providerFilter !== "all" ? "没有匹配的订阅" : "暂无订阅"}
            body={
              filter || providerFilter !== "all"
                ? "试试清空搜索或切换其他供应商分组。"
                : "点击右下角的 + 按钮，新增一个 Gemini、Claude 或 Codex 订阅。"
            }
          />
        </section>
      ) : null}

      <button
        className="fab-add"
        onClick={() => setEditing(emptySubscription())}
        aria-label="新增订阅"
        title="新增订阅"
        type="button"
      >
        <Plus size={20} />
      </button>

      {editing ? (
        <SubscriptionDialog
          subscription={editing}
          subscriptions={config.subscriptions || []}
          onClose={() => setEditing(null)}
          onSave={(payload) =>
            runAction(() => bridge.upsertSubscription(payload), "订阅已保存").then(() => setEditing(null))
          }
        />
      ) : null}
    </div>
  );
}

function SubscriptionRow({
  subscription,
  stats,
  providerUsage,
  onEdit,
  onToggle,
  onPriorityChange,
  onFetchModels,
  onQueryUsage,
  onTestConnection,
  onDelete
}) {
  const models = subscription.models?.length ? subscription.models : subscription.model ? [subscription.model] : [];
  const isActive = Boolean(subscription.enabled);
  return (
    <article
      className={`sub-row ${isActive ? "is-active" : "is-disabled"}`}
      role="group"
      aria-label={`订阅 ${subscription.name}`}
    >
      <div className="sub-row-glow" aria-hidden />
      <div className="sub-row-main">
        <div className="sub-row-icon" aria-hidden>
          <ProviderMark provider={subscription.provider} size={18} />
        </div>
        <div className="sub-row-identity">
          <div className="sub-row-name-line">
            <h3 className="sub-row-name" title={subscription.name}>{subscription.name}</h3>
            <ProviderBadge provider={subscription.provider} />
            {subscription.priority != null ? (
              <span className="sub-row-priority-badge" title="路由优先级">P{subscription.priority}</span>
            ) : null}
          </div>
          <div className="sub-row-meta">
            {subscription.website ? (
              <a
                href={subscription.website}
                target="_blank"
                rel="noreferrer"
                className="sub-row-link"
                title={`打开官网 ${subscription.website}`}
              >
                <Wifi size={11} />
                <span>{subscription.website.replace(/^https?:\/\//, "")}</span>
              </a>
            ) : (
              <span className="sub-row-muted"><Wifi size={11} />未配置接口地址</span>
            )}
            {subscription.notes ? (
              <span className="sub-row-muted" title={subscription.notes}>
                <FileText size={11} />
                <span className="sub-row-notes">{subscription.notes}</span>
              </span>
            ) : null}
          </div>
          <div className="sub-row-models">
            {models.length > 0 ? models.slice(0, 4).map((model) => (
              <code key={model} title={model}>{model}</code>
            )) : <span className="sub-row-muted">尚未指定模型</span>}
            {models.length > 4 ? <span className="sub-row-more">+{models.length - 4}</span> : null}
          </div>
        </div>
      </div>

      <div className="sub-row-stats" aria-label="订阅用量统计">
        <div>
          <span>请求</span>
          <strong>{formatNumber(stats.requests)}</strong>
        </div>
        <div>
          <span>Token</span>
          <strong>{formatNumber(stats.totalTokens)}</strong>
        </div>
        <div>
          <span>缓存</span>
          <strong>{formatPercent(stats.cacheHitRate)}</strong>
        </div>
        <div className="sub-row-quota" title="供应商额度（点击右侧按钮查询）">
          <span>额度</span>
          <strong>{providerUsage ? formatProviderUsage(providerUsage) : "—"}</strong>
        </div>
      </div>

      <div className="sub-row-controls">
        <label className="sub-row-priority" title="路由优先级（数字越小越优先）">
          <span>优先级</span>
          <PriorityInput
            ariaLabel={`设置 ${subscription.name} 的优先级`}
            value={subscription.priority}
            onCommit={onPriorityChange}
          />
        </label>
        <label className="switch sub-row-switch" title={isActive ? "停用订阅" : "启用订阅"}>
          <input
            checked={isActive}
            type="checkbox"
            aria-label={`${isActive ? "停用" : "启用"}订阅 ${subscription.name}`}
            onChange={(event) => onToggle(event.target.checked)}
          />
          <span />
        </label>
        <div className="sub-row-actions">
          <button
            className="icon-button"
            onClick={onTestConnection}
            aria-label={`测试 ${subscription.name} 的连通性`}
            title="测试连通性"
            type="button"
          >
            <Wifi size={15} />
          </button>
          <button
            className="icon-button"
            onClick={onFetchModels}
            aria-label={`一键获取 ${subscription.name} 的模型列表`}
            title="一键获取模型列表"
            type="button"
          >
            <RefreshCw size={15} />
          </button>
          <button
            className="icon-button"
            onClick={onQueryUsage}
            aria-label={`查询 ${subscription.name} 的供应商用量`}
            title="查询供应商额度"
            type="button"
          >
            <Gauge size={15} />
          </button>
          <button
            className="icon-button"
            onClick={onEdit}
            aria-label={`编辑订阅 ${subscription.name}`}
            title="编辑"
            type="button"
          >
            <Settings size={15} />
          </button>
          <button
            className="icon-button danger"
            onClick={onDelete}
            aria-label={`删除订阅 ${subscription.name}`}
            title="删除"
            type="button"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}

function PriorityInput({ value, ariaLabel, onCommit }) {
  const [draft, setDraft] = useState(String(value ?? ""));

  useEffect(() => {
    setDraft(String(value ?? ""));
  }, [value]);

  function commit() {
    const trimmed = draft.trim();
    const nextValue = Number(trimmed);
    if (!trimmed || !Number.isFinite(nextValue) || nextValue < 0) {
      setDraft(String(value ?? ""));
      return;
    }
    const intValue = Math.floor(nextValue);
    if (intValue !== Number(value)) {
      onCommit(intValue);
    } else {
      setDraft(String(intValue));
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(String(value ?? ""));
      event.currentTarget.blur();
    }
  }

  return (
    <input
      aria-label={ariaLabel}
      inputMode="numeric"
      type="number"
      min="0"
      step="1"
      value={draft}
      onBlur={commit}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={handleKeyDown}
    />
  );
}

function UsageView({ usage, refreshAll, providerUsage, setProviderUsage, runAction, config }) {
  const [filter, setFilter] = useState("");
  const subscriptionsByName = useMemo(() => new Map((config.subscriptions || []).map((item) => [item.name, item])), [config]);
  const rows = (usage.subscriptions || []).filter((item) =>
    `${item.name} ${item.provider} ${item.model}`.toLowerCase().includes(filter.toLowerCase())
  );

  async function queryUsage(row) {
    const subscription = subscriptionsByName.get(row.name);
    if (!subscription) {
      throw new Error(`Subscription "${row.name}" was not found.`);
    }
    const result = await runAction(() => bridge.querySubscriptionUsage(subscription.name), "供应商用量已更新");
    setProviderUsage((current) => ({ ...current, [subscription.name]: result }));
    return result;
  }

  return (
    <div className="stack">
      <section className="metrics-grid">
        <Metric label="总请求" value={formatNumber(usage.total.requests)} icon={BarChart3} />
        <Metric label="总 Token" value={formatNumber(usage.total.totalTokens)} icon={Activity} />
        <Metric label="缓存命中 Token" value={formatNumber(usage.total.cachedInputTokens)} icon={Gauge} tone="good" />
        <Metric label="平均延迟" value={`${formatNumber(usage.total.averageLatencyMs)} ms`} icon={Terminal} />
      </section>
      <SearchBar
        value={filter}
        onChange={setFilter}
        ariaLabel="筛选订阅用量"
        placeholder="筛选订阅、Provider 或模型…"
        matchLabel={
          <>
            共 <strong>{rows.length}</strong> 条
          </>
        }
        rightSlot={
          <button className="secondary-button" onClick={refreshAll} type="button">
            <RefreshCw size={16} />
            刷新
          </button>
        }
      />
      <section className="table-panel">
        <div className="table-wrapper">
          <table className="usage-table">
          <thead>
            <tr>
              <th>订阅</th>
              <th>Provider</th>
              <th>请求</th>
              <th>成功率</th>
              <th>输入</th>
              <th>输出</th>
              <th>总 Token</th>
              <th>缓存命中</th>
              <th>命中率</th>
              <th>供应商额度</th>
              <th>最后使用</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td className="strong">{row.name}</td>
                <td><ProviderBadge provider={row.provider} /></td>
                <td>{formatNumber(row.requests)}</td>
                <td>{formatPercent(row.successRate)}</td>
                <td>{formatNumber(row.inputTokens)}</td>
                <td>{formatNumber(row.outputTokens)}</td>
                <td>{formatNumber(row.totalTokens)}</td>
                <td>{formatNumber(row.cachedInputTokens)}</td>
                <td>{formatPercent(row.cacheHitRate)}</td>
                <td><ProviderUsageMini usage={providerUsage[row.name]} /></td>
                <td><code>{row.lastUsedAt || "-"}</code></td>
                <td>
                  <button className="icon-button" onClick={() => queryUsage(row)} aria-label={`查询 ${row.name} 的供应商用量`} title="查询供应商用量" type="button">
                    <Gauge size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <EmptyState title="暂无用量" body="请求完成后，这里会按订阅展示 Token、缓存命中和成功率。" /> : null}
    </section>
    </div>
  );
}

function PlatformKeysView({ platformKeys, service, runAction, runConfirmed, copyText }) {
  const [form, setForm] = useState({ name: "", monthlyRequestQuota: "", monthlyTokenQuota: "" });
  const [createdKey, setCreatedKey] = useState("");
  const [editing, setEditing] = useState(null);
  const enabledCount = (platformKeys || []).filter((key) => key.enabled).length;
  const monthRequests = (platformKeys || []).reduce((sum, key) => sum + Number(key.monthRequests || 0), 0);
  const monthTokens = (platformKeys || []).reduce((sum, key) => sum + Number(key.monthTokens || 0), 0);

  async function createKey() {
    try {
      const created = await runAction(
        () => bridge.createPlatformKey({
          name: form.name.trim(),
          monthlyRequestQuota: Number(form.monthlyRequestQuota || 0),
          monthlyTokenQuota: Number(form.monthlyTokenQuota || 0)
        }),
        "平台 Key 已创建"
      );
      setCreatedKey(created.key);
      setForm({ name: "", monthlyRequestQuota: "", monthlyTokenQuota: "" });
    } catch {
      // runAction already surfaced the error
    }
  }

  return (
    <div className="stack">
      <section className="metrics-grid">
        <Metric label="平台 Key 总数" value={platformKeys.length} icon={Clipboard} />
        <Metric label="启用 Key" value={enabledCount} icon={CheckCircle2} tone="good" />
        <Metric label="本月请求" value={formatNumber(monthRequests)} icon={BarChart3} />
        <Metric label="本月 Token" value={formatNumber(monthTokens)} icon={Activity} />
      </section>

      <section className="panel split-panel">
        <div>
          <h2>OpenAI-compatible 接入</h2>
          <p className="muted">创建平台 Key 后，外部 CLI 需要用它作为 Bearer Token 调用本地网关。</p>
          <div className="copy-row">
            <code>{service.baseUrl}</code>
            <button className="icon-button" onClick={() => copyText(service.baseUrl, "Base URL 已复制")} aria-label="复制 Base URL" title="复制 Base URL" type="button">
              <Clipboard size={16} />
            </button>
            <button
              className="icon-button"
              onClick={() => copyText(buildOpenAiEnvSnippet(service, platformKeys), "OpenAI 环境变量已复制")}
              aria-label="复制 OpenAI 环境变量"
              title="复制 export 语句"
              type="button"
            >
              <Terminal size={16} />
            </button>
          </div>
        </div>
        <form
          className="mini-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!form.name.trim()) {
              return;
            }
            createKey();
          }}
        >
          <Field label="Key 名称">
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="default-cli"
              required
            />
          </Field>
          <Field label="月请求额度">
            <input type="number" min="0" value={form.monthlyRequestQuota} onChange={(event) => setForm({ ...form, monthlyRequestQuota: event.target.value })} placeholder="0 表示不限" />
          </Field>
          <Field label="月 Token 额度">
            <input type="number" min="0" value={form.monthlyTokenQuota} onChange={(event) => setForm({ ...form, monthlyTokenQuota: event.target.value })} placeholder="0 表示不限" />
          </Field>
          <button className="primary-button" type="submit" disabled={!form.name.trim()}>
            <Plus size={16} />
            创建 Key
          </button>
        </form>
      </section>

      {createdKey ? (
        <section className="message-strip key-reveal">
          <KeyRound size={16} />
          <code>{createdKey}</code>
          <button className="icon-button" onClick={() => copyText(createdKey, "完整平台 Key 已复制")} aria-label="复制完整平台 Key" title="复制完整 Key" type="button">
            <Clipboard size={16} />
          </button>
        </section>
      ) : null}

      <section className="table-panel">
        <div className="table-wrapper">
          <table className="key-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>前缀</th>
              <th>状态</th>
              <th>本月请求</th>
              <th>本月 Token</th>
              <th>缓存命中</th>
              <th>成功率</th>
              <th>最后使用</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {platformKeys.map((key) => (
              <tr key={key.id}>
                <td className="strong">{key.name}</td>
                <td><code>{key.keyPrefix}</code></td>
                <td>{key.enabled ? <StatusLabel ok text="启用" /> : <StatusLabel text="禁用" />}</td>
                <td>{formatNumber(key.monthRequests)} / {key.monthlyRequestQuota ? formatNumber(key.monthlyRequestQuota) : "不限"}</td>
                <td>{formatNumber(key.monthTokens)} / {key.monthlyTokenQuota ? formatNumber(key.monthlyTokenQuota) : "不限"}</td>
                <td>{formatPercent(key.cacheHitRate)}</td>
                <td>{formatPercent(key.successRate)}</td>
                <td><code>{key.lastUsedAt || "-"}</code></td>
                <td>
                  <div className="row-actions">
                    <button
                      className="icon-button"
                      onClick={() => setEditing(key)}
                      aria-label={`编辑平台 Key ${key.name}`}
                      title="编辑"
                      type="button"
                    >
                      <Settings size={15} />
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => runAction(() => bridge.setPlatformKeyEnabled({ id: key.id, enabled: !key.enabled }), "平台 Key 状态已更新")}
                      aria-label={`${key.enabled ? "禁用" : "启用"}平台 Key ${key.name}`}
                      title={key.enabled ? "禁用" : "启用"}
                      type="button"
                    >
                      {key.enabled ? <Square size={15} /> : <CheckCircle2 size={15} />}
                    </button>
                    <button
                      className="icon-button danger"
                      onClick={() =>
                        runConfirmed({
                          title: "删除平台 Key",
                          body: `将删除平台 Key "${key.name}"。使用此前缀 ${key.keyPrefix} 的外部工具将无法继续访问本地网关。`,
                          confirmLabel: "删除 Key",
                          action: () => bridge.deletePlatformKey(key.id),
                          successMessage: "平台 Key 已删除"
                        })
                      }
                      aria-label={`删除平台 Key ${key.name}`}
                      title="删除"
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {platformKeys.length === 0 ? <EmptyState title="暂无平台 Key" body="未创建平台 Key 前，本地网关仍接受 aihub-local 兼容旧用法。" /> : null}
    </section>

    {editing ? (
      <PlatformKeyDialog
        platformKey={editing}
        onClose={() => setEditing(null)}
        onSave={(payload) =>
          runAction(() => bridge.updatePlatformKey(payload), "平台 Key 已更新").then(() => setEditing(null))
        }
      />
    ) : null}
    </div>
  );
}

function PlatformKeyDialog({ platformKey, onClose, onSave }) {
  const [name, setName] = useState(platformKey.name || "");
  const [requestQuota, setRequestQuota] = useState(String(platformKey.monthlyRequestQuota ?? ""));
  const [tokenQuota, setTokenQuota] = useState(String(platformKey.monthlyTokenQuota ?? ""));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  function parseQuota(raw) {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) {
      return 0;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0) {
      return NaN;
    }
    return Math.floor(value);
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) {
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("请填写 Key 名称。");
      return;
    }
    const requestValue = parseQuota(requestQuota);
    const tokenValue = parseQuota(tokenQuota);
    if (Number.isNaN(requestValue) || Number.isNaN(tokenValue)) {
      setError("额度必须是 0 或正整数。");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSave({
        id: platformKey.id,
        name: trimmedName,
        monthlyRequestQuota: requestValue,
        monthlyTokenQuota: tokenValue
      });
    } catch (nextError) {
      setError(nextError?.message || String(nextError));
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
      role="presentation"
    >
      <section className="modal" role="dialog" aria-modal="true" aria-label="编辑平台 Key">
        <div className="modal-header">
          <div>
            <div className="modal-kicker">Platform Key</div>
            <h2>编辑平台 Key</h2>
            <p className="muted">仅修改名称和额度，原 Key 内容不会变化。</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭" title="关闭" type="button" disabled={saving}>
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="form-grid compact">
            <Field label="Key 名称">
              <input value={name} onChange={(event) => setName(event.target.value)} autoFocus required />
            </Field>
            <Field label="前缀">
              <input value={platformKey.keyPrefix || ""} readOnly />
            </Field>
            <Field label="月请求额度">
              <input
                type="number"
                min="0"
                value={requestQuota}
                onChange={(event) => setRequestQuota(event.target.value)}
                placeholder="0 表示不限"
              />
            </Field>
            <Field label="月 Token 额度">
              <input
                type="number"
                min="0"
                value={tokenQuota}
                onChange={(event) => setTokenQuota(event.target.value)}
                placeholder="0 表示不限"
              />
            </Field>
          </div>
          {error ? <div className="dialog-status error">{error}</div> : null}
          <div className="modal-actions">
            <button className="secondary-button" onClick={onClose} type="button" disabled={saving}>取消</button>
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ModelsView({ config, modelAliases, runAction, runConfirmed }) {
  const [aliasForm, setAliasForm] = useState({ alias: "", description: "" });
  const [routeForm, setRouteForm] = useState({ alias: "", subscriptionName: "", providerModel: "", priority: 100, enabled: true });
  const [filter, setFilter] = useState("");
  const [editingAlias, setEditingAlias] = useState(null);
  const [editingRoute, setEditingRoute] = useState(null);
  const enabledAliases = modelAliases.filter((alias) => alias.enabled).length;
  const routeCount = modelAliases.reduce((sum, alias) => sum + alias.routes.length, 0);
  const normalizedFilter = filter.trim().toLowerCase();
  const filteredAliases = normalizedFilter
    ? modelAliases.filter((alias) => {
        const haystack = `${alias.alias} ${alias.description || ""} ${(alias.routes || [])
          .map((route) => `${route.subscriptionName} ${route.providerModel || ""}`)
          .join(" ")}`.toLowerCase();
        return haystack.includes(normalizedFilter);
      })
    : modelAliases;

  async function saveAlias() {
    try {
      await runAction(
        () => bridge.upsertModelAlias({ alias: aliasForm.alias.trim(), description: aliasForm.description.trim(), enabled: true }),
        "模型别名已保存"
      );
      setAliasForm({ alias: "", description: "" });
      setRouteForm((current) => ({ ...current, alias: aliasForm.alias || current.alias }));
    } catch {
      // already surfaced
    }
  }

  async function saveRoute() {
    try {
      await runAction(
        () => bridge.upsertModelRoute(routeForm),
        "模型路由已保存"
      );
      setRouteForm({ alias: routeForm.alias, subscriptionName: "", providerModel: "", priority: 100, enabled: true });
    } catch {
      // already surfaced
    }
  }

  return (
    <div className="stack">
      <section className="metrics-grid">
        <Metric label="公开模型" value={modelAliases.length} icon={SlidersHorizontal} />
        <Metric label="启用模型" value={enabledAliases} icon={CheckCircle2} tone="good" />
        <Metric label="路由数量" value={routeCount} icon={Layers} />
        <Metric label="订阅池" value={(config.subscriptions || []).length} icon={Database} />
      </section>

      <section className="two-column">
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            if (!aliasForm.alias.trim()) {
              return;
            }
            saveAlias();
          }}
        >
          <h2>创建公开模型名</h2>
          <div className="form-grid compact two-fields">
            <Field label="公开模型名">
              <input value={aliasForm.alias} onChange={(event) => setAliasForm({ ...aliasForm, alias: event.target.value })} placeholder="gpt-4o" required />
            </Field>
            <Field label="说明">
              <input value={aliasForm.description} onChange={(event) => setAliasForm({ ...aliasForm, description: event.target.value })} placeholder="给外部工具看到的模型" />
            </Field>
          </div>
          <div className="button-row">
            <button className="primary-button" disabled={!aliasForm.alias.trim()} type="submit">
              <Plus size={16} />
              保存模型
            </button>
          </div>
        </form>

        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            if (!routeForm.alias || !routeForm.subscriptionName) {
              return;
            }
            saveRoute();
          }}
        >
          <h2>绑定订阅路由</h2>
          <div className="form-grid compact">
            <Field label="公开模型">
              <select value={routeForm.alias} onChange={(event) => setRouteForm({ ...routeForm, alias: event.target.value })} required>
                <option value="">选择模型</option>
                {modelAliases.map((alias) => (
                  <option key={alias.alias} value={alias.alias}>{alias.alias}</option>
                ))}
              </select>
            </Field>
            <Field label="订阅">
              <select value={routeForm.subscriptionName} onChange={(event) => setRouteForm({ ...routeForm, subscriptionName: event.target.value })} required>
                <option value="">选择订阅</option>
                {(config.subscriptions || []).map((subscription) => (
                  <option key={subscription.name} value={subscription.name}>{subscription.name}</option>
                ))}
              </select>
            </Field>
            <Field label="真实模型">
              <input value={routeForm.providerModel} onChange={(event) => setRouteForm({ ...routeForm, providerModel: event.target.value })} placeholder="留空使用订阅默认模型" />
            </Field>
            <Field label="优先级">
              <input type="number" value={routeForm.priority} onChange={(event) => setRouteForm({ ...routeForm, priority: Number(event.target.value) })} />
            </Field>
          </div>
          <div className="button-row">
            <button className="primary-button" disabled={!routeForm.alias || !routeForm.subscriptionName} type="submit">
              <Plus size={16} />
              添加路由
            </button>
          </div>
        </form>
      </section>

      <SearchBar
        value={filter}
        onChange={setFilter}
        ariaLabel="筛选模型别名"
        placeholder="筛选别名、说明或路由订阅…"
        matchLabel={
          <>
            匹配 <strong>{filteredAliases.length}</strong> / {modelAliases.length}
          </>
        }
      />

      <section className="table-panel">
        <div className="table-wrapper">
          <table className="model-table">
          <thead>
            <tr>
              <th>公开模型</th>
              <th>状态</th>
              <th>说明</th>
              <th>路由</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredAliases.map((alias) => (
              <tr key={alias.alias}>
                <td><code>{alias.alias}</code></td>
                <td>{alias.enabled ? <StatusLabel ok text="启用" /> : <StatusLabel text="禁用" />}</td>
                <td>{alias.description || "-"}</td>
                <td>
                  <div className="route-list">
                    {alias.routes.length > 0 ? alias.routes.map((route) => (
                      <span key={route.id}>
                        {route.priority}: {route.subscriptionName} / {route.providerModel || "默认"}
                        <button
                          className="inline-icon"
                          onClick={() => setEditingRoute({ ...route, alias: alias.alias })}
                          aria-label={`编辑 ${alias.alias} 到 ${route.subscriptionName} 的路由`}
                          title="编辑路由"
                          type="button"
                        >
                          <Settings size={13} />
                        </button>
                        <button
                          className="inline-icon"
                          onClick={() =>
                            runConfirmed({
                              title: "删除模型路由",
                              body: `将删除 ${alias.alias} 到 ${route.subscriptionName} 的路由。该公开模型可能失去一个 fallback 入口。`,
                              confirmLabel: "删除路由",
                              action: () => bridge.deleteModelRoute(route.id),
                              successMessage: "路由已删除"
                            })
                          }
                          aria-label={`删除 ${alias.alias} 到 ${route.subscriptionName} 的路由`}
                          title="删除路由"
                          type="button"
                        >
                          <XCircle size={13} />
                        </button>
                      </span>
                    )) : "-"}
                  </div>
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      className="icon-button"
                      onClick={() => setEditingAlias(alias)}
                      aria-label={`编辑模型别名 ${alias.alias}`}
                      title="编辑"
                      type="button"
                    >
                      <Settings size={15} />
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => runAction(() => bridge.setModelAliasEnabled({ alias: alias.alias, enabled: !alias.enabled }), "模型状态已更新")}
                      aria-label={`${alias.enabled ? "禁用" : "启用"}模型别名 ${alias.alias}`}
                      title={alias.enabled ? "禁用" : "启用"}
                      type="button"
                    >
                      {alias.enabled ? <Square size={15} /> : <CheckCircle2 size={15} />}
                    </button>
                    <button
                      className="icon-button danger"
                      onClick={() =>
                        runConfirmed({
                          title: "删除模型别名",
                          body: `将删除公开模型 "${alias.alias}" 及其路由。外部工具继续请求该模型名时会失败。`,
                          confirmLabel: "删除模型",
                          action: () => bridge.deleteModelAlias(alias.alias),
                          successMessage: "模型别名已删除"
                        })
                      }
                      aria-label={`删除模型别名 ${alias.alias}`}
                      title="删除"
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modelAliases.length === 0 ? (
        <EmptyState title="暂无模型别名" body="创建公开模型名后，/v1/models 会优先暴露这些别名。" />
      ) : filteredAliases.length === 0 ? (
        <EmptyState title="没有匹配的模型" body="尝试清空搜索或换一个关键字。" />
      ) : null}
    </section>

    {editingAlias ? (
      <ModelAliasDialog
        alias={editingAlias}
        onClose={() => setEditingAlias(null)}
        onSave={(payload) =>
          runAction(() => bridge.upsertModelAlias(payload), "模型别名已更新").then(() => setEditingAlias(null))
        }
      />
    ) : null}

    {editingRoute ? (
      <ModelRouteDialog
        route={editingRoute}
        subscriptions={config.subscriptions || []}
        onClose={() => setEditingRoute(null)}
        onSave={(payload) =>
          runAction(() => bridge.upsertModelRoute(payload), "模型路由已更新").then(() => setEditingRoute(null))
        }
      />
    ) : null}
    </div>
  );
}

function ModelAliasDialog({ alias, onClose, onSave }) {
  const [description, setDescription] = useState(alias.description || "");
  const [enabled, setEnabled] = useState(alias.enabled !== false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  async function submit(event) {
    event.preventDefault();
    if (saving) {
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSave({ alias: alias.alias, description: description.trim(), enabled });
    } catch (nextError) {
      setError(nextError?.message || String(nextError));
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
      role="presentation"
    >
      <section className="modal" role="dialog" aria-modal="true" aria-label="编辑模型别名">
        <div className="modal-header">
          <div>
            <div className="modal-kicker">Model Alias</div>
            <h2>编辑模型别名</h2>
            <p className="muted">别名一旦创建不可改名，调整说明文字和启用状态。</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭" title="关闭" type="button" disabled={saving}>
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="form-grid compact">
            <Field label="别名">
              <input value={alias.alias} readOnly />
            </Field>
            <Field label="说明">
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                autoFocus
                placeholder="给外部工具看到的模型说明"
              />
            </Field>
          </div>
          <label className="check-row">
            <input checked={enabled} type="checkbox" onChange={(event) => setEnabled(event.target.checked)} />
            参与路由
          </label>
          {error ? <div className="dialog-status error">{error}</div> : null}
          <div className="modal-actions">
            <button className="secondary-button" onClick={onClose} type="button" disabled={saving}>取消</button>
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ModelRouteDialog({ route, subscriptions, onClose, onSave }) {
  const [subscriptionName, setSubscriptionName] = useState(route.subscriptionName || "");
  const [providerModel, setProviderModel] = useState(route.providerModel || "");
  const [priority, setPriority] = useState(String(route.priority ?? 100));
  const [enabled, setEnabled] = useState(route.enabled !== false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  async function submit(event) {
    event.preventDefault();
    if (saving) {
      return;
    }
    if (!subscriptionName) {
      setError("请选择订阅。");
      return;
    }
    const priorityValue = Number(priority);
    if (!Number.isFinite(priorityValue) || priorityValue < 0) {
      setError("优先级必须是 0 或正整数。");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSave({
        id: route.id,
        alias: route.alias,
        subscriptionName,
        providerModel: providerModel.trim(),
        priority: Math.floor(priorityValue),
        enabled
      });
    } catch (nextError) {
      setError(nextError?.message || String(nextError));
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
      role="presentation"
    >
      <section className="modal" role="dialog" aria-modal="true" aria-label="编辑模型路由">
        <div className="modal-header">
          <div>
            <div className="modal-kicker">Model Route</div>
            <h2>编辑路由 {route.alias}</h2>
            <p className="muted">调整该公开模型在某个订阅上的优先级或真实模型。</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭" title="关闭" type="button" disabled={saving}>
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="form-grid compact">
            <Field label="订阅">
              <select value={subscriptionName} onChange={(event) => setSubscriptionName(event.target.value)} required>
                <option value="">选择订阅</option>
                {subscriptions.map((subscription) => (
                  <option key={subscription.name} value={subscription.name}>{subscription.name}</option>
                ))}
              </select>
            </Field>
            <Field label="真实模型">
              <input
                value={providerModel}
                onChange={(event) => setProviderModel(event.target.value)}
                placeholder="留空使用订阅默认模型"
              />
            </Field>
            <Field label="优先级">
              <input
                type="number"
                min="0"
                step="1"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
              />
            </Field>
          </div>
          <label className="check-row">
            <input checked={enabled} type="checkbox" onChange={(event) => setEnabled(event.target.checked)} />
            启用此路由
          </label>
          {error ? <div className="dialog-status error">{error}</div> : null}
          <div className="modal-actions">
            <button className="secondary-button" onClick={onClose} type="button" disabled={saving}>取消</button>
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function SubscriptionDialog({ subscription, subscriptions = [], onClose, onSave }) {
  const originalName = subscription.name || "";
  const initialForm = useMemo(() => ({
    name: subscription.name || "",
    provider: subscription.provider || "gemini",
    apiKey: "",
    model: subscription.model || "",
    modelsText: (subscription.models || (subscription.model ? [subscription.model] : [])).join("\n"),
    priority: subscription.priority ?? 100,
    enabled: subscription.enabled !== false,
    baseUrl: subscription.baseUrl || "",
    usageUrl: subscription.usageUrl || "",
    apiVersion: subscription.apiVersion || "",
    website: subscription.website || "",
    notes: subscription.notes || "",
    tagsText: Array.isArray(subscription.tags) ? subscription.tags.join(", ") : "",
    timeoutMs: subscription.timeoutMs || 0
  }), [subscription]);
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const selectedProvider = providers.find((item) => item.value === form.provider) || providers[0];
  const dirty = useMemo(() => isFormDirty(form, initialForm), [form, initialForm]);

  const requestClose = useCallback(() => {
    if (testing || saving) {
      return;
    }
    if (dirty) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  }, [testing, saving, dirty, onClose]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !testing && !saving && !confirmingClose) {
        event.preventDefault();
        requestClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [requestClose, testing, saving, confirmingClose]);

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setStatus({ type: "", message: "" });
  }

  function applyPreset(preset) {
    setForm((current) => ({
      ...current,
      provider: preset.provider,
      model: current.model || preset.model,
      modelsText: current.modelsText || preset.model,
      baseUrl: preset.baseUrl
    }));
    setStatus({ type: "", message: "" });
  }

  async function save() {
    const validation = validateSubscriptionForm(form, {
      allowExistingSecret: Boolean(originalName),
      originalName,
      subscriptions
    });
    if (validation) {
      setStatus({ type: "error", message: validation });
      return;
    }
    setSaving(true);
    setStatus({ type: "", message: "" });
    try {
      await onSave({ ...normalizeSubscriptionForm(form), originalName });
      // dialog will be unmounted by parent on success; nothing to do here
    } catch (error) {
      setStatus({ type: "error", message: error.message || String(error) });
      setSaving(false);
    }
  }

  async function fetchModelsFromForm() {
    const validation = validateSubscriptionForm(form, {
      requireModel: false,
      allowExistingSecret: Boolean(originalName),
      originalName,
      subscriptions,
      checkDuplicate: false
    });
    if (validation) {
      setStatus({ type: "error", message: validation });
      return;
    }
    setTesting(true);
    setStatus({ type: "", message: "" });
    try {
      const result = await bridge.fetchSubscriptionModels(normalizeSubscriptionForm(form));
      setForm((current) => ({
        ...current,
        model: current.model || result.models[0] || "",
        modelsText: result.models.join("\n")
      }));
      setStatus({ type: "success", message: `已获取 ${result.models.length} 个模型` });
    } catch (error) {
      setStatus({ type: "error", message: error.message || String(error) });
    } finally {
      setTesting(false);
    }
  }

  async function testConnection() {
    const validation = validateSubscriptionForm(form, {
      requireModel: false,
      allowExistingSecret: Boolean(originalName),
      originalName,
      subscriptions,
      checkDuplicate: false
    });
    if (validation) {
      setStatus({ type: "error", message: validation });
      return;
    }
    setTesting(true);
    setStatus({ type: "", message: "" });
    try {
      const result = await bridge.testSubscriptionConnection(normalizeSubscriptionForm(form));
      setStatus({
        type: "success",
        message: `连接成功 · ${result.modelCount} 个模型 · ${result.latencyMs} ms`
      });
    } catch (error) {
      setStatus({ type: "error", message: error.message || String(error) });
    } finally {
      setTesting(false);
    }
  }

  async function queryUsageFromForm() {
    const validation = validateSubscriptionForm(form, {
      requireModel: false,
      allowExistingSecret: Boolean(originalName),
      originalName,
      subscriptions,
      checkDuplicate: false
    });
    if (validation) {
      setStatus({ type: "error", message: validation });
      return;
    }
    setTesting(true);
    setStatus({ type: "", message: "" });
    try {
      const result = await bridge.querySubscriptionUsage(normalizeSubscriptionForm(form));
      setStatus({
        type: "success",
        message: `用量查询成功 · ${formatProviderUsage(result)}`
      });
    } catch (error) {
      setStatus({ type: "error", message: error.message || String(error) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          requestClose();
        }
      }}
      role="presentation"
    >
      <section className="modal subscription-modal" role="dialog" aria-modal="true" aria-label="订阅编辑器">
        <div className="modal-header subscription-modal-header">
          <div>
            <div className="modal-kicker">Provider</div>
            <h2>
              {subscription.name ? "编辑订阅" : "新增订阅"}
              {dirty ? <span className="dirty-dot" title="存在未保存修改" aria-label="未保存"></span> : null}
            </h2>
            <p>选择供应商类型，配置 API 凭据、模型列表、用量查询和路由策略。</p>
          </div>
          <ProviderBadge provider={form.provider} />
          <button className="icon-button" onClick={requestClose} aria-label="关闭订阅编辑器" title="关闭" type="button">
            <X size={18} />
          </button>
        </div>
        <form
          autoComplete="off"
          className="subscription-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="subscription-provider-layout">
            <aside className="provider-preset-panel">
              <div className="form-section-title">供应商预设</div>
              <div className="preset-list">
                {providerPresets.map((preset) => (
                  <button
                    className={`preset-option ${form.provider === preset.provider ? "active" : ""}`}
                    key={preset.id}
                    onClick={() => applyPreset(preset)}
                    type="button"
                  >
                    <ProviderBadge provider={preset.provider} />
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
              <div className="provider-profile-card">
                <div className="provider-profile-title">{selectedProvider.label}</div>
                <div className="muted">{providerModeHint(form.provider)}</div>
                <label className="check-row provider-enable-row">
                  <input checked={form.enabled} type="checkbox" onChange={(event) => setField("enabled", event.target.checked)} aria-label="订阅参与路由" />
                  参与路由
                </label>
              </div>
            </aside>

            <div className="subscription-form-grid">
              <section className="form-section">
                <div className="form-section-title">
                  <LayoutDashboard size={14} />
                  <span>基础信息</span>
                </div>
                <div className="form-grid compact">
                  <Field label="名称">
                    <input autoComplete="off" autoFocus value={form.name} onChange={(event) => setField("name", event.target.value)} placeholder={`${form.provider}-main`} />
                  </Field>
                  <Field label="Provider">
                    <select value={form.provider} onChange={(event) => setField("provider", event.target.value)}>
                      {providers.map((provider) => (
                        <option key={provider.value} value={provider.value}>{provider.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="官方网站">
                    <input autoComplete="off" value={form.website} onChange={(event) => setField("website", event.target.value)} placeholder="https://..." />
                  </Field>
                </div>
              </section>

              <section className="form-section">
                <div className="form-section-title">
                  <SlidersHorizontal size={14} />
                  <span>路由策略</span>
                </div>
                <div className="form-grid compact two-fields">
                  <Field label="优先级">
                    <input autoComplete="off" type="number" value={form.priority} onChange={(event) => setField("priority", Number(event.target.value))} />
                  </Field>
                  <Field label="备注">
                    <input autoComplete="off" value={form.notes} onChange={(event) => setField("notes", event.target.value)} placeholder="记录供应商来源或用途" />
                  </Field>
                </div>
                <Field label="标签（逗号分隔）">
                  <input
                    autoComplete="off"
                    value={form.tagsText}
                    onChange={(event) => setField("tagsText", event.target.value)}
                    placeholder="例如：production, fallback, low-cost"
                  />
                </Field>
              </section>

              <section className="form-section">
                <div className="form-section-title">
                  <KeyRound size={14} />
                  <span>接口凭据</span>
                </div>
                <div className="form-grid">
                  <Field label="API Key">
                    <input autoComplete="new-password" value={form.apiKey} onChange={(event) => setField("apiKey", event.target.value)} placeholder={subscription.name ? "留空则保留原 key" : "必填"} type="password" />
                  </Field>
                  <Field label="Base URL">
                    <input autoComplete="off" value={form.baseUrl} onChange={(event) => setField("baseUrl", event.target.value)} placeholder={providerBaseUrlPlaceholder(form.provider)} />
                  </Field>
                </div>
                <div className="form-grid compact two-fields">
                  <Field label="用量查询 URL">
                    <input autoComplete="off" value={form.usageUrl} onChange={(event) => setField("usageUrl", event.target.value)} placeholder="可选，自定义查询接口" />
                  </Field>
                  <div className="form-grid compact two-fields">
                    <Field label="API Version">
                      <input autoComplete="off" value={form.apiVersion} onChange={(event) => setField("apiVersion", event.target.value)} placeholder="Claude 版本" />
                    </Field>
                    <Field label="Timeout">
                      <input autoComplete="off" type="number" value={form.timeoutMs} onChange={(event) => setField("timeoutMs", Number(event.target.value))} placeholder="0 默认" />
                    </Field>
                  </div>
                </div>
              </section>

              <section className="form-section models-section">
                <div className="form-section-title">
                  <Bot size={14} />
                  <span>模型与验证</span>
                </div>
                <div className="form-grid compact two-fields">
                  <Field label="默认模型">
                    <input autoComplete="off" value={form.model} onChange={(event) => setField("model", event.target.value)} placeholder={providerModelPlaceholder(form.provider)} />
                  </Field>
                  <div />
                </div>
                <Field label="支持模型列表">
                  <textarea className="models-textarea" value={form.modelsText} onChange={(event) => setField("modelsText", event.target.value)} placeholder="每行一个模型" />
                </Field>
                <div className="dialog-tool-row">
                  <button className="secondary-button" disabled={testing} onClick={testConnection} type="button">
                    {testing ? <Loader2 className="spin" size={16} /> : <Wifi size={16} />}
                    测试连通性
                  </button>
                  <button className="secondary-button" disabled={testing} onClick={fetchModelsFromForm} type="button">
                    {testing ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
                    获取模型
                  </button>
                  <button className="secondary-button" disabled={testing} onClick={queryUsageFromForm} type="button">
                    {testing ? <Loader2 className="spin" size={16} /> : <Gauge size={16} />}
                    查询用量
                  </button>
                </div>
                {status.message ? <div className={`dialog-status ${status.type}`}>{status.message}</div> : null}
              </section>
            </div>
          </div>
          <div className="modal-actions">
            {dirty ? <span className="modal-actions-hint">存在未保存的修改</span> : null}
            <button className="secondary-button" onClick={requestClose} type="button" disabled={saving}>取消</button>
            <button className="primary-button" type="submit" disabled={saving || testing}>
              {saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      </section>
      {confirmingClose ? (
        <ConfirmDialog
          confirm={{
            title: "放弃未保存的修改？",
            body: "当前订阅有未保存的修改。关闭后将丢失这些改动，确认继续？",
            confirmLabel: "放弃修改",
            cancelLabel: "返回编辑",
            tone: "danger"
          }}
          onCancel={() => setConfirmingClose(false)}
          onConfirm={() => {
            setConfirmingClose(false);
            onClose();
          }}
        />
      ) : null}
    </div>
  );
}

function isFormDirty(current, initial) {
  if (!initial) {
    return false;
  }
  for (const key of Object.keys(initial)) {
    if (key === "apiKey") {
      if ((current.apiKey || "").trim() !== "") {
        return true;
      }
      continue;
    }
    if ((current[key] ?? "") !== (initial[key] ?? "")) {
      return true;
    }
  }
  return false;
}

function normalizeSubscriptionForm(form) {
  const { modelsText, tagsText, ...payload } = form;
  return {
    ...payload,
    name: payload.name.trim(),
    model: payload.model.trim(),
    baseUrl: payload.baseUrl.trim(),
    usageUrl: payload.usageUrl.trim(),
    apiVersion: payload.apiVersion.trim(),
    apiKey: payload.apiKey.trim(),
    website: payload.website.trim(),
    notes: payload.notes.trim(),
    models: modelsText.split(/[\n,]/).map((value) => value.trim()).filter(Boolean),
    tags: (tagsText || "").split(/[\n,]/).map((value) => value.trim()).filter(Boolean)
  };
}

function validateSubscriptionForm(
  form,
  { requireModel = true, allowExistingSecret = false, originalName = "", subscriptions = [], checkDuplicate = true } = {}
) {
  const name = form.name.trim();
  if (!name) {
    return "请填写订阅名称。";
  }
  if (checkDuplicate) {
    const duplicated = subscriptions.some((item) => item.name === name && item.name !== originalName);
    if (duplicated) {
      return `订阅名称 "${name}" 已存在，请换一个名称。`;
    }
  }
  if (!form.provider) {
    return "请选择 Provider。";
  }
  if (requireModel && !form.model.trim()) {
    return "请填写默认模型，或先获取模型列表。";
  }
  if (!form.apiKey.trim() && !allowExistingSecret) {
    return "请填写 API Key。";
  }
  if (form.baseUrl && !isValidHttpUrl(form.baseUrl)) {
    return "Base URL 需要以 http:// 或 https:// 开头。";
  }
  if (form.usageUrl && !isValidHttpUrl(form.usageUrl)) {
    return "用量查询 URL 需要以 http:// 或 https:// 开头。";
  }
  if (form.website && !isValidHttpUrl(form.website)) {
    return "官方网站 URL 需要以 http:// 或 https:// 开头。";
  }
  if (form.provider === "openai-compatible" && !form.baseUrl.trim()) {
    return "OpenAI 兼容订阅必须填写 Base URL。";
  }
  const timeoutMs = Number(form.timeoutMs);
  if (form.timeoutMs !== "" && form.timeoutMs != null) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      return "Timeout 必须是 0 或正整数（毫秒）。";
    }
    if (timeoutMs > 600000) {
      return "Timeout 不应超过 600000 ms（10 分钟）。";
    }
  }
  const priority = Number(form.priority);
  if (!Number.isFinite(priority) || priority < 0) {
    return "优先级必须是 0 或正整数。";
  }
  return "";
}

function isValidHttpUrl(value) {
  if (!value) {
    return true;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function providerModelPlaceholder(provider) {
  return {
    gemini: "gemini-2.5-flash",
    claude: "claude-sonnet-4-5",
    codex: "gpt-5.1",
    "openai-compatible": "gpt-4o"
  }[provider] || "model";
}

function providerBaseUrlPlaceholder(provider) {
  return {
    gemini: "可选，默认 https://generativelanguage.googleapis.com",
    claude: "可选，默认 https://api.anthropic.com",
    codex: "可选，默认 https://api.openai.com",
    "openai-compatible": "必填第三方网关地址，例如 https://api.example.com"
  }[provider] || "上游 Base URL";
}

function providerModeHint(provider) {
  return {
    gemini: "Google Gemini generateContent 接口，可留空使用官方端点。",
    claude: "Anthropic Messages API，支持自定义兼容网关。",
    codex: "OpenAI Responses API，适合 Codex/OpenAI 订阅。",
    "openai-compatible": "任意兼容 OpenAI Chat Completions 的第三方上游。"
  }[provider] || "自定义供应商";
}

function ChatView({ config, service, runAction, runConfirmed, setActiveView, copyText }) {
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState("auto");
  const [subscription, setSubscription] = useState("");
  const [model, setModel] = useState("");
  const [result, setResult] = useState(null);
  const [sending, setSending] = useState(false);

  async function send() {
    if (!prompt.trim() || sending) {
      return;
    }
    setSending(true);
    try {
      const response = await runAction(() =>
        bridge.sendChat({
          prompt,
          provider,
          subscription: subscription || undefined,
          model: model || undefined
        })
      );
      setResult(response);
    } catch {
      // runAction already shows the toast
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-layout">
      <section className="panel chat-composer">
        <div className="form-grid compact">
          <Field label="Provider">
            <select value={provider} onChange={(event) => setProvider(event.target.value)}>
              <option value="auto">自动</option>
              {providers.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </Field>
          <Field label="订阅">
            <select value={subscription} onChange={(event) => setSubscription(event.target.value)}>
              <option value="">自动</option>
              {(config.subscriptions || []).map((item) => (
                <option key={item.name} value={item.name}>{item.name}</option>
              ))}
            </select>
          </Field>
          <Field label="模型覆盖">
            <input list="model-options" value={model} onChange={(event) => setModel(event.target.value)} placeholder="可选，优先匹配公开模型别名" />
            <datalist id="model-options">
              {(config.modelAliases || []).filter((alias) => alias.enabled).map((alias) => (
                <option key={alias.alias} value={alias.alias} />
              ))}
              {allConfiguredModels(config).map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </Field>
        </div>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              send();
            }
          }}
          placeholder="通过聚合路由发送测试消息"
          aria-label="对话内容"
        />
        <div className="chat-hint">
          <span>支持 <kbd>{getMetaKeyLabel()}</kbd><span className="shortcut-plus">+</span><kbd>Enter</kbd> 发送</span>
          <span className="muted">{prompt.length} 字符</span>
        </div>
        <div className="button-row">
          <button className="primary-button" disabled={sending || !prompt.trim()} onClick={send} type="button">
            {sending ? <Loader2 className="spin" size={16} /> : <Bot size={16} />}
            {sending ? "发送中…" : "发送"}
          </button>
          <button
            className="secondary-button"
            onClick={() => { setPrompt(""); setResult(null); }}
            disabled={sending || (!prompt && !result)}
            type="button"
          >
            清空
          </button>
        </div>
      </section>

      <section className="panel chat-result">
        <div className="chat-result-head">
          <h2>响应</h2>
          {result?.text ? (
            <button
              className="secondary-button chat-copy-response"
              onClick={() => copyText?.(result.text, "响应已复制")}
              type="button"
            >
              <Clipboard size={14} />
              复制响应
            </button>
          ) : null}
        </div>
        {service && !service.running ? (
          <div className="message-strip warn chat-service-banner">
            <AlertTriangle size={16} />
            <div>
              <div className="strong">本地网关未启动</div>
              <p className="muted">服务停止时仍可发起请求测试，但外部 CLI 无法走聚合路由。</p>
            </div>
            <button
              className="primary-button"
              onClick={() => runAction?.(() => bridge.startService(), "服务已启动")}
              type="button"
            >
              <Play size={14} />
              启动网关
            </button>
          </div>
        ) : null}
        {result ? (
          <>
            <pre className="response-text">{result.text}</pre>
            <div className="detail-list">
              <Row label="Provider" value={result.provider} />
              <Row label="订阅" value={result.subscription} />
              <Row label="模型" value={result.model} />
              <Row label="真实模型" value={result.providerModel} />
              <Row label="模型别名" value={result.alias} />
              <Row label="Token" value={formatNumber(result.usage?.totalTokens || 0)} />
              <Row label="缓存命中率" value={formatPercent(cacheHitRate(result.usage))} />
              <Row label="尝试次数" value={String(result.attempts?.length || 0)} />
            </div>
            {result.attempts && result.attempts.length > 0 ? (
              <div className="chat-attempts" aria-label="尝试链路">
                <div className="chat-attempts-title">尝试链路</div>
                <ol>
                  {result.attempts.map((attempt, index) => (
                    <li key={`${attempt.subscription || "auto"}-${index}`} className={attempt.ok ? "ok" : "fail"}>
                      <span className="chat-attempt-index">{index + 1}</span>
                      <div className="chat-attempt-body">
                        <div className="chat-attempt-line">
                          <strong>{attempt.subscription || "auto"}</strong>
                          <ProviderBadge provider={attempt.provider || "auto"} />
                          {attempt.model ? <code>{attempt.model}</code> : null}
                          <span className="chat-attempt-tag">
                            {attempt.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                            {attempt.ok ? "成功" : "失败"}
                          </span>
                          {Number.isFinite(Number(attempt.latencyMs)) ? (
                            <span className="muted">{formatNumber(attempt.latencyMs)} ms</span>
                          ) : null}
                        </div>
                        {attempt.error ? <div className="chat-attempt-error">{attempt.error}</div> : null}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState title="暂无响应" body="添加真实或 mock 订阅后，可以在这里验证路由、用量和缓存统计。" />
        )}
      </section>
    </div>
  );
}

function HistoryView({ history, refreshAll }) {
  const [filter, setFilter] = useState("");
  const [visible, setVisible] = useState(50);
  const lowered = filter.toLowerCase();
  const filtered = history.filter((entry) =>
    `${entry.ts} ${entry.provider} ${entry.subscription} ${entry.alias || ""} ${entry.model} ${entry.platformKey?.name || ""} ${entry.error || ""}`
      .toLowerCase()
      .includes(lowered)
  );
  const sorted = [...filtered].sort((a, b) => {
    const aTime = new Date(a.ts).getTime() || 0;
    const bTime = new Date(b.ts).getTime() || 0;
    return bTime - aTime;
  });
  const rows = sorted.slice(0, visible);
  const hasMore = sorted.length > visible;

  return (
    <div className="stack">
      <SearchBar
        value={filter}
        onChange={setFilter}
        ariaLabel="筛选请求历史"
        placeholder="筛选时间、订阅、模型或错误…"
        matchLabel={
          <>
            共 <strong>{rows.length}</strong> 条
          </>
        }
        rightSlot={
          <button className="secondary-button" onClick={refreshAll} type="button">
            <RefreshCw size={16} />
            刷新
          </button>
        }
      />
      <section className="table-panel">
        <div className="table-wrapper">
          <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>结果</th>
              <th>Provider</th>
              <th>订阅</th>
              <th>平台 Key</th>
              <th>别名</th>
              <th>模型</th>
              <th>Token</th>
              <th>缓存命中</th>
              <th>错误</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry, index) => (
              <tr key={`${entry.ts}-${index}`}>
                <td><code>{entry.ts}</code></td>
                <td>{entry.ok ? <StatusLabel ok text="成功" /> : <StatusLabel text="失败" />}</td>
                <td>{entry.provider || "auto"}</td>
                <td>{entry.subscription || "-"}</td>
                <td>{entry.platformKey?.name || "-"}</td>
                <td><code>{entry.alias || "-"}</code></td>
                <td><code>{entry.model || "-"}</code></td>
                <td>{formatNumber(entry.usage?.totalTokens || 0)}</td>
                <td>{formatPercent(cacheHitRate(entry.usage))}</td>
                <td className="truncate">{entry.error || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <EmptyState title="暂无历史" body="所有通过聚合路由的请求都会记录在这里。" /> : null}
      {hasMore ? (
        <div className="history-more">
          <button
            className="secondary-button"
            onClick={() => setVisible((current) => current + 50)}
            type="button"
          >
            加载更多 · 已显示 {rows.length} / {sorted.length}
          </button>
        </div>
      ) : null}
    </section>
    </div>
  );
}

function LogsView({ logs, refreshAll, refreshLogs }) {
  const [filter, setFilter] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const filtered = logs.filter((line) => line.toLowerCase().includes(filter.toLowerCase()));
  const preRef = useRef(null);
  const refreshLogsOnly = refreshLogs || refreshAll;

  useEffect(() => {
    if (!autoRefresh) {
      return undefined;
    }
    const handle = window.setInterval(() => {
      refreshLogsOnly();
    }, 4000);
    return () => window.clearInterval(handle);
  }, [autoRefresh, refreshLogsOnly]);

  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="stack">
      <SearchBar
        value={filter}
        onChange={setFilter}
        ariaLabel="筛选运行日志"
        placeholder="筛选关键字…"
        matchLabel={
          <>
            匹配 <strong>{filtered.length}</strong> 行
          </>
        }
        rightSlot={
          <>
            <button
              className={`secondary-button ${autoRefresh ? "is-active" : ""}`}
              onClick={() => setAutoRefresh((current) => !current)}
              aria-pressed={autoRefresh}
              type="button"
              title="每 4 秒自动刷新一次日志"
            >
              {autoRefresh ? <Pause size={16} /> : <Play size={16} />}
              {autoRefresh ? "停止跟随" : "实时跟随"}
            </button>
            <button className="secondary-button" onClick={refreshLogsOnly} type="button">
              <RefreshCw size={16} />
              刷新
            </button>
          </>
        }
      />
      <section className="panel terminal-panel">
        {filtered.length > 0 ? (
          <pre ref={preRef}>{filtered.join("\n")}</pre>
        ) : (
          <EmptyState title="暂无日志" body="启动、停止服务或发生异常时会生成日志。" />
        )}
      </section>
    </div>
  );
}

function ImportExportView({ migration, runAction, runConfirmed, copyText, notify, reportError }) {
  const [includeProviderKeys, setIncludeProviderKeys] = useState(false);
  const [exportText, setExportText] = useState("");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");

  async function exportData() {
    if (includeProviderKeys) {
      runConfirmed({
        title: "生成完整本机备份",
        body: "导出内容将包含 provider API Key。仅在受信任的本机环境中保存或传输，避免上传到共享空间。",
        confirmLabel: "生成完整备份",
        action: () => bridge.exportStore({ includeProviderKeys }),
        successMessage: "已生成完整本机备份",
        onResolved: (payload) => setExportText(JSON.stringify(payload, null, 2))
      });
      return;
    }
    const payload = await runAction(
      () => bridge.exportStore({ includeProviderKeys }),
      "已生成脱敏导出"
    );
    setExportText(JSON.stringify(payload, null, 2));
  }

  async function importData() {
    let payload;
    try {
      payload = JSON.parse(importText);
    } catch {
      setImportError("JSON 格式无效，请检查后再导入。");
      return;
    }
    setImportError("");
    runConfirmed({
      title: "导入配置数据",
      body: "导入会写入订阅、模型别名和平台 Key 元数据。请确认 JSON 来源可信，并已备份当前配置。",
      confirmLabel: "导入",
      action: () => bridge.importStore(payload),
      successMessage: "导入完成",
      onResolved: () => setImportText("")
    });
  }

  return (
    <div className="stack import-export-view">
      <section className="metrics-grid">
        <Metric label="SQLite 状态" value={migration?.initialized ? "已初始化" : "未初始化"} icon={Database} tone={migration?.initialized ? "good" : "warn"} />
        <Metric label="订阅" value={migration?.subscriptions || 0} icon={KeyRound} />
        <Metric label="平台 Key" value={migration?.platformKeys || 0} icon={Clipboard} />
        <Metric label="模型别名" value={migration?.modelAliases || 0} icon={SlidersHorizontal} />
      </section>

      <section className="two-column">
        <div className="panel">
          <h2>导出</h2>
          <label className="check-row">
            <input checked={includeProviderKeys} type="checkbox" onChange={(event) => setIncludeProviderKeys(event.target.checked)} />
            包含 provider API Key
          </label>
          <p className="muted">平台 Key 永远不会导出明文；脱敏导出适合迁移模型和订阅结构。</p>
          <div className="button-row">
            <button className="primary-button" onClick={exportData} type="button">
              <Database size={16} />
              生成导出
            </button>
            <button className="secondary-button" disabled={!exportText} onClick={() => copyText(exportText, "导出 JSON 已复制")} type="button">
              <Clipboard size={16} />
              复制
            </button>
            <button
              className="secondary-button"
              disabled={!exportText}
              onClick={async () => {
                try {
                  const result = await bridge.saveExportToFile?.({
                    content: exportText,
                    suggestedName: `aihub-export-${new Date().toISOString().slice(0, 10)}.json`
                  });
                  if (result?.canceled === false && result?.filePath) {
                    notify?.(`已保存到 ${result.filePath}`);
                  }
                } catch (nextError) {
                  reportError?.(nextError);
                }
              }}
              type="button"
            >
              <Save size={16} />
              另存为文件
            </button>
          </div>
          <textarea className="json-area" readOnly value={exportText} placeholder="导出的 JSON 会显示在这里" />
        </div>

        <div className="panel">
          <h2>导入</h2>
          <p className="muted">粘贴 AiHub 导出的 JSON。脱敏订阅不会覆盖已有 API Key，平台 Key 元数据会以禁用状态导入。</p>
          <textarea
            className="json-area"
            value={importText}
            onChange={(event) => {
              setImportText(event.target.value);
              setImportError("");
            }}
            placeholder="{ ... }"
          />
          {importError ? <div className="dialog-status error">{importError}</div> : null}
          <div className="button-row">
            <button className="primary-button" disabled={!importText.trim()} onClick={importData} type="button">
              <Save size={16} />
              导入
            </button>
            <button
              className="secondary-button"
              onClick={async () => {
                try {
                  const result = await bridge.openImportFromFile?.();
                  if (result?.canceled === false && typeof result.content === "string") {
                    setImportText(result.content);
                    setImportError("");
                    notify?.(`已加载 ${result.filePath || "导入文件"}`);
                  }
                } catch (nextError) {
                  reportError?.(nextError);
                }
              }}
              type="button"
            >
              <Database size={16} />
              从文件导入
            </button>
            <button className="secondary-button" onClick={() => { setImportText(""); setImportError(""); }} type="button">清空</button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>迁移状态</h2>
        <div className="detail-list">
          <Row label="数据库" value={migration?.dbPath} />
          <Row label="旧配置" value={migration?.configPath} />
          <Row label="JSON 已迁移" value={migration?.jsonMigrated ? "是" : "否"} />
        </div>
      </section>
    </div>
  );
}

function SettingsView({ config, service, migration, runAction, runConfirmed }) {
  const [host, setHost] = useState(config.service.host);
  const [port, setPort] = useState(config.service.port);
  const [timeoutMs, setTimeoutMs] = useState(config.routing.requestTimeoutMs || 120000);
  const [retryAttempts, setRetryAttempts] = useState(config.routing.retryAttempts ?? 5);

  return (
    <div className="settings-grid">
      <section className="panel">
        <h2>路由策略</h2>
        <div className="settings-row">
          <div>
            <div className="strong">失败自动切换</div>
            <p className="muted">请求失败时继续尝试下一个匹配订阅。</p>
          </div>
          <label className="switch large">
            <input
              checked={config.routing.fallback}
              type="checkbox"
              aria-label="开启或关闭失败自动切换"
              onChange={(event) => runAction(() => bridge.setFallback(event.target.checked), "路由策略已更新")}
            />
            <span />
          </label>
        </div>
        <div className="form-grid compact settings-form">
          <Field label="全局 Timeout ms">
            <input type="number" value={timeoutMs} onChange={(event) => setTimeoutMs(Number(event.target.value))} />
          </Field>
          <Field label="失败重试次数">
            <input type="number" min="0" max="20" value={retryAttempts} onChange={(event) => setRetryAttempts(Number(event.target.value))} />
          </Field>
          <div className="field action-field">
            <span>保存</span>
            <button
              className="secondary-button"
              onClick={() => runAction(async () => {
                await bridge.setRequestTimeout(timeoutMs);
                return bridge.setRetryAttempts(retryAttempts);
              }, "路由重试策略已更新")}
              type="button"
            >
              <Save size={16} />
              保存策略
            </button>
          </div>
        </div>
        <p className="muted settings-note">默认失败重试 5 次：某订阅首次失败后再重试 5 次，仍失败才切到下一个优先级订阅。</p>
      </section>

      <section className="panel">
        <h2>日志与隐私</h2>
        <div className="settings-row">
          <div>
            <div className="strong">写入请求日志</div>
            <p className="muted">记录每次请求的路由、Token 和缓存命中。</p>
          </div>
          <label className="switch large">
            <input
              checked={config.logging?.enabled !== false}
              type="checkbox"
              aria-label="开启或关闭请求日志"
              onChange={(event) => runAction(() => bridge.setLogging({ enabled: event.target.checked }), "日志开关已更新")}
            />
            <span />
          </label>
        </div>
        <div className="settings-row">
          <div>
            <div className="strong">在历史中保留 prompt</div>
            <p className="muted">关闭后请求历史只保留 metadata，不写入用户对话内容。</p>
          </div>
          <label className="switch large">
            <input
              checked={Boolean(config.logging?.includePrompt)}
              type="checkbox"
              aria-label="是否在历史中保留 prompt"
              onChange={(event) => runAction(() => bridge.setLogging({ includePrompt: event.target.checked }), "prompt 记录策略已更新")}
            />
            <span />
          </label>
        </div>
      </section>

      <section className="panel">
        <h2>服务地址</h2>
        <div className="form-grid compact">
          <Field label="Host">
            <input value={host} onChange={(event) => setHost(event.target.value)} />
          </Field>
          <Field label="Port">
            <input type="number" value={port} onChange={(event) => setPort(Number(event.target.value))} />
          </Field>
        </div>
        <div className="button-row">
          <button
            className="primary-button"
            onClick={async () => {
              const trimmedHost = (host || "").trim();
              if (!trimmedHost) {
                return;
              }
              const portNumber = Number(port);
              if (!Number.isFinite(portNumber) || portNumber <= 0 || portNumber > 65535) {
                return;
              }
              await runAction(() => bridge.setService({ host: trimmedHost, port: portNumber }), "服务地址已保存");
              if (service?.running) {
                runConfirmed?.({
                  tone: "info",
                  title: "重启本地网关？",
                  body: `服务地址已保存为 http://${trimmedHost}:${portNumber}。当前服务仍在 ${service.baseUrl}，需要重启后才能生效。`,
                  confirmLabel: "立即重启",
                  cancelLabel: "稍后",
                  action: async () => {
                    await bridge.stopService();
                    return bridge.startService();
                  },
                  successMessage: "服务已使用新地址重启"
                });
              }
            }}
            type="button"
          >
            <Save size={16} />
            保存地址
          </button>
        </div>
        <p className="muted">修改地址后需要重启服务才会生效。</p>
      </section>

      <section className="panel">
        <h2>路径</h2>
        <div className="detail-list">
          <PathRow label="配置文件" value={service.configPath} />
          <PathRow label="SQLite DB" value={migration?.dbPath} />
          <PathRow label="日志文件" value={service.logPath} />
          <Row label="Base URL" value={service.baseUrl} />
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, icon: Icon, tone = "neutral" }) {
  return (
    <div className={`metric ${tone}`}>
      <div className="metric-icon"><Icon size={18} /></div>
      <div>
        <div className="metric-label">{label}</div>
        <div className="metric-value">{value}</div>
      </div>
    </div>
  );
}

function SearchBar({
  value,
  onChange,
  placeholder = "搜索…",
  ariaLabel,
  matchLabel,
  registerForShortcut = true,
  rightSlot
}) {
  const inputRef = useRef(null);
  const focusRegistry = React.useContext(SearchFocusContext);

  useEffect(() => {
    if (!registerForShortcut || !focusRegistry) {
      return undefined;
    }
    const previous = focusRegistry.current;
    focusRegistry.current = () => {
      const node = inputRef.current;
      if (node) {
        node.focus();
        node.select?.();
      }
    };
    return () => {
      focusRegistry.current = previous || null;
    };
  }, [registerForShortcut, focusRegistry]);

  return (
    <section className="search-bar" role="search">
      <div className="search-box">
        <Search size={14} />
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={ariaLabel || placeholder}
          placeholder={placeholder}
        />
        {value ? (
          <button
            className="search-clear"
            onClick={() => onChange("")}
            aria-label="清除搜索"
            title="清除搜索"
            type="button"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      {matchLabel ? <span className="search-meta">{matchLabel}</span> : null}
      {rightSlot}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <code>{value || "-"}</code>
    </div>
  );
}

function PathRow({ label, value }) {
  const target = value || "";
  async function open() {
    if (!target) {
      return;
    }
    if (typeof bridge.revealPath === "function") {
      try {
        await bridge.revealPath(target);
      } catch {
        // ignore — silently fail in demo bridge
      }
    }
  }
  return (
    <div className="detail-row detail-row-path">
      <span>{label}</span>
      <code title={target}>{target || "-"}</code>
      {target ? (
        <button
          className="inline-copy-button"
          onClick={open}
          aria-label={`在文件管理器中打开 ${label}`}
          title="在文件管理器中打开"
          type="button"
        >
          <Database size={14} />
        </button>
      ) : null}
    </div>
  );
}

function ProviderBadge({ provider }) {
  const label = provider === "openai-compatible" ? "OpenAI" : provider;
  return <span className={`provider-badge ${provider}`}>{label}</span>;
}

function ProviderMark({ provider, size = 16 }) {
  const initial = provider === "openai-compatible"
    ? "OC"
    : (provider || "?").charAt(0).toUpperCase();
  const charLength = initial.length;
  const fontSize = charLength > 1 ? Math.round(size * 0.48) : Math.round(size * 0.62);
  return (
    <span className={`provider-mark ${provider || "default"}`} style={{ fontSize }} aria-hidden>
      {initial}
    </span>
  );
}

function ProviderUsageMini({ usage }) {
  if (!usage) {
    return <div className="muted provider-usage-mini">未查询供应商额度</div>;
  }
  return (
    <div className="provider-usage-mini">
      <span>{formatProviderUsage(usage)}</span>
      {usage.queriedAt ? <span className="muted"> · {new Date(usage.queriedAt).toLocaleTimeString("zh-CN")}</span> : null}
    </div>
  );
}

function StatusPill({ running }) {
  return (
    <div className={`status-pill ${running ? "running" : ""}`}>
      {running ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
      {running ? "运行中" : "已停止"}
    </div>
  );
}

function StatusLabel({ ok, text }) {
  return <span className={`status-label ${ok ? "ok" : "fail"}`}>{text}</span>;
}

function ToastStack({ toasts, onDismiss, busy }) {
  return (
    <div className="toast-stack" role="region" aria-live="polite" aria-label="通知">
      {busy ? (
        <div className="toast toast-busy" role="status">
          <Loader2 className="spin" size={14} />
          <span>处理中…</span>
        </div>
      ) : null}
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }) {
  const Icon = toast.tone === "error" ? XCircle : toast.tone === "warning" ? AlertTriangle : toast.tone === "info" ? Info : CheckCircle2;
  return (
    <div
      className={`toast toast-${toast.tone}`}
      role={toast.tone === "error" ? "alert" : "status"}
      aria-live={toast.tone === "error" ? "assertive" : "polite"}
    >
      <Icon className="toast-icon" size={15} />
      <div className="toast-body">
        {toast.title ? <strong>{toast.title}</strong> : null}
        <span>{toast.message}</span>
      </div>
      <button
        className="toast-close"
        onClick={() => onDismiss(toast.id)}
        aria-label="关闭通知"
        type="button"
      >
        <X size={13} />
      </button>
    </div>
  );
}

function ShortcutsDialog({ open, onClose }) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }
  const meta = getMetaKeyLabel();
  const groups = [
    {
      title: "全局",
      items: [
        { keys: [meta, "K"], label: "聚焦当前页搜索" },
        { keys: [meta, "R"], label: "刷新全部数据" },
        { keys: ["?"], label: "切换快捷键面板" },
        { keys: ["Esc"], label: "关闭弹窗或对话框" }
      ]
    },
    {
      title: "切换视图",
      items: navItems.slice(0, 9).map((item, index) => ({
        keys: [meta, String(index + 1)],
        label: item.label
      }))
    }
  ];

  return (
    <div
      className="modal-backdrop confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      <section className="modal shortcuts-modal" role="dialog" aria-modal="true" aria-label="键盘快捷键">
        <div className="modal-header shortcuts-modal-header">
          <div>
            <div className="modal-kicker">Shortcuts</div>
            <h2>键盘快捷键</h2>
            <p>这些组合键在桌面端任何视图都可用，让操作更快。</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭快捷键面板" title="关闭" type="button">
            <X size={16} />
          </button>
        </div>
        <div className="shortcuts-body">
          {groups.map((group) => (
            <section className="shortcut-group" key={group.title}>
              <h3>{group.title}</h3>
              <ul>
                {group.items.map((entry) => (
                  <li key={entry.label}>
                    <span>{entry.label}</span>
                    <span className="shortcut-keys">
                      {entry.keys.map((key, index) => (
                        <React.Fragment key={`${key}-${index}`}>
                          {index > 0 ? <span className="shortcut-plus">+</span> : null}
                          <kbd>{key}</kbd>
                        </React.Fragment>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}

function ConfirmDialog({ confirm, onCancel, onConfirm }) {
  useEffect(() => {
    if (!confirm) {
      return undefined;
    }
    const previousFocus = document.activeElement;
    const tone = confirm.tone || "danger";
    const focusFrame = window.requestAnimationFrame(() => {
      const focusTarget = tone === "danger"
        ? document.querySelector("[data-confirm-cancel]")
        : document.querySelector("[data-confirm-primary]");
      focusTarget?.focus();
    });
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.stopPropagation();
        onConfirm();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown, true);
      previousFocus?.focus?.();
    };
  }, [confirm, onCancel, onConfirm]);

  if (!confirm) {
    return null;
  }
  const tone = confirm.tone || "danger";
  return (
    <div
      className="modal-backdrop confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
      role="presentation"
    >
      <section className={`modal confirm-modal ${tone}`} role="dialog" aria-modal="true" aria-label={confirm.title}>
        <div className="confirm-icon">
          {tone === "danger" ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}
        </div>
        <div className="confirm-content">
          <div className="modal-kicker">人工复核</div>
          <h2>{confirm.title}</h2>
          <p>{confirm.body}</p>
          {tone === "danger" ? (
            <p className="confirm-hint">
              <kbd>Esc</kbd> 取消 · <kbd>{getMetaKeyLabel()}</kbd>
              <span className="shortcut-plus">+</span>
              <kbd>Enter</kbd> 确认
            </p>
          ) : null}
        </div>
        <div className="confirm-actions">
          <button className="secondary-button" data-confirm-cancel onClick={onCancel} type="button">
            {confirm.cancelLabel || "取消"}
          </button>
          <button className={tone === "danger" ? "danger-button solid" : "primary-button"} data-confirm-primary onClick={onConfirm} type="button">
            {confirm.confirmLabel || "确认"}
          </button>
        </div>
      </section>
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (typeof console !== "undefined") {
      console.error("[AiHub] renderer crashed:", error, info?.componentStack);
    }
  }

  handleReload = () => {
    if (typeof window !== "undefined" && typeof window.location?.reload === "function") {
      window.location.reload();
    }
  };

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    const message = error?.message || String(error);
    const stack = error?.stack ? String(error.stack) : "";
    return (
      <div className="app-shell error-shell">
        <main className="workspace">
          <div className="workspace-content">
            <section className="panel error-fallback" role="alert">
              <div className="error-fallback-icon" aria-hidden>
                <AlertTriangle size={22} />
              </div>
              <div className="error-fallback-body">
                <div className="modal-kicker">Renderer Crash</div>
                <h2>客户端遇到一个错误</h2>
                <p className="muted">
                  界面已被错误边界拦截，本地服务和数据未受影响。可以尝试重置当前视图，必要时整体重新加载。
                </p>
                <pre className="error-fallback-message">{message}</pre>
                {stack ? <details className="error-fallback-stack"><summary>错误堆栈</summary><pre>{stack}</pre></details> : null}
                <div className="button-row">
                  <button className="primary-button" onClick={this.handleReset} type="button">
                    <RefreshCw size={16} />
                    重置当前视图
                  </button>
                  <button className="secondary-button" onClick={this.handleReload} type="button">
                    <Activity size={16} />
                    重新加载客户端
                  </button>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    );
  }
}

function LoadingState() {
  return (
    <section className="panel loading-panel">
      <Loader2 className="spin" size={22} />
      正在加载桌面状态
    </section>
  );
}

function EmptyState({ title, body }) {
  return (
    <div className="empty-state">
      <Terminal size={22} />
      <div>
        <div className="strong">{title}</div>
        <p>{body}</p>
      </div>
    </div>
  );
}

function emptySubscription() {
  return {
    name: "",
    provider: "gemini",
    apiKey: "",
    model: "",
    priority: 100,
    enabled: true,
    baseUrl: "",
    usageUrl: "",
    apiVersion: "",
    website: "",
    notes: "",
    timeoutMs: 0
  };
}

function emptyUsageStats() {
  return {
    total: emptyUsageBucket({ name: "total" }),
    subscriptions: []
  };
}

function emptyUsageBucket(subscription = {}) {
  return {
    name: subscription.name || "",
    provider: subscription.provider || "",
    model: subscription.model || "",
    priority: subscription.priority || 9999,
    enabled: subscription.enabled,
    requests: 0,
    successes: 0,
    failures: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    latencyMs: 0,
    cacheHitRate: 0,
    successRate: 0,
    averageLatencyMs: 0,
    lastUsedAt: ""
  };
}

function viewSubtitle(view) {
  const subtitles = {
    dashboard: "查看服务状态、总用量、缓存命中和最近活动。",
    subscriptions: "管理 Gemini、Claude、Codex 订阅、优先级和每个订阅的用量。",
    platformKeys: "创建本地网关访问 Key，查看额度、成功率和缓存命中。",
    models: "把外部模型名绑定到多个订阅路由，实现稳定别名和优先级切换。",
    usage: "按总量和订阅维度统计请求、Token、缓存命中率、成功率。",
    chat: "通过聚合路由发送测试请求，确认订阅切换和统计是否正常。",
    history: "查看最近请求的路由、Token、缓存和错误信息。",
    logs: "查看本地桌面应用和服务日志。",
    importExport: "导入导出订阅、模型别名和平台 Key 元数据。",
    settings: "配置 fallback 策略和本地服务地址。"
  };
  return subtitles[view] || subtitles.dashboard;
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
}

function formatTokenLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) {
    return "—";
  }
  return `${formatNumber(value)} tk`;
}

function formatPercentOrDash(value, denominator) {
  const denom = Number(denominator);
  if (!Number.isFinite(denom) || denom <= 0) {
    return "—";
  }
  return formatPercent(value);
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 1000) / 10}%`;
}

function formatProviderUsage(usage = {}) {
  const unit = usage.currency ? ` ${usage.currency}` : "";
  if (usage.remaining != null && usage.total != null) {
    return `剩余 ${formatCompactNumber(usage.remaining)} / ${formatCompactNumber(usage.total)}${unit}`;
  }
  if (usage.used != null && usage.total != null) {
    return `已用 ${formatCompactNumber(usage.used)} / ${formatCompactNumber(usage.total)}${unit}`;
  }
  if (usage.remaining != null) {
    return `剩余 ${formatCompactNumber(usage.remaining)}${unit}`;
  }
  if (usage.used != null) {
    return `已用 ${formatCompactNumber(usage.used)}${unit}`;
  }
  if (usage.utilization != null) {
    return `使用率 ${formatPercent(Number(usage.utilization) / 100)}`;
  }
  return "已查询";
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function cacheHitRate(usage = {}) {
  const inputTokens = Number(usage?.inputTokens || 0);
  return inputTokens > 0 ? Number(usage?.cachedInputTokens || 0) / inputTokens : 0;
}

function buildOpenAiEnvSnippet(service, platformKeys = []) {
  const baseUrl = service?.baseUrl || "http://127.0.0.1:8787/v1";
  const enabledKey = (platformKeys || []).find((key) => key?.enabled);
  const tokenLine = enabledKey?.keyPrefix
    ? `# 使用平台 Key "${enabledKey.name}" (${enabledKey.keyPrefix})，导出实际 Key 值：\nexport OPENAI_API_KEY="<your-platform-key>"`
    : `# 未创建平台 Key，可暂用兼容旧用法的占位\nexport OPENAI_API_KEY="aihub-local"`;
  return `export OPENAI_BASE_URL="${baseUrl}"\n${tokenLine}`;
}

function allConfiguredModels(config = {}) {
  const values = [];
  for (const subscription of config.subscriptions || []) {
    values.push(subscription.model, ...(subscription.models || []));
  }
  return [...new Set(values.filter(Boolean))].sort();
}

function getMetaKeyLabel() {
  if (typeof window === "undefined") {
    return "Ctrl";
  }
  const platform = window.navigator?.platform || "";
  return /Mac|iPhone|iPad/.test(platform) ? "⌘" : "Ctrl";
}

function toggleThemeWithReveal(buttonEl, currentTheme, setTheme) {
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  const reduceMotion = typeof window !== "undefined"
    && window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const supportsViewTransition = typeof document !== "undefined"
    && typeof document.startViewTransition === "function";

  if (reduceMotion || !supportsViewTransition || !buttonEl) {
    setTheme(nextTheme);
    return;
  }

  const rect = buttonEl.getBoundingClientRect();
  const originX = rect.left + rect.width / 2;
  const originY = rect.top + rect.height / 2;
  const farthestCorner = Math.hypot(
    Math.max(originX, window.innerWidth - originX),
    Math.max(originY, window.innerHeight - originY)
  );

  const root = document.documentElement;
  root.style.setProperty("--theme-toggle-x", `${originX}px`);
  root.style.setProperty("--theme-toggle-y", `${originY}px`);
  root.style.setProperty("--theme-toggle-radius", `${farthestCorner}px`);
  root.dataset.themeTransition = nextTheme === "dark" ? "to-dark" : "to-light";

  const transition = document.startViewTransition(() => {
    setTheme(nextTheme);
  });
  transition.finished.finally(() => {
    delete root.dataset.themeTransition;
    root.style.removeProperty("--theme-toggle-x");
    root.style.removeProperty("--theme-toggle-y");
    root.style.removeProperty("--theme-toggle-radius");
  });
}

function getInitialTheme() {
  const fromBridge = bridge?.initialTheme;
  if (fromBridge === "light" || fromBridge === "dark") {
    return fromBridge;
  }
  const stored = window.localStorage?.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

function getInitialView() {
  try {
    const stored = window.localStorage?.getItem(ACTIVE_VIEW_STORAGE_KEY);
    if (stored && navItems.some((item) => item.id === stored)) {
      return stored;
    }
  } catch {
    // ignore storage errors
  }
  return "dashboard";
}

function createBrowserBridge() {
  const state = loadBrowserBridgeState({
    config: {
      version: 1,
      service: { host: "127.0.0.1", port: 8787 },
      routing: { fallback: true, requestTimeoutMs: 120000, retryAttempts: 5 },
      logging: { enabled: true, includePrompt: false },
      subscriptions: [
        {
          name: "demo-gemini",
          provider: "gemini",
          apiKey: "demo...key",
          model: "gemini-2.5-flash",
          models: ["gemini-2.5-flash", "gemini-2.5-pro"],
          priority: 1,
          enabled: true,
          baseUrl: "",
          usageUrl: "",
          apiVersion: "",
          website: "",
          notes: "",
          timeoutMs: 0,
          tags: []
        }
      ],
      modelAliases: [
        {
          alias: "gpt-4o",
          description: "演示公开模型",
          enabled: true,
          routes: [
            {
              id: 1,
              alias: "gpt-4o",
              subscriptionName: "demo-gemini",
              providerModel: "gemini-2.5-flash",
              priority: 1,
              enabled: true
            }
          ]
        }
      ]
    },
    platformKeys: [],
    service: {
      running: false,
      host: "127.0.0.1",
      port: 8787,
      url: "http://127.0.0.1:8787",
      baseUrl: "http://127.0.0.1:8787/v1",
      startedAt: "",
      configPath: "~/.aihub/config.json",
      logPath: "~/.aihub/aihub.log"
    },
    history: [],
    logs: [],
    nextPlatformKeyId: 1,
    nextRouteId: 2
  });

  function persist() {
    window.localStorage?.setItem(BROWSER_BRIDGE_STORAGE_KEY, JSON.stringify(state));
  }

  function configSnapshot() {
    return cloneBridgeValue(state.config);
  }

  return {
    initialTheme: null,
    persistTheme: async () => true,
    readConfig: async () => configSnapshot(),
    configPath: async () => "~/.aihub/config.json",
    setService: async ({ host, port }) => {
      state.config.service = { host, port };
      state.service = { ...state.service, host, port, url: `http://${host}:${port}`, baseUrl: `http://${host}:${port}/v1` };
      persist();
      return configSnapshot();
    },
    setFallback: async (enabled) => {
      state.config.routing.fallback = enabled;
      persist();
      return configSnapshot();
    },
    setRequestTimeout: async (timeoutMs) => {
      state.config.routing.requestTimeoutMs = Number(timeoutMs || 120000);
      persist();
      return configSnapshot();
    },
    setRetryAttempts: async (retryAttempts) => {
      state.config.routing.retryAttempts = Number(retryAttempts ?? 5);
      persist();
      return configSnapshot();
    },
    setLogging: async (payload = {}) => {
      state.config.logging = {
        ...state.config.logging,
        ...(typeof payload.enabled === "boolean" ? { enabled: payload.enabled } : {}),
        ...(typeof payload.includePrompt === "boolean" ? { includePrompt: payload.includePrompt } : {})
      };
      persist();
      return configSnapshot();
    },
    revealPath: async () => true,
    upsertSubscription: async (subscription) => {
      const originalName = subscription.originalName || subscription.name;
      const targetExists = state.config.subscriptions.some((item) => item.name === subscription.name);
      if (originalName && originalName !== subscription.name && targetExists) {
        throw new Error(`订阅名称 "${subscription.name}" 已存在，请换一个名称。`);
      }
      if (originalName && originalName !== subscription.name) {
        state.config.subscriptions = state.config.subscriptions.filter((item) => item.name !== originalName);
      }
      const index = state.config.subscriptions.findIndex((item) => item.name === subscription.name);
      const existing = index >= 0 ? state.config.subscriptions[index] : null;
      const { originalName: _originalName, ...payload } = subscription;
      const next = {
        ...existing,
        ...payload,
        apiKey: payload.apiKey || existing?.apiKey || "demo...key",
        tags: payload.tags || existing?.tags || []
      };
      if (index >= 0) {
        state.config.subscriptions[index] = next;
      } else {
        state.config.subscriptions.push(next);
      }
      state.config.subscriptions.sort((a, b) => a.priority - b.priority);
      persist();
      return configSnapshot();
    },
    removeSubscription: async (name) => {
      state.config.subscriptions = state.config.subscriptions.filter((item) => item.name !== name);
      persist();
      return configSnapshot();
    },
    setSubscriptionEnabled: async ({ name, enabled }) => {
      state.config.subscriptions.find((item) => item.name === name).enabled = enabled;
      persist();
      return configSnapshot();
    },
    setSubscriptionPriority: async ({ name, priority }) => {
      state.config.subscriptions.find((item) => item.name === name).priority = priority;
      state.config.subscriptions.sort((a, b) => a.priority - b.priority);
      persist();
      return configSnapshot();
    },
    fetchSubscriptionModels: async (name) => {
      const subscription = typeof name === "string"
        ? state.config.subscriptions.find((item) => item.name === name)
        : name;
      if (subscription) {
        const samples = {
          gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
          claude: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
          codex: ["gpt-5.1", "gpt-5.1-codex", "gpt-4.1"],
          "openai-compatible": ["gpt-4o", "gpt-4.1", "o4-mini"]
        };
        subscription.models = samples[subscription.provider] || [subscription.model].filter(Boolean);
        subscription.model = subscription.model || subscription.models[0] || "";
        persist();
      }
      return { models: subscription?.models || [], config: configSnapshot() };
    },
    testSubscriptionConnection: async (subscription) => {
      const models = {
        gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
        claude: ["claude-sonnet-4-5"],
        codex: ["gpt-5.1"],
        "openai-compatible": ["gpt-4o"]
      }[subscription.provider] || [];
      return { ok: true, provider: subscription.provider, name: subscription.name, modelCount: models.length, sampleModels: models, latencyMs: 18 };
    },
    querySubscriptionUsage: async (input) => {
      const subscription = typeof input === "string"
        ? state.config.subscriptions.find((item) => item.name === input)
        : input;
      return {
        ok: true,
        name: subscription?.name || "demo",
        provider: subscription?.provider || "gemini",
        remaining: 82,
        total: 100,
        used: 18,
        utilization: 18,
        currency: "",
        queriedAt: new Date().toISOString(),
        latencyMs: 20
      };
    },
    startService: async () => {
      state.service.running = true;
      state.service.startedAt = new Date().toISOString();
      state.logs.push(`${new Date().toISOString()}\t[desktop]\t服务已启动`);
      persist();
      return cloneBridgeValue(state.service);
    },
    stopService: async () => {
      state.service.running = false;
      state.logs.push(`${new Date().toISOString()}\t[desktop]\t服务已停止`);
      persist();
      return cloneBridgeValue(state.service);
    },
    serviceStatus: async () => cloneBridgeValue(state.service),
    readHistory: async () => cloneBridgeValue(state.history),
    readUsage: async () => buildClientUsageStats(state.history, state.config),
    readLogs: async () => cloneBridgeValue(state.logs),
    listPlatformKeys: async () => cloneBridgeValue(state.platformKeys),
    createPlatformKey: async (payload = {}) => {
      const key = `aih_demo_${Math.random().toString(36).slice(2, 18)}`;
      const item = {
        id: state.nextPlatformKeyId++,
        name: payload.name || "demo-key",
        keyPrefix: `${key.slice(0, 8)}...${key.slice(-4)}`,
        enabled: true,
        monthlyRequestQuota: Number(payload.monthlyRequestQuota || 0),
        monthlyTokenQuota: Number(payload.monthlyTokenQuota || 0),
        monthRequests: 0,
        monthTokens: 0,
        cachedInputTokens: 0,
        cacheHitRate: 0,
        successRate: 0,
        lastUsedAt: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.platformKeys.unshift(item);
      persist();
      return { key, item: cloneBridgeValue(item) };
    },
    updatePlatformKey: async (payload) => {
      const key = state.platformKeys.find((item) => item.id === payload.id);
      if (key) {
        Object.assign(key, payload);
        persist();
      }
      return cloneBridgeValue(state.platformKeys);
    },
    setPlatformKeyEnabled: async ({ id, enabled }) => {
      const key = state.platformKeys.find((item) => item.id === id);
      if (key) {
        key.enabled = enabled;
        persist();
      }
      return cloneBridgeValue(state.platformKeys);
    },
    deletePlatformKey: async (id) => {
      state.platformKeys = state.platformKeys.filter((item) => item.id !== id);
      persist();
      return cloneBridgeValue(state.platformKeys);
    },
    listModelAliases: async () => cloneBridgeValue(state.config.modelAliases),
    upsertModelAlias: async (payload) => {
      const existing = state.config.modelAliases.find((item) => item.alias === payload.alias);
      if (existing) {
        Object.assign(existing, payload);
      } else {
        state.config.modelAliases.push({ ...payload, enabled: payload.enabled !== false, routes: [] });
      }
      persist();
      return cloneBridgeValue(state.config.modelAliases);
    },
    setModelAliasEnabled: async ({ alias, enabled }) => {
      const item = state.config.modelAliases.find((modelAlias) => modelAlias.alias === alias);
      if (item) {
        item.enabled = enabled;
        persist();
      }
      return cloneBridgeValue(state.config.modelAliases);
    },
    deleteModelAlias: async (alias) => {
      state.config.modelAliases = state.config.modelAliases.filter((item) => item.alias !== alias);
      persist();
      return cloneBridgeValue(state.config.modelAliases);
    },
    upsertModelRoute: async (payload) => {
      const alias = state.config.modelAliases.find((item) => item.alias === payload.alias);
      if (alias) {
        alias.routes.push({ ...payload, id: state.nextRouteId++, enabled: payload.enabled !== false });
        persist();
      }
      return cloneBridgeValue(state.config.modelAliases);
    },
    deleteModelRoute: async (id) => {
      for (const alias of state.config.modelAliases) {
        alias.routes = alias.routes.filter((route) => route.id !== id);
      }
      persist();
      return cloneBridgeValue(state.config.modelAliases);
    },
    exportStore: async ({ includeProviderKeys } = {}) => ({
      version: 1,
      exportedAt: new Date().toISOString(),
      config: {
        service: state.config.service,
        routing: state.config.routing,
        logging: state.config.logging
      },
      subscriptions: includeProviderKeys ? state.config.subscriptions : state.config.subscriptions.map((subscription) => ({ ...subscription, apiKey: "demo...key" })),
      platformKeys: state.platformKeys,
      modelAliases: state.config.modelAliases
    }),
    importStore: async (payload) => {
      state.config.subscriptions = payload.subscriptions || state.config.subscriptions;
      state.config.modelAliases = payload.modelAliases || state.config.modelAliases;
      persist();
      return configSnapshot();
    },
    saveExportToFile: async ({ content, suggestedName } = {}) => {
      if (typeof content !== "string") {
        return { canceled: true };
      }
      try {
        const blob = new Blob([content], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = suggestedName || "aihub-export.json";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        return { canceled: false, filePath: link.download };
      } catch {
        return { canceled: true };
      }
    },
    openImportFromFile: async () => new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve({ canceled: true });
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve({ canceled: false, filePath: file.name, content: String(reader.result || "") });
        reader.onerror = () => resolve({ canceled: true });
        reader.readAsText(file);
      };
      input.click();
    }),
    migrationStatus: async () => ({
      dbPath: "~/.aihub/aihub.db",
      configPath: "~/.aihub/config.json",
      initialized: true,
      jsonMigrated: true,
      subscriptions: state.config.subscriptions.length,
      platformKeys: state.platformKeys.length,
      modelAliases: state.config.modelAliases.length
    }),
    sendChat: async (request) => {
      const usage = {
        inputTokens: 120,
        outputTokens: 36,
        totalTokens: 156,
        cachedInputTokens: 48,
        cacheWriteTokens: 0,
        reasoningTokens: 0
      };
      const result = {
        provider: request.provider === "auto" ? "gemini" : request.provider,
        subscription: request.subscription || "demo-gemini",
        model: request.model || "gemini-2.5-flash",
        text: `演示响应：${request.prompt}`,
        usage,
        attempts: [{ subscription: "demo-gemini", provider: "gemini", ok: true, latencyMs: 24 }]
      };
      state.history.push({
        ts: new Date().toISOString(),
        ok: true,
        provider: result.provider,
        subscription: result.subscription,
        model: result.model,
        usage,
        attempts: result.attempts
      });
      persist();
      return result;
    }
  };
}

function loadBrowserBridgeState(defaultState) {
  try {
    const raw = window.localStorage?.getItem(BROWSER_BRIDGE_STORAGE_KEY);
    if (!raw) {
      return defaultState;
    }
    const parsed = JSON.parse(raw);
    return {
      ...defaultState,
      ...parsed,
      config: {
        ...defaultState.config,
        ...(parsed.config || {})
      },
      service: {
        ...defaultState.service,
        ...(parsed.service || {})
      },
      platformKeys: parsed.platformKeys || defaultState.platformKeys,
      history: parsed.history || defaultState.history,
      logs: parsed.logs || defaultState.logs,
      nextPlatformKeyId: parsed.nextPlatformKeyId || defaultState.nextPlatformKeyId,
      nextRouteId: parsed.nextRouteId || defaultState.nextRouteId
    };
  } catch {
    return defaultState;
  }
}

function cloneBridgeValue(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function buildClientUsageStats(history, config) {
  const total = emptyUsageBucket({ name: "total" });
  const rows = new Map((config.subscriptions || []).map((subscription) => [subscription.name, emptyUsageBucket(subscription)]));
  for (const entry of history) {
    const row = rows.get(entry.subscription) || emptyUsageBucket({ name: entry.subscription, provider: entry.provider, model: entry.model });
    rows.set(row.name, row);
    total.requests += 1;
    row.requests += 1;
    if (entry.ok) {
      total.successes += 1;
      row.successes += 1;
    } else {
      total.failures += 1;
      row.failures += 1;
    }
    addClientUsage(total, entry.usage);
    addClientUsage(row, entry.usage);
    const latency = entry.attempts?.find((attempt) => attempt.ok)?.latencyMs || 0;
    total.latencyMs += latency;
    row.latencyMs += latency;
    row.lastUsedAt = entry.ts;
  }
  return {
    total: finalizeClientUsage(total),
    subscriptions: [...rows.values()].map(finalizeClientUsage).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
  };
}

function addClientUsage(target, usage = {}) {
  target.inputTokens += Number(usage.inputTokens || 0);
  target.outputTokens += Number(usage.outputTokens || 0);
  target.totalTokens += Number(usage.totalTokens || 0);
  target.cachedInputTokens += Number(usage.cachedInputTokens || 0);
  target.cacheWriteTokens += Number(usage.cacheWriteTokens || 0);
  target.reasoningTokens += Number(usage.reasoningTokens || 0);
}

function finalizeClientUsage(stats) {
  return {
    ...stats,
    cacheHitRate: stats.inputTokens > 0 ? stats.cachedInputTokens / stats.inputTokens : 0,
    successRate: stats.requests > 0 ? stats.successes / stats.requests : 0,
    averageLatencyMs: stats.requests > 0 ? Math.round(stats.latencyMs / stats.requests) : 0
  };
}

const rootElement = document.getElementById("root");
const root = window.__aihubReactRoot || createRoot(rootElement);
window.__aihubReactRoot = root;
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
