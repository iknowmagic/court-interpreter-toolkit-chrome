import type { PracticeState, PracticeTemplateTask } from "../shared/practice";
import * as db from "../shared/indexedDB";

export interface SessionManagerState {
	state: PracticeState | null;
	isRunning: boolean;
	isPaused: boolean;
	pausedAtMs: number;
}

let sessionState: SessionManagerState = {
	state: null,
	isRunning: false,
	isPaused: false,
	pausedAtMs: 0,
};
let lastToolbarStatusUpdateMs = 0;

function formatToolbarDuration(seconds: number): string {
	const safeSeconds = Math.max(0, Math.floor(seconds));
	const minutes = Math.floor(safeSeconds / 60);
	const remainingSeconds = safeSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function compactBadgeTime(seconds: number): string {
	const safeSeconds = Math.max(0, Math.floor(seconds));
	const minutes = Math.floor(safeSeconds / 60);
	const remainingSeconds = safeSeconds % 60;
	if (minutes >= 100) return `${minutes}m`;
	return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

async function refreshToolbarAction(
	state: PracticeState | null,
	isRunning: boolean,
): Promise<void> {
	if (!chrome.action) return;

	if (!state) {
		await chrome.action.setTitle({ title: "Court Interpreter Toolkit" });
		await chrome.action.setBadgeText({ text: "" });
		return;
	}

	const currentTask =
		state.session.tasks.find((task) => task.id === state.session.currentTaskId) ??
		state.session.tasks[0] ??
		null;

	if (!currentTask) {
		const doneText = state.session.done ? "DONE" : "";
		await chrome.action.setTitle({
			title: state.session.done
				? "Session complete"
				: "Court Interpreter Toolkit",
		});
		await chrome.action.setBadgeBackgroundColor({
			color: state.session.done ? "#2e7d52" : "#7a6e65",
		});
		await chrome.action.setBadgeText({ text: doneText });
		return;
	}

	const displaySeconds =
		currentTask.completedAt || currentTask.remainingSeconds === 0
			? currentTask.duration * 60
			: currentTask.remainingSeconds;
	const timeLabel = formatToolbarDuration(displaySeconds);
	const badgeText = state.session.done ? "DONE" : compactBadgeTime(displaySeconds);
	const statusLabel = state.session.done
		? "Complete"
		: isRunning
			? "Running"
			: "Stopped";
	const title = `${statusLabel}: ${currentTask.name} - ${timeLabel}`;
	const badgeColor = state.session.done
		? "#2e7d52"
		: isRunning
			? "#c4622d"
			: "#7a6e65";

	await chrome.action.setTitle({ title });
	await chrome.action.setBadgeBackgroundColor({ color: badgeColor });
	await chrome.action.setBadgeText({ text: badgeText });
}

export async function initializeSessionManager(): Promise<void> {
	// Initialize IndexedDB and load current state
	await db.initDB();
	sessionState.state = await db.loadState();
	await refreshToolbarAction(sessionState.state, sessionState.isRunning);
}

export async function getSessionState(): Promise<PracticeState | null> {
	if (!sessionState.state) {
		sessionState.state = await db.loadState();
	}
	return sessionState.state;
}

export async function loadStateByDate(date: string): Promise<PracticeState> {
	const state = await db.loadStateByDate(date);
	sessionState.state = state;
	await refreshToolbarAction(sessionState.state, sessionState.isRunning);
	return state;
}

export async function listSessionDates(): Promise<string[]> {
	return db.listSessionDates();
}

export async function startSession(): Promise<PracticeState | null> {
	if (!sessionState.state) {
		sessionState.state = await db.loadState();
	}

	sessionState.isRunning = true;
	sessionState.isPaused = false;
	await refreshToolbarAction(sessionState.state, sessionState.isRunning);

	return sessionState.state;
}

export async function pauseSession(): Promise<PracticeState | null> {
	sessionState.isRunning = false;
	sessionState.isPaused = true;
	sessionState.pausedAtMs = Date.now();

	// Persist the current session
	if (sessionState.state) {
		sessionState.state = await db.saveState(sessionState.state);
	}

	await refreshToolbarAction(sessionState.state, sessionState.isRunning);

	return sessionState.state;
}

export async function resumeSession(): Promise<PracticeState | null> {
	sessionState.isRunning = true;
	sessionState.isPaused = false;
	await refreshToolbarAction(sessionState.state, sessionState.isRunning);

	return sessionState.state;
}

export async function decrementTimer(
	seconds: number,
): Promise<PracticeState | null> {
	if (!sessionState.state || !sessionState.isRunning) {
		return sessionState.state || null;
	}

	const currentTask = sessionState.state.session.tasks.find(
		(t) => t.id === sessionState.state?.session.currentTaskId,
	);

	if (!currentTask) {
		return sessionState.state;
	}

	// Decrement the current task's remaining time
	currentTask.remainingSeconds = Math.max(
		0,
		currentTask.remainingSeconds - seconds,
	);

	// If task is complete, mark it and move to next
	if (currentTask.remainingSeconds === 0 && currentTask.completedAt === null) {
		currentTask.completedAt = new Date().toISOString();

		// Find next incomplete task
		const nextTask = sessionState.state.session.tasks.find(
			(t) => t.completedAt === null && t.id !== currentTask.id,
		);

		if (nextTask) {
			sessionState.state.session.currentTaskId = nextTask.id;
		} else {
			// All tasks complete
			sessionState.state.session.done = true;
			sessionState.state.session.currentTaskId = null;
			sessionState.isRunning = false;
		}
	}

	// Persist state periodically (e.g., every 10 decrements)
	// For now, persist on every change to ensure no data loss
	sessionState.state = await db.saveState(sessionState.state);
	await refreshToolbarAction(sessionState.state, sessionState.isRunning);

	return sessionState.state;
}

export async function saveSession(
	state: PracticeState,
): Promise<PracticeState> {
	sessionState.state = await db.saveState(state);
	await refreshToolbarAction(sessionState.state, sessionState.isRunning);
	return sessionState.state;
}

export async function newDay(
	template?: PracticeTemplateTask[],
): Promise<PracticeState> {
	if (template) {
		sessionState.state = await db.newDay(template);
	} else {
		const currentTemplate = sessionState.state?.template || undefined;
		sessionState.state = await db.newDay(currentTemplate || []);
	}

	sessionState.isRunning = false;
	sessionState.isPaused = false;
	await refreshToolbarAction(sessionState.state, sessionState.isRunning);

	return sessionState.state;
}

export async function resetToDefaults(): Promise<PracticeState> {
	sessionState.state = await db.resetToDefaults();
	sessionState.isRunning = false;
	sessionState.isPaused = false;
	await refreshToolbarAction(sessionState.state, sessionState.isRunning);

	return sessionState.state;
}

export async function editTemplate(
	template: PracticeTemplateTask[],
): Promise<PracticeState> {
	if (!sessionState.state) {
		sessionState.state = await db.loadState();
	}

	// Save new template and reconcile current session
	sessionState.state.template = template;
	sessionState.state = await db.saveState(sessionState.state);
	await refreshToolbarAction(sessionState.state, sessionState.isRunning);

	return sessionState.state;
}

export async function updateToolbarStatus(
	state: PracticeState,
	isRunning: boolean,
	timestampMs?: number,
	forceStopped?: boolean,
): Promise<{ ok: true; ignored?: true }> {
	const safeTimestamp = Math.max(0, Math.floor(timestampMs ?? Date.now()));
	if (safeTimestamp < lastToolbarStatusUpdateMs) {
		return { ok: true, ignored: true };
	}
	lastToolbarStatusUpdateMs = safeTimestamp;

	sessionState.state = state;
	sessionState.isRunning = forceStopped ? false : isRunning;
	sessionState.isPaused = !sessionState.isRunning;
	await refreshToolbarAction(sessionState.state, sessionState.isRunning);
	return { ok: true };
}

export function getRunningState(): { isRunning: boolean; isPaused: boolean } {
	return {
		isRunning: sessionState.isRunning,
		isPaused: sessionState.isPaused,
	};
}
