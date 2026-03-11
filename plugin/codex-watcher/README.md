# Codex Task Notifier (LaunchAgent)

独立的 Codex 任务完成通知器。

它会轮询 `~/.codex/sessions/**/*.jsonl`，捕获 `event_msg.payload.type=task_complete`，然后通过 `terminal-notifier` 发送 macOS 原生通知。运行时优先使用 `node`，缺失时自动回退到 `bun`。

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
# 1) 安装通知依赖
brew install terminal-notifier

# 2) 安装并加载 LaunchAgent
"$MANAGER" install

# 3) 查看服务状态
"$MANAGER" status

# 4) 停止服务
"$MANAGER" stop

# 5) 卸载服务
"$MANAGER" uninstall
```

## Runtime Behavior

- 监听源：`~/.codex/sessions/**/*.jsonl`
- 完成判定：`event_msg.payload.type = task_complete`
- 通知标题：`Codex`
- 通知副标题：`Codex 任务完成 · <cwd basename>`
- 去重策略：固定 `-group codex-task-complete`，一次只保留一条通知
- 任务文案：优先使用同一 turn 关联的 `user_message`；缺失时回退到 `last_agent_message`
- 默认轮询间隔：`1500ms`
- 默认 trailing debounce：`3000ms`

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

## Make Notifications Stay Until You Close Them

代码侧只负责发送通知和同组替换；是否 `Banner` 还是 `Alert` 由 macOS 系统设置决定。

首次安装后，手动打开：

```text
System Settings > Notifications > terminal-notifier
```

建议设置：
- Allow Notifications: 开启
- Notification Style: `Alerts`

这样通知会常驻，直到你手动关闭；同时由于固定 `group`，新任务完成只会替换当前那一条。

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

连续追加两条时，通知应保持只有一条，并显示最后一次完成内容。

## Troubleshooting

| Symptom | Check | Expected / Fix |
|---|---|---|
| `missing required terminal-notifier` | `command -v terminal-notifier` | 若为空，执行 `brew install terminal-notifier` |
| LaunchAgent 报 runtime 缺失 | `command -v node || command -v bun` | 至少安装一个；例如执行 `brew install node`，或确认现有 `bun` 在 PATH 中 |
| LaunchAgent 无法启动 | `launchctl print "$SERVICE"` | 确认服务存在；若不存在，重新执行 `"$MANAGER" install` |
| watcher 已启动但无通知 | `plutil -p "$INSTALLED_PLIST"` | 确认 `EnvironmentVariables.PATH` 包含 `terminal-notifier` 与 `node` 所在目录 |
| 通知会自动消失 | `System Settings > Notifications > terminal-notifier` | 将样式改为 `Alerts` |
| 调试去抖效果 | `plutil -p "$INSTALLED_PLIST"` | 确认 `CODEX_NOTIFY_DEBOUNCE_MS` 是否符合预期 |
