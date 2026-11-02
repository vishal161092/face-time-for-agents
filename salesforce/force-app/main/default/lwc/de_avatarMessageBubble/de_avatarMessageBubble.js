import { LightningElement, api } from "lwc";
import { publishAgentMessage } from "c/de_avatarBus";

/**
 * de_avatarMessageBubble — custom MIAW Text Message Bubble.
 *
 * MIAW renders one instance per text message and passes the message as
 * @api conversationEntry. It is the only officially-supported in-iframe hook
 * for message CONTENT, so we use it to (a) render the bubble normally and
 * (b) forward each agent/bot reply to the avatar in the header via the shared
 * de_avatarBus singleton (same iframe ⇒ same module instance).
 */

// Identifiers already forwarded — guards against double-speak when a bubble
// re-renders. Module-level so it's shared across all bubble instances.
const forwarded = new Set();

export default class DeAvatarMessageBubble extends LightningElement {
    _entry;
    text = "";
    isAgent = false;

    @api
    get conversationEntry() {
        return this._entry;
    }
    set conversationEntry(value) {
        this._entry = value;
        this.process(value);
    }

    process(entry) {
        if (!entry) {
            return;
        }
        const text = this.extractText(entry);
        this.text = text;
        const role = entry.sender && entry.sender.role;
        this.isAgent = role === "Agent" || role === "Chatbot";

        if (this.isAgent && text) {
            const id = entry.identifier || entry.messageId || text;
            if (!forwarded.has(id)) {
                forwarded.add(id);
                // The avatar drops this unless the user has enabled voice, so
                // history replays on reload stay silent.
                publishAgentMessage(text);
            }
        }
    }

    extractText(entry) {
        try {
            const payload =
                typeof entry.entryPayload === "string"
                    ? JSON.parse(entry.entryPayload)
                    : entry.entryPayload;
            const t =
                payload &&
                payload.abstractMessage &&
                payload.abstractMessage.staticContent &&
                payload.abstractMessage.staticContent.text;
            if (t) {
                return t;
            }
        } catch (e) {
            // fall through to shallow fallbacks
        }
        return (entry && (entry.text || entry.messageText)) || "";
    }

    get bubbleClass() {
        return this.isAgent ? "de-bubble de-bubble-agent" : "de-bubble de-bubble-user";
    }
}
