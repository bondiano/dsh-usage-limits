/**
 * Client half of `@local/dsh-usage-limits`.
 *
 * Registers one left-sidebar entry and the main panel it opens. The panel
 * reads the same-origin snapshot served by this package's Host half and draws
 * provider quota windows, balances, the default model's capacity, and the
 * deployment limits other services expose.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-usage-limits',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'usageLimits'
    /** Shared by the sidebar entry and the main panel it opens. */
    const PANEL_ID = 'usage-limits'
    /** Same-origin Host route that answers the snapshot. */
    const ROUTE = 'plugin-api/usage-limits/limits'

    const en = {
      panel: 'Limits',
      title: 'Limits',
      intro: 'Provider quotas, balances, and model limits',
      legend: 'Percentages show how much of each quota is used.',
      refresh: 'Refresh',
      updated: 'Updated {time}',
      loadingShort: 'Loading…',
      retry: 'Try again',
      providers: 'Providers',
      model: 'Model',
      platform: 'Platform',
      footnote: 'Quotas come from provider APIs and refresh automatically. Keys stay on the Host and never reach the browser.',
      statusOk: 'OK',
      statusWarning: 'Close to limit',
      statusError: 'Error',
      statusAuth: 'Key rejected',
      statusExpired: 'Session expired',
      statusExhausted: 'Exhausted',
      statusUnlinked: 'Not connected',
      statusAvailable: 'Available',
      statusUnavailable: 'Unavailable',
      noData: 'The provider returned no limit windows.',
      noBalance: 'The provider returned no balance.',
      hintKey: 'Add the provider key under Settings → Models.',
      hintCodex: 'Sign in under Settings → Models.',
      hintSubscription: 'Sign in under Settings → Subscriptions.',
      hintAuth: 'The key was rejected. Check it under Settings → Models.',
      hintCodexAuth: 'The sign-in was rejected. Sign in again under Settings → Models.',
      hintSubscriptionAuth: 'The sign-in was rejected. Sign in again under Settings → Subscriptions.',
      hintExpired: 'Session expired. Sign in again under Settings → Models.',
      hintSubscriptionExpired: 'Session expired. Sign in again under Settings → Subscriptions.',
      window5h: '5 hours',
      window7d: 'Weekly',
      window1mo: 'Monthly',
      window1d: 'Daily',
      window1h: 'Hourly',
      windowPremium: 'Premium requests',
      windowChat: 'Chat requests',
      windowCompletions: 'Code completions',
      kindTokens: 'tokens',
      kindRequests: 'requests',
      resetNow: 'resetting now',
      resetSoon: 'resets in {duration}',
      resetAt: 'resets {date}',
      durationMin: '{n} min',
      durationHour: '{h} h',
      durationHourMin: '{h} h {m} min',
      durationDay: '{d} d {h} h',
      durationDayOnly: '{d} d',
      requestsUsed: '{used} of {limit}',
      usedA11y: '{label}: {percent} used',
      balance: 'Balance',
      balanceNote: 'granted {granted} · top-ups {toppedUp}',
      balanceUnavailable: 'Balance unavailable',
      modelProvider: 'Provider',
      modelModel: 'Model',
      modelContext: 'Context window',
      modelOutput: 'Maximum output',
      modelReasoning: 'Reasoning levels',
      modelEffort: 'Default effort',
      modelEmpty: 'No default model is configured.',
      platformSubagentsLabel: 'Subagents',
      platformImagesLabel: 'Images',
      platformScheduleLabel: 'Automations',
      platformSubagents: 'depth: {n}',
      platformImages: '{mb} MB per image · {n} images per message',
      platformSchedule: 'new sessions: at most one per {seconds} s',
      tokens: '{n} tokens',
    }

    const ru = {
      panel: 'Лимиты',
      title: 'Лимиты',
      intro: 'Квоты, балансы и лимиты модели',
      legend: 'Проценты показывают, какая доля квоты уже израсходована.',
      refresh: 'Обновить',
      updated: 'Обновлено в {time}',
      loadingShort: 'Загрузка…',
      retry: 'Повторить',
      providers: 'Провайдеры',
      model: 'Модель',
      platform: 'Платформа',
      footnote: 'Квоты приходят из API провайдеров и обновляются автоматически. Ключи остаются на стороне ядра и не попадают в браузер.',
      statusOk: 'В норме',
      statusWarning: 'Близко к лимиту',
      statusError: 'Ошибка',
      statusAuth: 'Ключ отклонён',
      statusExpired: 'Сеанс истёк',
      statusExhausted: 'Исчерпано',
      statusUnlinked: 'Не подключён',
      statusAvailable: 'Доступен',
      statusUnavailable: 'Недоступен',
      noData: 'Провайдер не вернул ни одного окна квоты.',
      noBalance: 'Провайдер не вернул баланс.',
      hintKey: 'Добавьте ключ провайдера в Настройки → Модели.',
      hintCodex: 'Войдите в Настройки → Модели.',
      hintSubscription: 'Войдите в Настройки → Подписки.',
      hintAuth: 'Ключ отклонён. Проверьте его в Настройки → Модели.',
      hintCodexAuth: 'Вход отклонён. Войдите заново в Настройки → Модели.',
      hintSubscriptionAuth: 'Вход отклонён. Войдите заново в Настройки → Подписки.',
      hintExpired: 'Сеанс истёк. Войдите заново в Настройки → Модели.',
      hintSubscriptionExpired: 'Сеанс истёк. Войдите заново в Настройки → Подписки.',
      window5h: '5 часов',
      window7d: 'Неделя',
      window1mo: 'Месяц',
      window1d: 'Сутки',
      window1h: 'Час',
      windowPremium: 'Премиум-запросы',
      windowChat: 'Запросы чата',
      windowCompletions: 'Автодополнение',
      kindTokens: 'токены',
      kindRequests: 'запросы',
      resetNow: 'сброс вот-вот',
      resetSoon: 'сброс через {duration}',
      resetAt: 'сброс {date}',
      durationMin: '{n} мин',
      durationHour: '{h} ч',
      durationHourMin: '{h} ч {m} мин',
      durationDay: '{d} д {h} ч',
      durationDayOnly: '{d} д',
      requestsUsed: '{used} из {limit}',
      usedA11y: '{label}: использовано {percent}',
      balance: 'Баланс',
      balanceNote: 'бонусные {granted} · пополнения {toppedUp}',
      balanceUnavailable: 'Баланс недоступен',
      modelProvider: 'Провайдер',
      modelModel: 'Модель',
      modelContext: 'Контекстное окно',
      modelOutput: 'Максимальный вывод',
      modelReasoning: 'Уровни рассуждений',
      modelEffort: 'Уровень по умолчанию',
      modelEmpty: 'Модель по умолчанию не выбрана.',
      platformSubagentsLabel: 'Субагенты',
      platformImagesLabel: 'Изображения',
      platformScheduleLabel: 'Автозадачи',
      platformSubagents: 'глубина вложенности: {n}',
      platformImages: '{mb} МБ на изображение · {n} изображений на сообщение',
      platformSchedule: 'новые сессии — не чаще раза в {seconds} с',
      tokens: '{n} токенов',
    }

    const CSS = `
.dsh-ul-page { flex: 1 1 auto; min-height: 0; height: 100%; overflow-y: auto; scrollbar-gutter: stable; box-sizing: border-box; padding: 0 clamp(24px, 4vw, 48px) 48px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); -webkit-font-smoothing: antialiased; }
.dsh-ul-inner { box-sizing: border-box; max-width: 960px; margin: 0 auto; padding-top: 28px; display: flex; flex-direction: column; gap: 28px; }
[data-platform="darwin"] .dsh-ul-inner { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }
.dsh-ul-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.dsh-ul-headings { min-width: 0; }
.dsh-ul-title { margin: 0; font-size: 20px; line-height: 28px; font-weight: 500; }
.dsh-ul-intro { margin: 4px 0 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.dsh-ul-legend { margin: 2px 0 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-ul-actions { display: flex; align-items: center; gap: 12px; }
.dsh-ul-updated { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
.dsh-ul-btn { box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 18px; cursor: pointer; }
@media (hover: hover) { .dsh-ul-btn:hover { background: var(--dsw-alias-bg-layer-2); } }
.dsh-ul-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dsh-ul-btn:disabled { opacity: 0.55; cursor: default; }
.dsh-ul-btn[data-spin="true"] svg { animation: dsh-ul-spin 0.9s linear infinite; }
@keyframes dsh-ul-spin { to { transform: rotate(360deg); } }
.dsh-ul-section { display: flex; flex-direction: column; gap: 10px; }
.dsh-ul-section-title { margin: 0; font-size: 13px; line-height: 18px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dsh-ul-cards { display: flex; flex-direction: column; gap: 10px; }
.dsh-ul-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); padding: 14px 16px; }
.dsh-ul-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dsh-ul-name-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-ul-name { margin: 0; font-size: 15px; line-height: 22px; font-weight: 500; }
.dsh-ul-plan { flex: none; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; padding: 1px 7px; text-transform: lowercase; }
.dsh-ul-status { flex: none; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-ul-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
.dsh-ul-dot[data-tone="ok"] { background: var(--dsw-alias-state-success-primary); }
.dsh-ul-dot[data-tone="warn"] { background: var(--dsw-alias-state-warn-primary); }
.dsh-ul-dot[data-tone="error"] { background: var(--dsw-alias-state-error-primary); }
.dsh-ul-window { display: flex; flex-direction: column; gap: 6px; padding: 11px 0 1px; margin-top: 11px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dsh-ul-window-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.dsh-ul-window-label { font-size: 13px; line-height: 18px; }
.dsh-ul-window-kind { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-ul-window-pct { flex: none; font-size: 14px; line-height: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.dsh-ul-bar { height: 6px; border-radius: 3px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.dsh-ul-bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s ease, background-color 0.3s ease; }
.dsh-ul-window-foot { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary); }
.dsh-ul-note { margin: 10px 0 0; font-size: 12.5px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-ul-note[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
.dsh-ul-balances { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px 24px; margin-top: 12px; }
.dsh-ul-balance-label { flex-basis: 100%; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary); }
.dsh-ul-balance { display: flex; flex-direction: column; gap: 2px; }
.dsh-ul-amount { font-size: 20px; line-height: 26px; font-weight: 500; font-variant-numeric: tabular-nums; }
.dsh-ul-balance-note { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dsh-ul-facts { margin: 0; }
.dsh-ul-fact { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 9px 0; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 13px; line-height: 18px; }
.dsh-ul-fact:first-child { border-top: none; padding-top: 4px; }
.dsh-ul-fact dt { flex: none; color: var(--dsw-alias-label-secondary); }
.dsh-ul-fact dd { margin: 0; min-width: 0; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.dsh-ul-state { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); padding: 16px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.dsh-ul-state strong { color: var(--dsw-alias-label-primary); font-weight: 500; }
.dsh-ul-skeleton { display: flex; flex-direction: column; gap: 9px; margin-top: 11px; padding-top: 11px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dsh-ul-skeleton-line { height: 8px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2); animation: dsh-ul-pulse 1.5s ease-in-out infinite; }
.dsh-ul-skeleton-line + .dsh-ul-skeleton-line { width: 58%; }
@keyframes dsh-ul-pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
.dsh-ul-card-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 10px; }
.dsh-ul-card-error .dsh-ul-note { margin: 0; }
.dsh-ul-btn[data-size="sm"] { height: 28px; padding: 0 11px; border-radius: 14px; font-size: 12px; }
.dsh-ul-foot { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
@media (prefers-reduced-motion: reduce) {
  .dsh-ul-bar-fill { transition: none; }
  .dsh-ul-btn[data-spin="true"] svg { animation: none; }
  .dsh-ul-skeleton-line { animation: none; }
}
@media (max-width: 767px) {
  .dsh-ul-page { padding: 0 20px 40px; }
  .dsh-ul-inner { padding-top: 20px; gap: 22px; }
  .dsh-ul-fact { flex-direction: column; align-items: flex-start; gap: 2px; }
  .dsh-ul-fact dd { text-align: left; }
}
`

    /** Gauge glyph for the sidebar entry. */
    function UsageLimitsIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 18
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': true, focusable: false, style: { display: 'block' },
      },
      h('path', {
        d: 'M3.8 17.2a8.6 8.6 0 0 1 16.4 0',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round',
      }),
      h('path', {
        d: 'M12 17.2 16.1 10.5',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round',
      }),
      h('circle', { cx: 12, cy: 17.2, r: 1.5, fill: 'currentColor' }))
    }

    const WINDOW_KEYS = {
      '5h': 'window5h', '7d': 'window7d', '1mo': 'window1mo', '1d': 'window1d', '1h': 'window1h',
      premium: 'windowPremium', chat: 'windowChat', completions: 'windowCompletions',
    }

    /**
     * A provider whose login lives on the Subscriptions settings page rather
     * than as an API key on the Models page; its hints must point there. A
     * Codex grant the Host read from the Models-page store keeps pointing at
     * the page that owns it.
     * @param section - provider section.
     * @returns whether Settings → Subscriptions owns this provider's login.
     */
    function subscriptionProvider(section) {
      if (section.id === 'github-copilot') return true
      if (section.id === 'claude' || section.id === 'grok' || section.id === 'google-antigravity') return true
      if (section.id === 'openai-codex') return section.source !== 'models'
      return false
    }

    /** @param t - translator. @param window - window descriptor. @returns its localized label. */
    function windowLabel(t, window) {
      const key = WINDOW_KEYS[window.window]
      if (key !== undefined) return t(key)
      return typeof window.label === 'string' && window.label !== '' ? window.label : window.window
    }

    /** @param t - translator. @param window - window descriptor. @returns its kind label or null. */
    function kindLabel(t, window) {
      if (window.kind === 'tokens') return t('kindTokens')
      if (window.kind === 'requests') return t('kindRequests')
      return null
    }

    /** @param value - percent. @returns the compact percent text. */
    function percentText(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value > 0 && value < 1) return '<1%'
      return `${Math.round(value)}%`
    }

    /** @param percent - used percent. @returns the bar color token for the tone. */
    function barColor(percent) {
      if (percent >= 100) return 'var(--dsw-alias-state-error-primary)'
      if (percent >= 80) return 'var(--dsw-alias-state-warn-primary)'
      return 'var(--dsw-alias-brand-primary)'
    }

    /** @param number - grouping formatter. */
    const grouped = new Intl.NumberFormat(undefined)
    /** @param number - count. @returns grouped digits. */
    function fmt(value) {
      return typeof value === 'number' && Number.isFinite(value) ? grouped.format(value) : '—'
    }

    /** @param t - translator. @param count - token count. @returns the count text. */
    function tokenText(t, count) {
      return t('tokens', { n: fmt(count) })
    }

    /** @param value - bytes. @returns a whole-megabyte size. */
    function megabytes(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      const mb = value / (1024 * 1024)
      return mb >= 10 ? String(Math.round(mb)) : String(Math.round(mb * 10) / 10)
    }

    /** @param value - amount. @param currency - ISO currency code. @returns a currency string. */
    function money(value, currency) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
      } catch {
        return `${value.toFixed(2)} ${currency}`
      }
    }

    /** @param ms - remaining milliseconds. @param t - translator. @returns a compact duration. */
    function duration(ms, t) {
      const minutes = Math.max(1, Math.round(ms / 60000))
      if (minutes < 60) return t('durationMin', { n: minutes })
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      if (hours < 24) return rest === 0 ? t('durationHour', { h: hours }) : t('durationHourMin', { h: hours, m: rest })
      const days = Math.floor(hours / 24)
      return dayDuration(days, hours % 24, t)
    }

    /** @param at - instant in ms. @returns a formatted local instant, or an empty string when unrepresentable. */
    function instant(at) {
      if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0 || at >= 8.64e15) return ''
      try {
        return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(at))
      } catch {
        return ''
      }
    }

    /** @param at - reset instant in ms. @param t - translator. @returns the reset line and its exact instant title. */
    function resetText(at, t) {
      const title = instant(at)
      if (title === '') return null
      const diff = at - Date.now()
      if (diff <= 0) return { text: t('resetNow'), title }
      return { text: t('resetSoon', { duration: duration(diff, t) }), title }
    }

    /** @param days - whole days. @param hours - remaining hours. @param t - translator. @returns a day duration. */
    function dayDuration(days, hours, t) {
      return hours === 0 ? t('durationDayOnly', { d: days }) : t('durationDay', { d: days, h: hours })
    }

    /** @param section - provider section. @returns its tone. */
    function providerTone(section) {
      if (section.status === 'auth' || section.status === 'error' || section.status === 'expired') return 'error'
      if (section.status === 'no-credential') return 'idle'
      if (section.status !== 'ok') return 'idle'
      if (section.kind === 'balance') return section.available === false ? 'error' : 'ok'
      let worst = null
      for (const window of section.windows ?? []) {
        if (window.exhausted === true) return 'error'
        if (typeof window.usedPercent !== 'number') continue
        worst = worst === null ? window.usedPercent : Math.max(worst, window.usedPercent)
      }
      if (worst === null) return 'idle'
      if (worst >= 100) return 'error'
      if (worst >= 80) return 'warn'
      return 'ok'
    }

    /** @param section - provider section. @param t - translator. @returns the status text or null. */
    function providerStatus(section, t) {
      if (section.status === 'no-credential') return t('statusUnlinked')
      if (section.status === 'expired') return t('statusExpired')
      if (section.status === 'auth') return t('statusAuth')
      if (section.status === 'error') return t('statusError')
      if (section.kind === 'balance') return section.available === false ? t('statusUnavailable') : t('statusAvailable')
      if ((section.windows ?? []).some((window) => window.exhausted === true)) return t('statusExhausted')
      const tone = providerTone(section)
      if (tone === 'ok') return t('statusOk')
      if (tone === 'warn') return t('statusWarning')
      if (tone === 'error') return t('statusError')
      return null
    }

    /** One quota window row. */
    function WindowRow(props) {
      const { window, provider, t } = props
      const percent = typeof window.usedPercent === 'number' ? window.usedPercent : null
      const reset = resetText(window.resetsAt, t)
      const label = windowLabel(t, window)
      const kind = kindLabel(t, window)
      const scope = typeof window.scope === 'string' && window.scope !== '' ? window.scope : null
      const counts = window.kind === 'requests' && typeof window.used === 'number' && typeof window.limit === 'number'
        ? t('requestsUsed', { used: fmt(window.used), limit: fmt(window.limit) })
        : null
      const bar = percent === null
        ? { className: 'dsh-ul-bar' }
        : {
            className: 'dsh-ul-bar', role: 'progressbar',
            'aria-label': `${provider}, ${label}`,
            'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.min(100, Math.round(percent * 100) / 100),
            'aria-valuetext': t('usedA11y', { label, percent: percentText(percent) }),
          }
      return h('div', { className: 'dsh-ul-window' },
        h('div', { className: 'dsh-ul-window-head' },
          h('span', { className: 'dsh-ul-window-label' }, label,
            scope === null ? null : h('span', { className: 'dsh-ul-window-kind' }, ` · ${scope}`),
            kind === null ? null : h('span', { className: 'dsh-ul-window-kind' }, ` · ${kind}`)),
          h('span', { className: 'dsh-ul-window-pct' }, percentText(percent))),
        h('div', bar, h('div', {
          className: 'dsh-ul-bar-fill',
          style: {
            width: percent === null ? '0%' : `${percent > 0 ? Math.min(Math.max(percent, 2), 100) : 0}%`,
            backgroundColor: percent === null ? 'transparent' : window.exhausted === true ? 'var(--dsw-alias-state-error-primary)' : barColor(percent),
          },
        })),
        (reset === null && counts === null) ? null : h('div', { className: 'dsh-ul-window-foot' },
          reset === null ? h('span', null, '') : h('span', { title: reset.title }, reset.text),
          counts === null ? null : h('span', null, counts)))
    }

    /** Provider card: header, windows, balances, or an explanatory note. */
    function ProviderCard(props) {
      const { section, t, error, onRetry } = props
      const failed = typeof error === 'string' && error !== ''
      const tone = providerTone(section)
      const status = providerStatus(section, t)
      const windows = Array.isArray(section.windows) ? section.windows : []
      const balances = Array.isArray(section.balances) ? section.balances : []
      let note = null
      let noteTone = 'muted'
      if (section.status === 'no-credential') {
        note = subscriptionProvider(section) ? t('hintSubscription') : t('hintKey')
      } else if (section.status === 'expired') {
        note = subscriptionProvider(section) ? t('hintSubscriptionExpired') : t('hintExpired')
      } else if (section.status === 'auth') {
        note = subscriptionProvider(section) ? t('hintSubscriptionAuth') : t('hintAuth')
        noteTone = 'error'
      } else if (section.status === 'error') {
        note = section.message === undefined ? t('statusError') : `${t('statusError')}: ${section.message}`
        noteTone = 'error'
      } else if (section.kind === 'balance') {
        if (section.available === false) {
          note = t('balanceUnavailable')
          noteTone = 'error'
        } else if (balances.length === 0) {
          note = t('noBalance')
        }
      } else if (section.kind === 'quota' && windows.length === 0) {
        note = t('noData')
      }
      const showBalances = section.kind === 'balance' && section.available !== false && balances.length > 0
      return h('div', { className: 'dsh-ul-card' },
        h('div', { className: 'dsh-ul-card-head' },
          h('div', { className: 'dsh-ul-name-row' },
            h('h3', { className: 'dsh-ul-name' }, section.name),
            typeof section.plan === 'string' && section.plan !== ''
              ? h('span', { className: 'dsh-ul-plan' }, section.plan)
              : null),
          status === null ? null : h('span', { className: 'dsh-ul-status' },
            h('span', { className: 'dsh-ul-dot', 'data-tone': tone }),
            status)),
        windows.map((window, index) => h(WindowRow, {
          key: `${window.window}-${window.kind}-${index}`, window, provider: section.name, t,
        })),
        showBalances ? h('div', { className: 'dsh-ul-balances' },
          h('span', { className: 'dsh-ul-balance-label' }, t('balance')),
          balances.map((balance) => h('div', { className: 'dsh-ul-balance', key: balance.currency },
            h('span', { className: 'dsh-ul-amount' }, money(balance.total, balance.currency)),
            h('span', { className: 'dsh-ul-balance-note' },
              t('balanceNote', {
                granted: money(balance.granted, balance.currency),
                toppedUp: money(balance.toppedUp, balance.currency),
              }))))) : null,
        note === null ? null : h('p', { className: 'dsh-ul-note', 'data-tone': noteTone }, note),
        failed ? h('div', { className: 'dsh-ul-card-error' },
          h('p', { className: 'dsh-ul-note', 'data-tone': 'error' }, `${t('statusError')}: ${error}`),
          typeof onRetry === 'function'
            ? h('button', {
                type: 'button', className: 'dsh-ul-btn', 'data-size': 'sm',
                onClick: onRetry,
              }, t('retry'))
            : null) : null)
    }

    /** Label/value rows for the model and platform sections. */
    function FactList(props) {
      return h('dl', { className: 'dsh-ul-facts' },
        props.facts.map((fact, index) => h('div', { className: 'dsh-ul-fact', key: `${fact.label}-${index}` },
          h('dt', null, fact.label),
          h('dd', null, fact.value))))
    }

    /** Providers always shown, in display order; the Host answers each card on its own. */
    const PROVIDER_LIST = [
      { id: 'opencode-go', name: 'OpenCode Go' },
      { id: 'zai', name: 'Z.AI' },
      { id: 'deepseek', name: 'DeepSeek' },
      { id: 'openai-codex', name: 'OpenAI Codex' },
      { id: 'claude', name: 'Claude' },
      { id: 'grok', name: 'Grok' },
      { id: 'github-copilot', name: 'GitHub Copilot' },
      { id: 'google-antigravity', name: 'Google Antigravity' },
    ]

    /**
     * @param force - bypass the Host cache.
     * @param params - query parameters selecting the block.
     * @returns that block's URL.
     */
    function blockUrl(force, params) {
      const url = new URL(ROUTE, document.baseURI)
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
      url.searchParams.set('_', String(Date.now()))
      if (force) url.searchParams.set('refresh', '1')
      return url
    }

    /**
     * @param url - one block's URL.
     * @param signal - abort signal.
     * @returns its parsed body.
     */
    async function readBlock(url, signal) {
      const response = await fetch(url, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal,
      })
      const text = await response.text()
      let data = null
      try { data = text === '' ? null : JSON.parse(text) } catch { data = null }
      if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`)
      if (data && typeof data.error === 'string') throw new Error(data.error)
      return data
    }

    /** @param seconds - the Host's refresh window. @returns this block's polling delay in ms. */
    function refreshDelay(seconds) {
      return typeof seconds === 'number' && seconds > 0 ? Math.max(15, Math.min(600, seconds)) * 1000 : 60 * 1000
    }

    /** @param error - any thrown value. @returns its message. */
    function messageOf(error) {
      return error instanceof Error ? error.message : String(error)
    }

    /** @param props - translator. @returns a placeholder for a card still loading. */
    function SkeletonLines() {
      return h('div', { className: 'dsh-ul-card', 'aria-busy': 'true' },
        h('div', { className: 'dsh-ul-skeleton', style: { borderTop: 'none', marginTop: '0', paddingTop: '0' } },
          h('span', { className: 'dsh-ul-skeleton-line' }),
          h('span', { className: 'dsh-ul-skeleton-line' })))
    }

    /** One provider card: its own request, loader, retry, and polling cadence. */
    function ProviderBlock(props) {
      const { id, name, t, tick, onSettled, onUpdated } = props
      const [state, setState] = React.useState({ status: 'loading', section: null, error: null })
      const alive = React.useRef(true)
      const abort = React.useRef(null)
      const delay = React.useRef(60 * 1000)

      const load = React.useCallback(async (force) => {
        abort.current?.abort()
        const controller = new AbortController()
        abort.current = controller
        setState((previous) => previous.section === null
          ? { status: 'loading', section: null, error: null }
          : { ...previous, error: null })
        try {
          const data = await readBlock(blockUrl(force, { provider: id }), controller.signal)
          if (!alive.current || controller.signal.aborted) return
          const section = data?.provider
          if (section === null || typeof section !== 'object') throw new Error('malformed provider section')
          delay.current = refreshDelay(data?.refreshSeconds)
          setState({ status: 'ready', section, error: null })
          if (typeof data?.generatedAt === 'string') onUpdated(data.generatedAt)
        } catch (error) {
          if (controller.signal.aborted || !alive.current) return
          setState((previous) => ({
            status: previous.section === null ? 'error' : 'ready',
            section: previous.section,
            error: messageOf(error),
          }))
        }
      }, [id])

      React.useEffect(() => {
        alive.current = true
        let timer
        const arm = () => {
          clearTimeout(timer)
          timer = setTimeout(async () => {
            if (document.visibilityState === 'visible') await load(false)
            if (alive.current) arm()
          }, delay.current)
        }
        void load(false).finally(() => { if (alive.current) arm() })
        const onVisible = () => { if (document.visibilityState === 'visible') void load(false) }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          alive.current = false
          clearTimeout(timer)
          abort.current?.abort()
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [load])

      React.useEffect(() => {
        if (tick === 0) return
        void load(true).finally(() => { onSettled() })
      }, [tick])

      if (state.status === 'loading') {
        return h('div', { className: 'dsh-ul-card', 'aria-busy': 'true' },
          h('div', { className: 'dsh-ul-card-head' },
            h('div', { className: 'dsh-ul-name-row' }, h('h3', { className: 'dsh-ul-name' }, name)),
            h('span', { className: 'dsh-ul-status' },
              h('span', { className: 'dsh-ul-dot' }),
              t('loadingShort'))),
          h('div', { className: 'dsh-ul-skeleton' },
            h('span', { className: 'dsh-ul-skeleton-line' }),
            h('span', { className: 'dsh-ul-skeleton-line' })))
      }
      if (state.section === null) {
        return h('div', { className: 'dsh-ul-card' },
          h('div', { className: 'dsh-ul-card-head' },
            h('div', { className: 'dsh-ul-name-row' }, h('h3', { className: 'dsh-ul-name' }, name)),
            h('span', { className: 'dsh-ul-status' },
              h('span', { className: 'dsh-ul-dot', 'data-tone': 'error' }),
              t('statusError'))),
          h('div', { className: 'dsh-ul-card-error' },
            h('p', { className: 'dsh-ul-note', 'data-tone': 'error' }, `${t('statusError')}: ${state.error}`),
            h('button', {
              type: 'button', className: 'dsh-ul-btn', 'data-size': 'sm',
              onClick: () => { void load(true) },
            }, t('retry'))))
      }
      return h(ProviderCard, {
        section: { ...state.section, name: state.section.name ?? name },
        t,
        error: state.error,
        onRetry: () => { void load(true) },
      })
    }

    /** The model and platform cards: one local read, each section with its own placeholder. */
    function MetaBlocks(props) {
      const { t, tick, onSettled, onUpdated } = props
      const [state, setState] = React.useState({ status: 'loading', overview: null, error: null })
      const alive = React.useRef(true)
      const abort = React.useRef(null)
      const delay = React.useRef(60 * 1000)

      const load = React.useCallback(async (force) => {
        abort.current?.abort()
        const controller = new AbortController()
        abort.current = controller
        setState((previous) => previous.overview === null
          ? { status: 'loading', overview: null, error: null }
          : { ...previous, error: null })
        try {
          const data = await readBlock(blockUrl(force, { section: 'overview' }), controller.signal)
          if (!alive.current || controller.signal.aborted) return
          delay.current = refreshDelay(data?.refreshSeconds)
          setState({ status: 'ready', overview: data, error: null })
          if (typeof data?.generatedAt === 'string') onUpdated(data.generatedAt)
        } catch (error) {
          if (controller.signal.aborted || !alive.current) return
          setState((previous) => ({
            status: previous.overview === null ? 'error' : 'ready',
            overview: previous.overview,
            error: messageOf(error),
          }))
        }
      }, [])

      React.useEffect(() => {
        alive.current = true
        let timer
        const arm = () => {
          clearTimeout(timer)
          timer = setTimeout(async () => {
            if (document.visibilityState === 'visible') await load(false)
            if (alive.current) arm()
          }, delay.current)
        }
        void load(false).finally(() => { if (alive.current) arm() })
        const onVisible = () => { if (document.visibilityState === 'visible') void load(false) }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          alive.current = false
          clearTimeout(timer)
          abort.current?.abort()
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [load])

      React.useEffect(() => {
        if (tick === 0) return
        void load(true).finally(() => { onSettled() })
      }, [tick])

      const model = state.overview?.model
      const platform = state.overview?.platform
      const modelFacts = []
      if (model && model.provider && model.model) {
        const providerName = PROVIDER_LIST.find((entry) => entry.id === model.provider)?.name ?? model.provider
        modelFacts.push({ label: t('modelProvider'), value: providerName })
        modelFacts.push({
          label: t('modelModel'),
          value: model.name && model.name !== model.model ? model.name : model.model,
        })
        if (typeof model.contextWindow === 'number') {
          modelFacts.push({ label: t('modelContext'), value: tokenText(t, model.contextWindow) })
        }
        if (typeof model.maxTokens === 'number') {
          modelFacts.push({ label: t('modelOutput'), value: tokenText(t, model.maxTokens) })
        }
        if (Array.isArray(model.reasoningEfforts) && model.reasoningEfforts.length > 0) {
          modelFacts.push({ label: t('modelReasoning'), value: model.reasoningEfforts.join(' · ') })
        }
        if (typeof model.reasoningEffort === 'string' && model.reasoningEffort !== '') {
          modelFacts.push({ label: t('modelEffort'), value: model.reasoningEffort })
        }
      }
      const platformFacts = []
      if (platform) {
        if (typeof platform.subagentDepth === 'number') {
          platformFacts.push({ label: t('platformSubagentsLabel'), value: t('platformSubagents', { n: platform.subagentDepth }) })
        }
        if (platform.images) {
          platformFacts.push({
            label: t('platformImagesLabel'),
            value: t('platformImages', {
              mb: megabytes(platform.images.maxBytes),
              n: typeof platform.images.maxPerMessage === 'number' ? platform.images.maxPerMessage : '—',
            }),
          })
        }
        if (typeof platform.scheduleIntervalSeconds === 'number') {
          platformFacts.push({ label: t('platformScheduleLabel'), value: t('platformSchedule', { seconds: platform.scheduleIntervalSeconds }) })
        }
      }
      const loading = state.status === 'loading'
      const failed = typeof state.error === 'string' && state.error !== ''
      const retry = () => { void load(true) }
      const errorRow = h('div', { className: 'dsh-ul-card-error' },
        h('p', { className: 'dsh-ul-note', 'data-tone': 'error' }, `${t('statusError')}: ${state.error}`),
        h('button', { type: 'button', className: 'dsh-ul-btn', 'data-size': 'sm', onClick: retry }, t('retry')))
      const modelBody = modelFacts.length > 0
        ? h(FactList, { facts: modelFacts })
        : failed ? null : h('p', { className: 'dsh-ul-note' }, t('modelEmpty'))
      return h(React.Fragment, null,
        h('section', { className: 'dsh-ul-section' },
          h('h2', { className: 'dsh-ul-section-title' }, t('model')),
          loading
            ? h(SkeletonLines)
            : h('div', { className: 'dsh-ul-card' }, modelBody, failed ? errorRow : null)),
        loading || failed || platformFacts.length > 0
          ? h('section', { className: 'dsh-ul-section' },
            h('h2', { className: 'dsh-ul-section-title' }, t('platform')),
            loading
              ? h(SkeletonLines)
              : h('div', { className: 'dsh-ul-card' },
                platformFacts.length > 0 ? h(FactList, { facts: platformFacts }) : null,
                failed ? errorRow : null))
          : null)
    }

    /** The sidebar panel: every block loads on its own, so one slow provider holds nothing else. */
    function UsageLimitsPage(props) {
      const t = props.t
      const [tick, setTick] = React.useState(0)
      const [pending, setPending] = React.useState(0)
      const [updatedAt, setUpdatedAt] = React.useState(null)

      const settle = React.useCallback(() => {
        setPending((count) => Math.max(0, count - 1))
      }, [])
      const noteUpdated = React.useCallback((generatedAt) => {
        const at = Date.parse(generatedAt)
        if (!Number.isFinite(at)) return
        setUpdatedAt((previous) => previous === null || at > previous ? at : previous)
      }, [])

      const updated = (() => {
        if (updatedAt === null) return null
        try {
          return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(updatedAt))
        } catch {
          return null
        }
      })()
      const refreshing = pending > 0

      const header = h('div', { className: 'dsh-ul-head' },
        h('div', { className: 'dsh-ul-headings' },
          h('h1', { className: 'dsh-ul-title' }, t('title')),
          h('p', { className: 'dsh-ul-intro' }, t('intro')),
          h('p', { className: 'dsh-ul-legend' }, t('legend'))),
        h('div', { className: 'dsh-ul-actions' },
          updated === null ? null : h('span', { className: 'dsh-ul-updated' }, t('updated', { time: updated })),
          h('button', {
            type: 'button', className: 'dsh-ul-btn', disabled: refreshing,
            'data-spin': refreshing ? 'true' : 'false',
            onClick: () => {
              setPending(PROVIDER_LIST.length + 1)
              setTick((value) => value + 1)
            },
          },
          h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: false },
            h('path', { d: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
            h('path', { d: 'M13.6 2.4v2.9h-2.9', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' })),
          t('refresh'))))

      return h('div', { className: 'dsh-ul-page' },
        h('div', { className: 'dsh-ul-inner' },
          header,
          h('section', { className: 'dsh-ul-section' },
            h('h2', { className: 'dsh-ul-section-title' }, t('providers')),
            h('div', { className: 'dsh-ul-cards' },
              PROVIDER_LIST.map((provider) => h(ProviderBlock, {
                key: provider.id,
                id: provider.id,
                name: provider.name,
                t,
                tick,
                onSettled: settle,
                onUpdated: noteUpdated,
              })))),
          h(MetaBlocks, { t, tick, onSettled: settle, onUpdated: noteUpdated }),
          h('p', { className: 'dsh-ul-foot' }, t('footnote'))))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, ru }), 'usage-limits: dictionaries')
        ctx.effect(() => {
          for (const previous of document.querySelectorAll(`style[data-dsh-plugin="${PANEL_ID}"]`)) previous.remove()
          const style = document.createElement('style')
          style.dataset.dshPlugin = PANEL_ID
          style.textContent = CSS
          document.head.append(style)
          return () => { style.remove() }
        }, 'usage-limits: styles')
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID, locale: NS,
        }, UsageLimitsPage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 30, locale: NS, label: () => t('panel'),
        }, UsageLimitsIcon))
      },
    }
  },
})
