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
const CONTEXT_MENU_CURRENT = "practice-current-task";
const CONTEXT_MENU_PLAY = "practice-play";
const CONTEXT_MENU_STOP = "practice-stop";
const CONTEXT_MENU_DONE = "practice-done";
let tickIntervalId: number | null = null;
let tickInFlight = false;
let lastTickAtMs = Date.now();
let contextMenuInitialized = false;

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

function createMenuItem(
	createProperties: chrome.contextMenus.CreateProperties,
): Promise<void> {
	return new Promise((resolve) => {
		chrome.contextMenus.create(createProperties, () => {
			if (chrome.runtime.lastError) {
				console.error(
					`Failed to create context menu "${createProperties.id}":`,
					chrome.runtime.lastError.message,
				);
			}
			resolve();
		});
	});
}

function updateMenuItem(
	id: string,
	updateProperties: chrome.contextMenus.UpdateProperties,
): Promise<void> {
	return new Promise((resolve, reject) => {
		chrome.contextMenus.update(id, updateProperties, () => {
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message));
				return;
			}
			resolve();
		});
	});
}

function removeAllMenuItems(): Promise<void> {
	return new Promise((resolve) => {
		chrome.contextMenus.removeAll(() => {
			resolve();
		});
	});
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

function getCurrentTaskSnapshot(state: PracticeState | null): {
	task: (PracticeState["session"]["tasks"][number] & {
		remainingSeconds: number;
		completedAt: string | null;
		duration: number;
		name: string;
	}) | null;
	displaySeconds: number;
} {
	const task =
		state?.session.tasks.find((item) => item.id === state.session.currentTaskId) ??
		state?.session.tasks[0] ??
		null;
	if (!task) {
		return { task: null, displaySeconds: 0 };
	}

	const displaySeconds =
		task.completedAt || task.remainingSeconds === 0
			? task.duration * 60
			: task.remainingSeconds;
	return { task, displaySeconds };
}

async function ensureContextMenuInitialized(): Promise<void> {
	if (contextMenuInitialized || !chrome.contextMenus) return;

	await removeAllMenuItems();
	await createMenuItem({
		id: CONTEXT_MENU_CURRENT,
		title: "Current Task: —",
		contexts: ["action"],
		enabled: false,
	});
	await createMenuItem({
		id: CONTEXT_MENU_PLAY,
		title: "Play",
		contexts: ["action"],
	});
	await createMenuItem({
		id: CONTEXT_MENU_STOP,
		title: "Stop",
		contexts: ["action"],
	});
	await createMenuItem({
		id: CONTEXT_MENU_DONE,
		title: "Done",
		contexts: ["action"],
	});
	contextMenuInitialized = true;
}

async function refreshActionContextMenu(
	state: PracticeState | null,
	isRunning: boolean,
	retry = true,
): Promise<void> {
	if (!chrome.contextMenus) return;
	try {
		await ensureContextMenuInitialized();
		const { task, displaySeconds } = getCurrentTaskSnapshot(state);
		const currentTaskTitle = task
			? `Current Task: ${task.name} - ${formatToolbarDuration(displaySeconds)}`
			: "Current Task: —";
		const isDone = Boolean(state?.session.done);
		const canPlay = !isDone && !!task && !isRunning;
		const canStop = !!task && isRunning;
		const canDone = !isDone && !!task;

		await updateMenuItem(CONTEXT_MENU_CURRENT, {
			title: currentTaskTitle,
			enabled: false,
		});
		await updateMenuItem(CONTEXT_MENU_PLAY, {
			enabled: canPlay,
		});
		await updateMenuItem(CONTEXT_MENU_STOP, {
			enabled: canStop,
		});
		await updateMenuItem(CONTEXT_MENU_DONE, {
			enabled: canDone,
		});
	} catch (error) {
		if (!retry) {
			console.error("Failed to refresh action context menu", error);
			return;
		}
		contextMenuInitialized = false;
		await refreshActionContextMenu(state, isRunning, false);
	}
}

async function refreshToolbarAction(
	state: PracticeState | null,
	isRunning: boolean,
): Promise<void> {
	if (!chrome.action) return;

	if (!state) {
		await chrome.action.setTitle({ title: "Court Interpreter Toolkit" });
		await chrome.action.setBadgeText({ text: "" });
		await refreshActionContextMenu(state, isRunning);
		return;
	}

	const { task: currentTask, displaySeconds } = getCurrentTaskSnapshot(state);

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
		await refreshActionContextMenu(state, isRunning);
		return;
	}

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
	await refreshActionContextMenu(state, isRunning);
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
	if (!sessionState.state) {
		return null;
	}

	const currentTask =
		sessionState.state.session.tasks.find(
			(task) => task.id === sessionState.state?.session.currentTaskId,
		) ??
		sessionState.state.session.tasks[0] ??
		null;

	if (!currentTask) {
		sessionState.isRunning = false;
		sessionState.isPaused = false;
		stopTicker();
		await refreshToolbarAction(sessionState.state, sessionState.isRunning);
		return sessionState.state;
	}

	// Allow replaying completed tasks by resetting the selected task on start.
	if (currentTask.completedAt !== null || currentTask.remainingSeconds <= 0) {
		currentTask.completedAt = null;
		currentTask.remainingSeconds = currentTask.duration * 60;
	}
	sessionState.state.session.currentTaskId = currentTask.id;
	sessionState.state.session.done = false;
	sessionState.state = await db.saveState(sessionState.state);

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
			// Completing a task should not auto-run the next one.
			sessionState.isRunning = false;
			sessionState.isPaused = true;
			stopTicker();
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

export async function completeCurrentTaskAndAdvanceNoStart(): Promise<PracticeState | null> {
	if (!sessionState.state) {
		sessionState.state = await db.loadState();
	}
	if (!sessionState.state) return null;

	sessionState.isRunning = false;
	sessionState.isPaused = true;
	stopTicker();

	const session = sessionState.state.session;
	if (session.done || session.tasks.length === 0) {
		sessionState.state = await db.saveState(sessionState.state);
		await refreshToolbarAction(sessionState.state, sessionState.isRunning);
		return sessionState.state;
	}

	const currentTask =
		session.tasks.find((task) => task.id === session.currentTaskId) ??
		session.tasks[0] ??
		null;
	if (!currentTask) {
		session.done = true;
		session.currentTaskId = null;
		sessionState.state = await db.saveState(sessionState.state);
		await refreshToolbarAction(sessionState.state, sessionState.isRunning);
		return sessionState.state;
	}

	const currentTaskIndex = session.tasks.findIndex((task) => task.id === currentTask.id);
	if (currentTask.completedAt === null) {
		currentTask.completedAt = formatLosAngelesTimestamp();
		currentTask.remainingSeconds = 0;
	}

	const nextTask =
		session.tasks
			.slice(Math.max(0, currentTaskIndex + 1))
			.find((task) => task.completedAt === null) ??
		session.tasks.find((task) => task.completedAt === null) ??
		null;

	if (nextTask) {
		session.currentTaskId = nextTask.id;
		session.done = false;
	} else {
		session.done = true;
		session.currentTaskId =
			session.tasks[session.tasks.length - 1]?.id ?? currentTask.id ?? null;
	}

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

export async function initializeActionContextMenu(): Promise<void> {
	await refreshActionContextMenu(sessionState.state, sessionState.isRunning);
}

export async function handleActionContextMenuClick(menuItemId: string): Promise<void> {
	switch (menuItemId) {
		case CONTEXT_MENU_PLAY:
			await startSession();
			break;
		case CONTEXT_MENU_STOP:
			await pauseSession();
			break;
		case CONTEXT_MENU_DONE:
			await completeCurrentTaskAndAdvanceNoStart();
			break;
		default:
			break;
	}
}

export function getRunningState(): { isRunning: boolean; isPaused: boolean } {
	return {
		isRunning: sessionState.isRunning,
		isPaused: sessionState.isPaused,
	};
}
