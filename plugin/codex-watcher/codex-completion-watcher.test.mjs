import test from "node:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { execFile as execFileCallback } from "node:child_process"
import { promisify } from "node:util"
import { promises as fs } from "node:fs"

import {
  CODEX_EVENT_ENVELOPE_TYPE,
  CODEX_EVENT_PAYLOAD_KEY,
  CODEX_TASK_COMPLETE_EVENT_TYPE,
  CODEX_TASK_COMPLETE_MESSAGE_KEY,
  CODEX_TASK_COMPLETE_TURN_ID_KEY,
  CHECKPOINT_STATE_VERSION,
  NOTIFICATION_PAYLOAD_ID_KEY,
  NOTIFICATION_PAYLOAD_MESSAGE_KEY,
  NOTIFICATION_PAYLOAD_SUBTITLE_KEY,
  NOTIFIER_TITLE,
  STICKY_DIALOG_CLOSE_LABEL,
  STICKY_DIALOG_PID_FILE,
  STICKY_DIALOG_SCRIPT_PATH,
  TASK_COMPLETE_MESSAGE_FALLBACK,
  TASK_COMPLETE_MESSAGE_MAX_LENGTH,
  WATCHER_DEBOUNCE_DEFAULT_MS,
  WATCHER_DEBOUNCE_ENV_KEY,
  WATCHER_FIRST_SEEN_LOOKBACK_MS,
  WATCHER_INTERVAL_ENV_KEY,
  WATCHER_SUBTITLE,
  buildTaskCompleteNotificationPayload,
  createCheckpointState,
  getStickyDialogCommand,
  listSessionJsonlFiles,
  parseTaskCompleteEvent,
  resolveWatcherConfigFromEnv,
  runWatcherCli,
  runWatcherCycle,
  runWatcherLoop,
  sendStickyDialogNotification,
  tailFileTaskCompleteEvents,
  writeCheckpointStateAtomic
} from "./codex-completion-watcher.mjs"

const execFile = promisify(execFileCallback)
const launchAgentPlistPath = path.resolve("plugin/codex-watcher/com.codzr.codex-task-notifier.plist")
const manageLaunchAgentPath = path.resolve("plugin/codex-watcher/manage-launchagent.sh")
const runWatcherCycleNoDebounce = (options) => runWatcherCycle({ debounceMs: 0, ...options })

const makeTaskCompleteLine = (turnID, lastAgentMessage = "Done") => JSON.stringify({
  timestamp: "2026-03-03T00:00:00.000Z",
  type: CODEX_EVENT_ENVELOPE_TYPE,
  [CODEX_EVENT_PAYLOAD_KEY]: {
    type: CODEX_TASK_COMPLETE_EVENT_TYPE,
    [CODEX_TASK_COMPLETE_TURN_ID_KEY]: turnID,
    [CODEX_TASK_COMPLETE_MESSAGE_KEY]: lastAgentMessage
  }
})

const makeEventLine = ({ envelopeType = CODEX_EVENT_ENVELOPE_TYPE, payloadType = CODEX_TASK_COMPLETE_EVENT_TYPE, turnID = "turn_1", lastAgentMessage = "Done" } = {}) => JSON.stringify({
  timestamp: "2026-03-03T00:00:00.000Z",
  type: envelopeType,
  payload: {
    type: payloadType,
    turn_id: turnID,
    last_agent_message: lastAgentMessage
  }
})

const makeSessionMetaLine = (cwd) => JSON.stringify({
  timestamp: "2026-03-03T00:00:00.000Z",
  type: "session_meta",
  payload: {
    id: "session_test",
    cwd
  }
})

const makeTurnContextLine = ({ turnID = "turn_1", cwd = "/tmp/project" } = {}) => JSON.stringify({
  timestamp: "2026-03-03T00:00:00.000Z",
  type: "turn_context",
  payload: {
    turn_id: turnID,
    cwd
  }
})

const makeTaskStartedLine = (turnID) => JSON.stringify({
  timestamp: "2026-03-03T00:00:00.000Z",
  type: "event_msg",
  payload: {
    type: "task_started",
    turn_id: turnID
  }
})

const makeUserMessageLine = (message) => JSON.stringify({
  timestamp: "2026-03-03T00:00:00.000Z",
  type: "event_msg",
  payload: {
    type: "user_message",
    message,
    images: [],
    local_images: [],
    text_elements: []
  }
})

const withTempDir = async (fn) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-watcher-test-"))
  try {
    return await fn(tempDir)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

test("plist: uses independent codex label and logs without token env", async () => {
  const { stdout } = await execFile("plutil", ["-convert", "json", "-o", "-", launchAgentPlistPath])
  const plist = JSON.parse(stdout)

  assert.equal(plist.Label, "com.codzr.codex-task-notifier")
  assert.deepEqual(plist.ProgramArguments, [
    "/Users/codzr/.config/opencode/plugin/codex-watcher/run-codex-completion-watcher.sh"
  ])
  assert.equal(plist.StandardOutPath, "/Users/codzr/Library/Logs/codex-task-notifier.log")
  assert.equal(plist.StandardErrorPath, "/Users/codzr/Library/Logs/codex-task-notifier.error.log")
  assert.equal(typeof plist.EnvironmentVariables?.PATH, "string")
  assert.equal(Object.hasOwn(plist.EnvironmentVariables ?? {}, "OPENCODE_NOTIFY_TOKEN"), false)
})

test("manager script: targets new service label and new env keys", async () => {
  const scriptText = await fs.readFile(manageLaunchAgentPath, "utf8")

  assert.match(scriptText, /LABEL="com\.codzr\.codex-task-notifier"/)
  assert.match(scriptText, /PLIST_NAME="\$\{LABEL\}\.plist"/)
  assert.match(scriptText, /CODEX_NOTIFY_INTERVAL_MS/)
  assert.match(scriptText, /CODEX_NOTIFY_DEBOUNCE_MS/)
  assert.doesNotMatch(scriptText, /terminal-notifier/)
  assert.doesNotMatch(scriptText, /OPENCODE_NOTIFY_TOKEN/)
})

test("constants: sticky dialog defaults and checkpoint version remain stable", () => {
  assert.equal(NOTIFIER_TITLE, "Codex")
  assert.equal(STICKY_DIALOG_CLOSE_LABEL, "关闭")
  assert.equal(STICKY_DIALOG_PID_FILE.endsWith("dialog.pid"), true)
  assert.equal(STICKY_DIALOG_SCRIPT_PATH.endsWith("show-codex-dialog.applescript"), true)
  assert.equal(CHECKPOINT_STATE_VERSION, 1)
  assert.deepEqual(createCheckpointState(), {
    version: 1,
    files: {},
    recentTurnIds: [],
    pendingNotification: null,
    fileSessionCwds: {}
  })
})

test("event filter happy: parseTaskCompleteEvent accepts strict task_complete envelope", () => {
  const parsed = parseTaskCompleteEvent(makeEventLine({
    turnID: "turn_happy",
    lastAgentMessage: "Task done"
  }))

  assert.deepEqual(parsed, {
    turnID: "turn_happy",
    completionText: "Task done"
  })
})

test("ignore non event_msg: parseTaskCompleteEvent ignores non-target envelopes", () => {
  const nonEventMsg = parseTaskCompleteEvent(makeEventLine({ envelopeType: "agent_message" }))
  const wrongPayloadType = parseTaskCompleteEvent(makeEventLine({ payloadType: "task_started" }))

  assert.equal(nonEventMsg, null)
  assert.equal(wrongPayloadType, null)
})

test("completion payload: normalizes fallback, truncation, and payload keys", () => {
  const nullMessage = parseTaskCompleteEvent(makeEventLine({ turnID: "turn_null", lastAgentMessage: null }))
  const longMessage = "x".repeat(TASK_COMPLETE_MESSAGE_MAX_LENGTH + 40)
  const normalizedLong = parseTaskCompleteEvent(makeEventLine({ turnID: "turn_long", lastAgentMessage: longMessage }))
  const payload = buildTaskCompleteNotificationPayload({
    turnID: "turn_payload",
    completionText: "  hello\nworld  ",
    subtitle: WATCHER_SUBTITLE
  })

  assert.deepEqual(nullMessage, {
    turnID: "turn_null",
    completionText: TASK_COMPLETE_MESSAGE_FALLBACK
  })
  assert.equal(normalizedLong.turnID, "turn_long")
  assert.equal(normalizedLong.completionText.length <= TASK_COMPLETE_MESSAGE_MAX_LENGTH, true)
  assert.deepEqual(payload, {
    [NOTIFICATION_PAYLOAD_ID_KEY]: "turn_payload",
    [NOTIFICATION_PAYLOAD_MESSAGE_KEY]: "hello world",
    [NOTIFICATION_PAYLOAD_SUBTITLE_KEY]: WATCHER_SUBTITLE
  })
})

test("config: resolveWatcherConfigFromEnv resolves defaults and overrides without required token", () => {
  const defaultConfig = resolveWatcherConfigFromEnv({ env: {} })
  assert.equal(defaultConfig.ok, true)
  assert.equal(defaultConfig.config.intervalMs, 1500)
  assert.equal(defaultConfig.config.debounceMs, WATCHER_DEBOUNCE_DEFAULT_MS)
  assert.equal(defaultConfig.config.subtitle, WATCHER_SUBTITLE)

  const overriddenConfig = resolveWatcherConfigFromEnv({
    env: {
      [WATCHER_INTERVAL_ENV_KEY]: "2500",
      [WATCHER_DEBOUNCE_ENV_KEY]: "0"
    }
  })
  assert.equal(overriddenConfig.ok, true)
  assert.equal(overriddenConfig.config.intervalMs, 2500)
  assert.equal(overriddenConfig.config.debounceMs, 0)

  const clampedConfig = resolveWatcherConfigFromEnv({
    env: {
      [WATCHER_INTERVAL_ENV_KEY]: "-100",
      [WATCHER_DEBOUNCE_ENV_KEY]: "-15"
    }
  })
  assert.equal(clampedConfig.config.intervalMs, 1)
  assert.equal(clampedConfig.config.debounceMs, 0)
})

test("dialog command: builds osascript invocation with close button", () => {
  const payload = {
    [NOTIFICATION_PAYLOAD_ID_KEY]: "turn_notify",
    [NOTIFICATION_PAYLOAD_MESSAGE_KEY]: "Ship it",
    [NOTIFICATION_PAYLOAD_SUBTITLE_KEY]: "Codex 任务完成 · demo"
  }

  const command = getStickyDialogCommand({ payload, scriptPath: "/tmp/show-codex-dialog.applescript" })

  assert.equal(command.file, "/usr/bin/osascript")
  assert.deepEqual(command.args, [
    "/tmp/show-codex-dialog.applescript",
    "Codex",
    "Codex 任务完成 · demo",
    "Ship it",
    "关闭"
  ])
})

test("dialog delivery: sendStickyDialogNotification replaces active dialog and writes latest pid", async () => {
  await withTempDir(async (tempDir) => {
    const pidFilePath = path.join(tempDir, "dialog.pid")
    await fs.writeFile(pidFilePath, "111\n", "utf8")

    const payload = {
      [NOTIFICATION_PAYLOAD_ID_KEY]: "turn_notify",
      [NOTIFICATION_PAYLOAD_MESSAGE_KEY]: "Ship it",
      [NOTIFICATION_PAYLOAD_SUBTITLE_KEY]: "Codex 任务完成 · demo"
    }
    const killCalls = []
    const execCalls = []
    const spawnCalls = []

    const result = await sendStickyDialogNotification({
      payload,
      pidFilePath,
      scriptPath: "/tmp/show-codex-dialog.applescript",
      fsPromises: fs,
      execFileImpl: async (file, args) => {
        execCalls.push({ file, args })
        return { stdout: "/usr/bin/osascript /tmp/show-codex-dialog.applescript Codex\n", stderr: "" }
      },
      killImpl: (pid, signal) => {
        killCalls.push({ pid, signal })
      },
      spawnImpl: (file, args, options) => {
        spawnCalls.push({ file, args, options })
        return {
          pid: 222,
          unref() {}
        }
      }
    })

    assert.equal(result.ok, true)
    assert.deepEqual(execCalls, [{
      file: "/bin/ps",
      args: ["-p", "111", "-o", "command="]
    }])
    assert.deepEqual(killCalls, [{ pid: 111, signal: "SIGTERM" }])
    assert.equal(spawnCalls.length, 1)
    assert.equal(spawnCalls[0].file, "/usr/bin/osascript")
    assert.deepEqual(spawnCalls[0].args, getStickyDialogCommand({
      payload,
      scriptPath: "/tmp/show-codex-dialog.applescript"
    }).args)
    assert.equal(spawnCalls[0].options.detached, true)
    assert.equal(await fs.readFile(pidFilePath, "utf8"), "222\n")
  })
})

test("dialog delivery: sendStickyDialogNotification returns clear reason on spawn failure", async () => {
  const result = await sendStickyDialogNotification({
    payload: {
      id: "turn_missing",
      message: "Done",
      subtitle: WATCHER_SUBTITLE
    },
    execFileImpl: async () => ({ stdout: "", stderr: "" }),
    spawnImpl: () => {
      throw new Error("spawn failed")
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.error.reason, "spawn failed")
})

test("tailing: extracts task summary and cwd enrichment from same batch", async () => {
  await withTempDir(async (tempDir) => {
    const sessionFile = path.join(tempDir, "session.jsonl")
    await fs.writeFile(sessionFile, "", "utf8")

    const initialTail = await tailFileTaskCompleteEvents({
      filePath: sessionFile,
      state: createCheckpointState()
    })

    await fs.appendFile(sessionFile, [
      makeSessionMetaLine("/tmp/base"),
      makeTurnContextLine({ turnID: "turn_enriched", cwd: "/workspace/combination-flooding" }),
      makeTaskStartedLine("turn_enriched"),
      makeUserMessageLine("   build a combination flooding detector   "),
      makeTaskCompleteLine("turn_enriched", "fallback")
    ].join("\n") + "\n", "utf8")

    const tailResult = await tailFileTaskCompleteEvents({
      filePath: sessionFile,
      state: initialTail.state
    })

    assert.equal(tailResult.events.length, 1)
    assert.equal(tailResult.events[0].turnID, "turn_enriched")
    assert.equal(tailResult.events[0].taskSummary, "build a combination flooding detector")
    assert.equal(tailResult.events[0].cwd, "/workspace/combination-flooding")
  })
})

test("cycle: enriches subtitle basename and prefers user task summary", async () => {
  await withTempDir(async (tempDir) => {
    const sessionsRootPath = path.join(tempDir, "sessions")
    const sessionDir = path.join(sessionsRootPath, "2026", "03", "11")
    await fs.mkdir(sessionDir, { recursive: true })

    const sessionFile = path.join(sessionDir, "session.jsonl")
    await fs.writeFile(sessionFile, "", "utf8")

    const stateFilePath = path.join(tempDir, "state.json")
    await runWatcherCycleNoDebounce({
      sessionsRootPath,
      stateFilePath,
      sendNotification: async () => ({ ok: true })
    })

    await fs.appendFile(sessionFile, [
      makeSessionMetaLine("/workspace/demo-root"),
      makeTaskStartedLine("turn_summary"),
      makeUserMessageLine("  fix flaky payment retry handling   "),
      makeTurnContextLine({ turnID: "turn_summary", cwd: "/workspace/payments-service" }),
      makeTaskCompleteLine("turn_summary", "fallback done")
    ].join("\n") + "\n", "utf8")

    const notifications = []
    const cycleResult = await runWatcherCycleNoDebounce({
      sessionsRootPath,
      stateFilePath,
      sendNotification: async ({ payload }) => {
        notifications.push(payload)
        return { ok: true }
      }
    })

    assert.equal(cycleResult.emittedEvents, 1)
    assert.equal(cycleResult.deliveredNotifications, 1)
    assert.deepEqual(notifications, [{
      id: "turn_summary",
      message: "fix flaky payment retry handling",
      subtitle: "Codex 任务完成 · payments-service"
    }])
  })
})

test("debounce: stores only latest completion and delivers it once due", async () => {
  await withTempDir(async (tempDir) => {
    const sessionsRootPath = path.join(tempDir, "sessions")
    const sessionDir = path.join(sessionsRootPath, "2026", "03", "11")
    await fs.mkdir(sessionDir, { recursive: true })

    const sessionFile = path.join(sessionDir, "session.jsonl")
    await fs.writeFile(sessionFile, "", "utf8")

    const deliveredPayloads = []
    const stateFilePath = path.join(tempDir, "state.json")

    await runWatcherCycle({
      sessionsRootPath,
      stateFilePath,
      debounceMs: 3000,
      nowMs: () => 500,
      sendNotification: async ({ payload }) => {
        deliveredPayloads.push(payload)
        return { ok: true }
      }
    })

    await fs.appendFile(sessionFile, [
      makeTaskCompleteLine("turn_a", "A"),
      makeTaskCompleteLine("turn_b", "B")
    ].join("\n") + "\n", "utf8")

    const firstPass = await runWatcherCycle({
      sessionsRootPath,
      stateFilePath,
      debounceMs: 3000,
      nowMs: () => 1000,
      sendNotification: async ({ payload }) => {
        deliveredPayloads.push(payload)
        return { ok: true }
      }
    })

    assert.equal(firstPass.emittedEvents, 2)
    assert.equal(firstPass.deliveredNotifications, 0)
    assert.deepEqual(deliveredPayloads, [])

    const secondPass = await runWatcherCycle({
      sessionsRootPath,
      stateFilePath,
      debounceMs: 3000,
      nowMs: () => 4500,
      sendNotification: async ({ payload }) => {
        deliveredPayloads.push(payload)
        return { ok: true }
      }
    })

    assert.equal(secondPass.emittedEvents, 0)
    assert.equal(secondPass.deliveredNotifications, 1)
    assert.deepEqual(deliveredPayloads.map((payload) => payload.id), ["turn_b"])
  })
})

test("first seen recent file: recovers latest completion after watcher startup", async () => {
  await withTempDir(async (tempDir) => {
    const sessionsRootPath = path.join(tempDir, "sessions")
    const sessionDir = path.join(sessionsRootPath, "2026", "03", "11")
    await fs.mkdir(sessionDir, { recursive: true })

    const sessionFile = path.join(sessionDir, "recent.jsonl")
    await fs.writeFile(sessionFile, [
      makeSessionMetaLine("/workspace/demo-root"),
      makeTaskStartedLine("turn_recent"),
      makeUserMessageLine("recover first completion after reboot"),
      makeTurnContextLine({ turnID: "turn_recent", cwd: "/workspace/demo-root" }),
      makeTaskCompleteLine("turn_recent", "fallback")
    ].join("\n") + "\n", "utf8")

    const stateFilePath = path.join(tempDir, "state.json")
    const notifications = []
    const startupMs = Date.now()

    const cycleResult = await runWatcherCycleNoDebounce({
      sessionsRootPath,
      stateFilePath,
      startupMs,
      sendNotification: async ({ payload }) => {
        notifications.push(payload)
        return { ok: true }
      }
    })

    assert.equal(cycleResult.emittedEvents, 1)
    assert.equal(cycleResult.deliveredNotifications, 1)
    assert.deepEqual(notifications, [{
      id: "turn_recent",
      message: "recover first completion after reboot",
      subtitle: "Codex 任务完成 · demo-root"
    }])
  })
})

test("first seen stale file: still skips historical backfill on startup", async () => {
  await withTempDir(async (tempDir) => {
    const sessionsRootPath = path.join(tempDir, "sessions")
    const sessionDir = path.join(sessionsRootPath, "2026", "03", "11")
    await fs.mkdir(sessionDir, { recursive: true })

    const sessionFile = path.join(sessionDir, "stale.jsonl")
    await fs.writeFile(sessionFile, [
      makeSessionMetaLine("/workspace/legacy"),
      makeTaskCompleteLine("turn_stale", "historical notification")
    ].join("\n") + "\n", "utf8")

    const staleTimestampSeconds = Math.floor((Date.now() - WATCHER_FIRST_SEEN_LOOKBACK_MS - 5000) / 1000)
    await fs.utimes(sessionFile, staleTimestampSeconds, staleTimestampSeconds)

    const stateFilePath = path.join(tempDir, "state.json")
    const cycleResult = await runWatcherCycleNoDebounce({
      sessionsRootPath,
      stateFilePath,
      startupMs: Date.now(),
      sendNotification: async () => ({ ok: true })
    })

    assert.equal(cycleResult.emittedEvents, 0)

    const rawState = JSON.parse(await fs.readFile(stateFilePath, "utf8"))
    const sessionStat = await fs.stat(sessionFile)
    const checkpoint = rawState.files[sessionFile]
    assert.equal(typeof checkpoint.offset, "number")
    assert.equal(checkpoint.offset, sessionStat.size)
  })
})

test("checkpoint write: persists state atomically", async () => {
  await withTempDir(async (tempDir) => {
    const stateFilePath = path.join(tempDir, "state", "state.json")
    const state = createCheckpointState()
    state.recentTurnIds.push("turn_written")

    await writeCheckpointStateAtomic({ state, stateFilePath })

    const rawState = await fs.readFile(stateFilePath, "utf8")
    const parsedState = JSON.parse(rawState)
    assert.deepEqual(parsedState.recentTurnIds, ["turn_written"])
  })
})

test("runner loop: processes appended event between scans", async () => {
  await withTempDir(async (tempDir) => {
    const sessionsRootPath = path.join(tempDir, "sessions")
    const sessionDir = path.join(sessionsRootPath, "2026", "03", "11")
    await fs.mkdir(sessionDir, { recursive: true })

    const sessionFileA = path.join(sessionDir, "a.jsonl")
    const sessionFileB = path.join(sessionDir, "b.jsonl")
    await fs.writeFile(sessionFileA, "", "utf8")
    await fs.writeFile(sessionFileB, "", "utf8")

    const listedFiles = await listSessionJsonlFiles({ sessionsRootPath })
    assert.deepEqual(listedFiles, [sessionFileA, sessionFileB])

    const deliveredTurnIDs = []
    const cycleResults = []
    let sleepCallCount = 0

    const loopResult = await runWatcherLoop({
      maxCycles: 2,
      intervalMs: 10,
      cycleOptions: {
        sessionsRootPath,
        stateFilePath: path.join(tempDir, "state.json"),
        debounceMs: 0,
        sendNotification: async ({ payload }) => {
          deliveredTurnIDs.push(payload.id)
          return { ok: true }
        }
      },
      onCycleResult: (cycleResult) => {
        cycleResults.push(cycleResult)
      },
      sleepImpl: async () => {
        sleepCallCount += 1
        if (sleepCallCount === 1) {
          await fs.appendFile(sessionFileA, `${makeTaskCompleteLine("turn_appended", "Appended") }\n`, "utf8")
        }
      }
    })

    assert.equal(loopResult.cycles, 2)
    assert.equal(sleepCallCount, 1)
    assert.deepEqual(deliveredTurnIDs, ["turn_appended"])
    assert.equal(cycleResults[0].emittedEvents, 0)
    assert.equal(cycleResults[1].emittedEvents, 1)
    assert.equal(cycleResults[1].deliveredNotifications, 1)
  })
})

test("malformed json tolerated: cycle ignores invalid lines and continues", async () => {
  await withTempDir(async (tempDir) => {
    const sessionsRootPath = path.join(tempDir, "sessions")
    const sessionDir = path.join(sessionsRootPath, "2026", "03", "11")
    await fs.mkdir(sessionDir, { recursive: true })

    const sessionFile = path.join(sessionDir, "malformed.jsonl")
    await fs.writeFile(sessionFile, "", "utf8")

    const stateFilePath = path.join(tempDir, "state.json")
    await runWatcherCycleNoDebounce({
      sessionsRootPath,
      stateFilePath,
      sendNotification: async () => ({ ok: true })
    })

    await fs.appendFile(sessionFile, "{\"type\":\"event_msg\",\"payload\":\n", "utf8")
    await fs.appendFile(sessionFile, `${makeTaskCompleteLine("turn_valid", "Recovered")}\n`, "utf8")

    const deliveredTurnIDs = []
    const cycleResult = await runWatcherCycleNoDebounce({
      sessionsRootPath,
      stateFilePath,
      sendNotification: async ({ payload }) => {
        deliveredTurnIDs.push(payload.id)
        return { ok: true }
      }
    })

    assert.deepEqual(deliveredTurnIDs, ["turn_valid"])
    assert.equal(cycleResult.emittedEvents, 1)
    assert.equal(cycleResult.deliveredNotifications, 1)
    assert.equal(cycleResult.droppedNotifications, 0)
  })
})

test("delivery failure: cycle records notification_delivery errors", async () => {
  await withTempDir(async (tempDir) => {
    const sessionsRootPath = path.join(tempDir, "sessions")
    const sessionDir = path.join(sessionsRootPath, "2026", "03", "11")
    await fs.mkdir(sessionDir, { recursive: true })

    const sessionFile = path.join(sessionDir, "failure.jsonl")
    await fs.writeFile(sessionFile, "", "utf8")

    const stateFilePath = path.join(tempDir, "state.json")
    await runWatcherCycleNoDebounce({
      sessionsRootPath,
      stateFilePath,
      sendNotification: async () => ({ ok: true })
    })

    await fs.appendFile(sessionFile, `${makeTaskCompleteLine("turn_fail", "Done")}\n`, "utf8")

    const cycleResult = await runWatcherCycleNoDebounce({
      sessionsRootPath,
      stateFilePath,
      sendNotification: async () => ({
        ok: false,
        error: { reason: "notifier crashed" }
      })
    })

    assert.equal(cycleResult.deliveredNotifications, 0)
    assert.equal(cycleResult.droppedNotifications, 1)
    assert.equal(cycleResult.errors.some((error) => error.kind === "notification_delivery"), true)
  })
})

test("cli: runs once without external notifier lookup", async () => {
  const cycleCalls = []
  const exitCode = await runWatcherCli({
    argv: ["--once"],
    runCycle: async (cycleOptions) => {
      cycleCalls.push(cycleOptions)
    }
  })

  assert.equal(exitCode, 0)
  assert.equal(cycleCalls.length, 1)
  assert.equal(typeof cycleCalls[0].startupMs, "number")
  assert.equal(cycleCalls[0].subtitle, WATCHER_SUBTITLE)
})
