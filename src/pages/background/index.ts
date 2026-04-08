import * as sessionManager from "../../background/sessionManager";

console.log("background script loaded");

const PIN_REMINDER_KEYS = {
	dismissed: "pinReminderDismissed",
	pending: "pinReminderPending",
	shownAtLeastOnce: "pinReminderShownAtLeastOnce",
} as const;
const PIN_REMINDER_ROOT_ID = "court-interpreter-pin-reminder-root";

interface PinReminderState {
	dismissed: boolean;
	pending: boolean;
	shownAtLeastOnce: boolean;
}

function isInjectableTabUrl(url?: string): boolean {
	return Boolean(url && /^https?:\/\//.test(url));
}

async function loadPinReminderState(): Promise<PinReminderState> {
	const stored = await chrome.storage.local.get([
		PIN_REMINDER_KEYS.dismissed,
		PIN_REMINDER_KEYS.pending,
		PIN_REMINDER_KEYS.shownAtLeastOnce,
	]);
	return {
		dismissed: Boolean(stored[PIN_REMINDER_KEYS.dismissed]),
		pending: Boolean(stored[PIN_REMINDER_KEYS.pending]),
		shownAtLeastOnce: Boolean(stored[PIN_REMINDER_KEYS.shownAtLeastOnce]),
	};
}

async function savePinReminderState(
	partial: Partial<PinReminderState>,
): Promise<void> {
	const updates: Record<string, boolean> = {};
	if (typeof partial.dismissed === "boolean") {
		updates[PIN_REMINDER_KEYS.dismissed] = partial.dismissed;
	}
	if (typeof partial.pending === "boolean") {
		updates[PIN_REMINDER_KEYS.pending] = partial.pending;
	}
	if (typeof partial.shownAtLeastOnce === "boolean") {
		updates[PIN_REMINDER_KEYS.shownAtLeastOnce] = partial.shownAtLeastOnce;
	}
	if (Object.keys(updates).length > 0) {
		await chrome.storage.local.set(updates);
	}
}

async function dismissPinReminder(): Promise<void> {
	await savePinReminderState({
		dismissed: true,
		pending: false,
	});
}

async function isExtensionPinnedToToolbar(): Promise<boolean> {
	try {
		if (!chrome.action?.getUserSettings) return false;
		const settings = await chrome.action.getUserSettings();
		return Boolean(settings.isOnToolbar);
	} catch {
		return false;
	}
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
	try {
		const tabs = await chrome.tabs.query({
			active: true,
			lastFocusedWindow: true,
		});
		return tabs[0] ?? null;
	} catch {
		return null;
	}
}

function injectPinReminderWidget(rootId: string): "inserted" | "exists" | "unsupported" {
	if (!document?.documentElement) return "unsupported";
	if (document.getElementById(rootId)) return "exists";

	const host = document.createElement("div");
	host.id = rootId;
	host.style.position = "fixed";
	host.style.top = "16px";
	host.style.right = "16px";
	host.style.zIndex = "2147483647";

	const shadowRoot = host.attachShadow({ mode: "open" });
	const style = document.createElement("style");
	style.textContent = `
		:host {
			all: initial;
		}
		*,
		*::before,
		*::after {
			box-sizing: border-box;
		}
		.wrap {
			display: flex;
			flex-direction: column;
			align-items: flex-end;
			font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			color: #1f1f1f;
			pointer-events: auto;
		}
		.caret {
			width: 0;
			height: 0;
			border-left: 9px solid transparent;
			border-right: 9px solid transparent;
			border-bottom: 9px solid #d7deee;
			margin-right: 14px;
			position: relative;
		}
		.caret::after {
			content: "";
			position: absolute;
			top: 1.5px;
			left: -8px;
			border-left: 8px solid transparent;
			border-right: 8px solid transparent;
			border-bottom: 8px solid #fff;
		}
		.card {
			background: #fff;
			border: 1px solid #d7deee;
			border-radius: 14px;
			padding: 14px 16px;
			width: 240px;
			box-shadow: 0 8px 30px rgba(24, 39, 75, 0.14);
			display: flex;
			flex-direction: column;
			gap: 12px;
		}
		.row {
			display: flex;
			gap: 10px;
			align-items: flex-start;
		}
		.icon-wrap {
			width: 34px;
			height: 34px;
			border-radius: 9px;
			background: #e8f0fe;
			border: 1px solid #c5d7fb;
			display: flex;
			align-items: center;
			justify-content: center;
			flex-shrink: 0;
		}
		.title {
			margin: 0 0 3px;
			font-size: 13px;
			font-weight: 600;
			line-height: 1.3;
		}
		.body {
			margin: 0;
			font-size: 12px;
			line-height: 1.45;
			color: #4a4f59;
		}
		.foot {
			display: flex;
			justify-content: flex-end;
		}
		.btn {
			font-size: 12px;
			font-weight: 600;
			padding: 6px 14px;
			border-radius: 8px;
			border: none;
			background: #4285f4;
			color: #fff;
			cursor: pointer;
		}
		.btn:hover {
			background: #2f74e5;
		}
	`;

	const wrapper = document.createElement("div");
	wrapper.className = "wrap";
	wrapper.innerHTML = `
		<div class="caret" aria-hidden="true"></div>
		<section class="card" aria-label="Pin extension reminder">
			<div class="row">
				<div class="icon-wrap" aria-hidden="true">
					<svg width="17" height="17" viewBox="0 0 24 24" fill="none">
						<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Z" fill="#4285f4"></path>
						<circle cx="12" cy="9" r="2.5" fill="#fff"></circle>
					</svg>
				</div>
				<div>
					<p class="title">Pin this extension</p>
					<p class="body">Click the puzzle icon in Chrome, then pin Court Interpreter so it stays on your toolbar.</p>
				</div>
			</div>
			<div class="foot">
				<button type="button" class="btn">Got it</button>
			</div>
		</section>
	`;

	const button = wrapper.querySelector("button");
	button?.addEventListener("click", () => {
		try {
			chrome.runtime.sendMessage({ action: "dismissPinReminder" });
		} catch {
			// no-op
		}
		host.remove();
	});

	shadowRoot.append(style, wrapper);
	document.documentElement.appendChild(host);
	return "inserted";
}

async function tryInjectPinReminderIntoTab(
	tab: chrome.tabs.Tab | null,
): Promise<boolean> {
	if (!tab?.id || !isInjectableTabUrl(tab.url)) return false;
	try {
		const results = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: injectPinReminderWidget,
			args: [PIN_REMINDER_ROOT_ID],
		});
		return results.some(
			(result) => result.result === "inserted" || result.result === "exists",
		);
	} catch {
		return false;
	}
}

async function maybeShowPinReminderInActiveTab(): Promise<void> {
	const state = await loadPinReminderState();
	if (state.dismissed || !state.pending) return;
	if (await isExtensionPinnedToToolbar()) {
		await dismissPinReminder();
		return;
	}

	const activeTab = await getActiveTab();
	const shown = await tryInjectPinReminderIntoTab(activeTab);
	if (shown && !state.shownAtLeastOnce) {
		await savePinReminderState({ shownAtLeastOnce: true });
	}
}

async function handleExtensionInstall(
	details: chrome.runtime.InstalledDetails,
): Promise<void> {
	if (details.reason !== "install") return;
	await savePinReminderState({
		dismissed: false,
		pending: true,
		shownAtLeastOnce: false,
	});
	await maybeShowPinReminderInActiveTab();
}

// Initialize session manager on startup
sessionManager.initializeSessionManager().catch((err) => {
	console.error("Failed to initialize session manager:", err);
});
sessionManager.initializeActionContextMenu().catch((err) => {
	console.error("Failed to initialize action context menu:", err);
});

chrome.runtime.onInstalled.addListener((details) => {
	void handleExtensionInstall(details);
});

chrome.alarms.onAlarm.addListener((alarm) => {
	sessionManager.handleBackgroundTickAlarm(alarm);
});

chrome.contextMenus.onClicked.addListener((info) => {
	void sessionManager.handleActionContextMenuClick(String(info.menuItemId));
});

// Handle messages from UI pages (popup, options, panels, etc.)
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
	(async () => {
		try {
			let response: unknown;

			switch (request.action) {
				case "loadState":
				case "getSessionState":
					response = await sessionManager.getSessionState();
					break;

				case "loadStateByDate":
					response = await sessionManager.loadStateByDate(request.date);
					break;

				case "listSessionDates":
					response = await sessionManager.listSessionDates();
					break;

				case "startSession":
					response = await sessionManager.startSession();
					break;

				case "pauseSession":
					response = await sessionManager.pauseSession();
					break;

				case "resumeSession":
					response = await sessionManager.resumeSession();
					break;

				case "decrementTimer":
					response = await sessionManager.decrementTimer(request.seconds || 1);
					break;

				case "saveSession":
					response = await sessionManager.saveSession(request.state);
					break;

				case "newDay":
					response = await sessionManager.newDay(request.template);
					break;

				case "resetToDefaults":
					response = await sessionManager.resetToDefaults();
					break;

				case "editTemplate":
					response = await sessionManager.editTemplate(request.template);
					break;

				case "getRunningState":
					response = sessionManager.getRunningState();
					break;

				case "updateToolbarStatus":
					response = await sessionManager.updateToolbarStatus(
						request.state,
						Boolean(request.isRunning),
						typeof request.timestampMs === "number"
							? request.timestampMs
							: undefined,
						Boolean(request.forceStopped),
					);
					break;

				case "completeCurrentTaskAndAdvance":
					response = await sessionManager.completeCurrentTaskAndAdvanceNoStart();
					break;

				case "popupOpened":
					await maybeShowPinReminderInActiveTab();
					response = { ok: true };
					break;

				case "dismissPinReminder":
					await dismissPinReminder();
					response = { ok: true };
					break;

				default:
					response = { error: `Unknown action: ${request.action}` };
			}

			sendResponse({ success: true, data: response });
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			console.error(`Error handling ${request.action}:`, error);
			sendResponse({ success: false, error: errorMessage });
		}
	})();

	// Return true to indicate we will send a response asynchronously
	return true;
});
