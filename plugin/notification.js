const APP_TITLE = "OpenCode"
const IDLE_CONFIRMATION_DELAY_MS = 800
const BRIDGE_NOTIFY_BASE_URL = "http://127.0.0.1:17342"
const BRIDGE_NOTIFY_PATH = "/opencode/notify"
const BRIDGE_REQUEST_TIMEOUT_MS = 150
const BRIDGE_TOKEN_HEADER = "x-opencode-token"
const DECISION_LOG_PREFIX = "[NotificationPlugin][decision]"
const DECISION_REASON_IDLE_EVENT = "idle-event"
const DECISION_REASON_TIMER_CONFIRM = "timer-confirm"
const NOTIFICATION_SOUND_NAME = "Pop"
const NOTIFICATION_AUTO_DISMISS_SECONDS = "1"
const ROOT_STATE_UNKNOWN = "unknown"
const ERROR_LOG_PREFIX = "[NotificationPlugin][error]"
const NOTIFICATION_DEBUG_FLAG = (process.env.OPENCODE_NOTIFICATION_DEBUG || "").trim().toLowerCase()
const NOTIFICATION_DECISION_LOG_ENABLED = ["1", "true", "yes", "on"].includes(NOTIFICATION_DEBUG_FLAG)
const SESSION_OUTCOME_COMPLETED = "completed"
const SESSION_OUTCOME_INTERRUPTED = "interrupted"
const SESSION_OUTCOME_ERROR = "error"
const INTERRUPT_ERROR_NAME = "MessageAbortedError"
const INTERRUPT_COMMAND_NAMES = new Set(["session.interrupt", "session.abort"])
const BRIDGE_DISABLE_REASON_MISSING_TOKEN = "missing-token"
const HAMMERSPOON_APP_NAME = "Hammerspoon"
const HAMMERSPOON_BOOT_DELAY_MS = 350
const BOOLEAN_TRUE_VALUES = new Set(["1", "true", "yes", "on"])
const BOOLEAN_FALSE_VALUES = new Set(["0", "false", "no", "off"])
const TASK_SUMMARY_MAX_CHARS = 26
const IDLE_ELIGIBILITY_ELIGIBLE = "eligible"
const IDLE_ELIGIBILITY_SUPPRESSED_CHILD = "suppressed-child"
const IDLE_ELIGIBILITY_DEDUPED = "deduped"
const IDLE_ELIGIBILITY_UNKNOWN_ROOT = "unknown-root"

const debugLog = (...args) => {
  if (!NOTIFICATION_DECISION_LOG_ENABLED) return
  console.log(...args)
}

const debugWarn = (...args) => {
  if (!NOTIFICATION_DECISION_LOG_ENABLED) return
  console.warn(...args)
}

const logError = (code, { sessionID, reason } = {}) => {
  const details = [`code=${code}`]
  if (sessionID) details.push(`sessionID=${sessionID}`)
  if (reason) details.push(`reason=${reason}`)
  console.error(`${ERROR_LOG_PREFIX} ${details.join(" ")}`)
}

const escapeAppleScriptString = (value) => String(value)
  .replace(/\\/g, "\\\\")
  .replace(/"/g, '\\"')

const getFolderName = (pathLike = "") => {
  const normalized = pathLike.replace(/\/+$/, "")
  if (!normalized) return ""
  const segments = normalized.split("/").filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1] : ""
}

const getProjectLabel = ({ project, worktree, directory }) => {
  const explicitName = project?.name?.trim()
  if (explicitName) return explicitName

  const folderName = getFolderName(project?.worktree || worktree || directory || "")
  if (folderName) return folderName

  return project?.id || "当前项目"
}

const sendByTerminalNotifier = async ({ $, message, subtitle }) => {
  try {
    await $`command -v terminal-notifier`.quiet()
  } catch {
    return false
  }

  try {
    await $`terminal-notifier -title ${APP_TITLE} -message ${message} -subtitle ${subtitle} -sound ${NOTIFICATION_SOUND_NAME} -timeout ${NOTIFICATION_AUTO_DISMISS_SECONDS} -group opencode-session-idle`.quiet()
    return true
  } catch (err) {
    debugWarn("[NotificationPlugin] terminal-notifier 发送失败，降级到 osascript：", err)
    return false
  }
}

const sendByOsaScript = async ({ $, message, subtitle }) => {
  const escapedMessage = escapeAppleScriptString(message)
  const escapedSubtitle = escapeAppleScriptString(subtitle)
  const script = `display notification \"${escapedMessage}\" with title \"${APP_TITLE}\" subtitle \"${escapedSubtitle}\" sound name \"${NOTIFICATION_SOUND_NAME}\"`
  await $`osascript -e ${script}`.quiet()
}

const sendMacNotification = async ({ $, message, subtitle }) => {
  const sent = await sendByTerminalNotifier({ $, message, subtitle })
  if (sent) return
  await sendByOsaScript({ $, message, subtitle })
}

const logDecision = (marker, { sessionID, reason } = {}) => {
  if (!NOTIFICATION_DECISION_LOG_ENABLED) return
  const details = []
  if (sessionID) details.push(`sessionID=${sessionID}`)
  if (reason) details.push(`reason=${reason}`)
  const suffix = details.length > 0 ? ` ${details.join(" ")}` : ""
  debugLog(`${DECISION_LOG_PREFIX} marker=${marker}${suffix}`)
}

const getIdleEligibility = (sessionState) => {
  if (sessionState.isRoot === false) return IDLE_ELIGIBILITY_SUPPRESSED_CHILD
  if (sessionState.notifiedSinceBusy) return IDLE_ELIGIBILITY_DEDUPED
  if (sessionState.isRoot !== true) return IDLE_ELIGIBILITY_UNKNOWN_ROOT
  return IDLE_ELIGIBILITY_ELIGIBLE
}

const handleIdleSkip = ({ eligibility, sessionState, sessionID, reason, clearTimer, clearPending }) => {
  if (eligibility === IDLE_ELIGIBILITY_ELIGIBLE) return false
  if (clearTimer && typeof clearPending === "function") clearPending(sessionState)
  if (eligibility === IDLE_ELIGIBILITY_SUPPRESSED_CHILD || eligibility === IDLE_ELIGIBILITY_DEDUPED) {
    logDecision(eligibility, { sessionID, reason })
  }
  return true
}

const resolveBridgeToken = ({ bridgeToken, notifyToken, token }) => {
  const explicit = [bridgeToken, notifyToken, token]
    .find((value) => typeof value === "string" && value.trim())
  if (explicit) return explicit.trim()

  const envToken = process.env.OPENCODE_NOTIFY_TOKEN
  if (typeof envToken === "string" && envToken.trim()) return envToken.trim()

  return ""
}

const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs))

const resolveBoolean = (value, fallback) => {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (BOOLEAN_TRUE_VALUES.has(normalized)) return true
    if (BOOLEAN_FALSE_VALUES.has(normalized)) return false
  }
  return fallback
}

const resolveAutoStartDefault = () => {
  const flag = (process.env.OPENCODE_NOTIFY_AUTOSTART_HAMMERSPOON || "").trim().toLowerCase()
  if (!flag) return true
  if (BOOLEAN_FALSE_VALUES.has(flag)) return false
  if (BOOLEAN_TRUE_VALUES.has(flag)) return true
  return true
}

const normalizeTaskSummary = (value) => {
  if (typeof value !== "string") return ""
  const compact = value.replace(/\s+/g, " ").trim()
  if (!compact) return ""
  if (compact.length <= TASK_SUMMARY_MAX_CHARS) return compact
  return `${compact.slice(0, TASK_SUMMARY_MAX_CHARS)}…`
}

const resolveNetworkErrorReason = (err) => {
  const networkCode = err?.cause?.code || err?.code
  if (typeof networkCode !== "string") return "network-error"
  const normalized = networkCode.trim().toLowerCase()
  return normalized ? `network-${normalized}` : "network-error"
}

const getIdleMessageByOutcome = (sessionState) => {
  const taskSummary = sessionState?.lastTaskSummary || "当前任务"
  if (sessionState?.lastOutcome === SESSION_OUTCOME_INTERRUPTED) {
    return `已中断：${taskSummary}`
  }
  if (sessionState?.lastOutcome === SESSION_OUTCOME_ERROR) {
    return `异常结束：${taskSummary}`
  }
  return `已完成：${taskSummary}`
}

const sendByBridge = async ({ message, subtitle, sessionID, projectLabel, bridgeToken }) => {
  if (typeof fetch !== "function") {
    return { ok: false, error: false, reason: "fetch-unavailable" }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, BRIDGE_REQUEST_TIMEOUT_MS)

  try {
    const headers = {
      "content-type": "application/json"
    }
    if (bridgeToken) headers[BRIDGE_TOKEN_HEADER] = bridgeToken

    const response = await fetch(`${BRIDGE_NOTIFY_BASE_URL}${BRIDGE_NOTIFY_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message,
        subtitle,
        sessionID,
        projectLabel,
        createdAtMs: Date.now()
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      return { ok: false, error: false, reason: "non-2xx" }
    }

    let payload
    try {
      payload = await response.json()
    } catch {
      return { ok: false, error: false, reason: "invalid-json" }
    }

    if (payload?.ok !== true) {
      return { ok: false, error: false, reason: "ok-not-true" }
    }

    if (typeof payload?.id !== "string" || payload.id.trim().length === 0) {
      return { ok: false, error: false, reason: "missing-id" }
    }

    return { ok: true, error: false, reason: "ok" }
  } catch (err) {
    if (err?.name === "AbortError") {
      return { ok: false, error: true, reason: "timeout" }
    }
    return { ok: false, error: true, reason: resolveNetworkErrorReason(err) }
  } finally {
    clearTimeout(timeout)
  }
}

export const NotificationPlugin = async ({
  $,
  project,
  worktree,
  directory,
  bridgeToken,
  notifyToken,
  token,
  autoStartHammerspoon: autoStartOption,
  hammerspoonApp: hammerspoonAppOption
}) => {
  let projectLabel = getProjectLabel({ project, worktree, directory })
  const sessionStateByID = new Map()
  const messageRoleByID = new Map()
  const isDarwin = process.platform === "darwin"
  const autoStartHammerspoon = resolveBoolean(autoStartOption, resolveAutoStartDefault())
  const hammerspoonApp = typeof hammerspoonAppOption === "string"
    && hammerspoonAppOption.trim()
    ? hammerspoonAppOption.trim()
    : HAMMERSPOON_APP_NAME
  const sharedBridgeToken = resolveBridgeToken({ bridgeToken, notifyToken, token })
  let bridgeDisabledReason = sharedBridgeToken ? "" : BRIDGE_DISABLE_REASON_MISSING_TOKEN
  let initStartAttempted = false
  let retryStartAttempted = false

  const getSessionState = (sessionID) => {
    if (!sessionID) return null
    if (!sessionStateByID.has(sessionID)) {
      sessionStateByID.set(sessionID, {
        isRoot: ROOT_STATE_UNKNOWN,
        notifiedSinceBusy: false,
        lastOutcome: SESSION_OUTCOME_COMPLETED,
        lastTaskSummary: "",
        pendingIdleTimer: null
      })
    }
    return sessionStateByID.get(sessionID)
  }

  const clearPendingIdleTimer = (sessionState) => {
    if (!sessionState?.pendingIdleTimer) return
    clearTimeout(sessionState.pendingIdleTimer)
    sessionState.pendingIdleTimer = null
  }

  const updateSessionRootFlag = (sessionID, parentID) => {
    const sessionState = getSessionState(sessionID)
    if (!sessionState) return
    sessionState.isRoot = !parentID
    if (!sessionState.isRoot) clearPendingIdleTimer(sessionState)
  }

  const resetSessionOnBusy = (sessionID) => {
    const sessionState = getSessionState(sessionID)
    if (!sessionState) return
    clearPendingIdleTimer(sessionState)
    sessionState.notifiedSinceBusy = false
    sessionState.lastOutcome = SESSION_OUTCOME_COMPLETED
  }

  const updateSessionOutcome = ({ sessionID, outcome, reason }) => {
    const sessionState = getSessionState(sessionID)
    if (!sessionState) return
    sessionState.lastOutcome = outcome
    if (outcome !== SESSION_OUTCOME_COMPLETED) {
      logDecision(`outcome-${outcome}`, { sessionID, reason })
    }
  }

  const updateSessionTaskSummary = ({ sessionID, summary }) => {
    const sessionState = getSessionState(sessionID)
    if (!sessionState) return
    const normalized = normalizeTaskSummary(summary)
    if (!normalized) return
    sessionState.lastTaskSummary = normalized
  }

  const shouldTryBridge = () => !bridgeDisabledReason

  const startHammerspoon = async (mode) => {
    if (!isDarwin || !autoStartHammerspoon || !shouldTryBridge()) return false
    if (mode === "init" && initStartAttempted) return true
    if (mode === "retry" && retryStartAttempted) return true
    if (mode === "init") initStartAttempted = true
    if (mode === "retry") retryStartAttempted = true

    try {
      await $`open -g -a ${hammerspoonApp}`.quiet()
      await sleep(HAMMERSPOON_BOOT_DELAY_MS)
      logDecision("bridge-autostart", { reason: mode })
      return true
    } catch (err) {
      logDecision("bridge-autostart-failed", { reason: err?.name || "unknown" })
      return false
    }
  }

  const updateBridgeAvailability = ({ sessionID, reason }) => {
    if (!reason || bridgeDisabledReason) return
    if (reason === "timeout" || reason.startsWith("network-")) {
      bridgeDisabledReason = reason
      logDecision("bridge-disabled", { sessionID, reason })
    }
  }

  const notifySessionIdle = async ({ sessionID }) => {
    const sessionState = getSessionState(sessionID)
    if (!sessionState) return
    if (!isDarwin) {
      clearPendingIdleTimer(sessionState)
      return
    }

    const eligibility = getIdleEligibility(sessionState)
    if (handleIdleSkip({
      eligibility,
      sessionState,
      sessionID,
      reason: DECISION_REASON_TIMER_CONFIRM,
      clearTimer: true,
      clearPending: clearPendingIdleTimer
    })) {
      return
    }

    sessionState.notifiedSinceBusy = true

    try {
      const message = getIdleMessageByOutcome(sessionState)
      const subtitle = `项目：${projectLabel}`

      if (!shouldTryBridge()) {
        await sendMacNotification({ $, message, subtitle })
        return
      }

      const bridgeResult = await sendByBridge({
        message,
        subtitle,
        sessionID,
        projectLabel,
        bridgeToken: sharedBridgeToken
      })

      let resolvedBridgeResult = bridgeResult

      if (resolvedBridgeResult.error && (resolvedBridgeResult.reason === "timeout" || resolvedBridgeResult.reason.startsWith("network-"))) {
        const started = await startHammerspoon("retry")
        if (started) {
          resolvedBridgeResult = await sendByBridge({
            message,
            subtitle,
            sessionID,
            projectLabel,
            bridgeToken: sharedBridgeToken
          })
        }
      }

      if (resolvedBridgeResult.ok) {
        logDecision("bridge-success", { sessionID })
        return
      }

      if (resolvedBridgeResult.error) {
        updateBridgeAvailability({ sessionID, reason: resolvedBridgeResult.reason })
      }

      if (resolvedBridgeResult.error && !bridgeDisabledReason) {
        logError("bridge-request-failed", { sessionID, reason: resolvedBridgeResult.reason })
        logDecision("bridge-error", { sessionID, reason: resolvedBridgeResult.reason })
      }

      logDecision("bridge-fallback", { sessionID, reason: resolvedBridgeResult.reason })
      if (!resolvedBridgeResult.ok) {
        await sendMacNotification({ $, message, subtitle })
      }
    } catch (err) {
      logError("notify-session-idle-failed", {
        sessionID,
        reason: err?.name || "unknown"
      })
    }
  }

  const scheduleIdleConfirmation = (sessionID) => {
    const sessionState = getSessionState(sessionID)
    if (!sessionState) return
    if (!isDarwin) {
      clearPendingIdleTimer(sessionState)
      return
    }
    const eligibility = getIdleEligibility(sessionState)
    if (eligibility === IDLE_ELIGIBILITY_SUPPRESSED_CHILD) {
      handleIdleSkip({
        eligibility,
        sessionState,
        sessionID,
        reason: DECISION_REASON_IDLE_EVENT,
        clearTimer: true,
        clearPending: clearPendingIdleTimer
      })
      return
    }

    if (eligibility === IDLE_ELIGIBILITY_DEDUPED) {
      handleIdleSkip({
        eligibility,
        sessionState,
        sessionID,
        reason: DECISION_REASON_IDLE_EVENT,
        clearTimer: false,
        clearPending: clearPendingIdleTimer
      })
      return
    }

    if (eligibility !== IDLE_ELIGIBILITY_ELIGIBLE) return

    clearPendingIdleTimer(sessionState)
    sessionState.pendingIdleTimer = setTimeout(() => {
      sessionState.pendingIdleTimer = null
      void notifySessionIdle({ sessionID })
    }, IDLE_CONFIRMATION_DELAY_MS)
  }

  if (NOTIFICATION_DECISION_LOG_ENABLED) {
    debugLog("[NotificationPlugin] 已加载，当前项目：", projectLabel)
    if (bridgeDisabledReason === BRIDGE_DISABLE_REASON_MISSING_TOKEN) {
      logDecision("bridge-skipped", { reason: BRIDGE_DISABLE_REASON_MISSING_TOKEN })
    }
  }

  await startHammerspoon("init")

  return {
    event: async ({ event }) => {
      if (event.type === "project.updated") {
        projectLabel = getProjectLabel({
          project: event.properties,
          worktree: event.properties?.worktree || worktree,
          directory
        })
        return
      }

      if (event.type === "message.updated") {
        const messageInfo = event.properties?.info
        const messageID = messageInfo?.id || ""
        const messageRole = messageInfo?.role || ""

        if (messageID && messageRole) {
          messageRoleByID.set(messageID, messageRole)
        }

        if (messageRole === "user") {
          updateSessionTaskSummary({
            sessionID: messageInfo?.sessionID || "",
            summary: messageInfo?.summary?.title || messageInfo?.summary?.body || ""
          })
        }
        return
      }

      if (event.type === "message.part.updated") {
        const part = event.properties?.part
        if (part?.type !== "text") return

        const messageRole = messageRoleByID.get(part.messageID)
        if (messageRole !== "user") return

        updateSessionTaskSummary({
          sessionID: part.sessionID || "",
          summary: part.text || ""
        })
        return
      }

      if (event.type === "message.removed") {
        const messageID = event.properties?.messageID || ""
        if (messageID) messageRoleByID.delete(messageID)
        return
      }

      if (event.type === "session.created" || event.type === "session.updated") {
        const sessionInfo = event.properties?.info
        updateSessionRootFlag(sessionInfo?.id || "", sessionInfo?.parentID)
        return
      }

      if (event.type === "session.error") {
        const sessionID = event.properties?.sessionID || ""
        const errorName = event.properties?.error?.name || ""

        if (errorName === INTERRUPT_ERROR_NAME) {
          updateSessionOutcome({
            sessionID,
            outcome: SESSION_OUTCOME_INTERRUPTED,
            reason: errorName
          })
          return
        }

        updateSessionOutcome({
          sessionID,
          outcome: SESSION_OUTCOME_ERROR,
          reason: errorName || "unknown"
        })
        return
      }

      if (event.type === "command.executed") {
        const sessionID = event.properties?.sessionID || ""
        const commandName = event.properties?.name || ""
        if (INTERRUPT_COMMAND_NAMES.has(commandName)) {
          updateSessionOutcome({
            sessionID,
            outcome: SESSION_OUTCOME_INTERRUPTED,
            reason: commandName
          })
        }
        return
      }

      if (event.type === "session.status") {
        const sessionID = event.properties?.sessionID || ""
        const statusType = event.properties?.status?.type

        if (statusType === "busy") {
          resetSessionOnBusy(sessionID)
          return
        }

        if (statusType === "idle") return

        return
      }

      if (event.type !== "session.idle") return
      scheduleIdleConfirmation(event.properties?.sessionID || "")
    }
  }
}
