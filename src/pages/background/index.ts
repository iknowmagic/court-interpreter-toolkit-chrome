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

// Initialize session manager on startup
sessionManager.initializeSessionManager().catch((err) => {
	console.error("Failed to initialize session manager:", err);
});
sessionManager.initializeActionContextMenu().catch((err) => {
	console.error("Failed to initialize action context menu:", err);
});

chrome.runtime.onInstalled.addListener((details) => {
	void handleInstallWelcome(details);
});

chrome.alarms.onAlarm.addListener((alarm) => {
	sessionManager.handleBackgroundTickAlarm(alarm);
});

chrome.contextMenus.onClicked.addListener((info) => {
	void sessionManager.handleActionContextMenuClick(
		String(info.menuItemId),
		info.checked,
	);
});

// Handle messages from UI pages (popup, options, panels, etc.)
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
	if (!request || typeof request.action !== "string") {
		return false;
	}

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

				case "getCompletionAlarmSetting":
					response = await sessionManager.getCompletionAlarmSetting();
					break;

				case "setCompletionAlarmSetting":
					response = await sessionManager.setCompletionAlarmSetting(
						Boolean(request.enabled),
					);
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
