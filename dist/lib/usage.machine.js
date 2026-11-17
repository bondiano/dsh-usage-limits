/**
 * One provider card in the limits panel (client.js `ProviderBlock`).
 *
 * The card state shown to the user is the machine state; every ProviderBlock
 * status write goes through `nextBlockStatus`, so an impossible sequence fails
 * loudly instead of rendering a state the panel cannot explain.
 *
 * Diffed against `extensions/dsh/machines/machines/dsh-usage-limits.mjs`
 * `usageBlock`: added the self-transitions `ready --SUCCESS--> ready` (a poll
 * can answer while the card already shows data) and
 * `readyError --REFRESH_FAILED--> readyError` (two refreshes can fail in a
 * row); both keep the visible card unchanged. The same file's
 * `usageProvider` machine is deliberately not used here: the Host computes
 * each snapshot's provider status fresh from one response (index.js
 * provider fetchers), there is no persistent lifecycle to transition, so a
 * machine could not be authoritative for it.
 */
import { createMachine, initialTransition, transition } from 'xstate';
export const usageBlockMachine = createMachine({
    id: 'usageBlock',
    initial: 'loading',
    description: 'One provider card: initial load, ready with polling, or an error card that can retry.',
    states: {
        loading: { on: { SUCCESS: 'ready', FAIL: 'error' } },
        ready: { on: { SUCCESS: 'ready', REFRESH: 'ready', REFRESH_FAILED: 'readyError', TICK: 'ready' } },
        readyError: { on: { REFRESH: 'readyError', SUCCESS: 'ready', RETRY: 'loading', REFRESH_FAILED: 'readyError' } },
        error: { on: { RETRY: 'loading', SUCCESS: 'ready' } },
    },
});
/** The card state a provider block starts in. */
export function initialBlockStatus() {
    return initialTransition(usageBlockMachine)[0].value;
}
/**
 * Apply one lifecycle event to a card state.
 * @param {string} status - current card state.
 * @param {string | { type: string }} event - event type or event object.
 * @returns {string} the next card state.
 */
export function nextBlockStatus(status, event) {
    const eventObject = typeof event === 'string' ? { type: event } : event;
    const snapshot = usageBlockMachine.resolveState({ value: status });
    if (!snapshot.can(eventObject)) {
        throw new Error(`illegal usage block transition: ${status} --${eventObject.type}-->`);
    }
    return transition(usageBlockMachine, snapshot, eventObject)[0].value;
}
