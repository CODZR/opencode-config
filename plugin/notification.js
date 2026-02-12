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
const NOTIFICATION_AUTO_DISMISS_SECONDS = "3"
const ROOT_STATE_UNKNOWN = "unknown"
const NOTIFICATION_DEBUG_FLAG = (process.env.OPENCODE_NOTIFICATION_DEBUG || "").trim().toLowerCase()
const NOTIFICATION_DECISION_LOG_ENABLED = ["1", "true", "yes", "on"].includes(NOTIFICATION_DEBUG_FLAG)

const debugLog = (...args) => {
  if (!NOTIFICATION_DECISION_LOG_ENABLED) return
  console.log(...args)
}

const debugWarn = (...args) => {
  if (!NOTIFICATION_DECISION_LOG_ENABLED) return
  console.warn(...args)
}

const debugError = (...args) => {
  if (!NOTIFICATION_DECISION_LOG_ENABLED) return
  console.error(...args)
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

const resolveBridgeToken = ({ bridgeToken, notifyToken, token }) => {
  const explicit = [bridgeToken, notifyToken, token]
    .find((value) => typeof value === "string" && value.trim())
  if (explicit) return explicit.trim()

  const envToken = process.env.OPENCODE_NOTIFY_TOKEN
  if (typeof envToken === "string" && envToken.trim()) return envToken.trim()

  return ""
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
    return { ok: false, error: true, reason: "network-error" }
  } finally {
    clearTimeout(timeout)
  }
}

export const NotificationPlugin = async ({ $, project, worktree, directory, bridgeToken, notifyToken, token }) => {
  let projectLabel = getProjectLabel({ project, worktree, directory })
  const sessionStateByID = new Map()
  const isDarwin = process.platform === "darwin"
  const sharedBridgeToken = resolveBridgeToken({ bridgeToken, notifyToken, token })

  const getSessionState = (sessionID) => {
    if (!sessionID) return null
    if (!sessionStateByID.has(sessionID)) {
      sessionStateByID.set(sessionID, {
        isRoot: ROOT_STATE_UNKNOWN,
        notifiedSinceBusy: false,
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
  }

  const notifySessionIdle = async ({ sessionID }) => {
    const sessionState = getSessionState(sessionID)
    if (!sessionState) return
    if (!isDarwin) {
      clearPendingIdleTimer(sessionState)
      return
    }

    if (sessionState.isRoot === false) {
      logDecision("suppressed-child", { sessionID, reason: DECISION_REASON_TIMER_CONFIRM })
      clearPendingIdleTimer(sessionState)
      return
    }

    if (sessionState.notifiedSinceBusy) {
      logDecision("deduped", { sessionID, reason: DECISION_REASON_TIMER_CONFIRM })
      clearPendingIdleTimer(sessionState)
      return
    }

    if (sessionState.isRoot !== true) {
      clearPendingIdleTimer(sessionState)
      return
    }

    sessionState.notifiedSinceBusy = true

    try {
      const message = "任务已完成，等你下一步指令。"
      const subtitle = `项目：${projectLabel}`
      const bridgeResult = await sendByBridge({
        message,
        subtitle,
        sessionID,
        projectLabel,
        bridgeToken: sharedBridgeToken
      })

      if (bridgeResult.ok) {
        logDecision("bridge-success", { sessionID })
        return
      }

      if (bridgeResult.error) {
        logDecision("bridge-error", { sessionID, reason: bridgeResult.reason })
      }

      logDecision("bridge-fallback", { sessionID, reason: bridgeResult.reason })
      if (!bridgeResult.ok) {
        await sendMacNotification({ $, message, subtitle })
      }
    } catch (err) {
      debugError("[NotificationPlugin] 发送通知失败：", err)
    }
  }

  const scheduleIdleConfirmation = (sessionID) => {
    const sessionState = getSessionState(sessionID)
    if (!sessionState) return
    if (!isDarwin) {
      clearPendingIdleTimer(sessionState)
      return
    }
    if (sessionState.isRoot === false) {
      clearPendingIdleTimer(sessionState)
      logDecision("suppressed-child", { sessionID, reason: DECISION_REASON_IDLE_EVENT })
      return
    }

    if (sessionState.notifiedSinceBusy) {
      logDecision("deduped", { sessionID, reason: DECISION_REASON_IDLE_EVENT })
      return
    }

    if (sessionState.isRoot !== true) return

    clearPendingIdleTimer(sessionState)
    sessionState.pendingIdleTimer = setTimeout(() => {
      sessionState.pendingIdleTimer = null
      void notifySessionIdle({ sessionID })
    }, IDLE_CONFIRMATION_DELAY_MS)
  }

  if (NOTIFICATION_DECISION_LOG_ENABLED) {
    debugLog("[NotificationPlugin] 已加载，当前项目：", projectLabel)
  }

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

      if (event.type === "session.created" || event.type === "session.updated") {
        const sessionInfo = event.properties?.info
        updateSessionRootFlag(sessionInfo?.id || "", sessionInfo?.parentID)
        return
      }

      if (event.type === "session.status") {
        const sessionID = event.properties?.sessionID || ""
        const statusType = event.properties?.status?.type

        if (statusType === "busy") {
          resetSessionOnBusy(sessionID)
          return
        }

        if (statusType === "idle") {
          scheduleIdleConfirmation(sessionID)
        }

        return
      }

      if (event.type !== "session.idle") return
      scheduleIdleConfirmation(event.properties?.sessionID || "")
    }
  }
}
