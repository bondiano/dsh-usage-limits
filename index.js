/**
 * Host half of `@local/dsh-usage-limits`.
 *
 * Collects the limit data the running harness can actually observe — provider
 * quota windows, provider balances, the default model's capacity, and a few
 * deployment limits — and serves one JSON snapshot on a same-origin plugin
 * route. The Client half renders it in a left-sidebar panel. No secret leaves
 * this process: only percentages, reset instants, plan labels, and balances
 * travel over the route.
 *
 * @module @local/dsh-usage-limits
 */

/** Route the Client half reads; same origin, GET/HEAD only. */
const ROUTE = '/plugin-api/usage-limits/limits'

/** Provider endpoints, all account-level and read-only. */
const OPENCODE_GO_URL = 'https://opencode.ai/zen/go/v1/usage'
const ZAI_URL = 'https://api.z.ai/api/monitor/usage/quota/limit'
const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance'
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

/** Attribution for the background polls, matching each provider's expectation. */
const USER_AGENT = 'DeepSeek-Harness-usage-limits/0.1'

/** Stable per-process session id for the OpenCode Go usage poll. */
const OPENCODE_SESSION = (globalThis.crypto?.randomUUID?.() ?? `usage-${Date.now()}`)

/** Resolved defaults for a row that omits its config. */
const DEFAULTS = Object.freeze({ refreshSeconds: 60, requestTimeoutMs: 8000 })

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** The only mounted service this plugin must have; the rest are optional reads. */
export const inject = ['webServer']

/**
 * Register the limits snapshot route.
 * @param ctx - Host plugin context carrying `webServer` and the optional services read below.
 * @param config - row config: `refreshSeconds`, `requestTimeoutMs`.
 */
export function apply(ctx, config = {}) {
  const resolved = {
    refreshSeconds: positive(config?.refreshSeconds, DEFAULTS.refreshSeconds),
    requestTimeoutMs: positive(config?.requestTimeoutMs, DEFAULTS.requestTimeoutMs),
  }
  let cached
  let cachedAt = 0
  let inflight

  /**
   * Answer with a snapshot, reusing the cached one inside the refresh window.
   * @param force - true to bypass the cache (the panel's Refresh action).
   * @returns the snapshot.
   */
  function snapshot(force) {
    const fresh = !force && cached !== undefined && Date.now() - cachedAt < resolved.refreshSeconds * 1000
    if (fresh) return Promise.resolve(cached)
    if (inflight !== undefined) return inflight
    inflight = collect(ctx, resolved)
      .then((result) => {
        cached = result
        cachedAt = Date.now()
        return result
      })
      .finally(() => { inflight = undefined })
    return inflight
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    resource: async (request) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
      }
      if (!trusted(request)) return new Response('forbidden', { status: 403 })
      try {
        const url = new URL(request.url)
        const data = await snapshot(url.searchParams.get('refresh') === '1')
        return json(data)
      } catch (error) {
        return json({ generatedAt: new Date().toISOString(), error: reason(error) }, 500)
      }
    },
  }), 'usage-limits: limits route')
}

/**
 * A browser request from another site must not read this snapshot, and the
 * route serves nothing but the plugin's own panel.
 * @param request - the incoming resource request.
 * @returns whether the request may read the snapshot.
 */
function trusted(request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  // The route exists on this machine only: a LAN-bound or proxied listener
  // must not hand balances to whoever reaches it.
  const authority = request.headers.get('host')
  if (authority === null || !isLoopbackAuthority(authority)) return false
  const origin = request.headers.get('origin')
  if (origin === null || origin === '') return true
  try {
    const parsed = new URL(origin)
    return isLoopback(parsed.hostname)
  } catch {
    return false
  }
}

/** @param authority - a Host header value. @returns whether it names this machine. */
function isLoopbackAuthority(authority) {
  try {
    return isLoopback(new URL(`http://${authority}`).hostname)
  } catch {
    return false
  }
}

/** @param host - hostname to classify. @returns whether it names this machine. */
function isLoopback(host) {
  return host === 'localhost' || host === '::1' || host === '[::1]' || /^127\./.test(host) || host.endsWith('.localhost')
}

/** @param data - JSON-compatible payload. @param status - HTTP status. @returns a no-store JSON response. */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Build the complete snapshot; every section fails independently.
 * @param ctx - Host plugin context.
 * @param config - resolved row config.
 * @returns the snapshot value.
 */
async function collect(ctx, config) {
  const credentials = service(ctx, 'credentials')
  const readKey = keyReader(credentials)

  const [opencodeGo, zai, deepseek, codex] = await Promise.all([
    readOpencodeGo(readKey, config),
    readZai(readKey, config),
    readDeepseek(readKey, config),
    readCodex(credentials, config),
  ])
  const [model, platform] = await Promise.all([readModel(ctx, config), readPlatform(ctx)])

  return {
    generatedAt: new Date().toISOString(),
    refreshSeconds: config.refreshSeconds,
    providers: [opencodeGo, zai, deepseek, codex],
    model,
    platform,
  }
}

/**
 * Read one optional Cordis service.
 * @param ctx - Host plugin context.
 * @param name - service name.
 * @returns the service, or undefined when this composition has none.
 */
function service(ctx, name) {
  try {
    return ctx.get?.(name)
  } catch {
    return undefined
  }
}

/**
 * Resolve credential references through the credential plane, falling back to
 * the launching process environment.
 * @param credentials - the optional credentials service.
 * @returns a reader for one environment-style reference name.
 */
function keyReader(credentials) {
  return async (name) => {
    try {
      const hit = await credentials?.resolve(name)
      const value = typeof hit?.value === 'string' ? hit.value.trim() : ''
      if (value !== '') return value
    } catch {
      // A composition without a credential plane falls through to the environment.
    }
    const ambient = typeof process !== 'undefined' ? process.env?.[name] : undefined
    return typeof ambient === 'string' && ambient.trim() !== '' ? ambient.trim() : undefined
  }
}

/**
 * Read the OpenCode Go rolling, weekly, and monthly windows.
 * @param readKey - credential reader.
 * @param config - resolved row config.
 * @returns a provider section.
 */
async function readOpencodeGo(readKey, config) {
  const provider = { id: 'opencode-go', name: 'OpenCode Go', kind: 'quota', windows: [] }
  const credential = await readKey('OPENCODE_GO_API_KEY')
  if (credential === undefined) return { ...provider, status: 'no-credential', secret: 'OPENCODE_GO_API_KEY' }
  try {
    const response = await timedFetch(OPENCODE_GO_URL, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${credential}`,
        'user-agent': USER_AGENT,
        'x-opencode-session': OPENCODE_SESSION,
      },
    }, config)
    if (!response.ok) return httpFailure(provider, response, 'OPENCODE_GO_API_KEY')
    const payload = await response.json()
    const usage = payload?.usage ?? {}
    const windows = []
    for (const [key, meta] of [
      ['rolling', { id: '5h', label: '5 hours' }],
      ['weekly', { id: '7d', label: 'Weekly' }],
      ['monthly', { id: '1mo', label: 'Monthly' }],
    ]) {
      const window = usage[key]
      if (!window || typeof window.percent !== 'number') continue
      windows.push({
        window: meta.id,
        label: meta.label,
        kind: 'quota',
        usedPercent: clampPercent(window.percent),
        resetsAt: isoMs(window.resetsAt),
        exhausted: window.status === 'rate-limited',
      })
    }
    return { ...provider, status: 'ok', windows }
  } catch (error) {
    return { ...provider, status: 'error', message: reason(error) }
  }
}

/**
 * Read the Z.AI coding-plan quota windows.
 * @param readKey - credential reader.
 * @param config - resolved row config.
 * @returns a provider section.
 */
async function readZai(readKey, config) {
  const provider = { id: 'zai', name: 'Z.AI', kind: 'quota', windows: [] }
  const credential = await readKey('ZAI_API_KEY')
  if (credential === undefined) return { ...provider, status: 'no-credential', secret: 'ZAI_API_KEY' }
  try {
    const response = await timedFetch(ZAI_URL, {
      headers: { accept: 'application/json', authorization: `Bearer ${credential}`, 'user-agent': USER_AGENT },
    }, config)
    if (!response.ok) return httpFailure(provider, response, 'ZAI_API_KEY')
    const payload = await response.json()
    if (payload?.success === false) {
      return { ...provider, status: 'error', message: typeof payload.msg === 'string' ? payload.msg : 'Z.AI refused the quota request' }
    }
    const limits = Array.isArray(payload?.data?.limits) ? payload.data.limits : []
    const windows = []
    for (const item of limits) {
      const percent = number(item?.percentage)
      if (percent === undefined) continue
      const window = zaiWindow(item)
      const used = number(item?.currentValue)
      const limit = number(item?.usage)
      // A counted meter reports a floored whole percent that can disagree with
      // its own counters; the exact ratio is the honest number when both exist.
      const counted = used !== undefined && limit !== undefined && limit > 0
        ? clampPercent(used / limit * 100)
        : clampPercent(percent)
      windows.push({
        window: window.id,
        label: window.label,
        kind: item?.type === 'TIME_LIMIT' ? 'requests' : 'tokens',
        usedPercent: counted,
        used,
        limit,
        resetsAt: timestamp(item?.nextResetTime),
      })
    }
    windows.sort((left, right) => windowRank(left.window) - windowRank(right.window))
    const plan = typeof payload?.data?.level === 'string' && payload.data.level !== '' ? payload.data.level : undefined
    return { ...provider, status: 'ok', windows, ...(plan === undefined ? {} : { plan }) }
  } catch (error) {
    return { ...provider, status: 'error', message: reason(error) }
  }
}

/**
 * Map one Z.AI limit item to a window descriptor.
 * @param item - one `data.limits[]` entry.
 * @returns the window id and English fallback label.
 */
function zaiWindow(item) {
  const declared = number(item?.number)
  const count = declared !== undefined && declared > 0 ? declared : 1
  switch (number(item?.unit)) {
    case 3: return { id: `${count}h`, label: count === 1 ? 'Hourly' : `${count} hours` }
    case 4: return { id: `${count}d`, label: count === 1 ? 'Daily' : `${count} days` }
    case 5: return { id: '1mo', label: 'Monthly' }
    case 6: return { id: '7d', label: 'Weekly' }
    default: return { id: 'quota', label: 'Quota' }
  }
}

/** @param id - window id. @returns a sort rank for known windows. */
function windowRank(id) {
  if (id === '1h') return 1
  if (id === '5h') return 2
  if (id === '1d') return 3
  if (id === '7d') return 4
  if (id === '1mo') return 5
  return 9
}

/**
 * Read the DeepSeek API balance.
 * @param readKey - credential reader.
 * @param config - resolved row config.
 * @returns a provider section.
 */
async function readDeepseek(readKey, config) {
  const provider = { id: 'deepseek', name: 'DeepSeek', kind: 'balance' }
  const credential = await readKey('DEEPSEEK_API_KEY')
  if (credential === undefined) return { ...provider, status: 'no-credential', secret: 'DEEPSEEK_API_KEY' }
  try {
    const response = await timedFetch(DEEPSEEK_BALANCE_URL, {
      headers: { accept: 'application/json', authorization: `Bearer ${credential}`, 'user-agent': USER_AGENT },
    }, config)
    if (!response.ok) return httpFailure(provider, response, 'DEEPSEEK_API_KEY')
    const payload = await response.json()
    const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : []
    const balances = []
    for (const info of infos) {
      if (!info || typeof info.currency !== 'string') continue
      balances.push({
        currency: info.currency,
        total: number(info.total_balance),
        granted: number(info.granted_balance),
        toppedUp: number(info.topped_up_balance),
      })
    }
    return { ...provider, status: 'ok', available: payload?.is_available !== false, balances }
  } catch (error) {
    return { ...provider, status: 'error', message: reason(error) }
  }
}

/**
 * Read the Codex plan windows from a stored OAuth grant, when one exists.
 * @param credentials - the optional credentials service.
 * @param config - resolved row config.
 * @returns a provider section.
 */
async function readCodex(credentials, config) {
  const provider = { id: 'openai-codex', name: 'OpenAI Codex', kind: 'quota', windows: [] }
  if (credentials === undefined) return { ...provider, status: 'no-credential' }
  let record
  try {
    record = await credentials.readRecord('llm-pi-ai/openai-codex')
  } catch {
    record = undefined
  }
  const grant = record?.kind === 'grant' ? record.payload : undefined
  const access = firstString(grant?.accessToken, grant?.access, grant?.access_token)
  if (access === undefined) return { ...provider, status: 'no-credential' }

  const expiresAt = expiryMs(grant)
  if (expiresAt !== undefined && expiresAt <= Date.now()) {
    return { ...provider, status: 'expired' }
  }
  const accountId = firstString(grant?.accountId, grant?.account_id)
    ?? jwtClaim(access, 'https://api.openai.com/auth', 'chatgpt_account_id')
  const headers = { accept: 'application/json', authorization: `Bearer ${access}`, 'user-agent': USER_AGENT }
  if (accountId !== undefined) headers['chatgpt-account-id'] = accountId
  try {
    const response = await timedFetch(CODEX_USAGE_URL, { headers }, config)
    if (!response.ok) return httpFailure(provider, response)
    const payload = await response.json()
    const windows = codexWindows(payload)
    const plan = typeof payload?.plan_type === 'string' && payload.plan_type !== '' ? payload.plan_type : undefined
    return {
      ...provider,
      status: 'ok',
      windows,
      ...(plan === undefined ? {} : { plan }),
    }
  } catch (error) {
    return { ...provider, status: 'error', message: reason(error) }
  }
}

/** @param payload - `/wham/usage` body. @returns normalized plan windows. */
function codexWindows(payload) {
  const windows = []
  const rateLimit = payload?.rate_limit
  appendWindow(windows, rateLimit?.primary_window, '5h', '5 hours')
  appendWindow(windows, rateLimit?.secondary_window, '7d', 'Weekly')
  for (const extra of Array.isArray(payload?.additional_rate_limits) ? payload.additional_rate_limits : []) {
    appendWindow(windows, extra?.rate_limit?.primary_window, 'extra', firstString(extra?.limit_name) ?? 'Extra')
  }
  return windows
}

/** @param windows - output list. @param raw - one Codex window payload. @param fallbackId - window id when the payload names no duration. @param fallbackLabel - label fallback. */
function appendWindow(windows, raw, fallbackId, fallbackLabel) {
  const percent = number(raw?.used_percent)
  if (percent === undefined) return
  const seconds = number(raw?.limit_window_seconds)
  const id = seconds === undefined ? fallbackId
    : seconds >= 20 * DAY_MS / 1000 ? '1mo'
    : seconds >= 5 * DAY_MS / 1000 ? '7d'
    : seconds >= 4 * HOUR_MS / 1000 ? '5h'
    : '1h'
  const label = id === '1mo' ? 'Monthly' : id === '7d' ? 'Weekly' : id === '5h' ? '5 hours' : fallbackLabel
  windows.push({
    window: id,
    label,
    kind: 'tokens',
    usedPercent: clampPercent(percent),
    resetsAt: resetInstant(raw),
  })
}

/** @param raw - one Codex window payload. @returns its absolute reset instant in ms. */
function resetInstant(raw) {
  const at = number(raw?.reset_at)
  if (at !== undefined) return at > 1e12 ? at : at * 1000
  const after = number(raw?.reset_after_seconds)
  return after === undefined ? undefined : Date.now() + after * 1000
}

/** @param grant - stored OAuth payload. @returns its expiry instant in ms. */
function expiryMs(grant) {
  const at = number(grant?.expiresAt) ?? number(grant?.expires_at)
  if (at !== undefined) return at > 1e12 ? at : at * 1000
  const seconds = number(grant?.expires)
  return seconds === undefined ? undefined : seconds > 1e12 ? seconds : seconds * 1000
}

/**
 * Read one claim from a JWT-shaped access token.
 * @param token - the access token.
 * @param claim - claim namespace.
 * @param member - member inside the claim namespace.
 * @returns the string member, when present.
 */
function jwtClaim(token, claim, member) {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    const json = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    const value = json?.[claim]?.[member]
    return typeof value === 'string' && value !== '' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Read the default model selection and resolve its capacity.
 * @param ctx - Host plugin context.
 * @param config - resolved row config.
 * @returns the model section, or null when no default model is configured.
 */
async function readModel(ctx, config) {
  const llm = service(ctx, 'llm')
  let selection
  try {
    selection = service(ctx, 'agentDefaultModel')?.currentSelection?.()
  } catch {
    selection = undefined
  }
  if (llm === undefined || selection === undefined || selection?.provider === undefined || selection?.model === undefined) {
    return null
  }
  const section = { provider: selection.provider, model: selection.model }
  if (selection.reasoningEffort !== undefined) section.reasoningEffort = selection.reasoningEffort
  try {
    const info = await withTimeout(llm.resolveModelInfo(selection.provider, selection.model), config.requestTimeoutMs)
    if (typeof info?.name === 'string') section.name = info.name
    if (typeof info?.context?.contextWindow === 'number') section.contextWindow = info.context.contextWindow
    if (typeof info?.defaultMaxTokens === 'number') section.maxTokens = info.defaultMaxTokens
    const efforts = info?.reasoning?.efforts
    if (Array.isArray(efforts)) section.reasoningEfforts = efforts.map((effort) => effort?.id).filter((id) => typeof id === 'string')
  } catch {
    // Capacity stays unknown; the model row still names the route.
  }
  return section
}

/**
 * Read deployment limits other services expose.
 * @param ctx - Host plugin context.
 * @returns the platform section.
 */
async function readPlatform(ctx) {
  const platform = {}
  try {
    const depth = service(ctx, 'subagents')?.resolveMaxDepth?.()
    if (typeof depth === 'number') platform.subagentDepth = depth
  } catch {
    // A composition without subagents states no depth.
  }
  try {
    const limits = service(ctx, 'attachments')?.imageLimits
    if (limits && typeof limits === 'object') {
      platform.images = {
        maxBytes: number(limits.maxImageBytes),
        maxPerMessage: number(limits.maxImagesPerMessage),
        maxMessageBytes: number(limits.maxMessageImageBytes),
      }
    }
  } catch {
    // Image admission limits are optional.
  }
  try {
    const delivery = service(ctx, 'schedule')?.deliveryLimits?.()
    if (typeof delivery?.newSessionIntervalSeconds === 'number') {
      platform.scheduleIntervalSeconds = delivery.newSessionIntervalSeconds
    }
  } catch {
    // Schedule may be absent or fail before activation; omit the row.
  }
  return platform
}

/**
 * Fetch with the configured timeout.
 * @param url - request URL.
 * @param init - fetch options.
 * @param config - resolved row config.
 * @returns the response.
 */
async function timedFetch(url, init, config) {
  const timeout = AbortSignal.timeout(config.requestTimeoutMs)
  return fetch(url, { ...init, signal: timeout })
}

/** @param provider - provider section. @param response - failed response. @returns the failed section. */
function httpFailure(provider, response, secret) {
  const status = response.status
  const base = secret === undefined ? provider : { ...provider, secret }
  if (status === 401 || status === 403) {
    return { ...base, status: 'auth', message: `HTTP ${status}` }
  }
  return { ...base, status: 'error', message: `HTTP ${status} ${response.statusText}`.trim() }
}

/** @param value - candidate number. @returns a finite number, or undefined. */
function number(value) {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined
}

/** @param value - candidate string. @returns the first non-empty string. */
function firstString(...values) {
  for (const value of values) if (typeof value === 'string' && value.trim() !== '') return value.trim()
  return undefined
}

/** @param value - percent. @returns it clamped at zero; overage stays visible. */
function clampPercent(value) {
  return Math.max(number(value) ?? 0, 0)
}

/** @param value - ISO timestamp. @returns epoch ms, or undefined. */
function isoMs(value) {
  if (typeof value !== 'string' || value === '') return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed < 8.64e15 ? parsed : undefined
}

/** @param value - epoch seconds or milliseconds. @returns epoch ms, or undefined. */
function timestamp(value) {
  const parsed = number(value)
  if (parsed === undefined || parsed <= 0) return undefined
  const ms = parsed > 1e12 ? parsed : parsed * 1000
  return ms < 8.64e15 ? ms : undefined
}

/** @param error - any thrown value. @returns a short message without request state. */
function reason(error) {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'request timed out'
    return error.message
  }
  return String(error)
}

/** @param promise - operation to bound. @param ms - timeout in milliseconds. @returns its value, or undefined on timeout. */
async function withTimeout(promise, ms) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => { timer = setTimeout(() => resolve(undefined), ms) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** @param value - candidate number. @param fallback - value to use when unusable. @returns a positive finite number. */
function positive(value, fallback) {
  const parsed = number(value)
  return parsed !== undefined && parsed > 0 ? parsed : fallback
}
