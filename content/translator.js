const SELECTORS = {
  receivedMsgContainer: "#content-text",
  receivedMsgEl: ".ytAttributedStringHost",
  receivedStreamMsgContainer: "#content.yt-live-chat-text-message-renderer",
  receivedStreamMsgEl: "#message.yt-live-chat-text-message-renderer"
}

const DEFAULTS = {
  enabled: true,
  yourLanguage: normalizeLang(navigator.language),
  engine: "microsoft",
  color: "#1a73e8",
  bilingualDisplay: false
}

let settings = { ...DEFAULTS }
let scanScheduled = false
let activeController = null
let bilingualToggleButton = null

function normalizeLang(code) {
  if (!code) return "en"
  const base = code.toLowerCase().split("-")[0]
  const full = code.toLowerCase()
  if (full.startsWith("zh")) {
    return full.includes("tw") || full.includes("hk") ? "zh-tw" : "zh-cn"
  }
  if (full.startsWith("pt")) {
    return full.includes("br") ? "pt-br" : "pt-pt"
  }
  return base
}

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    "enabled",
    "yourLanguage",
    "engine",
    "color",
    "bilingualDisplay"
  ])
  settings = {
    enabled: stored.enabled ?? DEFAULTS.enabled,
    yourLanguage: stored.yourLanguage ?? DEFAULTS.yourLanguage,
    engine: stored.engine ?? DEFAULTS.engine,
    color: stored.color ?? DEFAULTS.color,
    bilingualDisplay: stored.bilingualDisplay ?? DEFAULTS.bilingualDisplay
  }
}

function getMessageEl(container) {
  return (
    container.querySelector(SELECTORS.receivedMsgEl) ||
    container.querySelector(SELECTORS.receivedStreamMsgEl)
  )
}

function setBilingualOnContainer(container) {
  const msgEl = getMessageEl(container)
  const translation = container.querySelector(".ytctl-translation")
  if (!msgEl || !translation) return

  container.querySelectorAll("[data-translation-divider]").forEach((el) => el.remove())

  if (settings.bilingualDisplay) {
    delete msgEl.dataset.hidingOrigin
    const divider = document.createElement("hr")
    divider.dataset.translationDivider = "true"
    container.insertBefore(divider, translation)
  } else {
    msgEl.dataset.hidingOrigin = "true"
  }
}

function refreshBilingualDisplay() {
  document.querySelectorAll('[data-translated="true"]').forEach(setBilingualOnContainer)
  updateBilingualToggleButton()
}

function updateBilingualToggleButton() {
  if (!bilingualToggleButton) return
  const on = settings.bilingualDisplay
  bilingualToggleButton.textContent = on ? "Both languages" : "Translation only"
  bilingualToggleButton.setAttribute("aria-pressed", String(on))
  bilingualToggleButton.title = on
    ? "Showing original and translation — click for translation only"
    : "Showing translation only — click to show both languages"
}

function mountBilingualToggle() {
  if (window !== window.top || bilingualToggleButton) return

  bilingualToggleButton = document.createElement("button")
  bilingualToggleButton.type = "button"
  bilingualToggleButton.id = "ytctl-bilingual-toggle"
  bilingualToggleButton.className = "ytctl-float-btn"
  bilingualToggleButton.addEventListener("click", () => {
    settings.bilingualDisplay = !settings.bilingualDisplay
    chrome.storage.local.set({ bilingualDisplay: settings.bilingualDisplay })
    refreshBilingualDisplay()
  })

  document.documentElement.appendChild(bilingualToggleButton)
  updateBilingualToggleButton()
}

function shouldSkipTranslation(text) {
  const value = text.trim()
  if (!value) return true

  // Emoji / symbols only (e.g. "👍👍", "💙💙")
  if (/^[\s\p{Extended_Pictographic}\u200d\ufe0f]+$/u.test(value)) return true

  // YouTube internal emoji shortcodes (e.g. face-fuchsia-wide-eyes)
  if (/^(?:face-[a-z0-9-]+)+$/i.test(value)) return true
  if (!/\s/.test(value) && /face-[a-z0-9-]+/i.test(value)) return true

  return false
}

function clearTranslation(node) {
  node.querySelectorAll(".ytctl-translation, [data-translation-divider]").forEach((el) =>
    el.remove()
  )
  delete node.dataset.translated
  delete node.dataset.targetLang
  delete node.dataset.translationMessage
  const msgEl = getMessageEl(node)
  if (msgEl) delete msgEl.dataset.hidingOrigin
}

function collectMessages(containerSelector, textSelector) {
  const nodes = document.querySelectorAll(
    `${containerSelector}:not([data-translation-message])`
  )
  const batch = []

  nodes.forEach((container) => {
    if (!(container instanceof HTMLElement)) return
    if (container.dataset.translated === "true") return

    const textEl = container.querySelector(textSelector)
    const text = textEl?.textContent?.trim()
    if (!text) return
    if (shouldSkipTranslation(text)) {
      container.dataset.translated = "true"
      container.dataset.translationMessage = "true"
      return
    }

    container.dataset.translated = "false"
    container.dataset.targetLang = settings.yourLanguage
    container.dataset.translationMessage = "true"
    batch.push({ container, textEl, text })
  })

  return batch
}

function applyTranslations(items, translations) {
  items.forEach((item, index) => {
    const translated = translations[index]
    if (!translated || translated === item.text) {
      clearTranslation(item.container)
      return
    }

    clearTranslation(item.container)

    const span = document.createElement("span")
    span.className = "ytctl-translation"
    span.style.color = settings.color
    span.textContent = translated
    item.container.appendChild(span)
    item.container.dataset.translated = "true"
    setBilingualOnContainer(item.container)
  })
}

async function translateBatch(items) {
  if (items.length === 0) return

  if (activeController) activeController.abort()
  const controller = new AbortController()
  activeController = controller

  let videoId = null
  try {
    const url = new URL(window.location.href)
    videoId = url.searchParams.get("v")
  } catch (e) {}

  const action = `translate:${Date.now()}`
  const response = await chrome.runtime.sendMessage({
    action,
    body: {
      texts: items.map((item) => item.text),
      from: "auto",
      to: settings.yourLanguage,
      service: settings.engine,
      videoId: videoId || "default"
    }
  })

  if (controller.signal.aborted) {
    items.forEach((item) => clearTranslation(item.container))
    return
  }

  if (!response || response.action !== action) {
    items.forEach((item) => clearTranslation(item.container))
    return
  }

  if (response.limitExceeded && (!response.texts || response.texts.length === 0)) {
    items.forEach((item) => clearTranslation(item.container))
    return
  }

  if (response.error || !response.texts) {
    items.forEach((item) => clearTranslation(item.container))
    return
  }

  const translated = response.texts
  applyTranslations(items.slice(0, translated.length), translated)
}

function ensureBilingualToggle() {
  if (window !== window.top) return
  if (!document.getElementById("ytctl-bilingual-toggle")) {
    bilingualToggleButton = null
    mountBilingualToggle()
  }
}

async function scan() {
  scanScheduled = false
  ensureBilingualToggle()
  if (!settings.enabled) return

  const comments = collectMessages(
    SELECTORS.receivedMsgContainer,
    SELECTORS.receivedMsgEl
  )
  const chat = collectMessages(
    SELECTORS.receivedStreamMsgContainer,
    SELECTORS.receivedStreamMsgEl
  )

  const all = [...comments, ...chat]
  if (all.length === 0) return

  const chunkSize = 12
  for (let i = 0; i < all.length; i += chunkSize) {
    await translateBatch(all.slice(i, i + chunkSize))
  }
}

function scheduleScan() {
  if (scanScheduled) return
  scanScheduled = true
  requestAnimationFrame(() => {
    scan().catch(() => {})
  })
}

function throttle(fn, waitMs) {
  let last = 0
  let timer = null
  return (...args) => {
    const now = Date.now()
    const run = () => {
      last = Date.now()
      timer = null
      fn(...args)
    }
    if (now - last >= waitMs) {
      run()
    } else if (!timer) {
      timer = setTimeout(run, waitMs - (now - last))
    }
  }
}

const throttledScan = throttle(scheduleScan, 800)

async function init() {
  await loadSettings()

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return
    if (changes.enabled) settings.enabled = changes.enabled.newValue ?? true
    if (changes.yourLanguage) {
      settings.yourLanguage = changes.yourLanguage.newValue ?? DEFAULTS.yourLanguage
    }
    if (changes.engine) settings.engine = changes.engine.newValue ?? DEFAULTS.engine
    if (changes.color) settings.color = changes.color.newValue ?? DEFAULTS.color
    if (changes.bilingualDisplay !== undefined) {
      settings.bilingualDisplay =
        changes.bilingualDisplay.newValue ?? DEFAULTS.bilingualDisplay
      refreshBilingualDisplay()
    }
    scheduleScan()
  })

  const observer = new MutationObserver(throttledScan)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  })

  mountBilingualToggle()
  throttledScan()
}

init().catch(() => {})
