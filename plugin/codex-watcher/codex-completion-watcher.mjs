import os from "node:os"
import path from "node:path"
import { promises as fs } from "node:fs"
import { execFile as execFileCallback } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

export const CODEX_EVENT_ENVELOPE_TYPE = "event_msg"
export const CODEX_EVENT_PAYLOAD_KEY = "payload"
export const CODEX_TASK_COMPLETE_EVENT_TYPE = "task_complete"
export const CODEX_TASK_COMPLETE_TURN_ID_KEY = "turn_id"
export const CODEX_TASK_COMPLETE_MESSAGE_KEY = "last_agent_message"

export const NOTIFIER_BINARY_NAME = "terminal-notifier"
export const NOTIFIER_GROUP = "codex-task-complete"
export const NOTIFIER_TITLE = "Codex"
export const NOTIFIER_SOUND = "default"

export const NOTIFICATION_PAYLOAD_ID_KEY = "id"
export const NOTIFICATION_PAYLOAD_MESSAGE_KEY = "message"
export const NOTIFICATION_PAYLOAD_SUBTITLE_KEY = "subtitle"

export const TASK_COMPLETE_MESSAGE_FALLBACK = "Codex：任务已完成"
export const TASK_COMPLETE_MESSAGE_MAX_LENGTH = 200
const TASK_COMPLETE_MESSAGE_TRUNCATION_SUFFIX = "..."
export const WATCHER_STATE_DIR = path.join(os.homedir(), ".local", "state", "codex-notify-watcher")
export const WATCHER_STATE_FILE = path.join(WATCHER_STATE_DIR, "state.json")
export const CHECKPOINT_STATE_VERSION = 1
export const TURN_ID_WINDOW_LIMIT = 128
export const WATCHER_SESSIONS_ROOT = path.join(os.homedir(), ".codex", "sessions")
export const WATCHER_LOOP_INTERVAL_MS = 1500
export const WATCHER_INTERVAL_ENV_KEY = "CODEX_NOTIFY_INTERVAL_MS"
export const WATCHER_DEBOUNCE_ENV_KEY = "CODEX_NOTIFY_DEBOUNCE_MS"
export const WATCHER_DEBOUNCE_DEFAULT_MS = 3000
export const WATCHER_SUBTITLE = "Codex 任务完成"
export const WATCHER_REPAIR_COMMAND = "brew install terminal-notifier"
const WATCHER_SUBTITLE_SEPARATOR = " · "
const SESSION_META_FILE_HEAD_MAX_BYTES = 8192

const WATCHER_CONFIG_EXIT_CODE = 2
const WATCHER_MISSING_NOTIFIER_ERROR = `missing required ${NOTIFIER_BINARY_NAME}. Install it with: ${WATCHER_REPAIR_COMMAND}`
const execFile = promisify(execFileCallback)

const sleepWithTimer = (durationMs, setTimeoutImpl = setTimeout) => new Promise((resolve) => {
  setTimeoutImpl(resolve, Math.max(0, Math.trunc(sanitizeFiniteNumber(durationMs, 0))))
})

const buildNotificationPayload = (payload) => ({
  [NOTIFICATION_PAYLOAD_ID_KEY]: String(payload?.[NOTIFICATION_PAYLOAD_ID_KEY] ?? ""),
  [NOTIFICATION_PAYLOAD_MESSAGE_KEY]: String(payload?.[NOTIFICATION_PAYLOAD_MESSAGE_KEY] ?? ""),
  [NOTIFICATION_PAYLOAD_SUBTITLE_KEY]: String(payload?.[NOTIFICATION_PAYLOAD_SUBTITLE_KEY] ?? "")
})

const buildNotificationError = (reason) => ({
  reason: String(reason ?? "terminal-notifier failed")
})

export const getTerminalNotifierArguments = ({
  payload,
  title = NOTIFIER_TITLE,
  group = NOTIFIER_GROUP,
  sound = NOTIFIER_SOUND
} = {}) => {
  const normalizedPayload = buildNotificationPayload(payload)
  return [
    "-title", String(title),
    "-subtitle", normalizedPayload[NOTIFICATION_PAYLOAD_SUBTITLE_KEY],
    "-message", normalizedPayload[NOTIFICATION_PAYLOAD_MESSAGE_KEY],
    "-group", String(group),
    "-sound", String(sound)
  ]
}

export const resolveTerminalNotifierCommand = async ({
  notifierBinary = NOTIFIER_BINARY_NAME,
  execFileImpl = execFile
} = {}) => {
  try {
    const result = await execFileImpl("/usr/bin/which", [String(notifierBinary)])
    const commandPath = typeof result?.stdout === "string" ? result.stdout.trim() : ""
    if (!commandPath) {
      return {
        ok: false,
        exitCode: WATCHER_CONFIG_EXIT_CODE,
        error: WATCHER_MISSING_NOTIFIER_ERROR
      }
    }

    return {
      ok: true,
      command: commandPath
    }
  } catch {
    return {
      ok: false,
      exitCode: WATCHER_CONFIG_EXIT_CODE,
      error: WATCHER_MISSING_NOTIFIER_ERROR
    }
  }
}

export const sendTerminalNotification = async ({
  payload,
  notifierCommand = NOTIFIER_BINARY_NAME,
  execFileImpl = execFile
} = {}) => {
  const normalizedPayload = buildNotificationPayload(payload)

  try {
    await execFileImpl(String(notifierCommand), getTerminalNotifierArguments({ payload: normalizedPayload }))
    return {
      ok: true,
      command: String(notifierCommand),
      payload: normalizedPayload
    }
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : ""
    const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : ""
    const errorMessage = error?.code === "ENOENT"
      ? WATCHER_MISSING_NOTIFIER_ERROR
      : stderr || stdout || error?.message || "terminal-notifier failed"

    return {
      ok: false,
      error: buildNotificationError(errorMessage)
    }
  }
}

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

const normalizeTaskSummaryHint = (userMessage) => {
  if (typeof userMessage !== "string") return ""
  const normalized = userMessage.replace(/\s+/g, " ").trim()
  if (!normalized) return ""
  if (normalized.length <= TASK_COMPLETE_MESSAGE_MAX_LENGTH) return normalized
  const suffixLength = TASK_COMPLETE_MESSAGE_TRUNCATION_SUFFIX.length
  const maxTextLength = Math.max(1, TASK_COMPLETE_MESSAGE_MAX_LENGTH - suffixLength)
  const truncated = normalized.slice(0, maxTextLength).trimEnd()
  return truncated ? `${truncated}${TASK_COMPLETE_MESSAGE_TRUNCATION_SUFFIX}` : ""
}

const resolveSubtitleWithCwdBasename = ({ subtitle, cwd }) => {
  const normalizedSubtitle = String(subtitle ?? "")
  if (typeof cwd !== "string") return normalizedSubtitle
  const normalizedCwd = cwd.trim()
  if (!normalizedCwd) return normalizedSubtitle
  const cwdBasename = path.basename(normalizedCwd) || normalizedCwd
  if (!cwdBasename) return normalizedSubtitle
  return `${normalizedSubtitle}${WATCHER_SUBTITLE_SEPARATOR}${cwdBasename}`
}

export const buildTaskCompleteNotificationPayload = ({ turnID, completionText, subtitle }) => ({
  [NOTIFICATION_PAYLOAD_ID_KEY]: String(turnID ?? ""),
  [NOTIFICATION_PAYLOAD_MESSAGE_KEY]: normalizeCompletionMessage(completionText),
  [NOTIFICATION_PAYLOAD_SUBTITLE_KEY]: String(subtitle ?? "")
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
  fileSessionCwds: {},
  pendingNotification: null
})

const normalizeFileSessionCwds = (fileSessionCwds) => {
  if (!isObjectRecord(fileSessionCwds)) return {}

  const normalized = {}
  for (const [filePath, cwd] of Object.entries(fileSessionCwds)) {
    if (!filePath || typeof cwd !== "string") continue
    const normalizedCwd = cwd.trim()
    if (!normalizedCwd) continue
    normalized[filePath] = normalizedCwd
  }

  return normalized
}

const normalizePendingNotification = (pendingNotification) => {
  if (!isObjectRecord(pendingNotification)) return null

  const payload = buildNotificationPayload(pendingNotification.payload)
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
    fileSessionCwds: normalizeFileSessionCwds(state.fileSessionCwds),
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

const parseJsonlLineRecord = (line) => {
  if (typeof line !== "string") return null
  try {
    const parsed = JSON.parse(line)
    return isObjectRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

const extractSessionMetaCwdFromChunk = (chunkText) => {
  if (typeof chunkText !== "string" || chunkText.length === 0) return ""
  const normalizedChunk = chunkText.replace(/^\uFEFF/, "")

  const candidateLines = normalizedChunk.split("\n")
  for (const line of candidateLines) {
    if (typeof line !== "string" || !line.trim()) continue

    const parsedLine = parseJsonlLineRecord(line)
    if (parsedLine?.type === "session_meta" && isObjectRecord(parsedLine.payload)) {
      const parsedCwd = typeof parsedLine.payload.cwd === "string"
        ? parsedLine.payload.cwd.trim()
        : ""
      if (parsedCwd) return parsedCwd
    }

    if (!/"type"\s*:\s*"session_meta"/.test(line)) continue

    const cwdMatch = line.match(/"cwd"\s*:\s*"((?:\\.|[^"\\])*)"/)
    if (!cwdMatch) continue

    try {
      const decoded = JSON.parse(`"${cwdMatch[1]}"`)
      if (typeof decoded === "string" && decoded.trim()) return decoded.trim()
    } catch {
      continue
    }
  }

  return ""
}

export const readSessionMetaCwdFromFileHead = async ({
  filePath,
  fsPromises = fs,
  maxBytes = SESSION_META_FILE_HEAD_MAX_BYTES
} = {}) => {
  if (typeof filePath !== "string" || !filePath.trim()) return ""

  try {
    const fileHandle = await fsPromises.open(filePath, "r")
    try {
      const stat = await fileHandle.stat()
      const boundedMaxBytes = Math.max(1, Math.trunc(sanitizeFiniteNumber(maxBytes, SESSION_META_FILE_HEAD_MAX_BYTES)))
      const bytesToRead = Math.max(0, Math.min(stat.size, boundedMaxBytes))
      if (bytesToRead === 0) return ""

      const headBuffer = Buffer.allocUnsafe(bytesToRead)
      const { bytesRead } = await fileHandle.read(headBuffer, 0, bytesToRead, 0)
      if (bytesRead <= 0) return ""

      const chunkText = headBuffer.subarray(0, bytesRead).toString("utf8")
      return extractSessionMetaCwdFromChunk(chunkText)
    } finally {
      await fileHandle.close()
    }
  } catch (error) {
    if (error?.code === "ENOENT") return ""
    throw error
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
  let sessionCwd = typeof normalizedState.fileSessionCwds[filePath] === "string"
    ? normalizedState.fileSessionCwds[filePath]
    : ""
  let latestTaskStartedTurnID = ""
  const userMessageByTurnID = new Map()
  const turnCwdByTurnID = new Map()

  for (const line of lines) {
    const parsedLine = parseJsonlLineRecord(line)
    const lineType = parsedLine?.type
    const linePayload = parsedLine?.payload

    if (lineType === "session_meta" && isObjectRecord(linePayload)) {
      const cwd = typeof linePayload.cwd === "string" ? linePayload.cwd.trim() : ""
      if (cwd) sessionCwd = cwd
    }

    if (lineType === "turn_context" && isObjectRecord(linePayload)) {
      const turnID = typeof linePayload.turn_id === "string" ? linePayload.turn_id.trim() : ""
      const cwd = typeof linePayload.cwd === "string" ? linePayload.cwd.trim() : ""
      if (turnID && cwd) turnCwdByTurnID.set(turnID, cwd)
    }

    if (lineType === CODEX_EVENT_ENVELOPE_TYPE && isObjectRecord(linePayload)) {
      if (linePayload.type === "task_started") {
        latestTaskStartedTurnID = typeof linePayload.turn_id === "string" ? linePayload.turn_id.trim() : ""
      }

      if (linePayload.type === "user_message") {
        const normalizedTaskSummary = normalizeTaskSummaryHint(linePayload.message)
        if (latestTaskStartedTurnID && normalizedTaskSummary) {
          userMessageByTurnID.set(latestTaskStartedTurnID, normalizedTaskSummary)
        }
      }
    }

    const event = parseTaskCompleteEvent(line)
    if (!event) continue

    const turnID = String(event.turnID ?? "")
    if (turnID && knownTurnIDs.has(turnID)) continue

    if (turnID) {
      rememberTurnID(normalizedState, turnID, turnIDWindowSize)
      knownTurnIDs.add(turnID)
    }

    const turnIDCwd = turnCwdByTurnID.get(turnID) || ""
    const taskSummary = userMessageByTurnID.get(turnID) || ""

    events.push({
      ...event,
      cwd: turnIDCwd || sessionCwd || "",
      taskSummary
    })
  }

  if (sessionCwd) {
    normalizedState.fileSessionCwds[filePath] = sessionCwd
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

  if (tailResult.didResetCheckpoint === true) {
    delete normalizedState.fileSessionCwds[filePath]
  }

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
  sessionsRootPath = WATCHER_SESSIONS_ROOT,
  stateFilePath = WATCHER_STATE_FILE,
  subtitle = WATCHER_SUBTITLE,
  fsPromises = fs,
  loadState = loadCheckpointState,
  writeState = writeCheckpointStateAtomic,
  listFiles = listSessionJsonlFiles,
  tailFileEvents = tailFileTaskCompleteEvents,
  readSessionMetaCwd = readSessionMetaCwdFromFileHead,
  sendNotification = sendTerminalNotification,
  notifierCommand = NOTIFIER_BINARY_NAME,
  debounceMs = WATCHER_DEBOUNCE_DEFAULT_MS,
  nowMs = () => Date.now()
} = {}) => {
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
      state = normalizeCheckpointState(tailResult.state)

      if (tailResult.didResetCheckpoint === true) {
        delete state.fileSessionCwds[filePath]
      }

      let sessionCwdFallback = typeof state.fileSessionCwds[filePath] === "string"
        ? state.fileSessionCwds[filePath]
        : ""

      const hasMissingEventCwd = tailResult.events.some((event) => {
        const eventCwd = typeof event?.cwd === "string" ? event.cwd.trim() : ""
        return !eventCwd
      })

      if (!sessionCwdFallback && hasMissingEventCwd) {
        try {
          const inferredCwd = await readSessionMetaCwd({ filePath, fsPromises })
          if (typeof inferredCwd === "string" && inferredCwd.trim()) {
            sessionCwdFallback = inferredCwd.trim()
            state.fileSessionCwds[filePath] = sessionCwdFallback
          }
        } catch (error) {
          cycleResult.errors.push({
            kind: "session_context_read",
            filePath,
            message: toErrorMessage(error)
          })
        }
      }

      for (const event of tailResult.events) {
        cycleResult.emittedEvents += 1

        const eventCwd = typeof event.cwd === "string" ? event.cwd.trim() : ""
        const resolvedEventCwd = eventCwd || sessionCwdFallback

        if (resolvedEventCwd && !sessionCwdFallback) {
          sessionCwdFallback = resolvedEventCwd
          state.fileSessionCwds[filePath] = resolvedEventCwd
        }

        const payload = buildTaskCompleteNotificationPayload({
          turnID: event.turnID,
          completionText: event.taskSummary || event.completionText,
          subtitle: resolveSubtitleWithCwdBasename({ subtitle, cwd: resolvedEventCwd })
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
          const notifyResult = await sendNotification({ payload, notifierCommand })
          if (notifyResult?.ok === true) {
            cycleResult.deliveredNotifications += 1
          } else {
            cycleResult.droppedNotifications += 1
            cycleResult.errors.push({
              kind: "notification_delivery",
              filePath,
              turnID: event.turnID,
              message: toErrorMessage(notifyResult?.error?.reason || "notification delivery failed")
            })
          }
        } catch (error) {
          cycleResult.droppedNotifications += 1
          cycleResult.errors.push({
            kind: "notification_delivery",
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
          const notifyResult = await sendNotification({ payload: pendingNotification.payload, notifierCommand })
          if (notifyResult?.ok === true) {
            cycleResult.deliveredNotifications += 1
            state.pendingNotification = null
          } else {
            cycleResult.droppedNotifications += 1
            cycleResult.errors.push({
              kind: "notification_delivery",
              filePath: pendingNotification.filePath,
              turnID: pendingNotification.turnID,
              message: toErrorMessage(notifyResult?.error?.reason || "notification delivery failed")
            })
            state.pendingNotification = null
          }
        } catch (error) {
          cycleResult.droppedNotifications += 1
          cycleResult.errors.push({
            kind: "notification_delivery",
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
  const intervalMs = Math.max(1, Math.trunc(sanitizeFiniteNumber(env?.[WATCHER_INTERVAL_ENV_KEY], WATCHER_LOOP_INTERVAL_MS)))
  const debounceMs = Math.max(0, Math.trunc(sanitizeFiniteNumber(env?.[WATCHER_DEBOUNCE_ENV_KEY], WATCHER_DEBOUNCE_DEFAULT_MS)))
  return {
    ok: true,
    config: {
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
  "Optional environment:",
  `  ${WATCHER_INTERVAL_ENV_KEY}=1500`,
  `  ${WATCHER_DEBOUNCE_ENV_KEY}=3000`,
  "",
  `Missing ${NOTIFIER_BINARY_NAME}? Run: ${WATCHER_REPAIR_COMMAND}`
].join("\n")

export const runWatcherCli = async ({
  argv = process.argv.slice(2),
  env = process.env,
  log = console.log,
  errorLog = console.error,
  resolveNotifierCommand = resolveTerminalNotifierCommand
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

  const resolvedNotifier = await resolveNotifierCommand()
  if (!resolvedNotifier.ok) {
    errorLog(resolvedNotifier.error)
    return resolvedNotifier.exitCode
  }

  try {
    const cycleOptions = {
      sessionsRootPath: resolvedConfig.config.sessionsRootPath,
      stateFilePath: resolvedConfig.config.stateFilePath,
      subtitle: resolvedConfig.config.subtitle,
      debounceMs: resolvedConfig.config.debounceMs,
      notifierCommand: resolvedNotifier.command
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
