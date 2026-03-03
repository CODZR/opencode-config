import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { execFile as execFileCallback } from "node:child_process"
import { promisify } from "node:util"
import { promises as fs } from "node:fs"

import {
  BRIDGE_NOTIFY_BASE_URL,
  BRIDGE_NOTIFY_PATH,
  BRIDGE_PAYLOAD_ID_KEY,
  BRIDGE_PAYLOAD_MESSAGE_KEY,
  BRIDGE_PAYLOAD_SUBTITLE_KEY,
  BRIDGE_REQUEST_TIMEOUT_MS,
  BRIDGE_TOKEN_HEADER,
  CODEX_EVENT_ENVELOPE_TYPE,
  CODEX_EVENT_PAYLOAD_KEY,
  CODEX_TASK_COMPLETE_EVENT_TYPE,
  CODEX_TASK_COMPLETE_MESSAGE_KEY,
  CODEX_TASK_COMPLETE_TURN_ID_KEY,
  CHECKPOINT_STATE_VERSION,
  TASK_COMPLETE_MESSAGE_FALLBACK,
  TASK_COMPLETE_MESSAGE_MAX_LENGTH,
  WATCHER_DEBOUNCE_DEFAULT_MS,
  WATCHER_DEBOUNCE_ENV_KEY,
  WATCHER_INTERVAL_ENV_KEY,
  WATCHER_TOKEN_ENV_KEY,
  applyJsonlTailToState,
  buildTaskCompleteNotificationPayload,
  createCheckpointState,
  getBridgeNotifyEndpoint,
  listSessionJsonlFiles,
  parseTaskCompleteEvent,
  readJsonlTailFromCheckpoint,
  resolveWatcherConfigFromEnv,
  runWatcherCycle,
  runWatcherLoop,
  sendBridgeNotification,
  tailFileTaskCompleteEvents,
  writeCheckpointStateAtomic
} from "./codex-completion-watcher.mjs"

const execFile = promisify(execFileCallback)
const launchAgentPlistPath = path.resolve("plugin/codex-watcher/com.codzr.codex-completion-watcher.plist")
const runWatcherCycleNoDebounce = (options) => runWatcherCycle({ debounceMs: 0, ...options })

const makeTaskCompleteLine = (turnID, lastAgentMessage = "Done") => JSON.stringify({
  timestamp: "2026-03-03T00:00:00.000Z",
  type: "event_msg",
  payload: {
    type: "task_complete",
    turn_id: turnID,
    last_agent_message: lastAgentMessage
  }
})

const makeEventLine = ({ envelopeType = "event_msg", payloadType = "task_complete", turnID = "turn_1", lastAgentMessage = "Done" } = {}) => JSON.stringify({
  timestamp: "2026-03-03T00:00:00.000Z",
  type: envelopeType,
  payload: {
    type: payloadType,
    turn_id: turnID,
    last_agent_message: lastAgentMessage
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

const withMockBridgeServer = async ({ onRequest } = {}, fn) => {
  const requests = []
  const waiters = []

  const resolveSatisfiedWaiters = () => {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      if (requests.length < waiters[index].count) continue
      const waiter = waiters[index]
      waiters.splice(index, 1)
      clearTimeout(waiter.timeoutHandle)
      waiter.resolve([...requests])
    }
  }

  const server = createServer(async (request, response) => {
    try {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)

      const rawBody = Buffer.concat(chunks).toString("utf8")
      let jsonBody = null
      if (rawBody) {
        try {
          jsonBody = JSON.parse(rawBody)
        } catch {
          jsonBody = null
        }
      }

      const requestRecord = {
        method: request.method,
        url: request.url,
        headers: request.headers,
        rawBody,
        jsonBody
      }
      requests.push(requestRecord)
      resolveSatisfiedWaiters()

      const defaultResponse = {
        statusCode: 200,
        headers: {
          "content-type": "application/json"
        },
        body: { ok: true }
      }

      const customResponse = typeof onRequest === "function"
        ? await onRequest(requestRecord)
        : null
      const finalResponse = customResponse && typeof customResponse === "object"
        ? {
          statusCode: customResponse.statusCode ?? defaultResponse.statusCode,
          headers: customResponse.headers ?? defaultResponse.headers,
          body: customResponse.body ?? defaultResponse.body
        }
        : defaultResponse

      response.statusCode = finalResponse.statusCode
      for (const [headerName, headerValue] of Object.entries(finalResponse.headers || {})) {
        response.setHeader(headerName, headerValue)
      }

      if (typeof finalResponse.body === "string" || Buffer.isBuffer(finalResponse.body)) {
        response.end(finalResponse.body)
        return
      }

      if (finalResponse.body === null || finalResponse.body === undefined) {
        response.end()
        return
      }

      response.end(JSON.stringify(finalResponse.body))
    } catch {
      response.statusCode = 500
      response.end(JSON.stringify({ ok: false }))
    }
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("failed to bind mock bridge server")
  }

  const endpoint = `http://127.0.0.1:${address.port}${BRIDGE_NOTIFY_PATH}`
  const waitForRequestCount = (count, timeoutMs = 1000) => new Promise((resolve, reject) => {
    if (requests.length >= count) {
      resolve([...requests])
      return
    }

    const timeoutHandle = setTimeout(() => {
      const index = waiters.findIndex((waiter) => waiter.resolve === resolve)
      if (index >= 0) waiters.splice(index, 1)
      reject(new Error(`timed out waiting for ${count} requests; saw ${requests.length}`))
    }, timeoutMs)

    waiters.push({ count, resolve, timeoutHandle })
  })

  try {
    return await fn({ endpoint, requests, waitForRequestCount })
  } finally {
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timeoutHandle)
      waiter.resolve([...requests])
    }
    await new Promise((resolve) => {
      server.close(() => resolve())
    })
  }
}

test("plist required keys: launchagent includes runner/env/log launchd keys", async () => {
  const { stdout } = await execFile("plutil", [
    "-convert",
    "json",
    "-o",
    "-",
    launchAgentPlistPath
  ], { encoding: "utf8" })

  const plist = JSON.parse(stdout)

  assert.equal(plist.Label, "com.codzr.codex-completion-watcher")
  assert.deepEqual(plist.ProgramArguments, [
    "/Users/codzr/.config/opencode/plugin/codex-watcher/run-codex-completion-watcher.sh"
  ])
  assert.equal(plist.RunAtLoad, true)
  assert.equal(plist.KeepAlive?.SuccessfulExit, false)
  assert.equal(plist.ThrottleInterval, 5)
  assert.equal(
    plist.EnvironmentVariables?.OPENCODE_NOTIFY_TOKEN,
    "__REPLACE_WITH_LOCAL_OPENCODE_NOTIFY_TOKEN__"
  )
  assert.equal(plist.StandardOutPath, "/Users/codzr/Library/Logs/codex-completion-watcher.log")
  assert.equal(plist.StandardErrorPath, "/Users/codzr/Library/Logs/codex-completion-watcher.error.log")
})

test("contract: exports strict event + bridge constants", () => {
  assert.equal(CODEX_EVENT_ENVELOPE_TYPE, "event_msg")
  assert.equal(CODEX_EVENT_PAYLOAD_KEY, "payload")
  assert.equal(CODEX_TASK_COMPLETE_EVENT_TYPE, "task_complete")
  assert.equal(CODEX_TASK_COMPLETE_TURN_ID_KEY, "turn_id")
  assert.equal(CODEX_TASK_COMPLETE_MESSAGE_KEY, "last_agent_message")

  assert.equal(BRIDGE_NOTIFY_BASE_URL, "http://127.0.0.1:17342")
  assert.equal(BRIDGE_NOTIFY_PATH, "/opencode/notify")
  assert.equal(BRIDGE_TOKEN_HEADER, "x-opencode-token")
  assert.equal(getBridgeNotifyEndpoint(), "http://127.0.0.1:17342/opencode/notify")
})

test("payload: helper returns exact id/message/subtitle keys", () => {
  const payload = buildTaskCompleteNotificationPayload({
    turnID: "turn_42",
    completionText: "Done",
    subtitle: "项目：demo"
  })

  assert.deepEqual(Object.keys(payload), [
    BRIDGE_PAYLOAD_ID_KEY,
    BRIDGE_PAYLOAD_MESSAGE_KEY,
    BRIDGE_PAYLOAD_SUBTITLE_KEY
  ])

  assert.deepEqual(payload, {
    id: "turn_42",
    message: "Done",
    subtitle: "项目：demo"
  })
})

test("null message fallback: null/empty completion text uses default", () => {
  const nullPayload = buildTaskCompleteNotificationPayload({
    turnID: "turn_null",
    completionText: null,
    subtitle: "项目：demo"
  })

  assert.equal(nullPayload.message, TASK_COMPLETE_MESSAGE_FALLBACK)

  const emptyPayload = buildTaskCompleteNotificationPayload({
    turnID: "turn_empty",
    completionText: "   ",
    subtitle: "项目：demo"
  })

  assert.equal(emptyPayload.message, TASK_COMPLETE_MESSAGE_FALLBACK)
})

test("event filter happy: parseTaskCompleteEvent accepts strict task_complete envelope", () => {
  const parsed = parseTaskCompleteEvent(makeEventLine({
    envelopeType: "event_msg",
    payloadType: "task_complete",
    turnID: "turn_happy",
    lastAgentMessage: "  completed\n\nwith   spacing  "
  }))

  assert.deepEqual(parsed, {
    turnID: "turn_happy",
    completionText: "completed with spacing"
  })
})

test("ignore non event_msg: parseTaskCompleteEvent ignores non-target envelopes", () => {
  const nonEventMsg = parseTaskCompleteEvent(makeEventLine({ envelopeType: "agent_message" }))
  const wrongPayloadType = parseTaskCompleteEvent(makeEventLine({ payloadType: "task_started" }))

  assert.equal(nonEventMsg, null)
  assert.equal(wrongPayloadType, null)
})

test("completion text: parseTaskCompleteEvent validates turn_id and normalizes/truncates", () => {
  const missingTurnID = parseTaskCompleteEvent(JSON.stringify({
    timestamp: "2026-03-03T00:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "task_complete",
      last_agent_message: "Done"
    }
  }))
  const emptyTurnID = parseTaskCompleteEvent(makeEventLine({ turnID: "   " }))
  const nonStringTurnID = parseTaskCompleteEvent(makeEventLine({ turnID: 42 }))
  const nullMessage = parseTaskCompleteEvent(makeEventLine({ turnID: "turn_null", lastAgentMessage: null }))
  const longMessage = "  line1\nline2\t" + "x".repeat(TASK_COMPLETE_MESSAGE_MAX_LENGTH + 20)
  const normalizedLong = parseTaskCompleteEvent(makeEventLine({ turnID: "turn_long", lastAgentMessage: longMessage }))

  assert.equal(missingTurnID, null)
  assert.equal(emptyTurnID, null)
  assert.equal(nonStringTurnID, null)
  assert.equal(nullMessage?.completionText, TASK_COMPLETE_MESSAGE_FALLBACK)
  assert.equal(typeof normalizedLong?.completionText, "string")
  assert.equal(normalizedLong?.completionText.includes("\n"), false)
  assert.equal(normalizedLong?.completionText.endsWith("..."), true)
  assert.equal(normalizedLong?.completionText.length <= TASK_COMPLETE_MESSAGE_MAX_LENGTH, true)
})

test("config: resolveWatcherConfigFromEnv resolves debounce default and override", () => {
  const defaultConfig = resolveWatcherConfigFromEnv({
    env: {
      [WATCHER_TOKEN_ENV_KEY]: "token_default"
    }
  })
  assert.equal(defaultConfig.ok, true)
  assert.equal(defaultConfig.config.intervalMs > 0, true)
  assert.equal(defaultConfig.config.debounceMs, WATCHER_DEBOUNCE_DEFAULT_MS)

  const overriddenConfig = resolveWatcherConfigFromEnv({
    env: {
      [WATCHER_TOKEN_ENV_KEY]: "token_override",
      [WATCHER_INTERVAL_ENV_KEY]: "2500",
      [WATCHER_DEBOUNCE_ENV_KEY]: "0"
    }
  })
  assert.equal(overriddenConfig.ok, true)
  assert.equal(overriddenConfig.config.intervalMs, 2500)
  assert.equal(overriddenConfig.config.debounceMs, 0)

  const clampedConfig = resolveWatcherConfigFromEnv({
    env: {
      [WATCHER_TOKEN_ENV_KEY]: "token_clamped",
      [WATCHER_DEBOUNCE_ENV_KEY]: "-15"
    }
  })
  assert.equal(clampedConfig.ok, true)
  assert.equal(clampedConfig.config.debounceMs, 0)
})

test("debounce trailing: watcher coalesces burst and only delivers latest after quiet period", async () => {
  let persistedState = createCheckpointState()
  let currentEvents = []
  let currentNowMs = 0
  const deliveredPayloads = []

  const runCycle = async () => runWatcherCycle({
    bridgeToken: "token_debounce_trailing",
    debounceMs: 3000,
    nowMs: () => currentNowMs,
    loadState: async () => persistedState,
    writeState: async ({ state }) => {
      persistedState = state
    },
    listFiles: async () => ["/tmp/debounce.jsonl"],
    tailFileEvents: async ({ state }) => ({
      state,
      events: currentEvents,
      didResetCheckpoint: false
    }),
    sendNotification: async ({ payload }) => {
      deliveredPayloads.push(payload)
      return { ok: true, statusCode: 200, attempts: 1 }
    }
  })

  currentNowMs = 1000
  currentEvents = [
    { turnID: "turn_1", completionText: "first" },
    { turnID: "turn_2", completionText: "second" }
  ]
  const firstCycle = await runCycle()
  assert.equal(firstCycle.emittedEvents, 2)
  assert.equal(firstCycle.deliveredNotifications, 0)
  assert.equal(persistedState.pendingNotification?.payload?.id, "turn_2")
  assert.equal(persistedState.pendingNotification?.dueAtMs, 4000)

  currentNowMs = 2500
  currentEvents = [{ turnID: "turn_3", completionText: "third" }]
  const secondCycle = await runCycle()
  assert.equal(secondCycle.emittedEvents, 1)
  assert.equal(secondCycle.deliveredNotifications, 0)
  assert.equal(persistedState.pendingNotification?.payload?.id, "turn_3")
  assert.equal(persistedState.pendingNotification?.dueAtMs, 5500)

  currentNowMs = 5400
  currentEvents = []
  const thirdCycle = await runCycle()
  assert.equal(thirdCycle.emittedEvents, 0)
  assert.equal(thirdCycle.deliveredNotifications, 0)
  assert.equal(deliveredPayloads.length, 0)

  currentNowMs = 5500
  const fourthCycle = await runCycle()
  assert.equal(fourthCycle.emittedEvents, 0)
  assert.equal(fourthCycle.deliveredNotifications, 1)
  assert.equal(deliveredPayloads.length, 1)
  assert.equal(deliveredPayloads[0].id, "turn_3")
  assert.equal(persistedState.pendingNotification, null)
})

test("debounce disabled: watcher immediately delivers all completion events", async () => {
  let persistedState = createCheckpointState()
  const deliveredPayloads = []

  const cycleResult = await runWatcherCycle({
    bridgeToken: "token_debounce_disabled",
    debounceMs: 0,
    loadState: async () => persistedState,
    writeState: async ({ state }) => {
      persistedState = state
    },
    listFiles: async () => ["/tmp/debounce-disabled.jsonl"],
    tailFileEvents: async ({ state }) => ({
      state,
      events: [
        { turnID: "turn_a", completionText: "A" },
        { turnID: "turn_b", completionText: "B" }
      ],
      didResetCheckpoint: false
    }),
    sendNotification: async ({ payload }) => {
      deliveredPayloads.push(payload)
      return { ok: true, statusCode: 200, attempts: 1 }
    }
  })

  assert.equal(cycleResult.emittedEvents, 2)
  assert.equal(cycleResult.deliveredNotifications, 2)
  assert.equal(deliveredPayloads.length, 2)
  assert.deepEqual(deliveredPayloads.map((payload) => payload.id), ["turn_a", "turn_b"])
  assert.equal(persistedState.pendingNotification, null)
})

test("debounce trailing: failed due flush is dropped and not retried on later cycles", async () => {
  let persistedState = createCheckpointState()
  let currentEvents = []
  let currentNowMs = 1000
  let sendAttempts = 0

  const runCycle = async () => runWatcherCycle({
    bridgeToken: "token_debounce_due_failure_drop",
    debounceMs: 3000,
    nowMs: () => currentNowMs,
    loadState: async () => persistedState,
    writeState: async ({ state }) => {
      persistedState = state
    },
    listFiles: async () => ["/tmp/debounce-due-failure.jsonl"],
    tailFileEvents: async ({ state }) => ({
      state,
      events: currentEvents,
      didResetCheckpoint: false
    }),
    sendNotification: async () => {
      sendAttempts += 1
      return {
        ok: false,
        error: { reason: "simulated failure" }
      }
    }
  })

  currentEvents = [{ turnID: "turn_due_fail", completionText: "pending" }]
  const enqueueCycle = await runCycle()
  assert.equal(enqueueCycle.emittedEvents, 1)
  assert.equal(enqueueCycle.deliveredNotifications, 0)
  assert.equal(persistedState.pendingNotification?.payload?.id, "turn_due_fail")

  currentEvents = []
  currentNowMs = 4000
  const dueFailureCycle = await runCycle()
  assert.equal(dueFailureCycle.deliveredNotifications, 0)
  assert.equal(dueFailureCycle.droppedNotifications, 1)
  assert.equal(sendAttempts, 1)
  assert.equal(persistedState.pendingNotification, null)

  currentNowMs = 7000
  const noRetryCycle = await runCycle()
  assert.equal(noRetryCycle.deliveredNotifications, 0)
  assert.equal(noRetryCycle.droppedNotifications, 0)
  assert.equal(sendAttempts, 1)
  assert.equal(persistedState.pendingNotification, null)
})

test("checkpoint: atomic write persists via temp file rename", async () => {
  const operations = []
  const mockFsPromises = {
    mkdir: async (targetPath, options) => {
      operations.push({ op: "mkdir", targetPath, options })
    },
    writeFile: async (targetPath, content, encoding) => {
      operations.push({ op: "writeFile", targetPath, content, encoding })
    },
    rename: async (fromPath, toPath) => {
      operations.push({ op: "rename", fromPath, toPath })
    }
  }

  const statePath = "/tmp/codex-watcher/state.json"
  await writeCheckpointStateAtomic({
    state: {
      version: CHECKPOINT_STATE_VERSION,
      files: {},
      recentTurnIds: ["turn_1"]
    },
    stateFilePath: statePath,
    fsPromises: mockFsPromises
  })

  assert.equal(operations[0].op, "mkdir")
  assert.equal(operations[1].op, "writeFile")
  assert.equal(operations[2].op, "rename")
  assert.equal(operations[0].targetPath, "/tmp/codex-watcher")
  assert.equal(operations[1].targetPath.endsWith(".tmp"), true)
  assert.equal(operations[2].fromPath, operations[1].targetPath)
  assert.equal(operations[2].toPath, statePath)
})

test("tail checkpoint resume: re-read does not emit duplicate turn_id events", async () => {
  await withTempDir(async (tempDir) => {
    const sessionFile = path.join(tempDir, "resume.jsonl")
    const firstLine = `${makeTaskCompleteLine("turn_a", "A complete")}\n`
    const secondLine = `${makeTaskCompleteLine("turn_b", "B complete")}\n`
    const thirdLine = `${makeTaskCompleteLine("turn_c", "C complete")}\n`
    await fs.writeFile(sessionFile, `${firstLine}${secondLine}`, "utf8")

    const initialState = createCheckpointState()
    const firstPass = await tailFileTaskCompleteEvents({ filePath: sessionFile, state: initialState })

    assert.deepEqual(firstPass.events.map((event) => event.turnID), [])

    await fs.appendFile(sessionFile, thirdLine, "utf8")
    const appendPass = await tailFileTaskCompleteEvents({ filePath: sessionFile, state: firstPass.state })
    assert.deepEqual(appendPass.events.map((event) => event.turnID), ["turn_c"])

    const secondPass = await tailFileTaskCompleteEvents({ filePath: sessionFile, state: appendPass.state })
    assert.equal(secondPass.events.length, 0)

    const replayState = structuredClone(appendPass.state)
    replayState.files[sessionFile].offset = Buffer.byteLength(`${firstLine}${secondLine}`)

    const replayPass = await tailFileTaskCompleteEvents({ filePath: sessionFile, state: replayState })
    assert.equal(replayPass.events.length, 0)
    assert.deepEqual(replayPass.state.recentTurnIds, ["turn_c"])
  })
})

test("tail partial-line: incomplete trailing JSON is ignored until newline arrives", async () => {
  await withTempDir(async (tempDir) => {
    const sessionFile = path.join(tempDir, "partial.jsonl")
    const completeLine = `${makeTaskCompleteLine("turn_complete", "Complete line")}\n`
    const pendingLinePrefix = makeTaskCompleteLine("turn_pending", "Pending line").slice(0, 36)
    await fs.writeFile(sessionFile, `${completeLine}${pendingLinePrefix}`, "utf8")

    const firstState = createCheckpointState()
    firstState.files[sessionFile] = {
      path: sessionFile,
      inode: null,
      offset: 0,
      mtimeMs: 0
    }
    const firstPass = await tailFileTaskCompleteEvents({ filePath: sessionFile, state: firstState })

    assert.deepEqual(firstPass.events.map((event) => event.turnID), ["turn_complete"])

    const firstCheckpoint = firstPass.state.files[sessionFile]
    assert.equal(firstCheckpoint.path, sessionFile)
    assert.equal(typeof firstCheckpoint.inode, "number")
    assert.equal(firstCheckpoint.offset, Buffer.byteLength(completeLine))
    assert.equal(typeof firstCheckpoint.mtimeMs, "number")

    const pendingSuffix = `${makeTaskCompleteLine("turn_pending", "Pending line").slice(36)}\n`
    await fs.appendFile(sessionFile, pendingSuffix, "utf8")

    const secondPass = await tailFileTaskCompleteEvents({ filePath: sessionFile, state: firstPass.state })
    assert.deepEqual(secondPass.events.map((event) => event.turnID), ["turn_pending"])
  })
})

test("checkpoint tail truncate/replace: restarts safely on file identity changes", async () => {
  await withTempDir(async (tempDir) => {
    const sessionFile = path.join(tempDir, "identity.jsonl")
    const originalContent = `${makeTaskCompleteLine("turn_1")}\n${makeTaskCompleteLine("turn_2")}\n`
    await fs.writeFile(sessionFile, originalContent, "utf8")

    const initialPass = await tailFileTaskCompleteEvents({
      filePath: sessionFile,
      state: createCheckpointState()
    })
    assert.deepEqual(initialPass.events.map((event) => event.turnID), [])

    await fs.writeFile(sessionFile, `${makeTaskCompleteLine("turn_3")}\n`, "utf8")

    const truncatePass = await tailFileTaskCompleteEvents({
      filePath: sessionFile,
      state: initialPass.state
    })
    assert.equal(truncatePass.didResetCheckpoint, true)
    assert.deepEqual(truncatePass.events.map((event) => event.turnID), ["turn_3"])

    const replacementFile = path.join(tempDir, "identity.replace.jsonl")
    await fs.writeFile(replacementFile, `${makeTaskCompleteLine("turn_4")}\n`, "utf8")
    await fs.rename(replacementFile, sessionFile)

    const replacePass = await tailFileTaskCompleteEvents({
      filePath: sessionFile,
      state: truncatePass.state
    })
    assert.equal(replacePass.didResetCheckpoint, true)
    assert.deepEqual(replacePass.events.map((event) => event.turnID), ["turn_4"])
  })
})

test("checkpoint apply: state updates file checkpoint metadata keys", () => {
  const filePath = "/tmp/example.jsonl"
  const result = applyJsonlTailToState({
    state: createCheckpointState(),
    filePath,
    lines: [makeTaskCompleteLine("turn_meta")],
    checkpoint: {
      path: filePath,
      inode: 42,
      offset: 99,
      mtimeMs: 1234
    }
  })

  assert.deepEqual(result.state.files[filePath], {
    path: filePath,
    inode: 42,
    offset: 99,
    mtimeMs: 1234
  })
})

test("tail helper: readJsonlTailFromCheckpoint only returns newline-terminated lines", async () => {
  await withTempDir(async (tempDir) => {
    const sessionFile = path.join(tempDir, "read-tail.jsonl")
    const complete = `${makeTaskCompleteLine("turn_r1")}\n`
    const partial = makeTaskCompleteLine("turn_r2")
    await fs.writeFile(sessionFile, `${complete}${partial}`, "utf8")

    const readResult = await readJsonlTailFromCheckpoint({
      filePath: sessionFile,
      checkpoint: {
        path: sessionFile,
        inode: null,
        offset: 0,
        mtimeMs: 0
      }
    })

    assert.deepEqual(readResult.lines, [makeTaskCompleteLine("turn_r1")])
    assert.equal(readResult.checkpoint.offset, Buffer.byteLength(complete))
  })
})

test("bridge success: posts strict payload with token header", async () => {
  const payload = buildTaskCompleteNotificationPayload({
    turnID: "turn_bridge_ok",
    completionText: "Bridge done",
    subtitle: "项目：demo"
  })
  const bridgeToken = "secret-token-bridge"
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, status: 200 }
  }

  const result = await sendBridgeNotification({
    payload,
    bridgeToken,
    fetchImpl,
    maxAttempts: 1
  })

  assert.equal(result.ok, true)
  assert.equal(result.attempts, 1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${BRIDGE_NOTIFY_BASE_URL}${BRIDGE_NOTIFY_PATH}`)
  assert.equal(calls[0].options.method, "POST")
  assert.equal(calls[0].options.headers["content-type"], "application/json")
  assert.equal(calls[0].options.headers[BRIDGE_TOKEN_HEADER], bridgeToken)

  const body = JSON.parse(calls[0].options.body)
  assert.deepEqual(Object.keys(body), [
    BRIDGE_PAYLOAD_ID_KEY,
    BRIDGE_PAYLOAD_MESSAGE_KEY,
    BRIDGE_PAYLOAD_SUBTITLE_KEY
  ])
  assert.deepEqual(body, payload)
})

test("bridge unauthorized: classifies 401 and does not retry", async () => {
  const token = "secret-token-401"
  let callCount = 0
  const fetchImpl = async () => {
    callCount += 1
    return { ok: false, status: 401 }
  }

  const result = await sendBridgeNotification({
    payload: {
      id: "turn_unauthorized",
      message: "done",
      subtitle: "项目：demo"
    },
    bridgeToken: token,
    fetchImpl,
    maxAttempts: 3,
    retryBackoffMs: [0, 0]
  })

  assert.equal(callCount, 1)
  assert.equal(result.ok, false)
  assert.equal(result.error.class, "unauthorized")
  assert.equal(result.error.statusCode, 401)
  assert.equal(result.error.retryable, false)
  assert.equal(result.error.reason.includes(token), false)
})

test("bridge timeout: retries boundedly and redacts token", async () => {
  const token = "secret-token-timeout"
  let fetchCallCount = 0

  const makeAbortController = () => {
    const listeners = []
    const signal = {
      aborted: false,
      addEventListener: (eventName, callback) => {
        if (eventName !== "abort") return
        listeners.push(callback)
        if (signal.aborted) callback()
      }
    }
    return {
      signal,
      abort: () => {
        signal.aborted = true
        for (const callback of listeners) callback()
      }
    }
  }

  const fetchImpl = async (_url, options) => {
    fetchCallCount += 1
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const timeoutError = new Error(`request timed out for ${token}`)
        timeoutError.name = "AbortError"
        reject(timeoutError)
      })
    })
  }

  const result = await sendBridgeNotification({
    payload: {
      id: "turn_timeout",
      message: "done",
      subtitle: "项目：demo"
    },
    bridgeToken: token,
    fetchImpl,
    timeoutMs: BRIDGE_REQUEST_TIMEOUT_MS,
    maxAttempts: 2,
    retryBackoffMs: [0],
    setTimeoutImpl: (callback) => {
      callback()
      return 1
    },
    clearTimeoutImpl: () => {},
    abortControllerFactory: makeAbortController
  })

  assert.equal(fetchCallCount, 2)
  assert.equal(result.ok, false)
  assert.equal(result.attempts, 2)
  assert.equal(result.error.class, "timeout")
  assert.equal(result.error.retryable, false)
  assert.equal(result.error.reason.includes(token), false)
  assert.equal(result.error.reason.includes("[redacted]"), true)
})

test("integration exactly once: watcher posts one bridge request per appended task_complete and resumes without duplicates", async () => {
  await withTempDir(async (tempDir) => {
    const sessionsRootPath = path.join(tempDir, "sessions")
    const sessionDir = path.join(sessionsRootPath, "2026", "03", "03")
    await fs.mkdir(sessionDir, { recursive: true })

    const sessionFile = path.join(sessionDir, "integration-exactly-once.jsonl")
    await fs.writeFile(sessionFile, `${makeTaskCompleteLine("turn_existing", "Already complete")}\n`, "utf8")

    await withMockBridgeServer({}, async ({ endpoint, requests, waitForRequestCount }) => {
      const stateFilePath = path.join(tempDir, "watcher-state.json")
      const sendNotification = ({ payload, bridgeToken }) => sendBridgeNotification({
        payload,
        bridgeToken,
        endpoint,
        maxAttempts: 1,
        retryBackoffMs: [0]
      })

      const firstCycle = await runWatcherCycleNoDebounce({
        bridgeToken: "token_integration_exactly_once",
        sessionsRootPath,
        stateFilePath,
        sendNotification
      })

      assert.equal(firstCycle.emittedEvents, 0)
      assert.equal(firstCycle.deliveredNotifications, 0)
      assert.equal(firstCycle.droppedNotifications, 0)
      assert.equal(requests.length, 0)

      const restartCycle = await runWatcherCycleNoDebounce({
        bridgeToken: "token_integration_exactly_once",
        sessionsRootPath,
        stateFilePath,
        sendNotification
      })

      assert.equal(restartCycle.emittedEvents, 0)
      assert.equal(restartCycle.deliveredNotifications, 0)
      assert.equal(requests.length, 0)

      await fs.appendFile(sessionFile, `${makeTaskCompleteLine("turn_appended", "Appended") }\n`, "utf8")

      const appendCycle = await runWatcherCycleNoDebounce({
        bridgeToken: "token_integration_exactly_once",
        sessionsRootPath,
        stateFilePath,
        sendNotification
      })

      await waitForRequestCount(1)
      assert.equal(appendCycle.emittedEvents, 1)
      assert.equal(appendCycle.deliveredNotifications, 1)
      assert.equal(appendCycle.droppedNotifications, 0)
      assert.equal(requests.length, 1)
      assert.equal(requests[0].method, "POST")
      assert.equal(requests[0].url, BRIDGE_NOTIFY_PATH)
      assert.equal(requests[0].jsonBody?.id, "turn_appended")

      const unchangedCycle = await runWatcherCycleNoDebounce({
        bridgeToken: "token_integration_exactly_once",
        sessionsRootPath,
        stateFilePath,
        sendNotification
      })

      assert.equal(unchangedCycle.emittedEvents, 0)
      assert.equal(unchangedCycle.deliveredNotifications, 0)
      assert.equal(requests.length, 1)
    })
  })
})

test("integration unauthorized: watcher drops unauthorized delivery without duplicate retry posts", async () => {
  await withTempDir(async (tempDir) => {
    const sessionsRootPath = path.join(tempDir, "sessions")
    const sessionDir = path.join(sessionsRootPath, "2026", "03", "03")
    await fs.mkdir(sessionDir, { recursive: true })

    const sessionFile = path.join(sessionDir, "integration-unauthorized.jsonl")
    await fs.writeFile(sessionFile, "", "utf8")

    await withMockBridgeServer({
      onRequest: async () => ({
        statusCode: 401,
        body: { ok: false }
      })
    }, async ({ endpoint, requests, waitForRequestCount }) => {
      const notifyResults = []
      const warmupCycle = await runWatcherCycleNoDebounce({
        bridgeToken: "token_integration_unauthorized",
        sessionsRootPath,
        stateFilePath: path.join(tempDir, "watcher-state.json"),
        sendNotification: async ({ payload, bridgeToken }) => {
          const notifyResult = await sendBridgeNotification({
            payload,
            bridgeToken,
            endpoint,
            maxAttempts: 3,
            retryBackoffMs: [0, 0]
          })
          notifyResults.push(notifyResult)
          return notifyResult
        }
      })

      assert.equal(warmupCycle.emittedEvents, 0)
      await fs.appendFile(sessionFile, `${makeTaskCompleteLine("turn_unauthorized_integration", "Denied")}\n`, "utf8")

      const cycleResult = await runWatcherCycleNoDebounce({
        bridgeToken: "token_integration_unauthorized",
        sessionsRootPath,
        stateFilePath: path.join(tempDir, "watcher-state.json"),
        sendNotification: async ({ payload, bridgeToken }) => {
          const notifyResult = await sendBridgeNotification({
            payload,
            bridgeToken,
            endpoint,
            maxAttempts: 3,
            retryBackoffMs: [0, 0]
          })
          notifyResults.push(notifyResult)
          return notifyResult
        }
      })

      await waitForRequestCount(1)

      assert.equal(requests.length, 1)
      assert.equal(requests[0].url, BRIDGE_NOTIFY_PATH)
      assert.equal(requests[0].jsonBody?.id, "turn_unauthorized_integration")
      assert.equal(requests[0].headers[BRIDGE_TOKEN_HEADER], "token_integration_unauthorized")

      assert.equal(notifyResults.length, 1)
      assert.equal(notifyResults[0].ok, false)
      assert.equal(notifyResults[0].error.class, "unauthorized")
      assert.equal(notifyResults[0].error.statusCode, 401)
      assert.equal(notifyResults[0].error.retryable, false)

      assert.equal(cycleResult.emittedEvents, 1)
      assert.equal(cycleResult.deliveredNotifications, 0)
      assert.equal(cycleResult.droppedNotifications, 1)
      assert.equal(cycleResult.errors.some((error) => error.kind === "bridge_delivery"), true)
    })
  })
})

test("integration timeout: delayed mock bridge response classifies timeout failure", async () => {
  await withMockBridgeServer({
    onRequest: async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 60)
      })
      return {
        statusCode: 200,
        body: { ok: true }
      }
    }
  }, async ({ endpoint, requests, waitForRequestCount }) => {
    const result = await sendBridgeNotification({
      payload: {
        id: "turn_timeout_integration",
        message: "done",
        subtitle: "项目：demo"
      },
      bridgeToken: "token_integration_timeout",
      endpoint,
      timeoutMs: 10,
      maxAttempts: 1,
      retryBackoffMs: [0]
    })

    await waitForRequestCount(1)
    assert.equal(requests.length, 1)
    assert.equal(result.ok, false)
    assert.equal(result.error.class, "timeout")
    assert.equal(result.error.retryable, false)
  })
})

test("runner loop: processes new event then idles between scans", async () => {
  await withTempDir(async (tempDir) => {
    const sessionsRootPath = path.join(tempDir, "sessions")
    const sessionDir = path.join(sessionsRootPath, "2026", "03", "03")
    await fs.mkdir(sessionDir, { recursive: true })

    const sessionFileB = path.join(sessionDir, "b.jsonl")
    const sessionFileA = path.join(sessionDir, "a.jsonl")
    await fs.writeFile(sessionFileB, "", "utf8")
    await fs.writeFile(sessionFileA, "", "utf8")

    const listedFiles = await listSessionJsonlFiles({ sessionsRootPath })
    assert.deepEqual(listedFiles, [sessionFileA, sessionFileB])

    const stateFilePath = path.join(tempDir, "state.json")
    const deliveredTurnIDs = []
    const cycleResults = []
    let sleepCallCount = 0

    const loopResult = await runWatcherLoop({
      maxCycles: 2,
      intervalMs: 10,
      cycleOptions: {
        bridgeToken: "token_runner_loop",
        debounceMs: 0,
        sessionsRootPath,
        stateFilePath,
        sendNotification: async ({ payload }) => {
          deliveredTurnIDs.push(payload.id)
          return { ok: true, statusCode: 200, attempts: 1 }
        }
      },
      onCycleResult: (cycleResult) => {
        cycleResults.push(cycleResult)
      },
      sleepImpl: async () => {
        sleepCallCount += 1
        if (sleepCallCount === 1) {
          await fs.appendFile(sessionFileA, `${makeTaskCompleteLine("turn_appended", "Appended done")}\n`, "utf8")
        }
      }
    })

    assert.equal(loopResult.cycles, 2)
    assert.equal(sleepCallCount, 1)
    assert.deepEqual(deliveredTurnIDs, ["turn_appended"])
    assert.equal(cycleResults.length, 2)
    assert.equal(cycleResults[0].emittedEvents, 0)
    assert.equal(cycleResults[0].deliveredNotifications, 0)
    assert.equal(cycleResults[1].emittedEvents, 1)
    assert.equal(cycleResults[1].deliveredNotifications, 1)
  })
})

test("malformed json tolerated: cycle ignores invalid lines and continues", async () => {
  await withTempDir(async (tempDir) => {
    const sessionsRootPath = path.join(tempDir, "sessions")
    const sessionDir = path.join(sessionsRootPath, "2026", "03", "03")
    await fs.mkdir(sessionDir, { recursive: true })

    const sessionFile = path.join(sessionDir, "malformed.jsonl")
    await fs.writeFile(sessionFile, "", "utf8")

    await runWatcherCycleNoDebounce({
      bridgeToken: "token_malformed",
      sessionsRootPath,
      stateFilePath: path.join(tempDir, "state.json"),
      sendNotification: async () => ({ ok: true, statusCode: 200, attempts: 1 })
    })

    const malformedLine = "{\"type\":\"event_msg\",\"payload\":"
    const validLine = makeTaskCompleteLine("turn_valid", "Recovered")
    await fs.writeFile(sessionFile, `${malformedLine}\n${validLine}\n`, "utf8")

    const deliveredTurnIDs = []
    const cycleResult = await runWatcherCycleNoDebounce({
      bridgeToken: "token_malformed",
      sessionsRootPath,
      stateFilePath: path.join(tempDir, "state.json"),
      sendNotification: async ({ payload }) => {
        deliveredTurnIDs.push(payload.id)
        return { ok: true, statusCode: 200, attempts: 1 }
      }
    })

    assert.deepEqual(deliveredTurnIDs, ["turn_valid"])
    assert.equal(cycleResult.emittedEvents, 1)
    assert.equal(cycleResult.deliveredNotifications, 1)
    assert.equal(cycleResult.droppedNotifications, 0)
  })
})

test("bridge down no crash: loop survives send failures and continues", async () => {
  await withTempDir(async (tempDir) => {
    const sessionsRootPath = path.join(tempDir, "sessions")
    const sessionDir = path.join(sessionsRootPath, "2026", "03", "03")
    await fs.mkdir(sessionDir, { recursive: true })

    const sessionFile = path.join(sessionDir, "bridge-down.jsonl")
    await fs.writeFile(sessionFile, "", "utf8")

    const cycleResults = []
    let sendCallCount = 0
    let sleepCallCount = 0

    const loopResult = await runWatcherLoop({
      maxCycles: 2,
      intervalMs: 10,
      cycleOptions: {
        bridgeToken: "token_bridge_down",
        debounceMs: 0,
        sessionsRootPath,
        stateFilePath: path.join(tempDir, "state.json"),
        sendNotification: async () => {
          sendCallCount += 1
          throw new Error("ECONNREFUSED bridge is down")
        }
      },
      onCycleResult: (cycleResult) => {
        cycleResults.push(cycleResult)
      },
      sleepImpl: async () => {
        sleepCallCount += 1
        if (sleepCallCount === 1) {
          await fs.appendFile(sessionFile, `${makeTaskCompleteLine("turn_bridge_down", "Done")}\n`, "utf8")
        }
      }
    })

    assert.equal(loopResult.cycles, 2)
    assert.equal(sendCallCount, 1)
    assert.equal(cycleResults.length, 2)
    assert.equal(cycleResults[0].emittedEvents, 0)
    assert.equal(cycleResults[0].droppedNotifications, 0)
    assert.equal(cycleResults[1].emittedEvents, 1)
    assert.equal(cycleResults[1].droppedNotifications, 1)
    assert.equal(cycleResults[1].errors.some((error) => error.kind === "bridge_delivery"), true)
  })
})
