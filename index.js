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

import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Route the Client half reads; same origin, GET/HEAD only. */
const ROUTE = '/plugin-api/usage-limits/limits'

/** The provider rows the panel asks for one at a time, in display order. */
const PROVIDER_IDS = Object.freeze([
  'opencode-go', 'zai', 'deepseek',
  'openai-codex', 'claude', 'grok', 'github-copilot', 'google-antigravity',
])

/** Provider endpoints, all account-level and read-only. */
const OPENCODE_GO_URL = 'https://opencode.ai/zen/go/v1/usage'
const ZAI_URL = 'https://api.z.ai/api/monitor/usage/quota/limit'
const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance'
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const COPILOT_QUOTA_URL = 'https://api.github.com/copilot_internal/user'
const ANTIGRAVITY_QUOTA_URL = 'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary'
const ANTIGRAVITY_CODE_ASSIST_URL = 'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'
const ANTIGRAVITY_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const CLAUDE_TOKEN_URL = 'https://claude.ai/v1/oauth/token'
const GROK_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits'
const GROK_DEFAULT_TOKEN_URL = 'https://auth.x.ai/oauth2/token'

/** Public OAuth client ids of the Claude Code and Grok CLI apps. */
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const GROK_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'

/** Claude's usage endpoint identifies the caller as the Claude Code CLI. */
const CLAUDE_USER_AGENT = 'claude-cli/2.1.283 (external, cli)'

/** Grok's billing endpoint only answers the CLI's own token-auth header. */
const GROK_TOKEN_AUTH = 'xai-grok-cli'

/** Display names for the numeric subscription tiers xAI stamps on its tokens. */
const GROK_TIERS = Object.freeze({
  0: 'Free',
  1: 'SuperGrok',
  2: 'X Basic',
  3: 'X Premium',
  4: 'X Premium+',
  5: 'SuperGrok Heavy',
  6: 'SuperGrok Lite',
  7: 'SuperGrok Plus',
})

/**
 * The public Antigravity desktop OAuth client identity is read from the
 * installed subscriptions bundle (see `antigravityClient`) so this plugin
 * carries no OAuth client credential of its own. The refresh token that
 * actually authorizes a call stays in the Host.
 */
/** Antigravity calls this CLI identity its backend expects. */
const ANTIGRAVITY_USER_AGENT = `antigravity/cli/1.3.4 (${process.platform}; ${process.arch})`
/** Antigravity gates its v1internal methods behind this assistant metadata. */
const ANTIGRAVITY_METADATA = Object.freeze({
  ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI',
})
/** The account-wide quota families Antigravity reports, in display order. */
const ANTIGRAVITY_SCOPES = Object.freeze(['Gemini Models', 'Claude and GPT models', 'Gemini 4 Argon'])

/**
 * The subscription plugin's OAuth document, relative to the harness home.
 * `dsh-plugin-subscriptions` owns the ChatGPT/Codex, Claude, Grok, GitHub
 * Copilot, and Google Antigravity logins made from Settings → Subscriptions;
 * that document, not the credential plane, is where those grants live.
 */
const SUBSCRIPTIONS_DOCUMENT = Object.freeze(['plugins', 'subscriptions', 'auth.json'])

/** Attribution for the background polls, matching each provider's expectation. */
const USER_AGENT = 'DeepSeek-Harness-usage-limits/0.1'

/** Stable per-process session id for the OpenCode Go usage poll. */
const OPENCODE_SESSION = (globalThis.crypto?.randomUUID?.() ?? `usage-${Date.now()}`)

/**
 * Refreshed OAuth access tokens, keyed by provider and refresh token. The
 * subscription document stays the plugin's to write; this cache only carries
 * a token this process obtained between snapshot reads.
 */
const refreshedTokens = new Map()

/** Resolved defaults for a row that omits its config. */
const DEFAULTS = Object.freeze({ refreshSeconds: 60, requestTimeoutMs: 8000 })

/** Short plan labels for the identifiers providers report. */
const PLAN_LABELS = Object.freeze({
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  promax: 'Pro Max',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
  individual: 'Individual',
  individual_max: 'Individual Max',
  max: 'Max',
  supergrok: 'SuperGrok',
  'supergrok heavy': 'SuperGrok Heavy',
})

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** The only mounted service this plugin must have; the rest are optional reads. */
export const inject = ['webServer']

/**
 * Register the limits route.
 *
 * The panel asks per block — `?provider=<id>` for one provider card and
 * `?section=overview` for the model and platform cards — so a slow provider
 * cannot hold the others behind it. One request without those parameters still
 * answers the whole snapshot for callers that want it in one round trip.
 * @param ctx - Host plugin context carrying `webServer` and the optional services read below.
 * @param config - row config: `refreshSeconds`, `requestTimeoutMs`.
 */
export function apply(ctx, config = {}) {
  const resolved = {
    refreshSeconds: positive(config?.refreshSeconds, DEFAULTS.refreshSeconds),
    requestTimeoutMs: positive(config?.requestTimeoutMs, DEFAULTS.requestTimeoutMs),
  }
  /** Cached answers per block key, and the polls currently producing them. */
  const cached = new Map()
  const inflight = new Map()
  const ttl = resolved.refreshSeconds * 1000

  /**
   * Answer one block from its cache inside the refresh window, sharing an
   * in-flight poll between the cards and the aggregate route.
   * @param key - cache key: `provider:<id>` or `overview`.
   * @param force - true to bypass the cache (a card's Refresh action).
   * @param produce - the read to run when the cache is stale.
   * @returns the block value.
   */
  function remember(key, force, produce) {
    const hit = cached.get(key)
    if (!force && hit !== undefined && Date.now() - hit.at < ttl) return Promise.resolve(hit.value)
    const running = inflight.get(key)
    if (running !== undefined) return running
    const poll = produce()
      .then((value) => {
        cached.set(key, { value, at: Date.now() })
        return value
      })
      .finally(() => { inflight.delete(key) })
    inflight.set(key, poll)
    return poll
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    resource: async (request) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
      }
      if (!trusted(request)) return new Response('forbidden', { status: 403 })
      const url = new URL(request.url)
      const force = url.searchParams.get('refresh') === '1'
      const generatedAt = new Date().toISOString()
      try {
        const provider = url.searchParams.get('provider')
        if (provider !== null) {
          if (!PROVIDER_IDS.includes(provider)) {
            return json({ generatedAt, error: `unknown provider "${provider}"` }, 400)
          }
          const section = await remember(`provider:${provider}`, force,
            () => readProviderSection(ctx, resolved, provider))
          return json({ generatedAt, refreshSeconds: resolved.refreshSeconds, provider: section })
        }
        if (url.searchParams.get('section') === 'overview') {
          const overview = await remember('overview', force, () => readOverview(ctx, resolved))
          return json({ generatedAt, refreshSeconds: resolved.refreshSeconds, ...overview })
        }
        const [providers, overview] = await Promise.all([
          Promise.all(PROVIDER_IDS.map((id) => remember(`provider:${id}`, force,
            () => readProviderSection(ctx, resolved, id)))),
          remember('overview', force, () => readOverview(ctx, resolved)),
        ])
        return json({ generatedAt, refreshSeconds: resolved.refreshSeconds, providers, ...overview })
      } catch (error) {
        return json({ generatedAt, error: reason(error) }, 500)
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
 * Read one provider section by its route id; every section fails independently.
 * @param ctx - Host plugin context.
 * @param config - resolved row config.
 * @param id - provider id from {@link PROVIDER_IDS}.
 * @returns the provider section.
 */
async function readProviderSection(ctx, config, id) {
  const credentials = service(ctx, 'credentials')
  switch (id) {
    case 'opencode-go': return readOpencodeGo(keyReader(credentials), config)
    case 'zai': return readZai(keyReader(credentials), config)
    case 'deepseek': return readDeepseek(keyReader(credentials), config)
    case 'openai-codex': return readCodex(credentials, config)
    case 'claude': return readClaude(credentials, config)
    case 'grok': return readGrok(credentials, config)
    case 'github-copilot': return readCopilot(credentials, config)
    case 'google-antigravity': return readAntigravity(credentials, config)
    default: return undefined
  }
}

/**
 * Read the deployment-owned cards: the default model and the platform limits.
 * @param ctx - Host plugin context.
 * @param config - resolved row config.
 * @returns the overview sections.
 */
async function readOverview(ctx, config) {
  const [model, platform] = await Promise.all([readModel(ctx, config), readPlatform(ctx)])
  return { model, platform }
}

/**
 * Read one OAuth grant payload from the credential plane.
 * @param credentials - the optional credentials service.
 * @param key - exact credential record key.
 * @returns the grant payload, or undefined when no grant is stored.
 */
async function grantPayload(credentials, key) {
  try {
    const record = await credentials?.readRecord(key)
    return record?.kind === 'grant' ? record.payload : undefined
  } catch {
    return undefined
  }
}

/**
 * Read the subscription plugin's document. It is the durable store behind
 * Settings → Subscriptions, so its grants are exactly the logins that plugin
 * serves requests with.
 * @returns the parsed document, or undefined when that bundle is not installed.
 */
async function subscriptionStore() {
  let text
  try {
    text = await readFile(join(harnessHome(), ...SUBSCRIPTIONS_DOCUMENT), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the default account's session for one subscription provider. Older
 * single-account documents keep the session fields at the entry root, so both
 * shapes are accepted.
 * @param provider - subscription provider id, such as `codex` or `copilot`.
 * @returns the session object, or undefined when the provider has no account.
 */
async function subscriptionSession(provider) {
  const store = await subscriptionStore()
  const entry = store?.[provider]
  if (entry === null || typeof entry !== 'object') return undefined
  const accounts = entry.accounts
  if (accounts === null || typeof accounts !== 'object') return entry
  const keys = Object.keys(accounts)
  if (keys.length === 0) return undefined
  const preferred = typeof entry.default === 'string' && Object.hasOwn(accounts, entry.default)
    ? entry.default
    : keys[0]
  const session = accounts[preferred]
  return session !== null && typeof session === 'object' ? session : undefined
}

/** @returns this machine's harness home. */
function harnessHome() {
  const configured = typeof process !== 'undefined' ? process.env?.DSH_HOME?.trim() : undefined
  return configured !== undefined && configured !== '' ? configured : join(homedir(), '.dsh')
}

let antigravityClientPromise

/**
 * Resolve the public Antigravity desktop OAuth client. The identity is
 * distributed by the subscriptions bundle and the Antigravity app, never as a
 * per-user credential; it is read from the installed bundle instead of being
 * duplicated here. `DSH_ANTIGRAVITY_CLIENT_ID` and
 * `DSH_ANTIGRAVITY_CLIENT_SECRET` override the lookup.
 * @returns the public client id and secret.
 */
function antigravityClient() {
  antigravityClientPromise ??= resolveAntigravityClient()
  return antigravityClientPromise
}

/** @returns the client identity from the environment or the subscriptions bundle. */
async function resolveAntigravityClient() {
  const configuredId = process.env?.DSH_ANTIGRAVITY_CLIENT_ID?.trim()
  const configuredSecret = process.env?.DSH_ANTIGRAVITY_CLIENT_SECRET?.trim()
  if (configuredId !== undefined && configuredId !== '' && configuredSecret !== undefined && configuredSecret !== '') {
    return { id: configuredId, secret: configuredSecret }
  }
  const profiles = join(harnessHome(), 'profiles')
  const profileDirs = []
  const active = process.env?.DSH_PROFILE_DIR?.trim()
  if (active !== undefined && active !== '') profileDirs.push(active)
  try {
    for (const name of await readdir(profiles)) profileDirs.push(join(profiles, name))
  } catch {
    // A harness home without profiles still allows the environment override.
  }
  for (const dir of profileDirs) {
    try {
      const requireFromProfile = createRequire(join(dir, 'package.json'))
      const manifest = requireFromProfile.resolve('dsh-plugin-subscriptions/package.json')
      const modulePath = join(dirname(manifest), 'lib', 'providers', 'antigravity-oauth-client.js')
      const client = await import(pathToFileURL(modulePath).href)
      const id = client.ANTIGRAVITY_DEFAULT_CLIENT_ID
      const secret = client.ANTIGRAVITY_DEFAULT_CLIENT_SECRET
      if (typeof id === 'string' && id !== '' && typeof secret === 'string' && secret !== '') {
        return { id, secret }
      }
    } catch {
      // Try the next installed profile.
    }
  }
  throw new SubscriptionAuthError(
    'the Antigravity OAuth client is unavailable; install dsh-plugin-subscriptions or set DSH_ANTIGRAVITY_CLIENT_ID and DSH_ANTIGRAVITY_CLIENT_SECRET',
  )
}

/**
 * Turn a provider plan identifier into the short label the panel renders.
 * @param value - raw plan id, such as `promax` or `individual_max`.
 * @returns a display label, or undefined when the provider named no plan.
 */
function planLabel(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const known = PLAN_LABELS[value.trim().toLowerCase()]
  return known ?? value.trim()
}

/** @param value - `YYYY-MM-DD`. @returns its UTC-midnight instant in ms, or undefined. */
function dateOnlyMs(value) {
  if (typeof value !== 'string' || value === '') return undefined
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(parsed) && parsed < 8.64e15 ? parsed : undefined
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
 * Read the GitHub Copilot quota windows.
 *
 * `copilot_internal/user` is the account endpoint the Copilot editor
 * extensions read: it reports the monthly quota snapshots and the plan. The
 * long-lived GitHub token (`refreshToken`) is the one that works there; the
 * stored Copilot API token (`accessToken`) is short-lived and is only a
 * fallback while it is still valid.
 * @param credentials - the optional credentials service.
 * @param config - resolved row config.
 * @returns a provider section.
 */
async function readCopilot(credentials, config) {
  const provider = { id: 'github-copilot', name: 'GitHub Copilot', kind: 'quota', windows: [] }
  const session = await subscriptionSession('copilot')
  const github = firstString(session?.refreshToken, session?.refresh)
  const access = firstString(session?.accessToken, session?.access)
  const grant = await grantPayload(credentials, 'llm-pi-ai/github-copilot')
  const grantToken = firstString(grant?.refreshToken, grant?.refresh, grant?.accessToken, grant?.access)
  const expiresAt = expiryMs(session)
  let token = github
  if (token === undefined && access !== undefined) {
    if (expiresAt === undefined || expiresAt > Date.now()) token = access
  }
  if (token === undefined) token = grantToken
  if (token === undefined) {
    if (access !== undefined || grantToken !== undefined) return { ...provider, status: 'expired' }
    return { ...provider, status: 'no-credential' }
  }
  const headers = { accept: 'application/json', authorization: `token ${token}`, 'user-agent': USER_AGENT }
  try {
    const response = await timedFetch(COPILOT_QUOTA_URL, { headers }, config)
    if (!response.ok) return httpFailure(provider, response)
    const payload = await response.json()
    const plan = planLabel(firstString(payload?.copilot_plan))
    return {
      ...provider,
      status: 'ok',
      windows: copilotWindows(payload),
      ...(plan === undefined ? {} : { plan }),
    }
  } catch (error) {
    return { ...provider, status: 'error', message: reason(error) }
  }
}

/**
 * Map the Copilot account body to normalized quota windows. Unlimited
 * buckets carry no measured quota and stay out; a current body reports
 * `quota_snapshots`, while older plans report a monthly/limited quota pair.
 * @param payload - `/copilot_internal/user` body.
 * @returns normalized windows.
 */
function copilotWindows(payload) {
  const windows = []
  const seen = new Set()
  const resetAt = isoMs(payload?.quota_reset_date_utc) ?? dateOnlyMs(payload?.quota_reset_date)
  const snapshots = payload?.quota_snapshots
  if (snapshots !== null && typeof snapshots === 'object') {
    for (const [id, snapshot] of Object.entries(snapshots)) {
      if (snapshot === null || typeof snapshot !== 'object' || snapshot.unlimited === true) continue
      const entitlement = number(snapshot.entitlement)
      const remaining = number(snapshot.remaining)
      const percentRemaining = number(snapshot.percent_remaining)
      let used
      let limit
      let usedPercent
      if (entitlement !== undefined && entitlement > 0 && remaining !== undefined) {
        used = Math.max(entitlement - remaining, 0)
        limit = entitlement
        usedPercent = clampPercent(used / entitlement * 100)
      } else if (percentRemaining !== undefined) {
        usedPercent = clampPercent(100 - percentRemaining)
      } else {
        continue
      }
      seen.add(id)
      windows.push({
        window: copilotWindowId(id),
        label: copilotWindowLabel(id),
        kind: used === undefined ? 'tokens' : 'requests',
        usedPercent,
        ...(used === undefined ? {} : { used, limit }),
        resetsAt: isoMs(snapshot.quota_reset_at) ?? resetAt,
      })
    }
  }
  const monthly = payload?.monthly_quotas
  const limited = payload?.limited_user_quotas
  if (monthly !== null && typeof monthly === 'object'
    && limited !== null && typeof limited === 'object') {
    for (const [id, total] of Object.entries(monthly)) {
      if (seen.has(id)) continue
      const limit = number(total)
      const remaining = number(limited[id])
      if (limit === undefined || limit <= 0 || remaining === undefined) continue
      windows.push({
        window: copilotWindowId(id),
        label: copilotWindowLabel(id),
        kind: 'requests',
        usedPercent: clampPercent((limit - remaining) / limit * 100),
        used: Math.max(limit - remaining, 0),
        limit,
        resetsAt: isoMs(payload?.limited_user_reset_date) ?? resetAt,
      })
    }
  }
  return windows
}

/** @param id - a Copilot quota bucket id. @returns a stable window id. */
function copilotWindowId(id) {
  if (id === 'premium_interactions') return 'premium'
  if (id === 'chat') return 'chat'
  if (id === 'completions') return 'completions'
  return id.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
}

/** @param id - a Copilot quota bucket id. @returns its English fallback label. */
function copilotWindowLabel(id) {
  if (id === 'premium_interactions') return 'Premium requests'
  if (id === 'chat') return 'Chat requests'
  if (id === 'completions') return 'Code completions'
  return id.replace(/_/g, ' ')
}

/**
 * Read the Claude plan windows.
 *
 * The OAuth usage endpoint behind Claude Code's `/usage` screen reports a
 * structured `limits` array on newer responses and flat buckets on older ones;
 * both are read, the array winning when it carries entries. The access token
 * lives about a day, so an expired one is refreshed through the Claude Code
 * OAuth client and kept only in this process.
 * @param credentials - the optional credentials service.
 * @param config - resolved row config.
 * @returns a provider section.
 */
async function readClaude(credentials, config) {
  const provider = { id: 'claude', name: 'Claude', kind: 'quota', windows: [] }
  const session = await subscriptionSession('claude')
  const stored = firstString(session?.accessToken, session?.access)
  const refresh = firstString(session?.refreshToken, session?.refresh)
  if (stored === undefined && refresh === undefined) return { ...provider, status: 'no-credential' }
  let access
  try {
    access = await claudeAccess(session, stored, refresh, false, config)
  } catch (error) {
    return subscriptionFailure(provider, error)
  }
  if (access === undefined) return { ...provider, status: 'expired' }
  try {
    let response = await timedFetch(CLAUDE_USAGE_URL, { headers: claudeHeaders(access) }, config)
    if (response.status === 401 || response.status === 403) {
      access = await claudeAccess(session, stored, refresh, true, config)
      if (access === undefined) return { ...provider, status: 'expired' }
      response = await timedFetch(CLAUDE_USAGE_URL, { headers: claudeHeaders(access) }, config)
    }
    if (!response.ok) return httpFailure(provider, response)
    const payload = await response.json()
    const plan = planLabel(firstString(session?.subscriptionType, session?.plan))
    return {
      ...provider,
      status: 'ok',
      windows: claudeWindows(payload),
      ...(plan === undefined ? {} : { plan }),
    }
  } catch (error) {
    return subscriptionFailure(provider, error)
  }
}

/**
 * Resolve a Claude access token: the newest usable one from this process or
 * the document, refreshing through the Claude Code OAuth client when needed.
 * @param session - the stored session.
 * @param stored - its access token.
 * @param refresh - its refresh token.
 * @param force - true to refresh now.
 * @param config - resolved row config.
 * @returns the token to send, or undefined when nothing can be refreshed.
 */
async function claudeAccess(session, stored, refresh, force, config) {
  const cached = refresh === undefined ? undefined : cachedAccessToken('claude', refresh)
  const expiresAt = expiryMs(session)
  if (!force) {
    if (cached !== undefined) return cached
    if (stored !== undefined && (expiresAt === undefined || expiresAt > Date.now() + 60_000)) return stored
  }
  if (refresh === undefined) return force ? undefined : stored
  const body = { grant_type: 'refresh_token', refresh_token: refresh, client_id: CLAUDE_CLIENT_ID }
  if (typeof session?.scopes === 'string' && session.scopes !== '') body.scope = session.scopes
  const response = await timedFetch(CLAUDE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  }, config)
  if (!response.ok) throw new SubscriptionAuthError(`token refresh HTTP ${response.status}`)
  const wire = await response.json()
  const access = firstString(wire?.access_token)
  if (access === undefined) throw new SubscriptionAuthError('token refresh returned no access_token')
  rememberAccessToken('claude', refresh, access, Date.now() + (number(wire?.expires_in) ?? 3600) * 1000)
  return access
}

/** @param access - Claude access token. @returns the usage request headers. */
function claudeHeaders(access) {
  return {
    authorization: `Bearer ${access}`,
    'anthropic-beta': 'oauth-2025-04-20',
    'user-agent': CLAUDE_USER_AGENT,
    accept: 'application/json',
  }
}

/**
 * Map the Claude usage body to normalized windows. A scoped weekly window
 * names the model family it applies to.
 * @param payload - `/api/oauth/usage` body.
 * @returns normalized windows.
 */
function claudeWindows(payload) {
  const windows = []
  const limits = Array.isArray(payload?.limits) ? payload.limits : []
  for (const entry of limits) {
    if (entry === null || typeof entry !== 'object') continue
    const percent = number(entry.percent)
    if (percent === undefined) continue
    const session = entry.kind === 'session'
    if (!session && entry.kind !== 'weekly_all' && entry.kind !== 'weekly_scoped') continue
    const scope = firstString(entry?.scope?.model?.display_name)
    windows.push({
      window: session ? '5h' : '7d',
      label: session ? '5 hours' : 'Weekly',
      ...(scope === undefined ? {} : { scope }),
      kind: 'quota',
      usedPercent: clampPercent(percent),
      resetsAt: isoMs(entry?.resets_at),
    })
  }
  if (windows.length > 0) return windows
  for (const [key, window, label, scope] of [
    ['five_hour', '5h', '5 hours'],
    ['seven_day', '7d', 'Weekly'],
    ['seven_day_opus', '7d', 'Weekly', 'Opus'],
    ['seven_day_sonnet', '7d', 'Weekly', 'Sonnet'],
  ]) {
    const bucket = payload?.[key]
    const utilization = number(bucket?.utilization)
    if (utilization === undefined) continue
    windows.push({
      window,
      label,
      ...(scope === undefined ? {} : { scope }),
      kind: 'quota',
      usedPercent: clampPercent(utilization),
      resetsAt: isoMs(bucket?.resets_at),
    })
  }
  return windows
}

/**
 * Read the Grok subscription usage.
 *
 * The Grok Build CLI's billing proxy reports the shared credit window (usually
 * weekly) with a ready-made percentage, and older responses report a monthly
 * credit limit and how much of it was used. The stored access token is
 * refreshed through the same OAuth client the CLI uses when it has expired.
 * @param credentials - the optional credentials service.
 * @param config - resolved row config.
 * @returns a provider section.
 */
async function readGrok(credentials, config) {
  const provider = { id: 'grok', name: 'Grok', kind: 'quota', windows: [] }
  const session = await subscriptionSession('grok')
  const stored = firstString(session?.accessToken, session?.access)
  const refresh = firstString(session?.refreshToken, session?.refresh)
  if (stored === undefined && refresh === undefined) return { ...provider, status: 'no-credential' }
  let access
  try {
    access = await grokAccess(session, stored, refresh, false, config)
  } catch (error) {
    return subscriptionFailure(provider, error)
  }
  if (access === undefined) return { ...provider, status: 'expired' }
  try {
    let response = await timedFetch(GROK_BILLING_URL, { headers: grokHeaders(access) }, config)
    if (response.status === 401 || response.status === 403) {
      access = await grokAccess(session, stored, refresh, true, config)
      if (access === undefined) return { ...provider, status: 'expired' }
      response = await timedFetch(GROK_BILLING_URL, { headers: grokHeaders(access) }, config)
    }
    if (!response.ok) return httpFailure(provider, response)
    const payload = await response.json()
    const plan = planLabel(firstString(payload?.subscriptionTier)) ?? planLabel(grokTier(access))
    return {
      ...provider,
      status: 'ok',
      windows: grokWindows(payload),
      ...(plan === undefined ? {} : { plan }),
    }
  } catch (error) {
    return subscriptionFailure(provider, error)
  }
}

/**
 * Resolve a Grok access token through the stored session's own token endpoint.
 * @param session - the stored session.
 * @param stored - its access token.
 * @param refresh - its refresh token.
 * @param force - true to refresh now.
 * @param config - resolved row config.
 * @returns the token to send, or undefined when nothing can be refreshed.
 */
async function grokAccess(session, stored, refresh, force, config) {
  const cached = refresh === undefined ? undefined : cachedAccessToken('grok', refresh)
  const expiresAt = expiryMs(session)
  if (!force) {
    if (cached !== undefined) return cached
    if (stored !== undefined && (expiresAt === undefined || expiresAt > Date.now() + 60_000)) return stored
  }
  if (refresh === undefined) return force ? undefined : stored
  const endpoint = firstString(session?.tokenEndpoint, session?.token_endpoint) ?? GROK_DEFAULT_TOKEN_URL
  const response = await timedFetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: GROK_CLIENT_ID,
      refresh_token: refresh,
    }).toString(),
  }, config)
  if (!response.ok) throw new SubscriptionAuthError(`token refresh HTTP ${response.status}`)
  const wire = await response.json()
  const access = firstString(wire?.access_token)
  if (access === undefined) throw new SubscriptionAuthError('token refresh returned no access_token')
  rememberAccessToken('grok', refresh, access, Date.now() + (number(wire?.expires_in) ?? 3600) * 1000)
  return access
}

/** @param access - Grok access token. @returns the billing request headers. */
function grokHeaders(access) {
  return {
    authorization: `Bearer ${access}`,
    'x-xai-token-auth': GROK_TOKEN_AUTH,
    accept: 'application/json',
    'user-agent': USER_AGENT,
  }
}

/**
 * Map the Grok billing body to normalized windows. The credits shape carries
 * its own percentage and period; the legacy shape carries credit counts.
 * @param payload - billing body.
 * @returns normalized windows.
 */
function grokWindows(payload) {
  const config = payload?.config
  if (config === null || typeof config !== 'object') return []
  const percent = number(config.creditUsagePercent)
  if (percent !== undefined) {
    const weekly = config.currentPeriod?.type === 'USAGE_PERIOD_TYPE_WEEKLY'
    return [{
      window: weekly ? '7d' : '1mo',
      label: weekly ? 'Weekly' : 'Monthly',
      kind: 'quota',
      usedPercent: clampPercent(percent),
      resetsAt: isoMs(config.currentPeriod?.end),
    }]
  }
  const limit = number(config.monthlyLimit?.val)
  if (limit === undefined || limit <= 0) return []
  const used = number(config.used?.val) ?? 0
  return [{
    window: '1mo',
    label: 'Monthly',
    kind: 'quota',
    usedPercent: clampPercent(used / limit * 100),
    resetsAt: isoMs(config.billingPeriodEnd),
  }]
}

/**
 * @param access - a Grok access token.
 * @returns the display name of its numeric tier claim, when present.
 */
function grokTier(access) {
  const tier = number(jwtPayload(access)?.tier)
  return tier === undefined ? undefined : GROK_TIERS[tier] ?? String(tier)
}

/**
 * Read the Antigravity shared quota families.
 *
 * Antigravity reports one weekly and one 5-hour window per model family
 * (`Gemini Models`, `Claude and GPT models`, and sometimes `Gemini 4 Argon`),
 * all through the same `v1internal` backend the Antigravity client uses. Its
 * access token lives about an hour, so the stored one is refreshed through the
 * public desktop OAuth client; the refreshed token stays in this process and
 * the subscription plugin remains the only writer of its document.
 * @param credentials - the optional credentials service.
 * @param config - resolved row config.
 * @returns a provider section.
 */
async function readAntigravity(credentials, config) {
  const provider = { id: 'google-antigravity', name: 'Google Antigravity', kind: 'quota', windows: [] }
  const session = await subscriptionSession('antigravity')
  const storedAccess = firstString(session?.accessToken, session?.access)
  const refresh = firstString(session?.refreshToken, session?.refresh)
  if (storedAccess === undefined && refresh === undefined) return { ...provider, status: 'no-credential' }

  let access
  try {
    access = await antigravityAccess(storedAccess, refresh, expiryMs(session), false, config)
  } catch (error) {
    return subscriptionFailure(provider, error)
  }
  if (access === undefined) return { ...provider, status: 'expired' }

  try {
    const project = firstString(session?.projectId, session?.project_id)
      ?? await antigravityProject(access, config)
    if (project === undefined) {
      return { ...provider, status: 'error', message: 'the account has no Cloud AI Companion project' }
    }
    let response = await antigravityCall(ANTIGRAVITY_QUOTA_URL, { project }, access, config)
    // A token the document still calls valid can be revoked server-side; one
    // forced refresh is the only retry that can change that answer.
    if (response.status === 401 || response.status === 403) {
      access = await antigravityAccess(storedAccess, refresh, expiryMs(session), true, config)
      if (access === undefined) return { ...provider, status: 'expired' }
      response = await antigravityCall(ANTIGRAVITY_QUOTA_URL, { project }, access, config)
    }
    if (!response.ok) return httpFailure(provider, response)
    const payload = await response.json()
    const plan = firstString(session?.plan)
    return {
      ...provider,
      status: 'ok',
      windows: antigravityWindows(payload),
      ...(plan === undefined ? {} : { plan }),
    }
  } catch (error) {
    return subscriptionFailure(provider, error)
  }
}

/**
 * Resolve an access token for Antigravity: the newest token this process or
 * the document holds while it has more than a minute left, otherwise a refresh
 * through the desktop OAuth client.
 * @param stored - the access token from the subscription document.
 * @param refresh - its refresh token.
 * @param expiresAt - the stored token's expiry in ms, when the document records one.
 * @param force - true to bypass both validities and refresh now.
 * @param config - resolved row config.
 * @returns the token to send, or undefined when nothing can be refreshed.
 */
async function antigravityAccess(stored, refresh, expiresAt, force, config) {
  const cached = refresh === undefined ? undefined : cachedAccessToken('antigravity', refresh)
  if (!force) {
    if (cached !== undefined) return cached
    if (stored !== undefined && (expiresAt === undefined || expiresAt > Date.now() + 60_000)) return stored
  }
  if (refresh === undefined) return force ? undefined : stored
  const client = await antigravityClient()
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refresh,
    client_id: client.id,
    client_secret: client.secret,
  })
  const response = await timedFetch(ANTIGRAVITY_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }, config)
  if (!response.ok) throw new SubscriptionAuthError(`token refresh HTTP ${response.status}`)
  const wire = await response.json()
  const access = firstString(wire?.access_token)
  if (access === undefined) throw new SubscriptionAuthError('token refresh returned no access_token')
  const lifetime = number(wire?.expires_in) ?? 3600
  rememberAccessToken('antigravity', refresh, access, Date.now() + lifetime * 1000)
  return access
}

/** @param error - any thrown value. @returns the failed provider section. */
function subscriptionFailure(provider, error) {
  if (error instanceof SubscriptionAuthError) return { ...provider, status: 'auth', message: error.message }
  return { ...provider, status: 'error', message: reason(error) }
}

/** Marks a refresh the account owner has to resolve by signing in again. */
class SubscriptionAuthError extends Error {}

/**
 * @param provider - provider id.
 * @param refresh - the refresh token that produced the access token.
 * @returns a still-valid cached access token, or undefined.
 */
function cachedAccessToken(provider, refresh) {
  const hit = refreshedTokens.get(`${provider}\u0000${refresh}`)
  return hit !== undefined && hit.expiresAt > Date.now() + 60_000 ? hit.access : undefined
}

/**
 * @param provider - provider id.
 * @param refresh - the refresh token that produced the access token.
 * @param access - the fresh access token.
 * @param expiresAt - its expiry in ms.
 */
function rememberAccessToken(provider, refresh, access, expiresAt) {
  refreshedTokens.set(`${provider}\u0000${refresh}`, { access, expiresAt })
}

/**
 * Discover the account's Cloud AI Companion project, for a document that
 * stored its login without one. Only reads; onboarding stays a sign-in job.
 * @param access - the access token.
 * @param config - resolved row config.
 * @returns the project id, or undefined when the account names none.
 */
async function antigravityProject(access, config) {
  const response = await antigravityCall(
    ANTIGRAVITY_CODE_ASSIST_URL, { metadata: ANTIGRAVITY_METADATA }, access, config,
  )
  if (!response.ok) throw new Error(`loadCodeAssist HTTP ${response.status}`)
  const payload = await response.json()
  const project = payload?.cloudaicompanionProject
  if (typeof project === 'string' && project !== '') return project
  if (project !== null && typeof project === 'object'
    && typeof project.id === 'string' && project.id !== '') return project.id
  return undefined
}

/**
 * POST one `v1internal` method.
 * @param url - exact method URL.
 * @param body - JSON body.
 * @param access - the access token.
 * @param config - resolved row config.
 * @returns the response.
 */
async function antigravityCall(url, body, access, config) {
  const init = {
    method: 'POST',
    headers: {
      authorization: `Bearer ${access}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': ANTIGRAVITY_USER_AGENT,
    },
    body: JSON.stringify(body),
  }
  const response = await timedFetch(url, init, config)
  // The daily endpoint is the shipped one; the production origin is the
  // documented fallback when the daily one is unavailable.
  if (![404, 502, 503, 504].includes(response.status)) return response
  const fallback = url.replace('https://daily-cloudcode-pa.googleapis.com', 'https://cloudcode-pa.googleapis.com')
  if (fallback === url) return response
  return timedFetch(fallback, init, config)
}

/**
 * Map `/v1internal:retrieveUserQuotaSummary` to normalized windows. Each
 * group's weekly and 5-hour buckets become rows tagged with the group they
 * apply to, because the same two windows repeat per model family.
 * @param payload - quota summary body.
 * @returns normalized windows.
 */
function antigravityWindows(payload) {
  const groups = Array.isArray(payload?.groups) ? payload.groups : []
  const windows = []
  for (const group of groups) {
    const scope = antigravityScope(firstString(group?.displayName, group?.display_name))
    const buckets = Array.isArray(group?.buckets) ? group.buckets : []
    for (const bucket of buckets) {
      const remaining = fraction(bucket?.remainingFraction ?? bucket?.remaining_fraction)
      if (remaining === undefined) continue
      const window = antigravityWindow(bucket)
      if (window === undefined) continue
      windows.push({
        window,
        label: window === '7d' ? 'Weekly' : '5 hours',
        scope,
        kind: 'quota',
        usedPercent: clampPercent((1 - remaining) * 100),
        resetsAt: isoMs(bucket?.resetTime ?? bucket?.reset_time),
      })
    }
  }
  return windows
}

/**
 * Classify one Antigravity bucket by the duration it names, not by position.
 * @param bucket - one `groups[].buckets[]` entry.
 * @returns `7d`, `5h`, or undefined for a window this panel cannot place.
 */
function antigravityWindow(bucket) {
  const hint = [
    bucket?.window, bucket?.displayName, bucket?.display_name, bucket?.description,
  ].filter((value) => typeof value === 'string').join(' ').toLowerCase()
  if (/week|7[ _-]?(?:day|d)\b/.test(hint)) return '7d'
  if (/(?:5|five)[ _-]?(?:hour|h)\b/.test(hint)) return '5h'
  return undefined
}

/**
 * Normalize a group name to one of the account-wide families. An unknown
 * group keeps its own name so a new family still reaches the panel.
 * @param name - group display name.
 * @returns the scope label.
 */
function antigravityScope(name) {
  if (name === undefined) return undefined
  const known = ANTIGRAVITY_SCOPES.find((scope) => scope.toLowerCase() === name.toLowerCase())
  return known ?? name
}

/** @param value - a reported remaining share. @returns 0..1, or undefined. */
function fraction(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value >= 0 && value <= 1 ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const trimmed = value.trim()
    const parsed = trimmed.endsWith('%') ? Number(trimmed.slice(0, -1)) / 100 : Number(trimmed)
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : undefined
  }
  return undefined
}

/**
 * Read the Codex plan windows from a stored login.
 *
 * Two stores can hold one: the subscription plugin's document — the login the
 * Settings → Subscriptions page creates — and, as a fallback, the credential
 * record the Models page's pi-ai route writes. The first grant that has not
 * expired wins; an expired one is never sent, because the provider answers
 * 401 and would hide the real reason.
 * @param credentials - the optional credentials service.
 * @param config - resolved row config.
 * @returns a provider section.
 */
async function readCodex(credentials, config) {
  const provider = { id: 'openai-codex', name: 'OpenAI Codex', kind: 'quota', windows: [] }
  const session = await subscriptionSession('codex')
  const sessionAccess = firstString(session?.accessToken, session?.access, session?.access_token)
  const grant = await grantPayload(credentials, 'llm-pi-ai/openai-codex')
  const grantAccess = firstString(grant?.accessToken, grant?.access, grant?.access_token)
  const candidates = []
  if (sessionAccess !== undefined) {
    candidates.push({
      source: 'subscriptions',
      access: sessionAccess,
      accountId: firstString(session?.accountId, session?.account_id),
      plan: planLabel(firstString(session?.planType)),
      expiresAt: expiryMs(session),
    })
  }
  if (grantAccess !== undefined) {
    candidates.push({
      source: 'models',
      access: grantAccess,
      accountId: firstString(grant?.accountId, grant?.account_id),
      expiresAt: expiryMs(grant),
    })
  }
  if (candidates.length === 0) return { ...provider, status: 'no-credential' }
  const now = Date.now()
  const live = candidates.find((candidate) => candidate.expiresAt === undefined || candidate.expiresAt > now)
  if (live === undefined) return { ...provider, status: 'expired', source: candidates[0].source }

  const accountId = live.accountId ?? jwtClaim(live.access, 'https://api.openai.com/auth', 'chatgpt_account_id')
  const headers = { accept: 'application/json', authorization: `Bearer ${live.access}`, 'user-agent': USER_AGENT }
  if (accountId !== undefined) headers['chatgpt-account-id'] = accountId
  try {
    const response = await timedFetch(CODEX_USAGE_URL, { headers }, config)
    if (!response.ok) return { ...httpFailure(provider, response), source: live.source }
    const payload = await response.json()
    const plan = planLabel(firstString(payload?.plan_type)) ?? live.plan
    return {
      ...provider,
      status: 'ok',
      windows: codexWindows(payload),
      source: live.source,
      ...(plan === undefined ? {} : { plan }),
    }
  } catch (error) {
    return { ...provider, status: 'error', message: reason(error), source: live.source }
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
 * Decode the payload of a JWT-shaped access token, without verifying it.
 * @param token - the access token.
 * @returns its payload object, or undefined when the token is not a JWT.
 */
function jwtPayload(token) {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    const json = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    return json !== null && typeof json === 'object' ? json : undefined
  } catch {
    return undefined
  }
}

/**
 * Read one claim from a JWT-shaped access token.
 * @param token - the access token.
 * @param claim - claim namespace.
 * @param member - member inside the claim namespace.
 * @returns the string member, when present.
 */
function jwtClaim(token, claim, member) {
  const value = jwtPayload(token)?.[claim]?.[member]
  return typeof value === 'string' && value !== '' ? value : undefined
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
