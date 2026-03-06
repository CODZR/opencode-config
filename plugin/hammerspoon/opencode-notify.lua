local M = {}

local CONFIG = {
  bindHost = "127.0.0.1",
  port = 17342,
  tokenHeader = "x-opencode-token",
  maxVisible = 5,
  dismissAfterMs = 3000,
  hoverDismissAfterMs = 1000,
  maxBodyBytes = 32768,
  generatedIdPrefix = "toast_17342_"
}

M.visualTokens = {
  font = {
    family = {
      primary = ".SF Pro Text, PingFang SC, Hiragino Sans GB, sans-serif"
    },
    size = {
      label = 12,
      message = 14,
      subtitle = 12
    },
    lineHeight = {
      label = 16,
      message = 20,
      subtitle = 17
    }
  },
  toast = {
    width = 344,
    minHeight = 74,
    paddingX = 14,
    paddingY = 12,
    contentGap = 5,
    radius = 16,
    borderWidth = 1,
    borderAlpha = 0.3,
    borderHoverAlpha = 0.4,
    opacityBackground = 0.94,
    opacityBackgroundHover = 0.97,
    labelOpacity = 0.72,
    subtitleOpacity = 0.86,
    accentDotSize = 8,
    accentDotOpacity = 0.62,
    accentInsetX = 12,
    accentInsetY = 12,
    contentInsetLeft = 18
  },
  color = {
    surface = "#F8FAFF",
    textPrimary = "#1F2937",
    textSecondary = "#4B5563",
    label = "#6B7280",
    accentBar = "#4F46E5",
    border = "#C7D2E5"
  },
  shadow = {
    default = {
      blurRadius = 18,
      alpha = 0.12,
      offsetW = 0,
      offsetH = 6
    },
    hover = {
      blurRadius = 22,
      alpha = 0.16,
      offsetW = 0,
      offsetH = 8
    }
  },
  stack = {
    gap = 8,
    marginTop = 20,
    marginRight = 20,
    maxVisible = CONFIG.maxVisible
  }
}

local VIEW = {
  appLabel = "OpenCode",
  width = M.visualTokens.toast.width,
  minHeight = M.visualTokens.toast.minHeight,
  paddingX = M.visualTokens.toast.paddingX,
  paddingY = M.visualTokens.toast.paddingY,
  contentGap = M.visualTokens.toast.contentGap,
  radius = M.visualTokens.toast.radius,
  borderWidth = M.visualTokens.toast.borderWidth,
  marginTop = M.visualTokens.stack.marginTop,
  marginRight = M.visualTokens.stack.marginRight,
  stackGap = M.visualTokens.stack.gap,
  accentDotSize = M.visualTokens.toast.accentDotSize,
  accentInsetX = M.visualTokens.toast.accentInsetX,
  accentInsetY = M.visualTokens.toast.accentInsetY,
  contentInsetLeft = M.visualTokens.toast.contentInsetLeft,
  messageCharsPerLine = 34
}

local state = {
  server = nil,
  token = nil,
  nextId = 1,
  active = {},
  activeById = {},
  timers = {}
}

local notifyAllowedKeys = {
  id = true,
  message = true,
  subtitle = true,
  sessionID = true,
  projectLabel = true,
  createdAtMs = true
}

local hoverAllowedKeys = {
  id = true,
  state = true
}

local removeToastById
local renderStack
local applyHoverState

local function nowMs()
  return math.floor(hs.timer.secondsSinceEpoch() * 1000)
end

local function trim(value)
  return (tostring(value):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function responseHeaders()
  return {
    ["content-type"] = "application/json; charset=utf-8",
    ["cache-control"] = "no-store"
  }
end

local function isArrayTable(value)
  if type(value) ~= "table" then
    return false
  end

  local maxIndex = 0
  local count = 0
  for key, _ in pairs(value) do
    if type(key) ~= "number" or key < 1 or key % 1 ~= 0 then
      return false
    end
    if key > maxIndex then
      maxIndex = key
    end
    count = count + 1
  end

  return maxIndex == count
end

local function encodeJsonString(value)
  local escaped = tostring(value)
    :gsub("\\", "\\\\")
    :gsub('"', '\\"')
    :gsub("\b", "\\b")
    :gsub("\f", "\\f")
    :gsub("\n", "\\n")
    :gsub("\r", "\\r")
    :gsub("\t", "\\t")

  escaped = escaped:gsub("[%z\1-\31]", function(char)
    return string.format("\\u%04x", string.byte(char))
  end)

  return '"' .. escaped .. '"'
end

local function encodeJsonValue(value)
  local valueType = type(value)

  if valueType == "nil" then
    return "null"
  end

  if valueType == "boolean" then
    return value and "true" or "false"
  end

  if valueType == "number" then
    if value ~= value or value == math.huge or value == -math.huge then
      return "null"
    end
    return tostring(value)
  end

  if valueType == "string" then
    return encodeJsonString(value)
  end

  if valueType ~= "table" then
    return "null"
  end

  if isArrayTable(value) then
    local items = {}
    for index = 1, #value do
      items[#items + 1] = encodeJsonValue(value[index])
    end
    return "[" .. table.concat(items, ",") .. "]"
  end

  local keys = {}
  for key, _ in pairs(value) do
    if type(key) == "string" then
      keys[#keys + 1] = key
    end
  end
  table.sort(keys)

  local pairsOut = {}
  for _, key in ipairs(keys) do
    local encodedKey = encodeJsonValue(key)
    local encodedValue = encodeJsonValue(value[key])
    pairsOut[#pairsOut + 1] = encodedKey .. ":" .. encodedValue
  end

  return "{" .. table.concat(pairsOut, ",") .. "}"
end

local function jsonEncode(payload)
  local ok, encoded = pcall(encodeJsonValue, payload)
  if ok and type(encoded) == "string" then
    return encoded
  end
  return "{\"error\":{\"code\":\"INTERNAL_ERROR\",\"message\":\"failed to encode response\"},\"ok\":false}"
end

local function respond(statusCode, payload)
  return jsonEncode(payload), statusCode, responseHeaders()
end

local function respondError(statusCode, code, message)
  return respond(statusCode, {
    ok = false,
    error = {
      code = code,
      message = message
    }
  })
end

local function readHeader(headers, wanted)
  if type(headers) ~= "table" then
    return nil
  end
  local wantedLower = string.lower(wanted)
  for key, value in pairs(headers) do
    if string.lower(tostring(key)) == wantedLower then
      return tostring(value)
    end
  end
  return nil
end

local function normalizeAddress(input)
  local value = trim(input or "")
  if value == "" then
    return ""
  end

  value = value:gsub('^"', ""):gsub('"$', "")
  local comma = value:find(",", 1, true)
  if comma then
    value = trim(value:sub(1, comma - 1))
  end

  local lower = string.lower(value)
  local forValue = lower:match("for=([^;]+)")
  if forValue then
    value = trim(forValue:gsub('^"', ""):gsub('"$', ""))
  end

  if value:sub(1, 1) == "[" then
    local endBracket = value:find("]", 2, true)
    if endBracket then
      return string.lower(value:sub(2, endBracket - 1))
    end
  end

  local colonCount = select(2, value:gsub(":", ""))
  if colonCount == 1 then
    value = value:match("^([^:]+)") or value
  end

  return string.lower(trim(value))
end

local function isLoopbackAddress(raw)
  local value = normalizeAddress(raw)
  if value == "" then
    return false
  end
  if value == "localhost" or value == "loopback" or value == "::1" or value == "0:0:0:0:0:0:0:1" then
    return true
  end
  value = value:gsub("^::ffff:", "")
  if value:match("^127%.%d+%.%d+%.%d+$") then
    return true
  end
  return false
end

local function isLoopbackRequest(headers)
  local forwardedFor = readHeader(headers, "x-forwarded-for")
  if forwardedFor and trim(forwardedFor) ~= "" and not isLoopbackAddress(forwardedFor) then
    return false
  end

  local realIp = readHeader(headers, "x-real-ip")
  if realIp and trim(realIp) ~= "" and not isLoopbackAddress(realIp) then
    return false
  end

  local forwarded = readHeader(headers, "forwarded")
  if forwarded and trim(forwarded) ~= "" and not isLoopbackAddress(forwarded) then
    return false
  end

  local host = readHeader(headers, "host")
  if host and trim(host) ~= "" and not isLoopbackAddress(host) then
    return false
  end

  return true
end

local function requireAuthorized(headers)
  local provided = trim(readHeader(headers, CONFIG.tokenHeader) or "")
  if provided == "" or provided ~= state.token then
    return false
  end
  return true
end

local function isNonNegativeInteger(value)
  return type(value) == "number" and value >= 0 and value % 1 == 0
end

local function isBoundedString(value, minLen, maxLen)
  if type(value) ~= "string" then
    return false
  end
  local len = #value
  return len >= minLen and len <= maxLen
end

local function onlyAllowedKeys(payload, allowed)
  for key, _ in pairs(payload) do
    if type(key) ~= "string" or not allowed[key] then
      return false
    end
  end
  return true
end

local function decodeJsonObject(rawBody)
  if type(rawBody) ~= "string" or rawBody == "" then
    return nil
  end
  local ok, decoded = pcall(hs.json.decode, rawBody)
  if not ok or type(decoded) ~= "table" then
    return nil
  end
  if isArrayTable(decoded) then
    return nil
  end
  return decoded
end

local function contentTypeIsJson(headers)
  local contentType = readHeader(headers, "content-type")
  if not contentType then
    return false
  end
  local normalized = string.lower(trim(contentType))
  return normalized == "application/json" or normalized:sub(1, 16) == "application/json"
end

local function makeGeneratedId()
  local id = string.format("%s%04d", CONFIG.generatedIdPrefix, state.nextId)
  state.nextId = state.nextId + 1
  return id
end

local function remainingMsForTimer(timerRecord, now)
  if not timerRecord or timerRecord.running ~= true then
    return 0
  end
  local remaining = timerRecord.dueAtMs - now
  if remaining < 0 then
    return 0
  end
  return math.floor(remaining)
end

local function toColor(hex, alpha)
  return {
    hex = hex,
    alpha = alpha
  }
end

local function shadowSpec(hovered)
  local spec = hovered and M.visualTokens.shadow.hover or M.visualTokens.shadow.default
  return {
    blurRadius = spec.blurRadius,
    color = { white = 0, alpha = spec.alpha },
    offset = { w = spec.offsetW, h = spec.offsetH }
  }
end

local function clamp(value, minValue, maxValue)
  if value < minValue then
    return minValue
  end
  if value > maxValue then
    return maxValue
  end
  return value
end

local function estimateWrappedLines(text, charsPerLine, maxLines)
  local value = tostring(text or "")
  if value == "" then
    return 1
  end

  local lines = 0
  local hasSegment = false
  for segment in value:gmatch("[^\r\n]+") do
    hasSegment = true
    local needed = math.max(1, math.ceil(#segment / charsPerLine))
    lines = lines + needed
  end

  if not hasSegment then
    lines = 1
  end

  return clamp(lines, 1, maxLines)
end

local function toastMessageLines(toast)
  return estimateWrappedLines(toast.message, VIEW.messageCharsPerLine, 2)
end

local function toastHeight(toast)
  local messageLines = toastMessageLines(toast)
  local labelHeight = M.visualTokens.font.lineHeight.label
  local messageHeight = M.visualTokens.font.lineHeight.message * messageLines
  local subtitleHeight = M.visualTokens.font.lineHeight.subtitle
  local contentHeight = labelHeight + VIEW.contentGap + messageHeight + VIEW.contentGap + subtitleHeight
  local total = VIEW.paddingY + contentHeight + VIEW.paddingY
  return math.max(VIEW.minHeight, total)
end

local function primaryScreenFrame()
  local screen = hs.screen.mainScreen()
  if screen and type(screen.fullFrame) == "function" then
    return screen:fullFrame()
  end
  return { x = 0, y = 0, w = 1440, h = 900 }
end

local function destroyCanvas(toast)
  if not toast or not toast.canvas then
    return
  end
  pcall(function()
    toast.canvas:hide()
    toast.canvas:delete()
  end)
  toast.canvas = nil
end

local function stopTimerForToast(id)
  local timerRecord = state.timers[id]
  if not timerRecord then
    return
  end
  if timerRecord.handle then
    timerRecord.handle:stop()
    timerRecord.handle = nil
  end
  timerRecord.running = false
  timerRecord.dueAtMs = 0
  local toast = state.activeById[id]
  if toast then
    toast.timerState = "idle"
  end
end

local function startDismissTimer(id, durationMs)
  local toast = state.activeById[id]
  if not toast then
    return nil
  end

  local delayMs = math.max(1, math.floor(tonumber(durationMs) or CONFIG.dismissAfterMs))
  stopTimerForToast(id)
  local dueAtMs = nowMs() + delayMs
  local timerRecord = state.timers[id] or { running = false, dueAtMs = 0, handle = nil }
  timerRecord.running = true
  timerRecord.dueAtMs = dueAtMs
  timerRecord.handle = hs.timer.doAfter(delayMs / 1000, function()
    removeToastById(id)
  end)

  state.timers[id] = timerRecord
  toast.timerState = "running"

  return timerRecord
end

local function parseMouseEvent(...)
  local sawEnter = false
  local sawLeave = false
  for index = 1, select("#", ...) do
    local value = select(index, ...)
    if type(value) == "string" then
      local event = string.lower(value)
      if event:find("enter", 1, true) then
        sawEnter = true
      end
      if event:find("exit", 1, true) or event:find("leave", 1, true) then
        sawLeave = true
      end
    end
  end
  if sawEnter then
    return "enter"
  end
  if sawLeave then
    return "leave"
  end
  return nil
end

local function makeToastElements(toast)
  local messageLines = toastMessageLines(toast)
  local cardHeight = toast.height
  local contentX = VIEW.paddingX + VIEW.contentInsetLeft
  local contentWidth = VIEW.width - VIEW.paddingX - contentX
  local labelHeight = M.visualTokens.font.lineHeight.label
  local messageHeight = M.visualTokens.font.lineHeight.message * messageLines
  local subtitleHeight = M.visualTokens.font.lineHeight.subtitle
  local dotDiameter = VIEW.accentDotSize
  local dotX = VIEW.accentInsetX
  local dotY = VIEW.accentInsetY + math.floor((labelHeight - dotDiameter) / 2)
  local borderAlpha = toast.hovered and M.visualTokens.toast.borderHoverAlpha or M.visualTokens.toast.borderAlpha

  local labelY = VIEW.paddingY
  local messageY = labelY + labelHeight + VIEW.contentGap
  local subtitleY = messageY + messageHeight + VIEW.contentGap

  local backgroundAlpha = toast.hovered and M.visualTokens.toast.opacityBackgroundHover or M.visualTokens.toast.opacityBackground

  return {
    {
      type = "rectangle",
      action = "fill",
      frame = { x = 0, y = 0, w = VIEW.width, h = cardHeight },
      roundedRectRadii = { xRadius = VIEW.radius, yRadius = VIEW.radius },
      fillColor = toColor(M.visualTokens.color.surface, backgroundAlpha),
      withShadow = true,
      shadow = shadowSpec(toast.hovered)
    },
    {
      type = "rectangle",
      action = "stroke",
      frame = { x = 0, y = 0, w = VIEW.width, h = cardHeight },
      roundedRectRadii = { xRadius = VIEW.radius, yRadius = VIEW.radius },
      strokeColor = toColor(M.visualTokens.color.border, borderAlpha),
      strokeWidth = VIEW.borderWidth
    },
    {
      type = "rectangle",
      action = "fill",
      frame = { x = 1, y = 1, w = VIEW.width - 2, h = 1 },
      fillColor = { white = 0, alpha = 0.03 }
    },
    {
      type = "oval",
      action = "fill",
      frame = { x = dotX - 2, y = dotY - 2, w = dotDiameter + 4, h = dotDiameter + 4 },
      fillColor = toColor(M.visualTokens.color.accentBar, 0.08)
    },
    {
      type = "oval",
      action = "fill",
      frame = { x = dotX, y = dotY, w = dotDiameter, h = dotDiameter },
      fillColor = toColor(M.visualTokens.color.accentBar, M.visualTokens.toast.accentDotOpacity)
    },
    {
      type = "text",
      action = "fill",
      frame = { x = contentX, y = labelY, w = contentWidth, h = labelHeight },
      text = VIEW.appLabel,
      textFont = M.visualTokens.font.family.primary,
      textSize = M.visualTokens.font.size.label,
      textColor = toColor(M.visualTokens.color.label, M.visualTokens.toast.labelOpacity),
      textAlignment = "left",
      textLineBreak = "truncateTail"
    },
    {
      type = "text",
      action = "fill",
      frame = { x = contentX, y = messageY, w = contentWidth, h = messageHeight },
      text = tostring(toast.message),
      textFont = M.visualTokens.font.family.primary,
      textSize = M.visualTokens.font.size.message,
      textColor = toColor(M.visualTokens.color.textPrimary, 1),
      textAlignment = "left",
      textLineBreak = messageLines > 1 and "wordWrap" or "truncateTail"
    },
    {
      type = "text",
      action = "fill",
      frame = { x = contentX, y = subtitleY, w = contentWidth, h = subtitleHeight },
      text = tostring(toast.subtitle),
      textFont = M.visualTokens.font.family.primary,
      textSize = M.visualTokens.font.size.subtitle,
      textColor = toColor(M.visualTokens.color.textSecondary, M.visualTokens.toast.subtitleOpacity),
      textAlignment = "left",
      textLineBreak = "truncateTail"
    },
    {
      type = "rectangle",
      action = "fill",
      id = "hover-tracker",
      frame = { x = 0, y = 0, w = VIEW.width, h = cardHeight },
      fillColor = { white = 0, alpha = 0 },
      trackMouseByBounds = true,
      trackMouseEnterExit = true
    }
  }
end

local function renderToast(toast, x, y)
  destroyCanvas(toast)

  local canvas = hs.canvas.new({ x = x, y = y, w = VIEW.width, h = toast.height })
  if not canvas then
    return
  end

  if hs.canvas.windowLevels and hs.canvas.windowLevels.status then
    canvas:level(hs.canvas.windowLevels.status)
  else
    canvas:level("status")
  end
  canvas:behavior({ "canJoinAllSpaces", "stationary", "ignoresCycle" })
  canvas:clickActivating(false)

  local elements = makeToastElements(toast)
  for index, element in ipairs(elements) do
    canvas[index] = element
  end

  canvas:mouseCallback(function(...)
    local parsed = parseMouseEvent(...)
    if parsed then
      applyHoverState(toast.id, parsed)
    end
  end)

  canvas:show()
  toast.canvas = canvas
end

renderStack = function()
  local screen = primaryScreenFrame()
  local startX = screen.x + screen.w - VIEW.marginRight - VIEW.width
  local currentY = screen.y + VIEW.marginTop

  for _, toast in ipairs(state.active) do
    toast.height = toastHeight(toast)
    renderToast(toast, startX, currentY)
    currentY = currentY + toast.height + VIEW.stackGap
  end
end

removeToastById = function(id)
  local toast = state.activeById[id]
  if not toast then
    return false
  end

  stopTimerForToast(id)
  destroyCanvas(toast)

  for index, candidate in ipairs(state.active) do
    if candidate.id == id then
      table.remove(state.active, index)
      break
    end
  end

  state.activeById[id] = nil
  state.timers[id] = nil
  renderStack()

  return true
end

applyHoverState = function(id, hoverState)
  local toast = state.activeById[id]
  if not toast then
    return nil, "NOT_FOUND", "toast id not found"
  end

  if hoverState == "enter" then
    toast.hovered = true
    startDismissTimer(id, CONFIG.hoverDismissAfterMs)
  elseif hoverState == "leave" then
    toast.hovered = false
    local timerRecord = state.timers[id]
    if not (timerRecord and timerRecord.running == true) then
      startDismissTimer(id)
    end
  else
    return nil, "INVALID_BODY", "state must be enter or leave"
  end

  renderStack()

  local timerRecord = state.timers[id]
  local running = timerRecord and timerRecord.running == true or false
  local dueAtMs = running and timerRecord.dueAtMs or 0
  local currentMs = nowMs()

  return {
    running = running,
    dueAtMs = dueAtMs,
    remainingMs = running and remainingMsForTimer(timerRecord, currentMs) or 0
  }
end

local function snapshotState()
  local currentMs = nowMs()
  local active = {}
  local timers = {}

  for _, toast in ipairs(state.active) do
    active[#active + 1] = {
      id = toast.id,
      message = toast.message,
      subtitle = toast.subtitle,
      hovered = toast.hovered,
      createdAtMs = toast.createdAtMs,
      dismissAfterMs = toast.dismissAfterMs,
      timerState = toast.timerState
    }

    local timerRecord = state.timers[toast.id]
    local running = timerRecord and timerRecord.running == true or false
    local dueAtMs = running and timerRecord.dueAtMs or 0
    timers[#timers + 1] = {
      id = toast.id,
      running = running,
      dueAtMs = dueAtMs,
      remainingMs = running and remainingMsForTimer(timerRecord, currentMs) or 0
    }
  end

  return {
    ok = true,
    nowMs = currentMs,
    active = active,
    timers = timers
  }
end

local function parseNotifyPayload(body)
  local payload = decodeJsonObject(body)
  if not payload then
    return nil, "INVALID_BODY", "request body must be valid JSON object"
  end
  if not onlyAllowedKeys(payload, notifyAllowedKeys) then
    return nil, "INVALID_BODY", "request body does not match schema"
  end

  if not isBoundedString(payload.message, 1, 500) or not isBoundedString(payload.subtitle, 1, 200) then
    return nil, "INVALID_BODY", "message and subtitle are required non-empty strings"
  end

  if payload.id ~= nil and not isBoundedString(payload.id, 1, 128) then
    return nil, "INVALID_BODY", "id must be a non-empty string up to 128 chars"
  end

  if payload.sessionID ~= nil and not isBoundedString(payload.sessionID, 1, 128) then
    return nil, "INVALID_BODY", "sessionID must be a non-empty string up to 128 chars"
  end

  if payload.projectLabel ~= nil and not isBoundedString(payload.projectLabel, 1, 120) then
    return nil, "INVALID_BODY", "projectLabel must be a non-empty string up to 120 chars"
  end

  if payload.createdAtMs ~= nil and not isNonNegativeInteger(payload.createdAtMs) then
    return nil, "INVALID_BODY", "createdAtMs must be a non-negative integer"
  end

  local hasExplicitId = payload.id ~= nil
  local toastId = payload.id or makeGeneratedId()
  while not hasExplicitId and state.activeById[toastId] do
    toastId = makeGeneratedId()
  end

  return {
    id = toastId,
    hasExplicitId = hasExplicitId,
    message = payload.message,
    subtitle = payload.subtitle,
    createdAtMs = payload.createdAtMs or nowMs()
  }
end

local function parseHoverPayload(body)
  local payload = decodeJsonObject(body)
  if not payload then
    return nil, "INVALID_BODY", "request body must be valid JSON object"
  end
  if not onlyAllowedKeys(payload, hoverAllowedKeys) then
    return nil, "INVALID_BODY", "request body does not match schema"
  end
  if not isBoundedString(payload.id, 1, 128) then
    return nil, "INVALID_BODY", "id must be a non-empty string up to 128 chars"
  end
  if payload.state ~= "enter" and payload.state ~= "leave" then
    return nil, "INVALID_BODY", "state must be enter or leave"
  end

  return {
    id = payload.id,
    state = payload.state
  }
end

local function handleNotify(body)
  local payload, code, message = parseNotifyPayload(body)
  if not payload then
    return respondError(400, code, message)
  end

  local existing = payload.hasExplicitId and state.activeById[payload.id] or nil
  if existing then
    existing.message = payload.message
    existing.subtitle = payload.subtitle
    existing.createdAtMs = payload.createdAtMs
    renderStack()

    return respond(200, {
      ok = true,
      id = existing.id,
      activeCount = #state.active
    })
  end

  if #state.active >= CONFIG.maxVisible then
    local oldest = state.active[#state.active]
    if oldest then
      removeToastById(oldest.id)
    end
  end

  local toast = {
    id = payload.id,
    message = payload.message,
    subtitle = payload.subtitle,
    hovered = false,
    createdAtMs = payload.createdAtMs,
    dismissAfterMs = CONFIG.dismissAfterMs,
    timerState = "idle",
    height = VIEW.minHeight,
    canvas = nil
  }

  state.activeById[toast.id] = toast
  state.timers[toast.id] = {
    running = false,
    dueAtMs = 0,
    handle = nil
  }

  table.insert(state.active, 1, toast)
  renderStack()

  return respond(200, {
    ok = true,
    id = toast.id,
    activeCount = #state.active
  })
end

local function handleHover(body)
  local payload, code, message = parseHoverPayload(body)
  if not payload then
    return respondError(400, code, message)
  end

  local timerState, errCode, errMessage = applyHoverState(payload.id, payload.state)
  if not timerState then
    if errCode == "NOT_FOUND" then
      return respondError(404, errCode, errMessage)
    end
    return respondError(400, errCode, errMessage)
  end

  return respond(200, {
    ok = true,
    id = payload.id,
    state = payload.state,
    timer = timerState
  })
end

local function route(method, path, headers, body)
  if not isLoopbackRequest(headers) then
    return respondError(403, "FORBIDDEN_NON_LOCAL", "loopback access only")
  end

  if not requireAuthorized(headers) then
    return respondError(401, "UNAUTHORIZED", "x-opencode-token is missing or invalid")
  end

  local normalizedMethod = string.upper(tostring(method or ""))
  local normalizedPath = tostring(path or ""):match("^[^?]+") or ""
  local key = normalizedMethod .. " " .. normalizedPath

  if key == "GET /opencode/health" then
    return respond(200, { ok = true })
  end

  if key == "POST /opencode/notify" then
    if not contentTypeIsJson(headers) then
      return respondError(415, "UNSUPPORTED_MEDIA_TYPE", "content-type must be application/json")
    end
    return handleNotify(body)
  end

  if key == "GET /opencode/debug/state" then
    return respond(200, snapshotState())
  end

  if key == "POST /opencode/debug/hover" then
    if not contentTypeIsJson(headers) then
      return respondError(415, "UNSUPPORTED_MEDIA_TYPE", "content-type must be application/json")
    end
    return handleHover(body)
  end

  return respondError(404, "NOT_FOUND", "endpoint not found")
end

local function clearState()
  for id, _ in pairs(state.timers) do
    stopTimerForToast(id)
  end
  for _, toast in ipairs(state.active) do
    destroyCanvas(toast)
  end

  state.active = {}
  state.activeById = {}
  state.timers = {}
  state.nextId = 1
end

local function resolveToken(options)
  if type(options.token) == "string" and options.token ~= "" then
    return options.token
  end

  if hs.settings and type(hs.settings.get) == "function" then
    local fromSettings = hs.settings.get("opencode.notify.token")
    if type(fromSettings) == "string" and fromSettings ~= "" then
      return fromSettings
    end
  end

  local fromEnv = os.getenv("OPENCODE_NOTIFY_TOKEN")
  if type(fromEnv) == "string" and fromEnv ~= "" then
    return fromEnv
  end

  return nil
end

function M.start(options)
  if type(hs) ~= "table"
    or type(hs.httpserver) ~= "table"
    or type(hs.timer) ~= "table"
    or type(hs.json) ~= "table"
    or type(hs.canvas) ~= "table"
    or type(hs.screen) ~= "table" then
    error("Hammerspoon runtime is required")
  end

  options = options or {}
  local token = resolveToken(options)
  if not token then
    error("Missing shared token. Set options.token, hs.settings key opencode.notify.token, or OPENCODE_NOTIFY_TOKEN")
  end

  if state.server then
    state.server:stop()
    state.server = nil
  end

  clearState()
  state.token = token

  local server = hs.httpserver.new(false, false)
  server:maxBodySize(CONFIG.maxBodyBytes)
  server:setInterface(CONFIG.bindHost)
  server:setPort(CONFIG.port)
  server:setName("opencode-notify")
  server:setCallback(route)
  server:start()

  state.server = server
  return M
end

function M.stop()
  if state.server then
    state.server:stop()
    state.server = nil
  end
  clearState()
  state.token = nil
end

function M.isRunning()
  return state.server ~= nil
end

function M.debugState()
  return snapshotState()
end

function M.config()
  return {
    bindHost = CONFIG.bindHost,
    port = CONFIG.port,
    maxVisible = CONFIG.maxVisible,
    dismissAfterMs = CONFIG.dismissAfterMs
  }
end

return M
