import { buildAllowanceView, usagePeriodPatch } from "../shared/usage-limits.js"

const API_BASE_URL = "https://y-tchattrans.vercel.app";

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

async function syncProfile() {
  const { authToken } = await chrome.storage.local.get("authToken")
  if (!authToken) {
    document.getElementById("btnShowAuth").style.display = "block"
    document.getElementById("btnSignOut").style.display = "none"
    return
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api/user/me`, {
      headers: { "Authorization": `Bearer ${authToken}` }
    })
    
    if (res.status === 401) {
      // Token is invalid/expired, sign out user
      await chrome.storage.local.remove(["authToken", "isPro", "userEmail"])
      document.getElementById("btnShowAuth").style.display = "block"
      document.getElementById("btnSignOut").style.display = "none"
      return
    }

    if (res.ok) {
      const data = await res.json()
      // Save synced fields to local storage
      await chrome.storage.local.set({
        isPro: data.isPro,
        usageDaily: data.usageDaily,
        usageMonthly: data.usageMonthly,
        userEmail: data.email
      })

      // Show signed in view
      document.getElementById("btnShowAuth").style.display = "none"
      const btnSignOut = document.getElementById("btnSignOut")
      btnSignOut.style.display = "flex"
      btnSignOut.title = `Sign Out (${data.email})`
    }
  } catch (err) {
    console.error("Failed to sync profile with server:", err)
    // If offline, still show signed in state based on presence of authToken
    const { userEmail } = await chrome.storage.local.get("userEmail")
    document.getElementById("btnShowAuth").style.display = "none"
    const btnSignOut = document.getElementById("btnSignOut")
    btnSignOut.style.display = "flex"
    if (userEmail) btnSignOut.title = `Sign Out (${userEmail})`
  }
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

  await syncProfile()
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
  const label = limit === 1 ? "video" : "videos"
  if (left <= 0) return `${limit} of ${limit} ${label} used`
  return `${used} of ${limit} ${label} used`
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

const authMessage = document.getElementById("authMessage")

function displayAuthMsg(type, text) {
  authMessage.textContent = text
  authMessage.className = `auth-message ${type}`
  authMessage.style.display = "block"
}

function clearAuthMsg() {
  authMessage.textContent = ""
  authMessage.className = "auth-message"
  authMessage.style.display = "none"
}

function switchAuthState(state) {
  currentAuthState = state
  clearAuthMsg()
  
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
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault()
  clearAuthMsg()
  
  const email = document.getElementById("signupEmail").value.trim()
  const password = document.getElementById("signupPassword").value
  
  const btn = signupForm.querySelector("button[type='submit']")
  const origText = btn.textContent
  btn.textContent = "Signing Up..."
  btn.disabled = true
  
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    })
    
    const data = await res.json()
    if (res.ok) {
      displayAuthMsg("success", data.message || "Registration successful! Check your inbox to verify your email.")
      signupForm.reset()
    } else {
      displayAuthMsg("error", data.error || "Failed to create account.")
    }
  } catch (err) {
    displayAuthMsg("error", "Network error. Please make sure the backend server is running.")
  } finally {
    btn.textContent = origText
    btn.disabled = false
  }
})

forgotForm.addEventListener("submit", async (e) => {
  e.preventDefault()
  clearAuthMsg()
  
  const email = document.getElementById("forgotEmail").value.trim()
  const btn = forgotForm.querySelector("button[type='submit']")
  const origText = btn.textContent
  btn.textContent = "Sending Link..."
  btn.disabled = true
  
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    })
    
    const data = await res.json()
    if (res.ok) {
      displayAuthMsg("success", data.message || "Reset link sent! Check your email inbox.")
      forgotForm.reset()
    } else {
      displayAuthMsg("error", data.error || "Failed to send reset link.")
    }
  } catch (err) {
    displayAuthMsg("error", "Network error. Please make sure the backend server is running.")
  } finally {
    btn.textContent = origText
    btn.disabled = false
  }
})

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault()
  clearAuthMsg()
  
  const email = document.getElementById("loginEmail").value.trim()
  const password = document.getElementById("loginPassword").value
  
  const btn = loginForm.querySelector("button[type='submit']")
  const origText = btn.textContent
  btn.textContent = "Logging In..."
  btn.disabled = true
  
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    })
    
    const data = await res.json()
    if (res.ok) {
      await chrome.storage.local.set({
        authToken: data.token,
        isPro: data.user.isPro,
        usageDaily: data.user.usageDaily,
        usageMonthly: data.user.usageMonthly,
        userEmail: data.user.email
      })
      
      document.getElementById("btnShowAuth").style.display = "none"
      const btnSignOut = document.getElementById("btnSignOut")
      btnSignOut.style.display = "flex"
      btnSignOut.title = `Sign Out (${data.user.email})`
      
      loginForm.reset()
      showView("mainView")
    } else if (res.status === 403 && data.pendingVerification) {
      displayAuthMsg("info", data.error || "Please verify your email address. A fresh link has been sent to your inbox.")
    } else {
      displayAuthMsg("error", data.error || "Invalid email or password.")
    }
  } catch (err) {
    displayAuthMsg("error", "Network error. Please make sure the backend server is running.")
  } finally {
    btn.textContent = origText
    btn.disabled = false
  }
})

// Google Sign-In
document.querySelector(".btn-google").addEventListener("click", () => {
  const CLIENT_ID = "488192202806-19athdfac58v2u4ekpisn6eq9101berh.apps.googleusercontent.com";
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const scope = "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";
  const authUrl =
    `https://accounts.google.com/o/oauth2/auth` +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&response_type=token` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}`;

  chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async (redirectUrl) => {
    if (chrome.runtime.lastError || !redirectUrl) {
      const errMsg = chrome.runtime.lastError ? chrome.runtime.lastError.message : "Cancelled";
      displayAuthMsg("error", `Google Sign-In failed: ${errMsg}`);
      return;
    }

    const token = new URLSearchParams(new URL(redirectUrl).hash.slice(1)).get("access_token");
    if (!token) {
      displayAuthMsg("error", "Google Sign-In failed: No token received.");
      return;
    }

    const btnGoogle = document.querySelector(".btn-google");
    const origHtml = btnGoogle.innerHTML;
    btnGoogle.disabled = true;
    btnGoogle.innerText = "Signing in with Google...";

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });

      const data = await res.json();
      if (res.ok) {
        await chrome.storage.local.set({
          authToken: data.token,
          isPro: data.user.isPro,
          usageDaily: data.user.usageDaily,
          usageMonthly: data.user.usageMonthly,
          userEmail: data.user.email
        });
        displayAuthMsg("success", "Welcome back!");

        document.getElementById("btnShowAuth").style.display = "none";
        const btnSignOut = document.getElementById("btnSignOut");
        btnSignOut.style.display = "flex";
        btnSignOut.title = `Sign Out (${data.user.email})`;

        loginForm.reset();
        signupForm.reset();
        showView("mainView");
      } else {
        displayAuthMsg("error", data.error || "Google authentication failed.");
      }
    } catch (err) {
      displayAuthMsg("error", "Network error. Please make sure the backend server is running.");
    } finally {
      btnGoogle.disabled = false;
      btnGoogle.innerHTML = origHtml;
    }
  });
});

document.getElementById("btnSignOut").addEventListener("click", async () => {
  await chrome.storage.local.remove(["authToken", "isPro", "usageDaily", "usageMonthly", "userEmail", "lastTranslatedVideoId"])
  document.getElementById("btnShowAuth").style.display = "block"
  document.getElementById("btnSignOut").style.display = "none"
  
  // Clear forms
  loginForm.reset()
  signupForm.reset()
  forgotForm.reset()
  clearAuthMsg()
  
  // Go back to main
  showView("mainView")
})

// Placeholder links
document.getElementById("linkRating").addEventListener("click", (e) => {
  e.preventDefault()
  alert("Redirecting to Chrome Web Store...")
})

