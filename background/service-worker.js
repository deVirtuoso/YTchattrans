import {
  allowanceForBatch,
  buildAllowanceView,
  normalizeUsage,
  usageAfterConsume,
  usagePeriodPatch
} from "../shared/usage-limits.js"

const API_BASE_URL = "https://y-tchattrans.vercel.app";

async function consumeBackendUsage(count) {
  const { authToken } = await chrome.storage.local.get("authToken")
  if (!authToken || authToken === "demo-token-123") return

  try {
    const res = await fetch(`${API_BASE_URL}/api/user/consume`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken}`
      },
      body: JSON.stringify({ count })
    })
    
    if (res.ok) {
      const data = await res.json()
      if (data.user) {
        await chrome.storage.local.set({
          isPro: data.user.isPro,
          usageDaily: data.user.usageDaily,
          usageMonthly: data.user.usageMonthly
        })
      }
    }
  } catch (err) {
    console.error("Failed to sync usage with backend server:", err)
  }
}

const GOOGLE_API_KEY = "AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520"

const SERVICES = {
  google: "google",
  google2: "google2",
  microsoft: "microsoft",
  yandex: "yandex"
}

const LANG = {
  auto: "auto",
  "zh-cn": "zh-CN",
  "zh-tw": "zh-TW",
  ja: "ja",
  en: "en",
  ko: "ko",
  fr: "fr",
  es: "es",
  ru: "ru",
  de: "de",
  it: "it",
  tr: "tr",
  "pt-pt": "pt",
  "pt-br": "pt",
  vi: "vi",
  id: "id",
  th: "th",
  ms: "ms",
  ar: "ar",
  hi: "hi",
  "mn-cy": "mn",
  km: "km",
  "nb-no": "no",
  "nn-no": "no",
  fa: "fa",
  sv: "sv",
  pl: "pl",
  nl: "nl",
  uk: "uk"
}

const MS_LANG = {
  auto: "",
  "zh-cn": "zh-Hans",
  "zh-tw": "zh-Hant",
  en: "en",
  ja: "ja",
  ko: "ko",
  fr: "fr",
  es: "es",
  ru: "ru",
  de: "de",
  it: "it",
  tr: "tr",
  "pt-pt": "pt-pt",
  "pt-br": "pt",
  vi: "vi",
  id: "id",
  th: "th",
  ms: "ms",
  ar: "ar",
  hi: "hi",
  km: "km",
  "nb-no": "nb",
  fa: "fa",
  sv: "sv",
  pl: "pl",
  nl: "nl",
  uk: "uk"
}

const YANDEX_LANG = {
  auto: "",
  "zh-cn": "zh",
  "zh-tw": "zh",
  en: "en",
  ja: "ja",
  ko: "ko",
  fr: "fr",
  es: "es",
  ru: "ru",
  de: "de",
  it: "it",
  tr: "tr",
  "pt-pt": "pt",
  "pt-br": "pt",
  vi: "vi",
  id: "id",
  th: "th",
  ms: "ms",
  ar: "ar",
  hi: "hi",
  "nb-no": "no",
  "nn-no": "no",
  fa: "fa",
  sv: "sv",
  pl: "pl",
  nl: "nl",
  uk: "uk"
}

function mapLang(code, table) {
  const key = (code || "auto").toLowerCase()
  return table[key] ?? key
}

/** Google HTML API returns entities like &#39; — normalize to plain text. */
function plainTextFromHtml(value) {
  if (!value || typeof value !== "string") return ""

  let text = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")

  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))

  return text.replace(/\n{3,}/g, "\n\n").trim()
}

let msToken = { value: "", expiresAt: 0 }

async function getMicrosoftToken() {
  if (msToken.value && Date.now() < msToken.expiresAt) {
    return msToken.value
  }

  const res = await fetch("https://edge.microsoft.com/translate/auth", {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
    }
  })

  if (!res.ok) {
    msToken = { value: "", expiresAt: 0 }
    throw new Error(`Microsoft token failed: ${res.status}`)
  }

  const value = await res.text()
  msToken = { value, expiresAt: Date.now() + 4 * 60 * 1000 }
  return value
}

async function translateGoogle(texts, from, to) {
  const url = new URL("https://translate.googleapis.com/translate_a/t")
  url.searchParams.set("client", "gtx")
  url.searchParams.set("dt", "t")
  url.searchParams.set("sl", mapLang(from, LANG))
  url.searchParams.set("tl", mapLang(to, LANG))
  url.searchParams.set("format", "text")

  const body = texts.map((t) => `q=${encodeURIComponent(t)}`).join("&")
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "*/*"
    },
    body
  })

  if (!res.ok) {
    throw new Error(`Google translate failed: ${res.status}`)
  }

  const payload = await res.json()
  return payload.map((entry) =>
    plainTextFromHtml(typeof entry === "string" ? entry : entry[0])
  )
}

async function translateGoogle2(texts, from, to) {
  const res = await fetch("https://translate-pa.googleapis.com/v1/translateHtml", {
    method: "POST",
    headers: {
      "Content-Type": "application/json+protobuf",
      "X-Goog-API-Key": GOOGLE_API_KEY
    },
    body: JSON.stringify([[texts, mapLang(from, LANG), mapLang(to, LANG)], "wt_lib"])
  })

  if (!res.ok) {
    throw new Error(`Google2 translate failed: ${res.status}`)
  }

  const payload = await res.json()
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
    throw new Error("Google2 translate returned unexpected format")
  }

  return payload[0].map(plainTextFromHtml)
}

async function translateMicrosoft(texts, from, to) {
  let source = mapLang(from, MS_LANG)
  const target = mapLang(to, MS_LANG) || "en"
  if (source === "auto") source = ""

  const token = await getMicrosoftToken()
  const url = new URL("https://api-edge.cognitive.microsofttranslator.com/translate")
  url.searchParams.set("api-version", "3.0")
  url.searchParams.set("includeSentenceLength", "true")
  url.searchParams.set("to", target)
  if (source) url.searchParams.set("from", source)

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(texts.map((Text) => ({ Text })))
  })

  if (!res.ok) {
    msToken = { value: "", expiresAt: 0 }
    throw new Error(`Microsoft translate failed: ${res.status}`)
  }

  const payload = await res.json()
  return payload.map((row) => row.translations[0]?.text?.trim() ?? "")
}

function randomId() {
  return crypto.randomUUID().replaceAll("-", "")
}

async function translateYandex(texts, from, to) {
  const source = mapLang(from, YANDEX_LANG)
  const target = mapLang(to, YANDEX_LANG) || "en"
  const params = new URLSearchParams()
  params.set("srv", "tr-url-widget")
  params.set("id", `${randomId()}-0-0`)
  params.set("format", "html")
  params.set("lang", source ? `${source}-${target}` : target)
  texts.forEach((text) => params.append("text", text))

  const res = await fetch(
    `https://translate.yandex.net/api/v1/tr.json/translate?${params}`,
    { headers: { accept: "*/*" } }
  )

  if (!res.ok) {
    throw new Error(`Yandex translate failed: ${res.status}`)
  }

  const payload = await res.json()
  if (!payload.text) {
    throw new Error("Yandex translate returned no text")
  }

  return payload.text.map(plainTextFromHtml)
}

async function translateWithProvider(service, texts, from, to) {
  switch (service) {
    case SERVICES.google:
      return translateGoogle(texts, from, to)
    case SERVICES.google2:
      return translateGoogle2(texts, from, to)
    case SERVICES.microsoft:
      return translateMicrosoft(texts, from, to)
    case SERVICES.yandex:
      return translateYandex(texts, from, to)
    default:
      throw new Error(`Unknown service: ${service}`)
  }
}

async function translateBatch({ service, from, to, texts }) {
  const list = Array.isArray(texts) ? texts : [texts]
  if (list.length === 0) return { texts: [] }

  let stored = await chrome.storage.local.get(["isPro", "usageDaily", "usageMonthly"])
  const periodPatch = usagePeriodPatch(stored)
  if (periodPatch) {
    await chrome.storage.local.set(periodPatch)
    stored = { ...stored, ...periodPatch }
  }
  const allowance = allowanceForBatch(stored, list.length)

  if (!allowance.isPro && allowance.allowed === 0) {
    return {
      texts: [],
      limitExceeded: true,
      usage: buildAllowanceView(stored)
    }
  }

  const toTranslate = allowance.isPro ? list : list.slice(0, allowance.allowed)

  const providers = [
    service,
    SERVICES.microsoft,
    SERVICES.yandex,
    SERVICES.google,
    SERVICES.google2
  ].filter((name, index, all) => all.indexOf(name) === index)

  let lastError = null
  for (const name of providers) {
    try {
      const textsOut = await translateWithProvider(name, toTranslate, from, to)
      if (!allowance.isPro && textsOut.length > 0) {
        const { usageDaily, usageMonthly } = normalizeUsage(stored)
        const next = usageAfterConsume(usageDaily, usageMonthly, textsOut.length)
        await chrome.storage.local.set(next)
      }
      if (textsOut.length > 0) {
        await consumeBackendUsage(textsOut.length)
      }
      const usage = buildAllowanceView(
        await chrome.storage.local.get(["isPro", "usageDaily", "usageMonthly"])
      )
      return {
        texts: textsOut,
        limitExceeded: !allowance.isPro && allowance.allowed < list.length,
        usage
      }
    } catch (error) {
      lastError = error
    }
  }

  return {
    texts: [],
    error: lastError instanceof Error ? lastError.message : String(lastError),
    usage: buildAllowanceView(stored)
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === "usage:get") {
    chrome.storage.local
      .get(["isPro", "usageDaily", "usageMonthly"])
      .then((stored) => sendResponse({ usage: buildAllowanceView(stored) }))
    return true
  }

  if (!message?.action?.startsWith("translate:")) return

  translateBatch(message.body)
    .then((result) => sendResponse({ ...result, action: message.action }))
    .catch((error) =>
      sendResponse({
        texts: [],
        error: error instanceof Error ? error.message : String(error),
        action: message.action
      })
    )

  return true
})
