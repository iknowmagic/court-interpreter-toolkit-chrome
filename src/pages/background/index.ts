import * as sessionManager from "../../background/sessionManager";

console.log("background script loaded");

async function handleInstallWelcome(
	details: chrome.runtime.InstalledDetails,
): Promise<void> {
	if (details.reason !== chrome.runtime.OnInstalledReason.INSTALL) return;

	try {
		await chrome.tabs.create({
			url: chrome.runtime.getURL("welcome.html"),
		});
	} catch (error) {
		console.error("Failed to open welcome page on install:", error);
	}
}

/**
 * Runs `operation` only after a fresh, successful `ensureInitialized()` for
 * *this* event. Unlike awaiting a single module-level promise, calling
 * `ensureInitialized()` again on every event means a prior initialization
 * failure (which resets the session manager's internal `initPromise`) can
 * still succeed on a later event instead of permanently failing every
 * caller. Rejections propagate to the caller, which logs at its own event
 * boundary.
 */
async function runInitialized<T>(
	label: string,
	operation: () => Promise<T> | T,
): Promise<T> {
	await sessionManager.ensureInitialized();
	return operation();
}

// Eager warm-up so the first real event doesn't pay full cold-start latency.
// Its rejection is only logged here; every event below calls
// ensureInitialized() again on its own, so a failure here never blocks a
// later retry.
void sessionManager.ensureInitialized().catch((error) => {
	console.error("Initial session manager warm-up failed:", error);
});

chrome.runtime.onInstalled.addListener((details) => {
	void handleInstallWelcome(details);
});

chrome.alarms.onAlarm.addListener((alarm) => {
	void runInitialized("alarm", () =>
		sessionManager.handleBackgroundTickAlarm(alarm),
	).catch((error) => {
		console.error("Failed to handle alarm:", error);
	});
});

chrome.contextMenus.onClicked.addListener((info) => {
	void runInitialized("context-menu click", () =>
		sessionManager.handleActionContextMenuClick(
			String(info.menuItemId),
			info.checked,
		),
	).catch((error) => {
		console.error("Failed to handle context-menu click:", error);
	});
});

// Handle messages from UI pages (popup, options).
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
	if (!request || typeof request.action !== "string") {
		return false;
	}

	(async () => {
		try {
			const response = await runInitialized(request.action, async () => {
				switch (request.action) {
					case "loadState":
					case "getSessionState":
						return sessionManager.getSessionState();

					case "readStateByDate":
						return sessionManager.readStateByDate(request.date as string);

					case "listSessionSummaries":
						return sessionManager.listSessionSummaries();

					case "startSession":
						return sessionManager.startSession();

					case "pauseSession":
						return sessionManager.pauseSession();

					case "saveSession":
						return sessionManager.saveSession(
							request.state as Parameters<typeof sessionManager.saveSession>[0],
						);

					case "newDay":
						return sessionManager.newDay(
							request.template as Parameters<typeof sessionManager.newDay>[0],
						);

					case "resetToDefaults":
						return sessionManager.resetToDefaults();

					case "editTemplate":
						return sessionManager.editTemplate(
							request.template as Parameters<typeof sessionManager.editTemplate>[0],
						);

					case "getRunningState":
						return sessionManager.getRunningState();

					case "getCompletionAlarmSetting":
						return sessionManager.getCompletionAlarmSetting();

					case "setCompletionAlarmSetting":
						return sessionManager.setCompletionAlarmSetting(
							Boolean(request.enabled),
						);

					case "completeCurrentTaskAndAdvance":
						return sessionManager.completeCurrentTaskAndAdvanceNoStart();

					default:
						return { error: `Unknown action: ${request.action}` };
				}
			});

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
