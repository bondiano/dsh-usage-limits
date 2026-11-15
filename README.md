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
  - OpenAI Codex: primary and weekly plan windows from
    `https://chatgpt.com/backend-api/wham/usage` when an OAuth grant is stored
    at `llm-pi-ai/openai-codex`; otherwise the row says the account is not
    connected.
  Each window shows the share of the quota already used, a bar, and the time
  left until its reset; a counted request meter also shows its exact
  counters. Providers that need attention sort above healthy ones. A provider
  without a stored credential is listed with a hint instead of a quota, and a
  failed request shows its HTTP status.
- **Model** — the profile's default model selection and its resolved context
  window, maximum output, and selectable reasoning levels.
- **Platform** — the deployment's subagent nesting limit, image admission
  limits, and the minimum interval between automation deliveries that create a
  Session.

The panel refreshes automatically once per minute while it is open, and the
**Refresh** action requests a fresh snapshot immediately.

## How it works

The Host half registers one exact read-only route,
`/plugin-api/usage-limits/limits`, served from the same origin as the GUI. It
resolves credentials through the DSH credential plane (falling back to the
Host process environment), polls the provider account endpoints with an
8-second timeout, and answers a JSON snapshot. The Client half only renders
that snapshot: no key or token reaches the browser. The route answers only a
loopback `Host` header and a same-origin page, so it stays unavailable when the
GUI is served on a LAN address.

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
- Codex usage requires a stored OAuth grant; the plugin never starts a sign-in
  itself.
- Balances are read from the API key's account, not from the DSH account
  session.
- The panel works only on the machine that runs the Harness: a GUI served over
  a non-loopback address cannot read the snapshot.
