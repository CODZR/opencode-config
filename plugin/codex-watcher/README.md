# Codex Task Watcher (LaunchAgent)

独立的 Codex 任务完成监测器。

它会轮询 `~/.codex/sessions/**/*.jsonl`，捕获 `event_msg.payload.type=task_complete`，然后发送非抢焦点的 macOS 系统通知。默认优先使用 `terminal-notifier`；如果本机没有该命令或发送失败，会自动降级到 `osascript display notification`。运行时优先使用 `node`，缺失时自动回退到 `bun`。

## Paths and Label

```bash
WATCHER_DIR="/Users/codzr/.config/opencode/plugin/codex-watcher"
MANAGER="$WATCHER_DIR/manage-launchagent.sh"
TEMPLATE_PLIST="$WATCHER_DIR/com.codzr.codex-task-notifier.plist"
INSTALLED_PLIST="$HOME/Library/LaunchAgents/com.codzr.codex-task-notifier.plist"
LABEL="com.codzr.codex-task-notifier"
SERVICE="gui/$(id -u)/$LABEL"
```

## Install / Start / Status / Stop / Uninstall

```bash
# 1) 安装并加载 LaunchAgent
"$MANAGER" install

# 2) 查看服务状态
"$MANAGER" status

# 3) 停止服务
"$MANAGER" stop

# 4) 卸载服务
"$MANAGER" uninstall
```

## Runtime Behavior

- 监听源：`~/.codex/sessions/**/*.jsonl`
- 完成判定：`event_msg.payload.type = task_complete`
- 展示形式：macOS 系统通知横幅 / 通知中心提醒
- 通知标题：`Codex`
- 通知正文：`Codex 任务完成 · <cwd basename>` + 任务摘要
- 触发策略：任务完成后立即提醒，不抢占当前输入焦点
- 发送链路：优先 `terminal-notifier`，失败后自动降级到 `osascript display notification`
- 默认轮询间隔：`1500ms`
- 默认 trailing debounce：`3000ms`
- 首次发现文件：近期新 session 会回扫末尾有限字节，避免重启后首个 `task_complete` 被漏掉；较旧文件仍从 EOF 开始，避免历史事件回灌

## Optional Environment Variables

安装时，`manage-launchagent.sh` 会保留已安装 plist 中已有的值，或者使用当前 shell 环境变量：

```bash
CODEX_NOTIFY_INTERVAL_MS=1500
CODEX_NOTIFY_DEBOUNCE_MS=3000
```

示例：

```bash
CODEX_NOTIFY_DEBOUNCE_MS=0 "$MANAGER" install
```

## Smoke Test

一次性执行 watcher：

```bash
node /Users/codzr/.config/opencode/plugin/codex-watcher/codex-completion-watcher.mjs --once
```

向最新会话文件追加一条测试完成事件：

```bash
TURN_ID="qa-codex-task-$(date +%s)"
SESSION_FILE="$(python3 - <<'PY'
import glob, os
files = sorted(glob.glob(os.path.expanduser('~/.codex/sessions/**/*.jsonl'), recursive=True), key=os.path.getmtime)
print(files[-1] if files else '')
PY
)"

printf '%s\n' "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"$TURN_ID\",\"last_agent_message\":\"watcher smoke\"}}" >> "$SESSION_FILE"
node /Users/codzr/.config/opencode/plugin/codex-watcher/codex-completion-watcher.mjs --once
```

连续追加两条时，应收到最新一条任务完成通知，且不会打断正在输入。

## Troubleshooting

| Symptom | Check | Expected / Fix |
|---|---|---|
| LaunchAgent 报 runtime 缺失 | `command -v node || command -v bun` | 至少安装一个；例如执行 `brew install node`，或确认现有 `bun` 在 PATH 中 |
| LaunchAgent 无法启动 | `launchctl print "$SERVICE"` | 确认服务存在；若不存在，重新执行 `"$MANAGER" install` |
| watcher 已启动但无通知 | `plutil -p "$INSTALLED_PLIST"` | 确认 `EnvironmentVariables.PATH` 包含 `node` 或 `bun` 所在目录 |
| 想使用更稳定的横幅提醒 | `command -v terminal-notifier` | 若缺失可执行 `brew install terminal-notifier`；否则会自动降级到 `osascript` |
| 调试去抖效果 | `plutil -p "$INSTALLED_PLIST"` | 确认 `CODEX_NOTIFY_DEBOUNCE_MS` 是否符合预期 |
