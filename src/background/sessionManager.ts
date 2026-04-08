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

export async function initializeSessionManager(): Promise<void> {
	// Initialize IndexedDB and load current state
	await db.initDB();
	sessionState.state = await db.loadState();
}

export async function getSessionState(): Promise<PracticeState | null> {
	if (!sessionState.state) {
		sessionState.state = await db.loadState();
	}
	return sessionState.state;
}

export async function startSession(): Promise<PracticeState | null> {
	if (!sessionState.state) {
		sessionState.state = await db.loadState();
	}

	sessionState.isRunning = true;
	sessionState.isPaused = false;

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

	return sessionState.state;
}

export async function resumeSession(): Promise<PracticeState | null> {
	sessionState.isRunning = true;
	sessionState.isPaused = false;

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

	return sessionState.state;
}

export async function saveSession(
	state: PracticeState,
): Promise<PracticeState> {
	sessionState.state = await db.saveState(state);
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

	return sessionState.state;
}

export async function resetToDefaults(): Promise<PracticeState> {
	sessionState.state = await db.resetToDefaults();
	sessionState.isRunning = false;
	sessionState.isPaused = false;

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

	return sessionState.state;
}

export function getRunningState(): { isRunning: boolean; isPaused: boolean } {
	return {
		isRunning: sessionState.isRunning,
		isPaused: sessionState.isPaused,
	};
}
