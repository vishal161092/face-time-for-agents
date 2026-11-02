/**
 * de_avatarBus — tiny in-iframe pub/sub singleton.
 *
 * The MIAW custom header and the custom text-message bubble render inside the
 * SAME widget iframe, so they share this one ES-module instance. The bubble
 * publishes each inbound agent/bot reply; the header's avatar subscribes and
 * speaks it. No DOM scraping and no cross-origin postMessage needed.
 */

const subscribers = new Set();

/**
 * Notify every subscriber with the agent reply text.
 * De-duplication (by conversation-entry identifier) is handled by the
 * publisher (de_avatarMessageBubble); this stays a dumb fan-out.
 * @param {string} text
 */
export function publishAgentMessage(text) {
    if (!text) {
        return;
    }
    for (const cb of subscribers) {
        try {
            cb(text);
        } catch (e) {
            // A broken subscriber must not stop the others.
        }
    }
}

/**
 * Register a listener. Returns an unsubscribe function.
 * @param {(text: string) => void} cb
 * @returns {() => void}
 */
export function subscribe(cb) {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
}
