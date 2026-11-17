# dsh-usage-limits Contributor Guide

Left-sidebar **Limits** panel (`@local/dsh-usage-limits`) showing per-provider subscription quotas (OpenCode Go, Z.AI, DeepSeek, Codex, Claude, Grok, Copilot, Antigravity), model window, and platform limits. See [README.md](README.md) and [../AGENTS.md](../AGENTS.md).

## Layout

- `index.ts`: Cordis host plugin registering `/plugin-api/usage-limits/limits`.
- `lib/usage.machine.ts`: `usageBlock` XState v5 machine.
- `src/client.ts`: client source compiled via `scripts/build-client.ts` into `dist/client.js`.
- `web-route-auth.ts`: fail-closed route auth facade.
- `locale/`: `en.json`, `ru.json`.
- `test/`: `client-bundle.test.ts`, `usage-machine.test.ts`, `web-route-auth.test.ts`.

## Invariants

- **Fail-closed auth & secret safety:** Protect `/plugin-api/usage-limits/limits` with `web-route-auth.ts`. Never leak OAuth tokens, cookies, API keys, or auth file contents in HTTP payloads, errors, or logs.
- **Per-card isolation:** Each provider card loads, retries, and refreshes independently; missing credentials show a connect hint, never fake zero usage.
- **Committed `dist/`:** Run `npm run build` (`tsc && node scripts/build-client.ts`) and commit `dist/`.

## Verification

```sh
npm ci
npm run check     # tsc --noEmit && tsc && node scripts/build-client.ts && node --test dist/test/*.test.js
```

Sync `../machines` if `lib/usage.machine.ts` changes, and update `../repositories.json` snapshot metadata when files here change.
