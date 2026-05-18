import { buildAllowanceView, usagePeriodPatch } from "../shared/usage-limits.js"

const LANGUAGES = [
  ["auto", "Auto-detect source"],
  ["en", "English"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt-br", "Portuguese (Brazil)"],
  ["pt-pt", "Portuguese"],
  ["ru", "Russian"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh-cn", "Chinese (Simplified)"],
  ["zh-tw", "Chinese (Traditional)"],
  ["ar", "Arabic"],
  ["hi", "Hindi"],
  ["id", "Indonesian"],
  ["th", "Thai"],
  ["vi", "Vietnamese"],
  ["tr", "Turkish"],
  ["pl", "Polish"],
  ["nl", "Dutch"],
  ["uk", "Ukrainian"]
]

const DEFAULTS = {
  enabled: true,
  yourLanguage: "en",
  engine: "microsoft",
  color: "#1a73e8",
  bilingualDisplay: false
}

const enabledEl = document.getElementById("enabled")
const bilingualEl = document.getElementById("bilingualDisplay")
const langEl = document.getElementById("yourLanguage")
const engineEl = document.getElementById("engine")
const colorEl = document.getElementById("color")

for (const [code, label] of LANGUAGES) {
  if (code === "auto") continue
  const opt = document.createElement("option")
  opt.value = code
  opt.textContent = label
  langEl.appendChild(opt)
}

function detectLanguage() {
  const code = (navigator.language || "en").toLowerCase()
  if (code.startsWith("zh")) {
    return code.includes("tw") || code.includes("hk") ? "zh-tw" : "zh-cn"
  }
  if (code.startsWith("pt")) {
    return code.includes("br") ? "pt-br" : "pt-pt"
  }
  return code.split("-")[0]
}

async function load() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS))
  const yourLanguage = stored.yourLanguage ?? detectLanguage()

  enabledEl.checked = stored.enabled ?? DEFAULTS.enabled
  bilingualEl.checked = stored.bilingualDisplay ?? DEFAULTS.bilingualDisplay
  langEl.value = yourLanguage
  engineEl.value = stored.engine ?? DEFAULTS.engine
  colorEl.value = stored.color ?? DEFAULTS.color

  if (stored.yourLanguage === undefined) {
    await chrome.storage.local.set({ yourLanguage })
  }
}

function save(patch) {
  chrome.storage.local.set(patch)
}

enabledEl.addEventListener("change", () => save({ enabled: enabledEl.checked }))
bilingualEl.addEventListener("change", () =>
  save({ bilingualDisplay: bilingualEl.checked })
)
langEl.addEventListener("change", () => save({ yourLanguage: langEl.value }))
engineEl.addEventListener("change", () => save({ engine: engineEl.value }))
colorEl.addEventListener("change", () => save({ color: colorEl.value }))

load()

const allowanceBanner = document.getElementById("allowanceBanner")
const proBadge = document.getElementById("proBadge")
const proSection = document.getElementById("proSection")
const dailyAllowanceEl = document.getElementById("dailyAllowance")
const monthlyAllowanceEl = document.getElementById("monthlyAllowance")

function formatUsage(used, limit, left) {
  if (left <= 0) return `${limit} of ${limit} used`
  return `${used} of ${limit} used`
}

async function refreshAllowance() {
  let stored = await chrome.storage.local.get(["isPro", "usageDaily", "usageMonthly"])
  const periodPatch = usagePeriodPatch(stored)
  if (periodPatch) {
    await chrome.storage.local.set(periodPatch)
    stored = { ...stored, ...periodPatch }
  }
  const usage = buildAllowanceView(stored)

  if (usage.isPro) {
    allowanceBanner.style.display = "none"
    proBadge.style.display = "block"
    proSection.style.display = "none"
    return
  }

  allowanceBanner.style.display = "flex"
  proBadge.style.display = "none"
  proSection.style.display = "block"

  dailyAllowanceEl.textContent = formatUsage(
    usage.dailyUsed,
    usage.dailyLimit,
    usage.dailyLeft
  )
  monthlyAllowanceEl.textContent = formatUsage(
    usage.monthlyUsed,
    usage.monthlyLimit,
    usage.monthlyLeft
  )

  dailyAllowanceEl.classList.toggle("depleted", usage.dailyLeft === 0)
  monthlyAllowanceEl.classList.toggle("depleted", usage.monthlyLeft === 0)
}

refreshAllowance()

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return
  if (changes.isPro || changes.usageDaily || changes.usageMonthly) {
    refreshAllowance()
  }
})

// --- UI Interaction Logic ---

const mainView = document.getElementById("mainView")
const authView = document.getElementById("authView")
const btnShowAuth = document.getElementById("btnShowAuth")
const btnBackToMain = document.getElementById("btnBackToMain")

// Auth forms and links
const loginForm = document.getElementById("loginForm")
const signupForm = document.getElementById("signupForm")
const forgotForm = document.getElementById("forgotForm")
const authTitle = document.getElementById("authTitle")
const linkToggleAuth = document.getElementById("linkToggleAuth")
const authSwitchText = document.getElementById("authSwitchText")
const linkToForgot = document.getElementById("linkToForgot")

let currentAuthState = "login" // 'login', 'signup', 'forgot'

function showView(viewId) {
  mainView.classList.remove("active")
  authView.classList.remove("active")
  document.getElementById(viewId).classList.add("active")
}

btnShowAuth.addEventListener("click", () => showView("authView"))
btnBackToMain.addEventListener("click", () => showView("mainView"))

function switchAuthState(state) {
  currentAuthState = state
  
  // Hide all forms
  loginForm.classList.remove("active")
  signupForm.classList.remove("active")
  forgotForm.classList.remove("active")
  
  const switchContainer = document.querySelector(".auth-switch")
  const divider = document.querySelector(".auth-divider")
  const btnGoogle = document.querySelector(".btn-google")

  if (state === "login") {
    authTitle.textContent = "Sign In"
    loginForm.classList.add("active")
    authSwitchText.textContent = "Don't have an account?"
    linkToggleAuth.textContent = "Sign up"
    switchContainer.style.display = "block"
    divider.style.display = "flex"
    btnGoogle.style.display = "flex"
  } else if (state === "signup") {
    authTitle.textContent = "Create Account"
    signupForm.classList.add("active")
    authSwitchText.textContent = "Already have an account?"
    linkToggleAuth.textContent = "Login"
    switchContainer.style.display = "block"
    divider.style.display = "flex"
    btnGoogle.style.display = "flex"
  } else if (state === "forgot") {
    authTitle.textContent = "Reset Password"
    forgotForm.classList.add("active")
    switchContainer.style.display = "none"
    divider.style.display = "none"
    btnGoogle.style.display = "none"
  }
}

linkToggleAuth.addEventListener("click", (e) => {
  e.preventDefault()
  if (currentAuthState === "login") {
    switchAuthState("signup")
  } else {
    switchAuthState("login")
  }
})

linkToForgot.addEventListener("click", (e) => {
  e.preventDefault()
  switchAuthState("forgot")
})

// Auth form submissions
document.getElementById("signupForm").addEventListener("submit", (e) => {
  e.preventDefault()
  alert("This functionality will be connected later.")
})

document.getElementById("forgotForm").addEventListener("submit", (e) => {
  e.preventDefault()
  alert("Reset link sent (placeholder).")
})

document.getElementById("loginForm").addEventListener("submit", (e) => {
  e.preventDefault()
  const email = document.getElementById("loginEmail").value
  const password = document.getElementById("loginPassword").value
  
  if (email === "test@test.com" && password === "password") {
    document.getElementById("btnShowAuth").style.display = "none"
    document.getElementById("btnSignOut").style.display = "flex"
    showView("mainView")
  } else {
    alert("Invalid credentials. Try test@test.com / password for the trial demo.")
  }
})

document.getElementById("btnSignOut").addEventListener("click", () => {
  document.getElementById("btnShowAuth").style.display = "block"
  document.getElementById("btnSignOut").style.display = "none"

  // Reset form
  document.getElementById("loginEmail").value = ""
  document.getElementById("loginPassword").value = ""
})

// Placeholder links
document.getElementById("linkRating").addEventListener("click", (e) => {
  e.preventDefault()
  alert("Redirecting to Chrome Web Store...")
})

