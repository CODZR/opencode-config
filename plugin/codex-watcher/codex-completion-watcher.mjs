import os from "node:os"
import path from "node:path"
import { promises as fs } from "node:fs"
import { fileURLToPath } from "node:url"

export const CODEX_EVENT_ENVELOPE_TYPE = "event_msg"
export const CODEX_EVENT_PAYLOAD_KEY = "payload"
export const CODEX_TASK_COMPLETE_EVENT_TYPE = "task_complete"
export const CODEX_TASK_COMPLETE_TURN_ID_KEY = "turn_id"
export const CODEX_TASK_COMPLETE_MESSAGE_KEY = "last_agent_message"

export const BRIDGE_NOTIFY_BASE_URL = "http://127.0.0.1:17342"
export const BRIDGE_NOTIFY_PATH = "/opencode/notify"
export const BRIDGE_TOKEN_HEADER = "x-opencode-token"
export const BRIDGE_REQUEST_TIMEOUT_MS = 150
export const BRIDGE_RETRY_MAX_ATTEMPTS = 3
export const BRIDGE_RETRY_BACKOFF_MS = [40, 90]

export const BRIDGE_PAYLOAD_ID_KEY = "id"
export const BRIDGE_PAYLOAD_MESSAGE_KEY = "message"
export const BRIDGE_PAYLOAD_SUBTITLE_KEY = "subtitle"

export const TASK_COMPLETE_MESSAGE_FALLBACK = "Codex：任务已完成"
export const TASK_COMPLETE_MESSAGE_MAX_LENGTH = 200
const TASK_COMPLETE_MESSAGE_TRUNCATION_SUFFIX = "..."
export const WATCHER_STATE_DIR = path.join(os.homedir(), ".local", "state", "codex-notify-watcher")
export const WATCHER_STATE_FILE = path.join(WATCHER_STATE_DIR, "state.json")
export const CHECKPOINT_STATE_VERSION = 1
export const TURN_ID_WINDOW_LIMIT = 128
export const WATCHER_SESSIONS_ROOT = path.join(os.homedir(), ".codex", "sessions")
export const WATCHER_LOOP_INTERVAL_MS = 1500
export const WATCHER_TOKEN_ENV_KEY = "OPENCODE_NOTIFY_TOKEN"
export const WATCHER_INTERVAL_ENV_KEY = "CODEX_WATCHER_INTERVAL_MS"
export const WATCHER_DEBOUNCE_ENV_KEY = "CODEX_WATCHER_DEBOUNCE_MS"
export const WATCHER_DEBOUNCE_DEFAULT_MS = 3000
export const WATCHER_SUBTITLE = "Codex 任务完成"

const WATCHER_CONFIG_EXIT_CODE = 2

export const getBridgeNotifyEndpoint = () => `${BRIDGE_NOTIFY_BASE_URL}${BRIDGE_NOTIFY_PATH}`

const BRIDGE_SERVER_ERROR_MIN = 500
const BRIDGE_SERVER_ERROR_MAX = 599
const REDACTED_TOKEN_VALUE = "[redacted]"

const sleepWithTimer = (durationMs, setTimeoutImpl = setTimeout) => new Promise((resolve) => {
  setTimeoutImpl(resolve, Math.max(0, Math.trunc(sanitizeFiniteNumber(durationMs, 0))))
})

const redactTokenFromText = (text, token) => {
  if (typeof text !== "string") return ""
  if (typeof token !== "string" || token.length === 0) return text
  return text.split(token).join(REDACTED_TOKEN_VALUE)
}

const classifyBridgeHttpStatus = (statusCode) => {
  if (statusCode === 401) return "unauthorized"
  if (statusCode === 415) return "unsupported_media_type"
  if (statusCode >= BRIDGE_SERVER_ERROR_MIN && statusCode <= BRIDGE_SERVER_ERROR_MAX) return "server"
  return "other_http"
}

const normalizeBridgeRetryBackoff = (retryBackoffMs) => {
  if (!Array.isArray(retryBackoffMs) || retryBackoffMs.length === 0) return [0]
  const normalized = retryBackoffMs
    .map((value) => Math.max(0, Math.trunc(sanitizeFiniteNumber(value, 0))))
    .filter((value) => Number.isFinite(value))
  return normalized.length > 0 ? normalized : [0]
}

const shouldRetryBridgeRequest = ({ errorClass, statusCode, attempt, maxAttempts }) => {
  if (attempt >= maxAttempts) return false
  if (errorClass === "timeout" || errorClass === "network") return true
  return statusCode >= BRIDGE_SERVER_ERROR_MIN && statusCode <= BRIDGE_SERVER_ERROR_MAX
}

const buildBridgeNotifyPayload = (payload) => ({
  [BRIDGE_PAYLOAD_ID_KEY]: String(payload?.[BRIDGE_PAYLOAD_ID_KEY] ?? ""),
  [BRIDGE_PAYLOAD_MESSAGE_KEY]: String(payload?.[BRIDGE_PAYLOAD_MESSAGE_KEY] ?? ""),
  [BRIDGE_PAYLOAD_SUBTITLE_KEY]: String(payload?.[BRIDGE_PAYLOAD_SUBTITLE_KEY] ?? "")
})

const buildBridgeError = ({ errorClass, statusCode = null, attempt, maxAttempts, reason, token }) => ({
  class: errorClass,
  statusCode,
  attempt,
  maxAttempts,
  retryable: shouldRetryBridgeRequest({ errorClass, statusCode: statusCode ?? -1, attempt, maxAttempts }),
  reason: redactTokenFromText(String(reason ?? ""), token)
})

export const deliverBridgeNotification = async ({
  payload,
  bridgeToken,
  endpoint = getBridgeNotifyEndpoint(),
  fetchImpl = globalThis.fetch,
  timeoutMs = BRIDGE_REQUEST_TIMEOUT_MS,
  maxAttempts = BRIDGE_RETRY_MAX_ATTEMPTS,
  retryBackoffMs = BRIDGE_RETRY_BACKOFF_MS,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  abortControllerFactory = () => new AbortController()
} = {}) => {
  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      error: buildBridgeError({
        errorClass: "network",
        attempt: 1,
        maxAttempts: 1,
        reason: "fetch unavailable",
        token: bridgeToken
      })
    }
  }

  const requestPayload = buildBridgeNotifyPayload(payload)
  const totalAttempts = Math.max(1, Math.trunc(sanitizeFiniteNumber(maxAttempts, BRIDGE_RETRY_MAX_ATTEMPTS)))
  const timeoutDurationMs = Math.max(1, Math.trunc(sanitizeFiniteNumber(timeoutMs, BRIDGE_REQUEST_TIMEOUT_MS)))
  const backoffDurations = normalizeBridgeRetryBackoff(retryBackoffMs)

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    let timeoutHandle = null
    const abortController = typeof abortControllerFactory === "function" ? abortControllerFactory() : null

    try {
      if (abortController && typeof abortController.abort === "function") {
        timeoutHandle = setTimeoutImpl(() => {
          abortController.abort()
        }, timeoutDurationMs)
      }

      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [BRIDGE_TOKEN_HEADER]: String(bridgeToken ?? "")
        },
        body: JSON.stringify(requestPayload),
        signal: abortController?.signal
      })

      if (response?.ok === true) {
        return {
          ok: true,
          attempts: attempt,
          statusCode: Number.isFinite(response?.status) ? response.status : 200,
          payload: requestPayload
        }
      }

      const statusCode = Number.isFinite(response?.status) ? response.status : 0
      const errorClass = classifyBridgeHttpStatus(statusCode)
      const error = buildBridgeError({
        errorClass,
        statusCode,
        attempt,
        maxAttempts: totalAttempts,
        reason: `bridge status ${statusCode}`,
        token: bridgeToken
      })

      if (!shouldRetryBridgeRequest({ errorClass, statusCode, attempt, maxAttempts: totalAttempts })) {
        return { ok: false, attempts: attempt, error }
      }
    } catch (error) {
      const errorClass = error?.name === "AbortError" ? "timeout" : "network"
      const safeReason = redactTokenFromText(error?.message || error?.name || "request failed", bridgeToken)
      const shapedError = buildBridgeError({
        errorClass,
        attempt,
        maxAttempts: totalAttempts,
        reason: safeReason,
        token: bridgeToken
      })

      if (!shouldRetryBridgeRequest({ errorClass, statusCode: -1, attempt, maxAttempts: totalAttempts })) {
        return { ok: false, attempts: attempt, error: shapedError }
      }
    } finally {
      if (timeoutHandle !== null) clearTimeoutImpl(timeoutHandle)
    }

    const backoffIndex = Math.min(attempt - 1, backoffDurations.length - 1)
    await sleepWithTimer(backoffDurations[backoffIndex], setTimeoutImpl)
  }

  return {
    ok: false,
    attempts: totalAttempts,
    error: buildBridgeError({
      errorClass: "network",
      attempt: totalAttempts,
      maxAttempts: totalAttempts,
      reason: "bridge delivery exhausted retries",
      token: bridgeToken
    })
  }
}

export const sendBridgeNotification = deliverBridgeNotification

const normalizeCompletionMessage = (completionText) => {
  if (typeof completionText !== "string") return TASK_COMPLETE_MESSAGE_FALLBACK
  const normalized = completionText.replace(/\s+/g, " ").trim()
  if (!normalized) return TASK_COMPLETE_MESSAGE_FALLBACK
  if (normalized.length <= TASK_COMPLETE_MESSAGE_MAX_LENGTH) return normalized
  const suffixLength = TASK_COMPLETE_MESSAGE_TRUNCATION_SUFFIX.length
  const maxTextLength = Math.max(1, TASK_COMPLETE_MESSAGE_MAX_LENGTH - suffixLength)
  const truncated = normalized.slice(0, maxTextLength).trimEnd()
  if (truncated.length > 0) return `${truncated}${TASK_COMPLETE_MESSAGE_TRUNCATION_SUFFIX}`
  return TASK_COMPLETE_MESSAGE_FALLBACK
}

export const buildTaskCompleteNotificationPayload = ({ turnID, completionText, subtitle }) => ({
  id: String(turnID ?? ""),
  message: normalizeCompletionMessage(completionText),
  subtitle: String(subtitle ?? "")
})

const isObjectRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

const sanitizeFiniteNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : fallback
}

const normalizeFileCheckpoint = (filePath, candidate = null) => {
  const inputPath = typeof filePath === "string" ? filePath : String(filePath ?? "")
  if (!isObjectRecord(candidate)) {
    return {
      path: inputPath,
      inode: null,
      offset: 0,
      mtimeMs: 0
    }
  }

  const inode = sanitizeFiniteNumber(candidate.inode, null)
  return {
    path: typeof candidate.path === "string" && candidate.path ? candidate.path : inputPath,
    inode: inode === null ? null : Math.trunc(inode),
    offset: Math.max(0, Math.trunc(sanitizeFiniteNumber(candidate.offset, 0))),
    mtimeMs: Math.max(0, sanitizeFiniteNumber(candidate.mtimeMs, 0))
  }
}

const buildFileCheckpoint = (filePath, stat, offset) => ({
  path: filePath,
  inode: sanitizeFiniteNumber(stat?.ino, null),
  offset: Math.max(0, Math.trunc(sanitizeFiniteNumber(offset, 0))),
  mtimeMs: Math.max(0, sanitizeFiniteNumber(stat?.mtimeMs, 0))
})

const normalizeRecentTurnIds = (recentTurnIds) => {
  if (!Array.isArray(recentTurnIds)) return []
  const deduped = []
  const seen = new Set()
  for (const candidate of recentTurnIds) {
    const turnID = String(candidate ?? "")
    if (!turnID || seen.has(turnID)) continue
    seen.add(turnID)
    deduped.push(turnID)
  }
  return deduped
}

export const createCheckpointState = () => ({
  version: CHECKPOINT_STATE_VERSION,
  files: {},
  recentTurnIds: [],
  pendingNotification: null
})

const normalizePendingNotification = (pendingNotification) => {
  if (!isObjectRecord(pendingNotification)) return null

  const payload = buildBridgeNotifyPayload(pendingNotification.payload)
  if (!payload.id) return null

  const dueAtMs = Math.max(0, Math.trunc(sanitizeFiniteNumber(pendingNotification.dueAtMs, 0)))
  return {
    payload,
    dueAtMs,
    turnID: String(pendingNotification.turnID ?? payload.id ?? ""),
    filePath: typeof pendingNotification.filePath === "string" ? pendingNotification.filePath : ""
  }
}

export const normalizeCheckpointState = (state) => {
  if (!isObjectRecord(state)) return createCheckpointState()

  const normalizedFiles = {}
  const rawFiles = isObjectRecord(state.files) ? state.files : {}
  for (const [filePath, fileCheckpoint] of Object.entries(rawFiles)) {
    if (!filePath) continue
    normalizedFiles[filePath] = normalizeFileCheckpoint(filePath, fileCheckpoint)
  }

  return {
    version: CHECKPOINT_STATE_VERSION,
    files: normalizedFiles,
    recentTurnIds: normalizeRecentTurnIds(state.recentTurnIds),
    pendingNotification: normalizePendingNotification(state.pendingNotification)
  }
}

export const loadCheckpointState = async ({
  stateFilePath = WATCHER_STATE_FILE,
  fsPromises = fs
} = {}) => {
  try {
    const rawState = await fsPromises.readFile(stateFilePath, "utf8")
    return normalizeCheckpointState(JSON.parse(rawState))
  } catch (error) {
    if (error?.code === "ENOENT") return createCheckpointState()
    throw error
  }
}

export const writeCheckpointStateAtomic = async ({
  state,
  stateFilePath = WATCHER_STATE_FILE,
  fsPromises = fs
}) => {
  const normalizedState = normalizeCheckpointState(state)
  const stateDirectory = path.dirname(stateFilePath)
  const tempFilePath = `${stateFilePath}.${process.pid}.${Date.now()}.tmp`
  const serializedState = `${JSON.stringify(normalizedState, null, 2)}\n`

  await fsPromises.mkdir(stateDirectory, { recursive: true })
  await fsPromises.writeFile(tempFilePath, serializedState, "utf8")
  await fsPromises.rename(tempFilePath, stateFilePath)
}

const splitCompleteJsonlLines = (buffer) => {
  const newlineIndex = buffer.lastIndexOf(0x0a)
  if (newlineIndex < 0) {
    return {
      lines: [],
      consumedBytes: 0
    }
  }

  const completeChunk = buffer.subarray(0, newlineIndex + 1).toString("utf8")
  const lines = completeChunk.split("\n")
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()

  return {
    lines,
    consumedBytes: newlineIndex + 1
  }
}

const calculateTailOffset = ({ filePath, stat, checkpoint }) => {
  const normalizedCheckpoint = normalizeFileCheckpoint(filePath, checkpoint)
  const currentInode = sanitizeFiniteNumber(stat.ino, null)

  const checkpointPathChanged = normalizedCheckpoint.path !== filePath
  const checkpointMissingIdentity = normalizedCheckpoint.inode === null
  const inodeChanged = !checkpointMissingIdentity && normalizedCheckpoint.inode !== currentInode
  const checkpointAheadOfFile = normalizedCheckpoint.offset > stat.size

  const shouldRestartFromHead = checkpointPathChanged || inodeChanged || checkpointAheadOfFile
  return {
    didResetCheckpoint: shouldRestartFromHead,
    startOffset: shouldRestartFromHead ? 0 : normalizedCheckpoint.offset
  }
}

export const readJsonlTailFromCheckpoint = async ({
  filePath,
  checkpoint,
  fsPromises = fs
} = {}) => {
  try {
    const fileHandle = await fsPromises.open(filePath, "r")
    try {
      const stat = await fileHandle.stat()

      // First-seen files should start at EOF to avoid historical backfill.
      if (checkpoint === null || checkpoint === undefined) {
        return {
          lines: [],
          didResetCheckpoint: false,
          checkpoint: buildFileCheckpoint(filePath, stat, stat.size)
        }
      }

      const { didResetCheckpoint, startOffset } = calculateTailOffset({ filePath, stat, checkpoint })
      const unreadBytes = Math.max(0, stat.size - startOffset)

      if (unreadBytes === 0) {
        return {
          lines: [],
          didResetCheckpoint,
          checkpoint: buildFileCheckpoint(filePath, stat, startOffset)
        }
      }

      const unreadBuffer = Buffer.allocUnsafe(unreadBytes)
      const { bytesRead } = await fileHandle.read(unreadBuffer, 0, unreadBytes, startOffset)
      const payloadBuffer = bytesRead === unreadBytes ? unreadBuffer : unreadBuffer.subarray(0, bytesRead)

      const { lines, consumedBytes } = splitCompleteJsonlLines(payloadBuffer)
      const nextOffset = startOffset + consumedBytes

      return {
        lines,
        didResetCheckpoint,
        checkpoint: buildFileCheckpoint(filePath, stat, nextOffset)
      }
    } finally {
      await fileHandle.close()
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
    return {
      lines: [],
      didResetCheckpoint: true,
      checkpoint: normalizeFileCheckpoint(filePath)
    }
  }
}

export const parseTaskCompleteEvent = (line) => {
  if (typeof line !== "string") return null

  let parsed
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }

  if (!isObjectRecord(parsed) || parsed.type !== CODEX_EVENT_ENVELOPE_TYPE) return null

  const payload = parsed[CODEX_EVENT_PAYLOAD_KEY]
  if (!isObjectRecord(payload) || payload.type !== CODEX_TASK_COMPLETE_EVENT_TYPE) return null

  const turnID = typeof payload[CODEX_TASK_COMPLETE_TURN_ID_KEY] === "string"
    ? payload[CODEX_TASK_COMPLETE_TURN_ID_KEY].trim()
    : ""
  if (!turnID) return null

  return {
    turnID,
    completionText: normalizeCompletionMessage(payload[CODEX_TASK_COMPLETE_MESSAGE_KEY])
  }
}

const rememberTurnID = (state, turnID, turnIDWindowSize) => {
  if (!turnID) return
  const normalizedState = state
  const windowLimit = Math.max(1, Math.trunc(sanitizeFiniteNumber(turnIDWindowSize, TURN_ID_WINDOW_LIMIT)))
  const recentTurnIds = normalizeRecentTurnIds(normalizedState.recentTurnIds)

  if (recentTurnIds.includes(turnID)) {
    normalizedState.recentTurnIds = recentTurnIds
    return
  }

  recentTurnIds.push(turnID)
  while (recentTurnIds.length > windowLimit) recentTurnIds.shift()
  normalizedState.recentTurnIds = recentTurnIds
}

export const applyJsonlTailToState = ({
  state,
  filePath,
  lines,
  checkpoint,
  turnIDWindowSize = TURN_ID_WINDOW_LIMIT
}) => {
  const normalizedState = normalizeCheckpointState(state)
  const normalizedCheckpoint = normalizeFileCheckpoint(filePath, checkpoint)
  normalizedState.files[filePath] = normalizedCheckpoint

  const knownTurnIDs = new Set(normalizedState.recentTurnIds)
  const events = []

  for (const line of lines) {
    const event = parseTaskCompleteEvent(line)
    if (!event) continue

    const turnID = String(event.turnID ?? "")
    if (turnID && knownTurnIDs.has(turnID)) continue

    if (turnID) {
      rememberTurnID(normalizedState, turnID, turnIDWindowSize)
      knownTurnIDs.add(turnID)
    }

    events.push(event)
  }

  return {
    state: normalizedState,
    events
  }
}

export const tailFileTaskCompleteEvents = async ({
  filePath,
  state,
  fsPromises = fs,
  turnIDWindowSize = TURN_ID_WINDOW_LIMIT
}) => {
  const normalizedState = normalizeCheckpointState(state)
  const fileCheckpoint = normalizedState.files[filePath]
  const tailResult = await readJsonlTailFromCheckpoint({ filePath, checkpoint: fileCheckpoint, fsPromises })

  const appliedResult = applyJsonlTailToState({
    state: normalizedState,
    filePath,
    lines: tailResult.lines,
    checkpoint: tailResult.checkpoint,
    turnIDWindowSize
  })

  return {
    state: appliedResult.state,
    events: appliedResult.events,
    didResetCheckpoint: tailResult.didResetCheckpoint
  }
}

const toErrorMessage = (error) => {
  if (typeof error?.message === "string" && error.message) return error.message
  return String(error ?? "unknown error")
}

export const listSessionJsonlFiles = async ({
  sessionsRootPath = WATCHER_SESSIONS_ROOT,
  fsPromises = fs
} = {}) => {
  const discoveredFiles = []

  const walkDirectory = async (directoryPath) => {
    let entries
    try {
      entries = await fsPromises.readdir(directoryPath, { withFileTypes: true })
    } catch (error) {
      if (error?.code === "ENOENT") return
      throw error
    }

    for (const entry of entries) {
      const entryName = typeof entry?.name === "string" ? entry.name : ""
      if (!entryName || entryName === "." || entryName === "..") continue

      const entryPath = path.join(directoryPath, entryName)
      if (typeof entry?.isDirectory === "function" && entry.isDirectory()) {
        await walkDirectory(entryPath)
        continue
      }

      if (typeof entry?.isFile === "function" && entry.isFile() && entryName.endsWith(".jsonl")) {
        discoveredFiles.push(entryPath)
      }
    }
  }

  await walkDirectory(sessionsRootPath)
  discoveredFiles.sort((left, right) => left.localeCompare(right))
  return discoveredFiles
}

export const runWatcherCycle = async ({
  bridgeToken,
  sessionsRootPath = WATCHER_SESSIONS_ROOT,
  stateFilePath = WATCHER_STATE_FILE,
  subtitle = WATCHER_SUBTITLE,
  fsPromises = fs,
  loadState = loadCheckpointState,
  writeState = writeCheckpointStateAtomic,
  listFiles = listSessionJsonlFiles,
  tailFileEvents = tailFileTaskCompleteEvents,
  sendNotification = sendBridgeNotification,
  debounceMs = WATCHER_DEBOUNCE_DEFAULT_MS,
  nowMs = () => Date.now()
} = {}) => {
  if (typeof bridgeToken !== "string" || bridgeToken.trim() === "") {
    const configError = new Error(`missing required ${WATCHER_TOKEN_ENV_KEY}`)
    configError.code = "WATCHER_CONFIG"
    throw configError
  }

  const cycleResult = {
    scannedFiles: 0,
    emittedEvents: 0,
    deliveredNotifications: 0,
    droppedNotifications: 0,
    errors: []
  }
  const normalizedDebounceMs = Math.max(0, Math.trunc(sanitizeFiniteNumber(debounceMs, WATCHER_DEBOUNCE_DEFAULT_MS)))
  const debounceEnabled = normalizedDebounceMs > 0

  let state = createCheckpointState()
  try {
    state = await loadState({ stateFilePath, fsPromises })
  } catch (error) {
    cycleResult.errors.push({
      kind: "checkpoint_load",
      message: toErrorMessage(error)
    })
  }

  let sessionFiles = []
  try {
    sessionFiles = await listFiles({ sessionsRootPath, fsPromises })
  } catch (error) {
    cycleResult.errors.push({
      kind: "session_enumeration",
      message: toErrorMessage(error)
    })
  }

  const stableSessionFiles = [...sessionFiles].sort((left, right) => left.localeCompare(right))
  cycleResult.scannedFiles = stableSessionFiles.length

  let latestDebounceCandidate = null

  for (const filePath of stableSessionFiles) {
    try {
      const tailResult = await tailFileEvents({
        filePath,
        state,
        fsPromises
      })
      state = tailResult.state

      for (const event of tailResult.events) {
        cycleResult.emittedEvents += 1

        const payload = buildTaskCompleteNotificationPayload({
          turnID: event.turnID,
          completionText: event.completionText,
          subtitle
        })

        if (debounceEnabled) {
          latestDebounceCandidate = {
            payload,
            filePath,
            turnID: event.turnID
          }
          continue
        }

        try {
          const notifyResult = await sendNotification({ payload, bridgeToken })
          if (notifyResult?.ok === true) {
            cycleResult.deliveredNotifications += 1
          } else {
            cycleResult.droppedNotifications += 1
            cycleResult.errors.push({
              kind: "bridge_delivery",
              filePath,
              turnID: event.turnID,
              message: toErrorMessage(notifyResult?.error?.reason || "bridge delivery failed")
            })
          }
        } catch (error) {
          cycleResult.droppedNotifications += 1
          cycleResult.errors.push({
            kind: "bridge_delivery",
            filePath,
            turnID: event.turnID,
            message: toErrorMessage(error)
          })
        }
      }
    } catch (error) {
      cycleResult.errors.push({
        kind: "file_processing",
        filePath,
        message: toErrorMessage(error)
      })
    }
  }

  if (debounceEnabled) {
    const currentMs = Math.max(0, Math.trunc(sanitizeFiniteNumber(nowMs?.(), Date.now())))

    if (latestDebounceCandidate !== null) {
      state.pendingNotification = {
        payload: latestDebounceCandidate.payload,
        dueAtMs: currentMs + normalizedDebounceMs,
        turnID: latestDebounceCandidate.turnID,
        filePath: latestDebounceCandidate.filePath
      }
    } else {
      const pendingNotification = normalizePendingNotification(state.pendingNotification)
      if (pendingNotification !== null && pendingNotification.dueAtMs <= currentMs) {
        try {
          const notifyResult = await sendNotification({ payload: pendingNotification.payload, bridgeToken })
          if (notifyResult?.ok === true) {
            cycleResult.deliveredNotifications += 1
            state.pendingNotification = null
          } else {
            cycleResult.droppedNotifications += 1
            cycleResult.errors.push({
              kind: "bridge_delivery",
              filePath: pendingNotification.filePath,
              turnID: pendingNotification.turnID,
              message: toErrorMessage(notifyResult?.error?.reason || "bridge delivery failed")
            })
            state.pendingNotification = null
          }
        } catch (error) {
          cycleResult.droppedNotifications += 1
          cycleResult.errors.push({
            kind: "bridge_delivery",
            filePath: pendingNotification.filePath,
            turnID: pendingNotification.turnID,
            message: toErrorMessage(error)
          })
          state.pendingNotification = null
        }
      }
    }
  } else {
    state.pendingNotification = null
  }

  try {
    await writeState({ state, stateFilePath, fsPromises })
  } catch (error) {
    cycleResult.errors.push({
      kind: "checkpoint_write",
      message: toErrorMessage(error)
    })
  }

  return cycleResult
}

export const runWatcherLoop = async ({
  intervalMs = WATCHER_LOOP_INTERVAL_MS,
  maxCycles = Number.POSITIVE_INFINITY,
  signal = null,
  cycleOptions = {},
  runCycle = runWatcherCycle,
  sleepImpl = (durationMs) => sleepWithTimer(durationMs),
  onCycleResult = null,
  onCycleError = null
} = {}) => {
  const normalizedIntervalMs = Math.max(0, Math.trunc(sanitizeFiniteNumber(intervalMs, WATCHER_LOOP_INTERVAL_MS)))
  const normalizedMaxCycles = Number.isFinite(maxCycles)
    ? Math.max(0, Math.trunc(maxCycles))
    : Number.POSITIVE_INFINITY

  let cycles = 0
  while (cycles < normalizedMaxCycles) {
    if (signal?.aborted === true) break

    try {
      const cycleResult = await runCycle(cycleOptions)
      if (typeof onCycleResult === "function") await onCycleResult(cycleResult)
    } catch (error) {
      if (typeof onCycleError === "function") await onCycleError(error)
    }

    cycles += 1
    if (cycles >= normalizedMaxCycles) break
    if (signal?.aborted === true) break
    await sleepImpl(normalizedIntervalMs)
  }

  return { cycles }
}

export const resolveWatcherConfigFromEnv = ({ env = process.env } = {}) => {
  const bridgeToken = typeof env?.[WATCHER_TOKEN_ENV_KEY] === "string"
    ? env[WATCHER_TOKEN_ENV_KEY].trim()
    : ""
  if (!bridgeToken) {
    return {
      ok: false,
      exitCode: WATCHER_CONFIG_EXIT_CODE,
      error: `missing required ${WATCHER_TOKEN_ENV_KEY}`
    }
  }

  const intervalMs = Math.max(1, Math.trunc(sanitizeFiniteNumber(env?.[WATCHER_INTERVAL_ENV_KEY], WATCHER_LOOP_INTERVAL_MS)))
  const debounceMs = Math.max(0, Math.trunc(sanitizeFiniteNumber(env?.[WATCHER_DEBOUNCE_ENV_KEY], WATCHER_DEBOUNCE_DEFAULT_MS)))
  return {
    ok: true,
    config: {
      bridgeToken,
      intervalMs,
      debounceMs,
      sessionsRootPath: WATCHER_SESSIONS_ROOT,
      stateFilePath: WATCHER_STATE_FILE,
      subtitle: WATCHER_SUBTITLE
    }
  }
}

const WATCHER_USAGE = [
  "Usage: codex-completion-watcher [--once] [--help]",
  "",
  "Required environment:",
  `  ${WATCHER_TOKEN_ENV_KEY}=<bridge-token>`,
  "",
  "Optional environment:",
  `  ${WATCHER_INTERVAL_ENV_KEY}=1500`,
  `  ${WATCHER_DEBOUNCE_ENV_KEY}=3000`
].join("\n")

export const runWatcherCli = async ({
  argv = process.argv.slice(2),
  env = process.env,
  log = console.log,
  errorLog = console.error
} = {}) => {
  if (argv.includes("--help") || argv.includes("-h")) {
    log(WATCHER_USAGE)
    return 0
  }

  const runOnce = argv.includes("--once")
  const resolvedConfig = resolveWatcherConfigFromEnv({ env })
  if (!resolvedConfig.ok) {
    errorLog(resolvedConfig.error)
    return resolvedConfig.exitCode
  }

  try {
    const cycleOptions = {
      bridgeToken: resolvedConfig.config.bridgeToken,
      sessionsRootPath: resolvedConfig.config.sessionsRootPath,
      stateFilePath: resolvedConfig.config.stateFilePath,
      subtitle: resolvedConfig.config.subtitle,
      debounceMs: resolvedConfig.config.debounceMs
    }

    if (runOnce) {
      await runWatcherCycle(cycleOptions)
      return 0
    }

    await runWatcherLoop({
      intervalMs: resolvedConfig.config.intervalMs,
      cycleOptions
    })
    return 0
  } catch (error) {
    errorLog(`watcher runtime error (continuing): ${toErrorMessage(error)}`)
    return 0
  }
}

const isDirectExecution = (() => {
  const entryPoint = typeof process.argv[1] === "string" ? path.resolve(process.argv[1]) : ""
  if (!entryPoint) return false
  return entryPoint === fileURLToPath(import.meta.url)
})()

if (isDirectExecution) {
  runWatcherCli().then((exitCode) => {
    if (exitCode !== 0) process.exitCode = exitCode
  }).catch((error) => {
    console.error(`watcher runtime error (continuing): ${toErrorMessage(error)}`)
    process.exitCode = 0
  })
}
