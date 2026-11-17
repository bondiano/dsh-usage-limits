# Usage limits

A DSH bundle that adds a **Limits** entry to the left sidebar. The panel it
opens lists every limit the running harness can observe.

## What the panel shows

- **Providers** — quota windows for the providers whose credentials this
  profile already holds:
  - OpenCode Go: rolling 5-hour, weekly, and monthly windows from
    `https://opencode.ai/zen/go/v1/usage` (`OPENCODE_GO_API_KEY`).
  - Z.AI: request and token windows from
    `https://api.z.ai/api/monitor/usage/quota/limit` (`ZAI_API_KEY`), with the
    coding-plan level when the endpoint reports one.
  - DeepSeek: prepaid, granted, and total balance from
    `https://api.deepseek.com/user/balance` (`DEEPSEEK_API_KEY`).
  - OpenAI Codex: plan windows from
    `https://chatgpt.com/backend-api/wham/usage`. The grant is read from the
    subscription plugin's document (`~/.dsh/plugins/subscriptions/auth.json`,
    the login made under Settings → Subscriptions), with the credential record
    at `llm-pi-ai/openai-codex` as a fallback; otherwise the row says the
    account is not connected.
  - Claude: the session and weekly windows (a scoped weekly window names the
    model family it applies to) from
    `https://api.anthropic.com/api/oauth/usage`, the source of Claude Code's
    `/usage` screen. Both the structured `limits` array and the older flat
    buckets are read.
  - Grok: the shared credit window from the Grok Build CLI billing proxy
    (`cli-chat-proxy.grok.com/v1/billing`), with the subscription tier as its
    plan. Older responses report a monthly credit limit and usage instead.
  - GitHub Copilot: the monthly premium-request quota and the plan from
    `https://api.github.com/copilot_internal/user`, using the GitHub token the
    subscription plugin stores for the default Copilot account. Unlimited
    buckets carry no measured quota and are not listed.
  - Google Antigravity: the weekly and 5-hour windows of each shared quota
    family (`Gemini Models`, `Claude and GPT models`, and `Gemini 4 Argon`
    when the account reports it) from
    `daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`,
    with the stored plan. The access token lives about an hour, so it is
    refreshed in-process through the public Antigravity desktop OAuth client.
  Each window shows the share of the quota already used, a bar, and the time
  left until its reset; a window that belongs to a quota family names it, and
  a counted request meter also shows its exact counters. Every provider card
  loads on its own: it has its own placeholder, its own error with **Retry**,
  and its own refresh cadence, so one slow or failing provider never holds
  the others. A provider without a stored credential is listed with a hint
  instead of a quota, and a failed request shows its HTTP status.
- **Model** — the profile's default model selection and its resolved context
  window, maximum output, and selectable reasoning levels.
- **Platform** — the deployment's subagent nesting limit, image admission
  limits, and the minimum interval between automation deliveries that create a
  Session.

Every card refreshes itself once per minute while the panel is open, and the
**Refresh** action forces all cards at once.

## How it works

The Host half registers one exact read-only route,
`/plugin-api/usage-limits/limits`, served from the same origin as the GUI.
`?provider=<id>` answers one provider card and `?section=overview` answers the
model and platform cards; a request with neither answers the whole snapshot.
Each block is cached for the refresh window, and in-flight polls are shared
between the per-block and whole-snapshot forms. The Host resolves credentials
through the DSH credential plane (falling back to the Host process
environment), reads the subscription plugin's OAuth document for the Codex,
Claude, Grok, Copilot, and Antigravity logins, and polls the provider account endpoints with
an 8-second timeout. The Client half only renders those answers: no key or
token reaches the browser. The route answers only a loopback `Host` header and
a same-origin page, so it stays unavailable when the GUI is served on a LAN
address.

The Client half is built: `npm run build` bundles `src/client.js` (which owns
the `usageBlock` card machine from `lib/usage.machine.mjs`) into the committed
`client.js`; edit the source, never the generated file.

## Configuration

Set these fields on the bundle's row in `cordis.patch.yml`:

| Field | Default | Meaning |
|---|---|---|
| `refreshSeconds` | `60` | How long a snapshot is reused before the next poll |
| `requestTimeoutMs` | `8000` | Timeout of each provider request |

## Limitations

- The panel shows windows the providers report; it does not estimate usage.
- Quota endpoints are provider-owned interfaces, so a provider can change or
  withdraw one. Such a change appears as an error row, not a crash.
- Codex, Claude, Grok, Copilot, and Antigravity usage require a stored
  subscription login;
  the plugin never starts a sign-in itself. An expired grant is reported as
  such instead of being sent, so the fix is a fresh sign-in in Settings →
  Subscriptions (or, for a Codex login made on the Models page, there).
- Claude and Grok tokens are refreshed in-process through the same public OAuth
  clients their CLIs use; the refreshed token is not written back, so the
  subscription plugin stays the document's only writer.
- Antigravity quotas are account-wide families, not per-model quotas; the
  panel shows the windows the account reports and leaves model-only
  supplemental quotas to the subscription plugin's own card. Its refresh uses
  the public desktop OAuth client shipped by that bundle; set
  `DSH_ANTIGRAVITY_CLIENT_ID` and `DSH_ANTIGRAVITY_CLIENT_SECRET` to override
  it when the bundle is not installed.
- The subscription plugin is the writer of its OAuth document; this plugin only
  reads it, so a token it refreshes in the background is picked up on the next
  refresh of the panel.
- Balances are read from the API key's account, not from the DSH account
  session.
- The panel works only on the machine that runs the Harness: a GUI served over
  a non-loopback address cannot read the snapshot.
