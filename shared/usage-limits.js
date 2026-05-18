export const STRIPE_CHECKOUT_URL =
  "https://buy.stripe.com/7sY3cx1TNeYA7BuaVg9fW00"

export const FREE_DAILY_LIMIT = 1
export const FREE_MONTHLY_LIMIT = 5

export function localDateKey(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function monthKey(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  return `${y}-${m}`
}

export function normalizeUsage(stored = {}) {
  const today = localDateKey()
  const month = monthKey()
  let usageDaily = stored.usageDaily
  let usageMonthly = stored.usageMonthly

  if (!usageDaily || usageDaily.period !== today) {
    usageDaily = { period: today, count: 0 }
  }
  if (!usageMonthly || usageMonthly.period !== month) {
    usageMonthly = { period: month, count: 0 }
  }

  return { usageDaily, usageMonthly }
}

export function buildAllowanceView(stored = {}) {
  const isPro = !!stored.isPro
  const { usageDaily, usageMonthly } = normalizeUsage(stored)
  const dailyUsed = usageDaily.count
  const monthlyUsed = usageMonthly.count
  const dailyLeft = Math.max(0, FREE_DAILY_LIMIT - dailyUsed)
  const monthlyLeft = Math.max(0, FREE_MONTHLY_LIMIT - monthlyUsed)

  return {
    isPro,
    usageDaily,
    usageMonthly,
    dailyUsed,
    monthlyUsed,
    dailyLimit: FREE_DAILY_LIMIT,
    monthlyLimit: FREE_MONTHLY_LIMIT,
    dailyLeft,
    monthlyLeft,
    canTranslate: isPro || (dailyLeft > 0 && monthlyLeft > 0)
  }
}

export function allowanceForBatch(stored, requestedCount) {
  const view = buildAllowanceView(stored)
  if (view.isPro) {
    return { allowed: requestedCount, ...view }
  }
  const allowed = Math.min(requestedCount, view.dailyLeft, view.monthlyLeft)
  return { allowed, ...view }
}

export function usageAfterConsume(usageDaily, usageMonthly, count) {
  return {
    usageDaily: { ...usageDaily, count: usageDaily.count + count },
    usageMonthly: { ...usageMonthly, count: usageMonthly.count + count }
  }
}

/** Reset counters when the calendar day or month changes. */
export function usagePeriodPatch(stored = {}) {
  const { usageDaily, usageMonthly } = normalizeUsage(stored)
  const patch = {}
  if (stored.usageDaily?.period !== usageDaily.period) patch.usageDaily = usageDaily
  if (stored.usageMonthly?.period !== usageMonthly.period) {
    patch.usageMonthly = usageMonthly
  }
  return Object.keys(patch).length ? patch : null
}
