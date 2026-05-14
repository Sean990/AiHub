# AiHub

一个本地聚合 API 管理工具，用来管理 Gemini、Claude、Codex 和 OpenAI-compatible 上游/API Key，并按自定义优先级自动路由请求。启动服务后，可以通过自带 CLI 使用，也可以把其他支持 OpenAI-compatible API 的工具指向本地服务。

## 能力

- 订阅管理：添加、删除、启用、禁用 Gemini / Claude / Codex / OpenAI-compatible 订阅；一个订阅可以维护多个可用模型。
- 优先级：数字越小越优先，例如 `1` 会先于 `10` 使用。
- 无感切换：默认开启 fallback，请求失败会自动尝试下一个匹配订阅。
- 本地服务：提供统一 `/v1/chat`、`/v1/messages`，以及基础 OpenAI-compatible `/v1/chat/completions`、`/v1/responses`。
- 常驻进程：支持 `start`、`stop`、`status`、`logs`，不需要手动占着一个终端窗口。
- CLI：可以直接 `aihub ask` 发起请求，也可以 `aihub terminal` 快捷打开终端。
- 外部 CLI：`aihub run` 可以临时注入 `OPENAI_BASE_URL` / `OPENAI_API_KEY` 后运行其他命令。
- 平台 Key：外部工具通过本地平台 Key 调用 `/v1/*`，支持月请求额度、月 Token 额度和用量统计。
- 模型别名：把公开模型名映射到多个订阅路由，按路由优先级和 fallback 自动切换。
- SQLite 数据层：业务数据默认写入 `~/.aihub/aihub.db`，旧 `config.json` 首次启动会自动迁移。

## 安装与启动

当前项目使用 Node 内置 SQLite，需要 Node.js 22.13+：

```bash
npm test
npm link
```

桌面开发版：

```bash
npm install
npm run desktop
```

`npm run desktop` 会同时启动 Vite 渲染进程和 Electron 主进程。桌面应用为中文界面，可管理订阅、平台 Key、模型别名、导入导出、启动/停止本地 API 服务、查看历史与日志、统计总用量和每个订阅的 Token / 缓存命中率，并在对话测试页发起请求。订阅管理页会按模型供应商分组展示 Gemini / Claude / Codex，并提供“一键获取模型列表”按钮。

## 桌面打包

先安装依赖：

```bash
npm install
```

构建当前系统的安装包：

```bash
npm run dist
```

仅生成未压缩的本机应用目录，适合快速验证打包内容：

```bash
npm run pack
```

`npm run pack` 使用项目内 Electron 缓存目录，并跳过 Windows 可执行文件签名/资源编辑步骤，避免普通 Windows 用户在解压 `winCodeSign` 依赖时遇到符号链接权限限制。生成的本地验证产物位于 `release/win-unpacked/`。

macOS：

```bash
npm run dist:mac
```

产物会输出到 `release/`，包含 `.dmg` 和 `.zip`，应用图标使用界面左上角的 AiHub 图标。当前配置未签名，首次打开可能需要在系统安全设置中允许。

Windows：

```bash
npm run dist:win
```

产物会输出到 `release/`，包含 `AiHub-<version>-setup-x64.exe` 和 `AiHub-<version>-portable-x64.exe`，应用图标使用界面左上角的 AiHub 图标。正式 Windows 安装包会保留可执行文件资源编辑流程；如果本机没有创建符号链接权限，请开启 Windows 开发者模式或使用管理员终端后再执行 `npm run dist:win`。

添加订阅：

```bash
aihub add gemini-main --provider gemini --key "$GEMINI_API_KEY" --model gemini-2.5-flash --priority 1
aihub add claude-main --provider claude --key "$ANTHROPIC_API_KEY" --model claude-sonnet-4-5 --priority 2
aihub add codex-main --provider codex --key "$OPENAI_API_KEY" --model gpt-5.1 --priority 3
aihub add oneapi-main --provider openai-compatible --key "$ONEAPI_KEY" --base-url "https://oneapi.example.com" --model gpt-4o --priority 4
```

如果一个订阅支持多个模型，可以直接写入模型列表，也可以后续一键拉取：

```bash
aihub add codex-main --provider codex --key "$OPENAI_API_KEY" --model gpt-5.1 --models gpt-5.1,gpt-5.1-codex
aihub model fetch codex-main
```

前台启动本地服务：

```bash
aihub service
```

后台启动本地服务：

```bash
aihub start
aihub status
aihub stop
```

默认监听：

```text
http://127.0.0.1:8787
```

## CLI 使用

直接提问：

```bash
aihub ask "用一句话解释什么是优先级路由"
```

指定 provider：

```bash
aihub ask "hello" --provider claude
```

指定订阅：

```bash
aihub ask "hello" --subscription gemini-main
```

查看订阅：

```bash
aihub list
```

创建平台 Key：

```bash
aihub key create default-cli --request-quota 10000 --token-quota 5000000
aihub key list
```

创建公开模型别名并绑定路由：

```bash
aihub model create gpt-4o --description "默认高优先级模型"
aihub model route gpt-4o gemini-main --model gemini-2.5-flash --priority 1
aihub model route gpt-4o claude-main --model claude-sonnet-4-5 --priority 2
aihub model list
```

调整优先级：

```bash
aihub priority gemini-main 1
aihub priority claude-main 2
```

调整 fallback：

```bash
aihub routing fallback status
aihub routing fallback on
aihub routing fallback off
```

查看服务日志和请求历史：

```bash
aihub logs
aihub history
aihub history --json
aihub doctor
```

打开终端：

```bash
aihub terminal
aihub terminal --app iTerm --cwd /Users/zhangxiang/Documents/AiHub
```

## 给其他 CLI 工具使用

启动后台服务后，导出 OpenAI-compatible 环境变量：

```bash
aihub start
eval "$(aihub env)"
```

然后将支持 OpenAI-compatible API 的工具配置到：

```text
OPENAI_BASE_URL=http://127.0.0.1:8787/v1
OPENAI_API_KEY=aihub-local
```

未创建平台 Key 前，`aihub-local` 用于兼容旧用法。创建任意平台 Key 后，`/v1/*` 请求会要求有效平台 Key：

```bash
export OPENAI_API_KEY="aih_xxx"
```

也可以只对单个命令注入环境变量：

```bash
aihub run --start -- your-openai-compatible-cli --model gemini-2.5-flash
```

## HTTP API

统一接口：

```bash
curl http://127.0.0.1:8787/v1/chat \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer aihub-local' \
  -d '{"prompt":"hello","provider":"auto"}'
```

OpenAI-compatible Chat Completions：

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer aihub-local' \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hello"}]}'
```

模型列表：

```bash
curl http://127.0.0.1:8787/v1/models
```

用量统计：

```bash
curl http://127.0.0.1:8787/v1/usage
```

统计来源是本地 SQLite `request_logs`，并兼容旧 `history.jsonl`。目前会聚合请求数、成功率、输入/输出/总 Token、缓存命中 Token、缓存命中率、平均延迟，并按订阅拆分。Codex/OpenAI、Claude、Gemini 的 usage 字段会被标准化后写入历史。

`/v1/chat/completions` 支持 `stream: true`，会返回 OpenAI Chat Completions 风格 SSE。`/v1/responses` 也提供最小可用的 Responses API SSE 事件。`tools` / `tool_choice` 会透传到 provider，网关只负责格式转换，不执行工具。

管理接口：

```bash
curl http://127.0.0.1:8787/v1/admin/platform-keys
curl http://127.0.0.1:8787/v1/admin/model-aliases
curl http://127.0.0.1:8787/v1/admin/export
```

## 配置位置

```bash
aihub config path
aihub config show
aihub config service --host 127.0.0.1 --port 8787
aihub migrate status
```

也可以用 `AIHUB_CONFIG=/path/to/config.json` 指定旧配置入口，或用 `AIHUB_DB=/path/to/aihub.db` 指定 SQLite 数据库，方便测试或多环境隔离。

导入导出：

```bash
aihub export --safe --out aihub.safe.json
aihub export --include-provider-keys --out aihub.full.local.json
aihub import aihub.safe.json
```

## Provider 说明

- Gemini：调用 Google Gemini `generateContent` REST API。
- Claude：调用 Anthropic Messages API。
- Codex：使用 OpenAI Responses API 作为 Codex/OpenAI 适配层。
- OpenAI-compatible：调用任意兼容 `/v1/chat/completions` 和 `/v1/models` 的第三方上游，可接入 OneAPI、New API、OpenRouter 或自建聚合服务。

如果你使用代理网关或企业网关，可以添加 `--base-url`：

```bash
aihub add work-codex --provider codex --key "$KEY" --model "$MODEL" --base-url https://api.example.com --priority 1
```
