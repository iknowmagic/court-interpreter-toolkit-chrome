import {
	formatLosAngelesTimestamp,
	type PracticeState,
	type PracticeTemplateTask,
} from "../shared/practice";
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
const BACKGROUND_TICK_INTERVAL_MS = 1000;
const BACKGROUND_TICK_ALARM = "practice-session-tick";
let tickIntervalId: number | null = null;
let tickInFlight = false;
let lastTickAtMs = Date.now();

function elapsedSecondsSinceLastTick(nowMs = Date.now()): number {
	const elapsed = Math.floor((nowMs - lastTickAtMs) / 1000);
	if (elapsed <= 0) return 0;
	lastTickAtMs += elapsed * 1000;
	return elapsed;
}

function ensureTickerRunning(): void {
	if (tickIntervalId !== null) return;
	lastTickAtMs = Date.now();
	tickIntervalId = globalThis.setInterval(() => {
		const elapsedSeconds = elapsedSecondsSinceLastTick();
		void runBackgroundTick(elapsedSeconds);
	}, BACKGROUND_TICK_INTERVAL_MS);
	if (chrome.alarms) {
		void chrome.alarms.create(BACKGROUND_TICK_ALARM, { periodInMinutes: 0.5 });
	}
}

function stopTicker(): void {
	if (tickIntervalId !== null) {
		globalThis.clearInterval(tickIntervalId);
		tickIntervalId = null;
	}
	if (chrome.alarms) {
		void chrome.alarms.clear(BACKGROUND_TICK_ALARM);
	}
}

async function runBackgroundTick(seconds: number): Promise<void> {
	if (seconds <= 0 || !sessionState.isRunning || tickInFlight) return;
	tickInFlight = true;
	try {
		await decrementTimer(seconds);
	} catch (error) {
		console.error("Failed to run background timer tick", error);
	} finally {
		tickInFlight = false;
	}
}

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
	if (chrome.alarms) {
		const existingAlarm = await chrome.alarms.get(BACKGROUND_TICK_ALARM);
		if (existingAlarm) {
			sessionState.isRunning = true;
			sessionState.isPaused = false;
			ensureTickerRunning();
		}
	}
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
	if (sessionState.state?.session.done) {
		sessionState.isRunning = false;
		sessionState.isPaused = false;
		stopTicker();
		await refreshToolbarAction(sessionState.state, sessionState.isRunning);
		return sessionState.state;
	}

	sessionState.isRunning = true;
	sessionState.isPaused = false;
	ensureTickerRunning();
	await refreshToolbarAction(sessionState.state, sessionState.isRunning);

	return sessionState.state;
}

export async function pauseSession(): Promise<PracticeState | null> {
	sessionState.isRunning = false;
	sessionState.isPaused = true;
	sessionState.pausedAtMs = Date.now();
	stopTicker();

	// Persist the current session
	if (sessionState.state) {
		sessionState.state = await db.saveState(sessionState.state);
	}

	await refreshToolbarAction(sessionState.state, sessionState.isRunning);

	return sessionState.state;
}

export async function resumeSession(): Promise<PracticeState | null> {
	if (sessionState.state?.session.done) {
		sessionState.isRunning = false;
		sessionState.isPaused = false;
		stopTicker();
		await refreshToolbarAction(sessionState.state, sessionState.isRunning);
		return sessionState.state;
	}
	sessionState.isRunning = true;
	sessionState.isPaused = false;
	ensureTickerRunning();
	await refreshToolbarAction(sessionState.state, sessionState.isRunning);

	return sessionState.state;
}

export async function decrementTimer(
	seconds: number,
): Promise<PracticeState | null> {
	if (!sessionState.state || !sessionState.isRunning) {
		return sessionState.state || null;
	}
	if (sessionState.state.session.done) {
		sessionState.isRunning = false;
		sessionState.isPaused = false;
		stopTicker();
		await refreshToolbarAction(sessionState.state, sessionState.isRunning);
		return sessionState.state;
	}

	const currentTask = sessionState.state.session.tasks.find(
		(t) => t.id === sessionState.state?.session.currentTaskId,
	);

	if (!currentTask) {
		sessionState.isRunning = false;
		sessionState.isPaused = false;
		stopTicker();
		await refreshToolbarAction(sessionState.state, sessionState.isRunning);
		return sessionState.state;
	}

	// Decrement the current task's remaining time
	currentTask.remainingSeconds = Math.max(
		0,
		currentTask.remainingSeconds - seconds,
	);

	// If task is complete, mark it and move to next
	if (currentTask.remainingSeconds === 0 && currentTask.completedAt === null) {
		currentTask.completedAt = formatLosAngelesTimestamp();
		const currentTaskIndex = sessionState.state.session.tasks.findIndex(
			(task) => task.id === currentTask.id,
		);

		// Find next incomplete task
		const nextTask =
			sessionState.state.session.tasks
				.slice(currentTaskIndex + 1)
				.find((task) => task.completedAt === null) ??
			sessionState.state.session.tasks.find((task) => task.completedAt === null) ??
			null;

		if (nextTask) {
			sessionState.state.session.currentTaskId = nextTask.id;
		} else {
			// All tasks complete
			sessionState.state.session.done = true;
			sessionState.state.session.currentTaskId =
				sessionState.state.session.tasks[sessionState.state.session.tasks.length - 1]?.id ??
				null;
			sessionState.isRunning = false;
			sessionState.isPaused = false;
			stopTicker();
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
	stopTicker();
	await refreshToolbarAction(sessionState.state, sessionState.isRunning);

	return sessionState.state;
}

export async function resetToDefaults(): Promise<PracticeState> {
	sessionState.state = await db.resetToDefaults();
	sessionState.isRunning = false;
	sessionState.isPaused = false;
	stopTicker();
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
	if (sessionState.state.session.done) {
		sessionState.isRunning = false;
		sessionState.isPaused = false;
		stopTicker();
	}
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
	sessionState.isRunning =
		!state.session.done && !forceStopped && Boolean(isRunning);
	sessionState.isPaused = !sessionState.isRunning;
	if (sessionState.isRunning) {
		ensureTickerRunning();
	} else {
		stopTicker();
	}
	await refreshToolbarAction(sessionState.state, sessionState.isRunning);
	return { ok: true };
}

export function handleBackgroundTickAlarm(alarm: chrome.alarms.Alarm): void {
	if (alarm.name !== BACKGROUND_TICK_ALARM || !sessionState.isRunning) return;
	const elapsedSeconds = elapsedSecondsSinceLastTick();
	if (elapsedSeconds <= 1) return;
	void runBackgroundTick(elapsedSeconds);
}

export function getRunningState(): { isRunning: boolean; isPaused: boolean } {
	return {
		isRunning: sessionState.isRunning,
		isPaused: sessionState.isPaused,
	};
}
