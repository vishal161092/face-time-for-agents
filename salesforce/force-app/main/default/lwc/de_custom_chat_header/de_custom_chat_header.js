import { LightningElement, api } from "lwc";
import { subscribe } from "c/de_avatarBus";
import {
    dispatchMessagingEvent,
    assignMessagingEventHandler,
    MESSAGING_EVENT
} from "lightningsnapin/eventStore";

// Hardcoded dealer-journey options so the 3-dot menu always has choices to
// click. Clicking one dispatches MENU_ITEM_SELECTED and pushes the option's
// title into the conversation as a customer message (so the agent routes it).
const TEST_MENU_OPTIONS = [
    {
        optionIdentifier: "Place an Order",
        title: "Place an Order",
        subtitle: "Photo, voice, file or manual",
        emoji: "🛒",
        accent: "#F26B21",
        tint: "#FDE9DC"
    },
    {
        optionIdentifier: "Raise a Complaint",
        title: "Raise a Complaint",
        subtitle: "Quality, short supply, delay",
        emoji: "⚠️",
        accent: "#E23744",
        tint: "#FBE0E3"
    },
    {
        optionIdentifier: "Track an Order",
        title: "Track an Order",
        subtitle: "3 in transit",
        emoji: "🚚",
        accent: "#7A3E9D",
        tint: "#EEE4F3"
    },
    {
        optionIdentifier: "My Schemes",
        title: "My Schemes",
        subtitle: "3 running this quarter",
        emoji: "🏅",
        accent: "#E8961E",
        tint: "#FCF0D6"
    },
    {
        optionIdentifier: "Ledger & Credit",
        title: "Ledger & Credit",
        subtitle: "₹6,20,000 available",
        emoji: "📒",
        accent: "#2E8B57",
        tint: "#E1F0E7"
    }
];

export default class DeCustomChatHeader extends LightningElement {
    /**
     * Deployment configuration data. Populated by the MIAW runtime.
     * Declared for future use (e.g. authenticated mode endSession()); not
     * currently read for the guest-user path.
     * @type {Object}
     */
    @api configuration = {};

    /**
     * The status of the conversation. Valid values:
     * - NOT_STARTED
     * - OPEN
     * - CLOSED
     * @type {ConversationStatus}
     */
    @api conversationStatus;

    /**
     * Array to store bot options menu. Seeded with test options so the inline
     * options panel always has clickable choices.
     * @type {Array}
     */
    chatbotOptionsMenu = [...TEST_MENU_OPTIONS];

    /**
     * Title shown in the header bar (swap for your own logo if you like).
     * @type {String}
     */
    headerTitle = "Face Time";

    /**
     * Language passed to the avatar for TTS voice selection.
     * @type {String}
     */
    avatarLang = "en-US";

    /**
     * Whether the avatar is currently allowed to speak replies aloud. Starts
     * off (muted) so there's no autoplay surprise; the first toggle-on is the
     * user gesture that unlocks browser audio.
     * @type {Boolean}
     */
    voiceEnabled = false;

    /**
     * Unsubscribe handle for the de_avatarBus subscription.
     * @type {Function}
     */
    _unsubscribeAvatar;

    /**
     * Bound window 'message' handler for inbound agent replies relayed from the
     * host page. In Embedded Messaging Web v2 the in-iframe header has NO API to
     * read inbound message text, so the host page listens for
     * `onEmbeddedMessageSent` and postMessages each agent/bot reply into this
     * iframe as `{ type: "de_agentMessage", text }`.
     * @type {Function}
     */
    _onHostMessage;

    /**
     * Whether the inline options panel is expanded. Starts open so the dealer
     * sees the journeys immediately; collapses once a choice is made (or when
     * the menu button is toggled) to hand the full panel back to the chat.
     * @type {Boolean}
     */
    isExpanded = true;

    /**
     * Whether the close-confirmation modal is open.
     * @type {Boolean}
     */
    showCloseModal = false;

    /**
     * Whether the post-chat survey modal is open.
     * @type {Boolean}
     */
    showSurvey = false;

    /**
     * Collected survey feedback.
     */
    surveyRating = 0;
    surveyThumb = "";

    /**
     * Identifier of the currently selected option (for highlight state).
     * @type {String}
     */
    selectedOption;

    /**
     * Options normalized with icon + selected-state classes for the card UI.
     * @returns {Array}
     */
    get menuOptions() {
        return this.chatbotOptionsMenu.map((option) => {
            const selected = option.optionIdentifier === this.selectedOption;
            const accent = option.accent || "#1C355E";
            const tint = option.tint || "#f4f5f7";
            return {
                optionIdentifier: option.optionIdentifier,
                title: option.title || option.optionIdentifier,
                subtitle: option.subtitle || "",
                emoji: option.emoji || "💬",
                cardClass: selected ? "de-opt-card de-opt-card-selected" : "de-opt-card",
                cardStyle: `--de-accent:${accent}; --de-tint:${tint};`,
                iconStyle: `background:${tint};`
            };
        });
    }

    /**
     * Whether the user is authenticated.
     * AuthMode can have the following values:
     * - Auth: user is in verified, which corresponds to the authenticated user mode.
     * - UnAuth: user is in unverified, which corresponds to the guest user mode.
     */
    get isAuthenticatedContext() {
        return (
            this.configuration &&
            this.configuration.embeddedServiceMessagingChannel &&
            this.configuration.embeddedServiceMessagingChannel.authMode === "Auth"
        );
    }

    /**
     * Whether to show the transcript button in the header bar.
     * @returns {Boolean}
     */
    get showTranscriptButton() {
        return this.conversationStatus === "OPEN";
    }

    /**
     * Whether the inline options panel is currently visible. The panel stays
     * expanded for the whole open conversation so the dealer always sees the
     * journeys.
     * @returns {Boolean}
     */
    get showOptions() {
        return this.isExpanded && this.conversationStatus === "OPEN";
    }

    /**
     * Whether to show the collapsed "Expand options" affordance (shown after a
     * pill is picked, so the dealer can reveal the pills again).
     * @returns {Boolean}
     */
    get showCollapsedHint() {
        return !this.isExpanded && this.conversationStatus === "OPEN";
    }

    /**
     * Host class — `is-expanded` lets the header grow to fit the inline
     * options panel.
     * @returns {String}
     */
    get hostClass() {
        return this.showOptions ? "is-expanded" : "";
    }

    /**
     * Whether the avatar bust should render in its enlarged form (while the
     * options panel is open and the header is tall).
     * @returns {Boolean}
     */
    get avatarBig() {
        return this.showOptions;
    }

    /**
     * Icon for the voice toggle button.
     * @returns {String}
     */
    get voiceIcon() {
        return this.voiceEnabled ? "utility:volume_high" : "utility:volume_off";
    }

    /**
     * Tooltip/label for the voice toggle button.
     * @returns {String}
     */
    get voiceTitle() {
        return this.voiceEnabled ? "Mute avatar voice" : "Let the avatar speak";
    }

    get voiceButtonClass() {
        return this.voiceEnabled
            ? "headerButton voiceButton voiceButton-on"
            : "headerButton voiceButton";
    }

    /**
     * Toggle whether the avatar speaks replies aloud. Runs inside a user-gesture
     * handler, so the first enable can unlock browser audio via face.prime().
     */
    handleToggleVoice() {
        this.voiceEnabled = !this.voiceEnabled;
        const face = this.template.querySelector("c-de_avatar-face");
        if (!face) {
            return;
        }
        if (this.voiceEnabled) {
            face.prime();
            face.mute(false);
        } else {
            face.mute(true);
        }
    }

    /**
     * Forward an inbound agent/bot reply (relayed from the custom text-message
     * bubble via de_avatarBus) to the avatar. The avatar itself drops it unless
     * voice is enabled.
     * @param {String} text
     */
    handleAgentMessage(text) {
        if (!text) {
            return;
        }
        // De-dupe: the host relays from BOTH onEmbeddedMessageSent and
        // onEmbeddedMessagingFirstBotMessageSent, and may reach this iframe via
        // more than one postMessage target — so the same reply can arrive 2x.
        // Drop an identical message seen within a short window.
        const now = Date.now();
        if (text === this._lastAgentText && now - (this._lastAgentAt || 0) < 4000) {
            return;
        }
        this._lastAgentText = text;
        this._lastAgentAt = now;

        const face = this.template.querySelector("c-de_avatar-face");
        if (face) {
            face.speak(text);
        }
    }

    /**
     * Re-reveal the options panel from the collapsed state.
     */
    handleExpandOptions() {
        this.isExpanded = true;
    }

    /**
     * Handle minimize button click. Runtime collapses the widget.
     */
    handleMinimize() {
        dispatchMessagingEvent(MESSAGING_EVENT.MINIMIZE_BUTTON_CLICK, {});
    }

    /**
     * Handle transcript button click in the header bar. Runtime handles the
     * download itself — we just signal intent.
     */
    handleHeaderTranscript() {
        dispatchMessagingEvent(MESSAGING_EVENT.REQUEST_TRANSCRIPT, {});
    }

    /**
     * Handle close (X) button click.
     * When the conversation is NOT open we dismiss the container. When it IS
     * open we show a HWD confirmation modal instead of hiding the button.
     */
    handleCloseClick() {
        if (this.conversationStatus === "OPEN") {
            this.showCloseModal = true;
        } else {
            dispatchMessagingEvent(MESSAGING_EVENT.CLOSE_CONTAINER, {});
        }
    }

    /**
     * "No (Keep Chatting)" — dismiss the modal without ending the chat.
     */
    handleCancelClose() {
        this.showCloseModal = false;
    }

    /**
     * "Download Transcript" from the modal.
     */
    handleDownloadTranscript() {
        dispatchMessagingEvent(MESSAGING_EVENT.REQUEST_TRANSCRIPT, {});
    }

    /**
     * "Yes (End Chat)" — show the post-chat survey before actually ending the
     * conversation, mimicking a Salesforce post-chat survey.
     */
    handleConfirmClose() {
        this.showCloseModal = false;
        this.showSurvey = true;
    }

    /**
     * Actually end the conversation.
     * Ending a messaging session is only supported for verified users.
     * Ending a conversation is only supported for unverified users.
     */
    endChat() {
        if (this.isAuthenticatedContext && this.configuration.util) {
            this.configuration.util.endSession();
        } else {
            dispatchMessagingEvent(MESSAGING_EVENT.CLOSE_CONVERSATION, {});
        }
    }

    /**
     * Star rating options with filled/empty state for the survey.
     * @returns {Array}
     */
    get stars() {
        return [1, 2, 3, 4, 5].map((n) => ({
            value: n,
            class: n <= this.surveyRating ? "de-star de-star-filled" : "de-star"
        }));
    }

    get thumbUpClass() {
        return this.surveyThumb === "up" ? "de-thumb de-thumb-selected" : "de-thumb";
    }

    get thumbDownClass() {
        return this.surveyThumb === "down" ? "de-thumb de-thumb-selected" : "de-thumb";
    }

    /**
     * Handle a star selection.
     */
    handleStarClick(event) {
        this.surveyRating = parseInt(event.currentTarget.dataset.value, 10);
    }

    /**
     * Handle a thumbs up/down selection.
     */
    handleThumbClick(event) {
        this.surveyThumb = event.currentTarget.dataset.value;
    }

    /**
     * Submit the survey, then end the chat.
     */
    handleSurveySubmit() {
        // Demo: log the feedback. In a real deployment this would be sent to a
        // Survey / Feedback record via an Apex or REST call.
        // eslint-disable-next-line no-console
        console.log("[Post-chat survey]", {
            rating: this.surveyRating,
            resolved: this.surveyThumb
        });
        this.showSurvey = false;
        this.endChat();
    }

    /**
     * Skip the survey and end the chat.
     */
    handleSurveySkip() {
        this.showSurvey = false;
        this.endChat();
    }

    /**
     * Handle a click on one of the 3-dot menu options.
     * Sends the option's title into the conversation as a text message so it
     * behaves like the customer typed and sent it.
     */
    handleMenuOptionClick(event) {
        event.preventDefault();

        const selectedIdentifier = event.currentTarget.dataset.value;
        const selectedOption = this.chatbotOptionsMenu.find(
            (option) => option.optionIdentifier === selectedIdentifier
        );
        this.selectedOption = selectedIdentifier;

        // Still notify the runtime that a menu item was selected.
        dispatchMessagingEvent(MESSAGING_EVENT.MENU_ITEM_SELECTED, {
            selectedOption: selectedOption
        });

        // Push the option text into the chat as a customer message.
        if (selectedOption && selectedOption.title) {
            this.sendTextToChat(selectedOption.title);
        }

        // Collapse the panel; the "Expand options" hint lets them re-open it.
        this.isExpanded = false;
    }

    /**
     * Inject a text message into the Embedded Messaging conversation.
     *
     * The header runs inside the MIAW widget iframe, which is cross-origin to
     * the host page — so we cannot read the host's embeddedservice_bootstrap
     * object directly (that throws). Instead we postMessage the text out to the
     * host page, where a Head Markup listener relays it to
     * embeddedservice_bootstrap.utilAPI.sendTextMessage(). This mirrors the
     * de_chatPromoPopup pattern.
     */
    sendTextToChat(text) {
        const payload = { type: "de_sendText", message: text };

        // 1) Same-origin: call the bootstrap API directly if reachable.
        try {
            let win = window;
            for (let i = 0; i < 10 && win; i++) {
                const boot = win.embeddedservice_bootstrap;
                if (boot && boot.utilAPI && typeof boot.utilAPI.sendTextMessage === "function") {
                    boot.utilAPI.sendTextMessage(text);
                    return;
                }
                if (win === win.parent) {
                    break;
                }
                win = win.parent;
            }
        } catch (e) {
            // Cross-origin — fall through to postMessage relay.
        }

        // 2) Cross-origin: post the text out to the host page (never throws).
        try {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage(payload, "*");
            }
            if (window.top && window.top !== window.parent) {
                window.top.postMessage(payload, "*");
            }
        } catch (e) {
            // no-op
        }
    }

    connectedCallback() {
        // PRIMARY (v2) path: agent replies are relayed from the HOST page (which
        // listens for `onEmbeddedMessageSent`) and postMessaged into this iframe.
        this._onHostMessage = (event) => {
            const data = event && event.data;
            if (data && data.type === "de_agentMessage" && data.text) {
                this.handleAgentMessage(data.text);
            }
        };
        window.addEventListener("message", this._onHostMessage);

        // Announce to the host page that an avatar header is live in this iframe,
        // so the host can postMessage agent replies straight back to event.source
        // (with a broadcast-to-all-iframes fallback on the host side).
        this.announceAvatarReady();

        // SECONDARY path (kept for forward-compat): if a custom Text Message
        // Bubble ever becomes available, it publishes to the shared in-iframe
        // de_avatarBus singleton. Harmless no-op when nothing publishes.
        this._unsubscribeAvatar = subscribe((text) => this.handleAgentMessage(text));

        assignMessagingEventHandler(MESSAGING_EVENT.PARTICIPANT_JOINED, (data) => {
            // Append any bot-provided options on top of the test options.
            if (data.options && Array.isArray(data.options)) {
                data.options.forEach((participantOption) => {
                    this.chatbotOptionsMenu.push(participantOption);
                });
            }
        });

        assignMessagingEventHandler(MESSAGING_EVENT.PARTICIPANT_LEFT, () => {
            // Reset back to the test options.
            this.chatbotOptionsMenu = [...TEST_MENU_OPTIONS];
        });

        assignMessagingEventHandler(MESSAGING_EVENT.UPDATE_HEADER_TEXT, () => {
            // Empty by design — the header always shows the fixed branded title.
        });
    }

    /**
     * Post a readiness ping up to the host page so it can learn this iframe's
     * window and relay agent replies back to it. Cross-origin safe (never
     * throws); the host also has a broadcast fallback if this is missed.
     */
    announceAvatarReady() {
        const ping = { type: "de_avatarReady" };
        try {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage(ping, "*");
            }
            if (window.top && window.top !== window.parent) {
                window.top.postMessage(ping, "*");
            }
        } catch (e) {
            // no-op
        }
    }

    disconnectedCallback() {
        if (this._onHostMessage) {
            window.removeEventListener("message", this._onHostMessage);
            this._onHostMessage = null;
        }
        if (this._unsubscribeAvatar) {
            this._unsubscribeAvatar();
            this._unsubscribeAvatar = null;
        }
    }
}