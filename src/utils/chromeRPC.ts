import type { PracticeState, PracticeTemplateTask } from "../shared/practice";

interface Message {
	action: string;
	[key: string]: unknown;
}

interface Response {
	success: boolean;
	data?: unknown;
	error?: string;
}

async function sendMessage<T>(message: Message): Promise<T> {
	return new Promise((resolve, reject) => {
		chrome.runtime.sendMessage(message, (response: Response) => {
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message));
			} else if (!response.success) {
				reject(new Error(response.error || "Unknown error"));
			} else {
				resolve(response.data as T);
			}
		});
	});
}

export async function loadState(): Promise<PracticeState> {
	return sendMessage<PracticeState>({ action: "loadState" });
}

export async function loadStateByDate(date: string): Promise<PracticeState> {
	return sendMessage<PracticeState>({ action: "loadStateByDate", date });
}

export async function listSessionDates(): Promise<string[]> {
	return sendMessage<string[]>({ action: "listSessionDates" });
}

export async function getSessionState(): Promise<PracticeState | null> {
	return sendMessage<PracticeState | null>({ action: "getSessionState" });
}

export async function startSession(): Promise<PracticeState | null> {
	return sendMessage<PracticeState | null>({ action: "startSession" });
}

export async function pauseSession(): Promise<PracticeState | null> {
	return sendMessage<PracticeState | null>({ action: "pauseSession" });
}

export async function resumeSession(): Promise<PracticeState | null> {
	return sendMessage<PracticeState | null>({ action: "resumeSession" });
}

export async function decrementTimer(
	seconds: number,
): Promise<PracticeState | null> {
	return sendMessage<PracticeState | null>({
		action: "decrementTimer",
		seconds,
	});
}

export async function saveSession(
	state: PracticeState,
): Promise<PracticeState> {
	return sendMessage<PracticeState>({ action: "saveSession", state });
}

export async function saveState(state: PracticeState): Promise<PracticeState> {
	return saveSession(state);
}

export async function newDay(
	template?: PracticeTemplateTask[],
): Promise<PracticeState> {
	return sendMessage<PracticeState>({ action: "newDay", template });
}

export async function resetToDefaults(): Promise<PracticeState> {
	return sendMessage<PracticeState>({ action: "resetToDefaults" });
}

export async function editTemplate(
	template: PracticeTemplateTask[],
): Promise<PracticeState> {
	return sendMessage<PracticeState>({ action: "editTemplate", template });
}

export async function getRunningState(): Promise<{
	isRunning: boolean;
	isPaused: boolean;
}> {
	return sendMessage<{ isRunning: boolean; isPaused: boolean }>({
		action: "getRunningState",
	});
}

export async function updateToolbarStatus(
	state: PracticeState,
	isRunning: boolean,
	options?: { timestampMs?: number; forceStopped?: boolean },
): Promise<void> {
	await sendMessage<{ ok: true }>({
		action: "updateToolbarStatus",
		state,
		isRunning,
		timestampMs: options?.timestampMs,
		forceStopped: options?.forceStopped,
	});
}
