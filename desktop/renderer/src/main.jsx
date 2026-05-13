import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BarChart3,
  Bot,
  CheckCircle2,
  Clipboard,
  Database,
  FileText,
  Gauge,
  History,
  KeyRound,
  Layers,
  LayoutDashboard,
  Loader2,
  MessageSquareText,
  Moon,
  Play,
  Plus,
  Power,
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

const topModeItems = [
  { id: "dashboard", label: "总览", icon: LayoutDashboard },
  { id: "subscriptions", label: "订阅池", icon: KeyRound },
  { id: "platformKeys", label: "平台 Key", icon: Clipboard },
  { id: "models", label: "模型", icon: SlidersHorizontal }
];

const THEME_STORAGE_KEY = "aihub-theme";
const BROWSER_BRIDGE_STORAGE_KEY = "aihub-browser-bridge-state";
const defaultBridge = createBrowserBridge();
const bridge = window.aihub || defaultBridge;

function App() {
  const [activeView, setActiveView] = useState("dashboard");
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
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refreshAll() {
    const [
      nextConfig,
      nextStatus,
      nextHistory,
      nextLogs,
      nextUsage,
      nextPlatformKeys,
      nextModelAliases,
      nextMigration
    ] = await Promise.all([
      bridge.readConfig(),
      bridge.serviceStatus(),
      bridge.readHistory({ limit: 80 }),
      bridge.readLogs({ lines: 180 }),
      bridge.readUsage({ limit: 10000 }),
      bridge.listPlatformKeys(),
      bridge.listModelAliases(),
      bridge.migrationStatus()
    ]);
    setConfig(nextConfig);
    setService(nextStatus);
    setHistory(nextHistory);
    setLogs(nextLogs);
    setUsage(nextUsage);
    setPlatformKeys(nextPlatformKeys);
    setModelAliases(nextModelAliases);
    setMigration(nextMigration);
  }

  async function runAction(action, successMessage) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      await refreshAll();
      const nextConfig = configFromActionResult(result);
      if (nextConfig) {
        setConfig(nextConfig);
      }
      if (successMessage) {
        setNotice(successMessage);
      }
      return result;
    } catch (nextError) {
      setError(nextError.message || String(nextError));
      throw nextError;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refreshAll().catch((nextError) => setError(nextError.message || String(nextError)));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage?.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const enabledSubscriptions = useMemo(
    () => (config?.subscriptions || []).filter((subscription) => subscription.enabled),
    [config]
  );
  const recent = history[history.length - 1];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="titlebar-drag" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="brand">
          <div className="brand-mark">
            <Bot size={18} />
          </div>
          <div>
            <div className="brand-title">AiHub</div>
            <div className="brand-subtitle">Local Client</div>
          </div>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-button ${activeView === item.id ? "active" : ""}`}
                key={item.id}
                onClick={() => setActiveView(item.id)}
                aria-current={activeView === item.id ? "page" : undefined}
                title={item.label}
                type="button"
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <StatusPill running={service?.running} />
          <code>{service?.baseUrl || "http://127.0.0.1:8787/v1"}</code>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{navItems.find((item) => item.id === activeView)?.label}</h1>
            <p>{viewSubtitle(activeView)}</p>
          </div>
          <div className="client-segmented" role="tablist" aria-label="常用工作区">
            {topModeItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={`top-mode-button ${activeView === item.id ? "active" : ""}`}
                  key={item.id}
                  onClick={() => setActiveView(item.id)}
                  role="tab"
                  aria-selected={activeView === item.id}
                  type="button"
                >
                  <Icon size={15} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button theme-toggle"
              onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
              aria-label={theme === "dark" ? "切换浅色模式" : "切换深色模式"}
              title={theme === "dark" ? "切换浅色模式" : "切换深色模式"}
              type="button"
            >
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button className="icon-button" onClick={() => runAction(refreshAll)} aria-label="刷新全部状态" title="刷新" type="button">
              <RefreshCw size={17} />
            </button>
            {service?.running ? (
              <button className="danger-button" onClick={() => runAction(() => bridge.stopService(), "服务已停止")} type="button">
                <Square size={16} />
                停止
              </button>
            ) : (
              <button className="primary-button" onClick={() => runAction(() => bridge.startService(), "服务已启动")} type="button">
                <Play size={16} />
                启动
              </button>
            )}
          </div>
        </header>

        <div className="workspace-content">
          {config && service ? (
            <WorkspaceStatusBar
              config={config}
              enabledSubscriptions={enabledSubscriptions}
              modelAliases={modelAliases}
              platformKeys={platformKeys}
              service={service}
              usage={usage}
              providerUsage={providerUsage}
            />
          ) : null}

          <MessageStrip notice={notice} error={error} busy={busy} />

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
              providerUsage={providerUsage}
              setProviderUsage={setProviderUsage}
              setActiveView={setActiveView}
            />
          )}
        </div>
      </main>
    </div>
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

function WorkspaceStatusBar({ config, enabledSubscriptions, modelAliases, platformKeys, service, usage }) {
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
          onClick={() => navigator.clipboard?.writeText(service.baseUrl)}
          aria-label="复制 Base URL"
          title="复制 Base URL"
          type="button"
        >
          <Clipboard size={14} />
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

function DashboardView({ config, service, enabledSubscriptions, history, logs, usage, platformKeys, modelAliases, recent, runAction, setActiveView }) {
  const providerSummaries = buildProviderSummaries(config.subscriptions || []);
  const routingLanes = [...enabledSubscriptions]
    .sort((a, b) => Number(a.priority || 9999) - Number(b.priority || 9999))
    .slice(0, 4);

  return (
    <div className="stack">
      <section className="client-control-grid">
        <div className="client-control-card">
          <div className="control-card-head">
            <div>
              <p className="eyebrow">Local Gateway</p>
              <h2>{service.running ? "网关正在接管本机 AI 请求" : "网关待启动"}</h2>
              <p className="muted">统一接入订阅池、平台 Key 和公开模型别名，外部工具只需要指向本地 API。</p>
            </div>
            <StatusPill running={service.running} />
          </div>
          <div className="endpoint-box">
            <div>
              <span>Base URL</span>
              <code>{service.baseUrl}</code>
            </div>
            <button className="icon-button" onClick={() => navigator.clipboard?.writeText(service.baseUrl)} aria-label="复制 Base URL" title="复制 Base URL" type="button">
              <Clipboard size={16} />
            </button>
          </div>
          <div className="control-card-actions">
            {service.running ? (
              <button className="danger-button" onClick={() => runAction(() => bridge.stopService(), "服务已停止")} type="button">
                <Square size={16} />
                停止网关
              </button>
            ) : (
              <button className="primary-button" onClick={() => runAction(() => bridge.startService(), "服务已启动")} type="button">
                <Play size={16} />
                启动网关
              </button>
            )}
            <button className="secondary-button" onClick={() => setActiveView("chat")} type="button">
              <MessageSquareText size={16} />
              对话测试
            </button>
            <button className="secondary-button" onClick={() => setActiveView("settings")} type="button">
              <Settings size={16} />
              策略设置
            </button>
          </div>
        </div>

        <div className="client-switch-card">
          <div className="control-card-head compact">
            <div>
              <p className="eyebrow">Provider Switch</p>
              <h2>订阅切换池</h2>
            </div>
            <button className="secondary-button" onClick={() => setActiveView("subscriptions")} type="button">
              <KeyRound size={16} />
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
              <div className="routing-step" key={subscription.name}>
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

      <section className="metrics-grid">
        <Metric label="服务状态" value={service.running ? "运行中" : "已停止"} icon={Power} tone={service.running ? "good" : "warn"} />
        <Metric label="启用订阅" value={enabledSubscriptions.length} icon={Database} />
        <Metric label="启用平台 Key" value={(platformKeys || []).filter((key) => key.enabled).length} icon={Clipboard} />
        <Metric label="公开模型" value={(modelAliases || []).filter((alias) => alias.enabled).length} icon={SlidersHorizontal} />
        <Metric label="总 Token" value={formatNumber(usage.total.totalTokens)} icon={Activity} />
      </section>

      <section className="panel split-panel">
        <div>
          <h2><Terminal size={18} /> 本地 API</h2>
          <p className="muted">把这个 Base URL 配给兼容 OpenAI API 的 CLI 或工具。</p>
          <div className="copy-row">
            <code>{service.baseUrl}</code>
            <button className="icon-button" onClick={() => navigator.clipboard?.writeText(service.baseUrl)} aria-label="复制 Base URL" title="复制 Base URL" type="button">
              <Clipboard size={16} />
            </button>
          </div>
        </div>
        <div className="button-row">
          {service.running ? (
            <button className="danger-button" onClick={() => runAction(() => bridge.stopService(), "服务已停止")} type="button">
              <Square size={16} />
              停止服务
            </button>
          ) : (
            <button className="primary-button" onClick={() => runAction(() => bridge.startService(), "服务已启动")} type="button">
              <Play size={16} />
              启动服务
            </button>
          )}
          <button className="secondary-button" onClick={() => setActiveView("settings")} type="button">
            <Settings size={16} />
            设置
          </button>
        </div>
      </section>

      <section className="metrics-grid">
        <Metric label="请求总数" value={formatNumber(usage.total.requests)} icon={BarChart3} />
        <Metric label="成功率" value={formatPercent(usage.total.successRate)} icon={CheckCircle2} tone="good" />
        <Metric label="缓存命中率" value={formatPercent(usage.total.cacheHitRate)} icon={Gauge} tone={usage.total.cacheHitRate > 0 ? "good" : "neutral"} />
        <Metric label="输入 Token" value={formatNumber(usage.total.inputTokens)} icon={Terminal} />
        <Metric label="输出 Token" value={formatNumber(usage.total.outputTokens)} icon={Bot} />
      </section>

      <section className="two-column">
        <div className="panel">
          <h2><Layers size={18} /> 最近路由</h2>
          {recent ? (
            <div className="detail-list">
              <Row label="时间" value={recent.ts} />
              <Row label="结果" value={recent.ok ? "成功" : "失败"} />
              <Row label="路由" value={`${recent.provider || "auto"} / ${recent.subscription || "-"} / ${recent.model || "-"}`} />
              <Row label="Token" value={formatNumber(recent.usage?.totalTokens || 0)} />
              <Row label="缓存命中" value={formatPercent(cacheHitRate(recent.usage))} />
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

function SubscriptionsView({ config, usage, runAction, providerUsage, setProviderUsage }) {
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const usageByName = useMemo(() => new Map((usage.subscriptions || []).map((item) => [item.name, item])), [usage]);
  const normalizedFilter = filter.trim().toLowerCase();
  const subscriptions = (config.subscriptions || []).filter((item) => {
    const providerMatched = providerFilter === "all" || item.provider === providerFilter;
    const textMatched = `${item.name} ${item.provider} ${item.model} ${(item.models || []).join(" ")}`
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

  return (
    <div className="stack">
      <section className="panel toolbar-panel">
        <div className="search-box">
          <Search size={16} />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="按名称、供应商或模型筛选订阅" placeholder="按名称、供应商或模型筛选" />
        </div>
        <div className="toolbar-meta">
          <span>{providerFilter === "all" ? "全部供应商" : providers.find((provider) => provider.value === providerFilter)?.label}</span>
          <strong>{subscriptions.length}</strong>
          <span>个匹配订阅</span>
        </div>
        {(filter || providerFilter !== "all") ? (
          <button className="secondary-button" onClick={() => { setFilter(""); setProviderFilter("all"); }} type="button">
            <XCircle size={16} />
            清除筛选
          </button>
        ) : null}
        <button className="primary-button" onClick={() => setEditing(emptySubscription())} type="button">
          <Plus size={16} />
          新增订阅
        </button>
      </section>

      <section className="provider-summary-grid">
        <button
          className={`provider-summary-card all ${providerFilter === "all" ? "active" : ""}`}
          onClick={() => setProviderFilter("all")}
          aria-pressed={providerFilter === "all"}
          type="button"
          title="显示全部供应商"
        >
          <span className="provider-all-mark"><Layers size={17} /></span>
          <div>
            <div className="provider-summary-title">全部供应商</div>
            <div className="provider-summary-meta">
              {allSubscriptions.filter((subscription) => subscription.enabled).length}/{allSubscriptions.length} 启用 · {allSubscriptions.reduce((sum, item) => sum + (item.models?.length || (item.model ? 1 : 0)), 0)} 模型
            </div>
          </div>
        </button>
        {allGroups.map((group) => (
          <button
            className={`provider-summary-card ${group.value} ${providerFilter === group.value ? "active" : ""}`}
            key={group.value}
            onClick={() => setProviderFilter(group.value)}
            aria-pressed={providerFilter === group.value}
            type="button"
            title={`筛选 ${group.label}`}
          >
            <ProviderBadge provider={group.value} />
            <div>
              <div className="provider-summary-title">{group.label}</div>
              <div className="provider-summary-meta">{group.enabled}/{group.total} 启用 · {group.models} 模型</div>
            </div>
          </button>
        ))}
      </section>

      {grouped.map((group) => (
        <section className="table-panel provider-section" key={group.value}>
          <div className="provider-section-header">
            <div>
              <h2>{group.label}</h2>
              <p className="muted">{group.items.length} 个订阅，{group.items.reduce((sum, item) => sum + (item.models?.length || (item.model ? 1 : 0)), 0)} 个模型</p>
            </div>
            <ProviderBadge provider={group.value} />
          </div>
          <div className="table-wrapper">
            <table className="subscription-table">
            <thead>
              <tr>
                <th>优先级</th>
                <th>状态</th>
                <th>订阅</th>
                <th>默认模型</th>
                <th>支持模型</th>
                <th>请求</th>
                <th>Token</th>
                <th>缓存</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {group.items.map((subscription) => {
                const stats = usageByName.get(subscription.name) || emptyUsageBucket(subscription);
                return (
                  <tr key={subscription.name}>
                    <td>
                      <input
                        className="priority-input"
                        type="number"
                        value={subscription.priority}
                        aria-label={`设置 ${subscription.name} 的优先级`}
                        onChange={(event) =>
                          runAction(() =>
                            bridge.setSubscriptionPriority({
                              name: subscription.name,
                              priority: Number(event.target.value)
                            })
                          )
                        }
                      />
                    </td>
                    <td>
                      <label className="switch">
                        <input
                          checked={subscription.enabled}
                          type="checkbox"
                          aria-label={`${subscription.enabled ? "禁用" : "启用"}订阅 ${subscription.name}`}
                          onChange={(event) =>
                            runAction(() =>
                              bridge.setSubscriptionEnabled({
                                name: subscription.name,
                                enabled: event.target.checked
                              })
                            )
                          }
                        />
                        <span />
                      </label>
                    </td>
                    <td>
                      <div className="subscription-name-cell">
                        <div className="strong truncate">{subscription.name}</div>
                        <div className="subscription-meta-icons">
                          {subscription.website ? (
                            <a href={subscription.website} target="_blank" rel="noreferrer" title={`访问官网: ${subscription.website}`} className="meta-icon-link">
                              <Wifi size={12} />
                            </a>
                          ) : null}
                          {subscription.notes ? (
                            <span title={subscription.notes} className="meta-icon-note">
                              <FileText size={12} />
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="muted">成功率 {formatPercent(stats.successRate)}</div>
                      <ProviderUsageMini usage={providerUsage[subscription.name]} />
                    </td>
                    <td><code>{subscription.model || "-"}</code></td>
                    <td><ModelChips models={subscription.models || (subscription.model ? [subscription.model] : [])} /></td>
                    <td>{formatNumber(stats.requests)}</td>
                    <td>{formatNumber(stats.totalTokens)}</td>
                    <td>{formatPercent(stats.cacheHitRate)}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          onClick={() => runAction(() => bridge.fetchSubscriptionModels(subscription.name), "模型列表已更新")}
                          aria-label={`一键获取 ${subscription.name} 的模型列表`}
                          title="一键获取模型列表"
                          type="button"
                        >
                          <RefreshCw size={15} />
                        </button>
                        <button
                          className="icon-button"
                          onClick={() => queryUsage(subscription)}
                          aria-label={`查询 ${subscription.name} 的供应商用量`}
                          title="查询供应商用量"
                          type="button"
                        >
                          <Gauge size={15} />
                        </button>
                        <button className="icon-button" onClick={() => setEditing(subscription)} aria-label={`编辑订阅 ${subscription.name}`} title="编辑" type="button">
                          <Settings size={15} />
                        </button>
                        <button
                          className="icon-button danger"
                          onClick={() => runAction(() => bridge.removeSubscription(subscription.name), "订阅已删除")}
                          aria-label={`删除订阅 ${subscription.name}`}
                          title="删除"
                          type="button"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      ))}
      {subscriptions.length === 0 ? <section className="panel"><EmptyState title="没有匹配的订阅" body="新增 Gemini、Claude 或 Codex 订阅后即可开始路由。" /></section> : null}

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
      <section className="panel toolbar-panel">
        <div className="search-box">
          <Search size={16} />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="筛选订阅用量" placeholder="筛选订阅用量" />
        </div>
        <button className="secondary-button" onClick={refreshAll} type="button">
          <RefreshCw size={16} />
          刷新
        </button>
      </section>
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

function PlatformKeysView({ platformKeys, service, runAction }) {
  const [form, setForm] = useState({ name: "", monthlyRequestQuota: "", monthlyTokenQuota: "" });
  const [createdKey, setCreatedKey] = useState("");
  const enabledCount = (platformKeys || []).filter((key) => key.enabled).length;
  const monthRequests = (platformKeys || []).reduce((sum, key) => sum + Number(key.monthRequests || 0), 0);
  const monthTokens = (platformKeys || []).reduce((sum, key) => sum + Number(key.monthTokens || 0), 0);

  async function createKey() {
    const created = await runAction(
      () => bridge.createPlatformKey({
        name: form.name,
        monthlyRequestQuota: Number(form.monthlyRequestQuota || 0),
        monthlyTokenQuota: Number(form.monthlyTokenQuota || 0)
      }),
      "平台 Key 已创建"
    );
    setCreatedKey(created.key);
    setForm({ name: "", monthlyRequestQuota: "", monthlyTokenQuota: "" });
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
            <button className="icon-button" onClick={() => navigator.clipboard?.writeText(service.baseUrl)} aria-label="复制 Base URL" title="复制 Base URL" type="button">
              <Clipboard size={16} />
            </button>
          </div>
        </div>
        <div className="mini-form">
          <Field label="Key 名称">
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="default-cli" />
          </Field>
          <Field label="月请求额度">
            <input type="number" value={form.monthlyRequestQuota} onChange={(event) => setForm({ ...form, monthlyRequestQuota: event.target.value })} placeholder="0 表示不限" />
          </Field>
          <Field label="月 Token 额度">
            <input type="number" value={form.monthlyTokenQuota} onChange={(event) => setForm({ ...form, monthlyTokenQuota: event.target.value })} placeholder="0 表示不限" />
          </Field>
          <button className="primary-button" onClick={createKey} type="button">
            <Plus size={16} />
            创建 Key
          </button>
        </div>
      </section>

      {createdKey ? (
        <section className="message-strip key-reveal">
          <KeyRound size={16} />
          <code>{createdKey}</code>
          <button className="icon-button" onClick={() => navigator.clipboard?.writeText(createdKey)} aria-label="复制完整平台 Key" title="复制完整 Key" type="button">
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
                      onClick={() => runAction(() => bridge.setPlatformKeyEnabled({ id: key.id, enabled: !key.enabled }), "平台 Key 状态已更新")}
                      aria-label={`${key.enabled ? "禁用" : "启用"}平台 Key ${key.name}`}
                      title={key.enabled ? "禁用" : "启用"}
                      type="button"
                    >
                      {key.enabled ? <Square size={15} /> : <CheckCircle2 size={15} />}
                    </button>
                    <button
                      className="icon-button danger"
                      onClick={() => runAction(() => bridge.deletePlatformKey(key.id), "平台 Key 已删除")}
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
    </div>
  );
}

function ModelsView({ config, modelAliases, runAction }) {
  const [aliasForm, setAliasForm] = useState({ alias: "", description: "" });
  const [routeForm, setRouteForm] = useState({ alias: "", subscriptionName: "", providerModel: "", priority: 100, enabled: true });
  const enabledAliases = modelAliases.filter((alias) => alias.enabled).length;
  const routeCount = modelAliases.reduce((sum, alias) => sum + alias.routes.length, 0);

  async function saveAlias() {
    await runAction(
      () => bridge.upsertModelAlias({ alias: aliasForm.alias, description: aliasForm.description, enabled: true }),
      "模型别名已保存"
    );
    setAliasForm({ alias: "", description: "" });
    setRouteForm((current) => ({ ...current, alias: aliasForm.alias || current.alias }));
  }

  async function saveRoute() {
    await runAction(
      () => bridge.upsertModelRoute(routeForm),
      "模型路由已保存"
    );
    setRouteForm({ alias: routeForm.alias, subscriptionName: "", providerModel: "", priority: 100, enabled: true });
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
        <div className="panel">
          <h2>创建公开模型名</h2>
          <div className="form-grid compact two-fields">
            <Field label="公开模型名">
              <input value={aliasForm.alias} onChange={(event) => setAliasForm({ ...aliasForm, alias: event.target.value })} placeholder="gpt-4o" />
            </Field>
            <Field label="说明">
              <input value={aliasForm.description} onChange={(event) => setAliasForm({ ...aliasForm, description: event.target.value })} placeholder="给外部工具看到的模型" />
            </Field>
          </div>
          <div className="button-row">
            <button className="primary-button" disabled={!aliasForm.alias.trim()} onClick={saveAlias} type="button">
              <Plus size={16} />
              保存模型
            </button>
          </div>
        </div>

        <div className="panel">
          <h2>绑定订阅路由</h2>
          <div className="form-grid compact">
            <Field label="公开模型">
              <select value={routeForm.alias} onChange={(event) => setRouteForm({ ...routeForm, alias: event.target.value })}>
                <option value="">选择模型</option>
                {modelAliases.map((alias) => (
                  <option key={alias.alias} value={alias.alias}>{alias.alias}</option>
                ))}
              </select>
            </Field>
            <Field label="订阅">
              <select value={routeForm.subscriptionName} onChange={(event) => setRouteForm({ ...routeForm, subscriptionName: event.target.value })}>
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
            <button className="primary-button" disabled={!routeForm.alias || !routeForm.subscriptionName} onClick={saveRoute} type="button">
              <Plus size={16} />
              添加路由
            </button>
          </div>
        </div>
      </section>

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
            {modelAliases.map((alias) => (
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
                          onClick={() => runAction(() => bridge.deleteModelRoute(route.id), "路由已删除")}
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
                      onClick={() => runAction(() => bridge.setModelAliasEnabled({ alias: alias.alias, enabled: !alias.enabled }), "模型状态已更新")}
                      aria-label={`${alias.enabled ? "禁用" : "启用"}模型别名 ${alias.alias}`}
                      title={alias.enabled ? "禁用" : "启用"}
                      type="button"
                    >
                      {alias.enabled ? <Square size={15} /> : <CheckCircle2 size={15} />}
                    </button>
                    <button
                      className="icon-button danger"
                      onClick={() => runAction(() => bridge.deleteModelAlias(alias.alias), "模型别名已删除")}
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
      {modelAliases.length === 0 ? <EmptyState title="暂无模型别名" body="创建公开模型名后，/v1/models 会优先暴露这些别名。" /> : null}
    </section>
    </div>
  );
}

function SubscriptionDialog({ subscription, subscriptions = [], onClose, onSave }) {
  const originalName = subscription.name || "";
  const [form, setForm] = useState({
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
    timeoutMs: subscription.timeoutMs || 0
  });
  const [status, setStatus] = useState({ type: "", message: "" });
  const [testing, setTesting] = useState(false);
  const selectedProvider = providers.find((item) => item.value === form.provider) || providers[0];

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

  function save() {
    const validation = validateSubscriptionForm(form, {
      allowExistingSecret: Boolean(originalName),
      originalName,
      subscriptions
    });
    if (validation) {
      setStatus({ type: "error", message: validation });
      return;
    }
    onSave({ ...normalizeSubscriptionForm(form), originalName });
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
    <div className="modal-backdrop" role="presentation">
      <section className="modal subscription-modal" role="dialog" aria-modal="true" aria-label="订阅编辑器">
        <div className="modal-header subscription-modal-header">
          <div>
            <div className="modal-kicker">Provider</div>
            <h2>{subscription.name ? "编辑订阅" : "新增订阅"}</h2>
            <p>选择供应商类型，配置 API 凭据、模型列表、用量查询和路由策略。</p>
          </div>
          <ProviderBadge provider={form.provider} />
          <button className="icon-button" onClick={onClose} aria-label="关闭订阅编辑器" title="关闭" type="button">
            <XCircle size={18} />
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
                    <input autoComplete="off" value={form.name} onChange={(event) => setField("name", event.target.value)} placeholder={`${form.provider}-main`} />
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
            <button className="secondary-button" onClick={onClose} type="button">取消</button>
            <button className="primary-button" type="submit">
              <Save size={16} />
              保存
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function normalizeSubscriptionForm(form) {
  const { modelsText, ...payload } = form;
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
    models: modelsText.split(/[\n,]/).map((value) => value.trim()).filter(Boolean)
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
  return "";
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

function ChatView({ config, runAction }) {
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState("auto");
  const [subscription, setSubscription] = useState("");
  const [model, setModel] = useState("");
  const [result, setResult] = useState(null);
  const [sending, setSending] = useState(false);

  async function send() {
    if (!prompt.trim()) {
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
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="通过聚合路由发送测试消息" />
        <div className="button-row">
          <button className="primary-button" disabled={sending || !prompt.trim()} onClick={send} type="button">
            {sending ? <Loader2 className="spin" size={16} /> : <Bot size={16} />}
            发送
          </button>
          <button className="secondary-button" onClick={() => setPrompt("")} type="button">清空</button>
        </div>
      </section>

      <section className="panel chat-result">
        <h2>响应</h2>
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
  const rows = history.filter((entry) =>
    `${entry.ts} ${entry.provider} ${entry.subscription} ${entry.alias || ""} ${entry.model} ${entry.platformKey?.name || ""} ${entry.error || ""}`.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="stack">
      <section className="panel toolbar-panel">
        <div className="search-box">
          <Search size={16} />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="筛选请求历史" placeholder="筛选历史" />
        </div>
        <button className="secondary-button" onClick={refreshAll} type="button">
          <RefreshCw size={16} />
          刷新
        </button>
      </section>
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
    </section>
    </div>
  );
}

function LogsView({ logs, refreshAll }) {
  const [filter, setFilter] = useState("");
  const filtered = logs.filter((line) => line.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="stack">
      <section className="panel toolbar-panel">
        <div className="search-box">
          <Search size={16} />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="筛选运行日志" placeholder="筛选日志" />
        </div>
        <button className="secondary-button" onClick={refreshAll} type="button">
          <RefreshCw size={16} />
          刷新
        </button>
      </section>
      <section className="panel terminal-panel">
        {filtered.length > 0 ? <pre>{filtered.join("\n")}</pre> : <EmptyState title="暂无日志" body="启动、停止服务或发生异常时会生成日志。" />}
      </section>
    </div>
  );
}

function ImportExportView({ migration, runAction }) {
  const [includeProviderKeys, setIncludeProviderKeys] = useState(false);
  const [exportText, setExportText] = useState("");
  const [importText, setImportText] = useState("");

  async function exportData() {
    const payload = await runAction(
      () => bridge.exportStore({ includeProviderKeys }),
      includeProviderKeys ? "已生成完整本机备份" : "已生成脱敏导出"
    );
    setExportText(JSON.stringify(payload, null, 2));
  }

  async function importData() {
    const payload = JSON.parse(importText);
    await runAction(() => bridge.importStore(payload), "导入完成");
    setImportText("");
  }

  return (
    <div className="stack">
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
            <button className="secondary-button" disabled={!exportText} onClick={() => navigator.clipboard?.writeText(exportText)} type="button">
              <Clipboard size={16} />
              复制
            </button>
          </div>
          <textarea className="json-area" readOnly value={exportText} placeholder="导出的 JSON 会显示在这里" />
        </div>

        <div className="panel">
          <h2>导入</h2>
          <p className="muted">粘贴 AiHub 导出的 JSON。脱敏订阅不会覆盖已有 API Key，平台 Key 元数据会以禁用状态导入。</p>
          <textarea className="json-area" value={importText} onChange={(event) => setImportText(event.target.value)} placeholder="{ ... }" />
          <div className="button-row">
            <button className="primary-button" disabled={!importText.trim()} onClick={importData} type="button">
              <Save size={16} />
              导入
            </button>
            <button className="secondary-button" onClick={() => setImportText("")} type="button">清空</button>
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

function SettingsView({ config, service, migration, runAction }) {
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
          <button className="primary-button" onClick={() => runAction(() => bridge.setService({ host, port }), "服务地址已保存")} type="button">
            <Save size={16} />
            保存地址
          </button>
        </div>
        <p className="muted">修改地址后需要重启服务。</p>
      </section>

      <section className="panel">
        <h2>路径</h2>
        <div className="detail-list">
          <Row label="配置文件" value={service.configPath} />
          <Row label="SQLite DB" value={migration?.dbPath} />
          <Row label="日志文件" value={service.logPath} />
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

function ProviderBadge({ provider }) {
  const label = provider === "openai-compatible" ? "OpenAI" : provider;
  return <span className={`provider-badge ${provider}`}>{label}</span>;
}

function ModelChips({ models = [] }) {
  const visible = models.slice(0, 3);
  return (
    <div className="model-chip-list" title={models.join("\n")}>
      {visible.length > 0 ? visible.map((model) => <span key={model}>{model}</span>) : <code>-</code>}
      {models.length > visible.length ? <span>+{models.length - visible.length}</span> : null}
    </div>
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

function MessageStrip({ notice, error, busy }) {
  if (!notice && !error && !busy) {
    return null;
  }
  return (
    <div className={`message-strip ${error ? "error" : ""}`} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"}>
      {busy ? <Loader2 className="spin" size={16} /> : error ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
      <span>{error || notice || "处理中"}</span>
    </div>
  );
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

function allConfiguredModels(config = {}) {
  const values = [];
  for (const subscription of config.subscriptions || []) {
    values.push(subscription.model, ...(subscription.models || []));
  }
  return [...new Set(values.filter(Boolean))].sort();
}

function getInitialTheme() {
  const stored = window.localStorage?.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return "light";
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
root.render(<App />);
