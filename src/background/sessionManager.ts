import {
	getLosAngelesDateString,
	type PracticeState,
	type PracticeSession,
	type PracticeSessionSummary,
	type PracticeTemplateTask,
} from "../shared/practice";
import * as db from "../shared/indexedDB";
import * as timerRuntime from "./timerRuntime";
import { completeCurrentTaskAndAdvance } from "./sessionTransitions";

export interface SessionManagerState {
	state: PracticeState | null;
	isRunning: boolean;
	isPaused: boolean;
}

const sessionState: SessionManagerState = {
	state: null,
	isRunning: false,
	isPaused: false,
};

const BACKGROUND_TICK_INTERVAL_MS = 1000;
const BACKGROUND_TICK_ALARM = "practice-session-tick";
const CONTEXT_MENU_CURRENT = "practice-current-task";
export const CONTEXT_MENU_PLAY = "practice-play";
export const CONTEXT_MENU_STOP = "practice-stop";
export const CONTEXT_MENU_DONE = "practice-done";
const SETTINGS_STORAGE_KEY = "session-manager-settings";
const OFFSCREEN_ALARM_DOCUMENT = "alarm-player.html";
const OFFSCREEN_ALARM_MESSAGE_TYPE = "PLAY_COMPLETION_ALARM";

let tickIntervalId: ReturnType<typeof setInterval> | null = null;
let contextMenuInitialized = false;
let settingsLoaded = false;
let initPromise: Promise<void> | null = null;

interface SessionManagerSettings {
	completionAlarmEnabled: boolean;
}

const DEFAULT_SETTINGS: SessionManagerSettings = {
	completionAlarmEnabled: false,
};

let sessionSettings: SessionManagerSettings = { ...DEFAULT_SETTINGS };

type OffscreenApi = {
	createDocument: (params: {
		url: string;
		reasons: string[];
		justification: string;
	}) => Promise<void>;
};

function ensureTickerRunning(): void {
	if (tickIntervalId !== null) return;
	tickIntervalId = globalThis.setInterval(() => {
		void materializeRunningTimer(Date.now()).catch((error) => {
			console.error("Failed to materialize running timer", error);
		});
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

async function updateMenuItem(
	id: string,
	updateProperties: Omit<chrome.contextMenus.CreateProperties, "id">,
): Promise<void> {
	await chrome.contextMenus.update(id, updateProperties);
}

async function removeAllMenuItems(): Promise<void> {
	await chrome.contextMenus.removeAll();
}

function parseStoredSettings(raw: unknown): SessionManagerSettings {
	const stored = (raw ?? {}) as Partial<SessionManagerSettings>;
	return {
		completionAlarmEnabled: Boolean(stored.completionAlarmEnabled),
	};
}

async function ensureSettingsLoaded(): Promise<void> {
	if (settingsLoaded) return;
	if (!chrome.storage?.local) {
		settingsLoaded = true;
		return;
	}

	try {
		const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
		sessionSettings = parseStoredSettings(stored[SETTINGS_STORAGE_KEY]);
	} catch (error) {
		console.error("Failed to load session manager settings", error);
		sessionSettings = { ...DEFAULT_SETTINGS };
	}
	settingsLoaded = true;
}

async function persistSettings(): Promise<void> {
	if (!chrome.storage?.local) return;
	try {
		await chrome.storage.local.set({
			[SETTINGS_STORAGE_KEY]: sessionSettings,
		});
	} catch (error) {
		console.error("Failed to persist session manager settings", error);
	}
}

async function setCompletionAlarmEnabled(enabled: boolean): Promise<void> {
	await ensureSettingsLoaded();
	sessionSettings = {
		...sessionSettings,
		completionAlarmEnabled: enabled,
	};
	await persistSettings();
}

async function ensureAlarmOffscreenDocument(): Promise<boolean> {
	const offscreen = (chrome as unknown as { offscreen?: OffscreenApi }).offscreen;
	if (!offscreen?.createDocument) return false;

	try {
		await offscreen.createDocument({
			url: OFFSCREEN_ALARM_DOCUMENT,
			reasons: ["AUDIO_PLAYBACK"],
			justification: "Play a smooth completion alarm when a task completes.",
		});
		return true;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (
			message.includes("Only a single offscreen document") ||
			message.includes("already exists")
		) {
			return true;
		}
		console.error("Failed to initialize offscreen audio document", error);
		return false;
	}
}

async function maybePlayCompletionAlarm(): Promise<void> {
	await ensureSettingsLoaded();
	if (!sessionSettings.completionAlarmEnabled) return;

	const offscreenReady = await ensureAlarmOffscreenDocument();
	if (!offscreenReady) return;

	try {
		await chrome.runtime.sendMessage({
			type: OFFSCREEN_ALARM_MESSAGE_TYPE,
			target: "offscreen",
		});
	} catch (error) {
		console.error("Failed to trigger completion alarm", error);
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
	if (minutes >= 10) return `${minutes}m`;
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
	await ensureSettingsLoaded();

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

/**
 * Stops the runtime record without touching persisted session progress.
 * Used whenever a persisted deadline points at something that no longer
 * makes sense (deleted task, completed task, wrong day) so a corrupt or
 * stale runtime record can never overwrite real progress.
 */
async function stopRuntimeSafely(state: PracticeState | null): Promise<void> {
	stopTicker();
	sessionState.isRunning = false;
	sessionState.isPaused = false;
	await timerRuntime.saveTimerRuntime(
		timerRuntime.stoppedRuntime(
			state?.session.date ?? null,
			state?.session.currentTaskId ?? null,
			false,
		),
	);
	await refreshToolbarAction(state, false);
}

async function resolvePriorDayRollover(
	runtime: timerRuntime.PersistedTimerRuntime,
	nowMs: number,
): Promise<void> {
	const priorDate = runtime.sessionDate as string;
	const priorState = await db.loadStateByDate(priorDate);
	const currentTask = priorState.session.tasks.find(
		(task) => task.id === runtime.taskId,
	);

	if (
		currentTask &&
		currentTask.completedAt === null &&
		!priorState.session.done &&
		runtime.endsAtMs !== null
	) {
		const remaining = timerRuntime.remainingSecondsFromDeadline(
			runtime.endsAtMs,
			nowMs,
		);

		if (remaining > 0) {
			const updatedSession: PracticeSession = {
				...priorState.session,
				tasks: priorState.session.tasks.map((task) =>
					task.id === currentTask.id
						? { ...task, remainingSeconds: remaining }
						: task,
				),
			};
			await db.saveState({ ...priorState, session: updatedSession });
		} else {
			const { session, completedTaskId } = completeCurrentTaskAndAdvance(
				priorState.session,
			);
			await db.saveState({ ...priorState, session });
			if (completedTaskId) {
				await maybePlayCompletionAlarm();
			}
		}
	}

	stopTicker();
	sessionState.isRunning = false;
	sessionState.isPaused = false;
	await timerRuntime.saveTimerRuntime(timerRuntime.stoppedRuntime(null, null, false));

	sessionState.state = await db.loadState();
	await refreshToolbarAction(sessionState.state, false);
}

/**
 * Recomputes the active practice state from the persisted deadline. Safe to
 * call repeatedly (ticker, alarm, queries, restart) at the same or later
 * timestamp: recomputation is idempotent because remaining time is always
 * derived fresh from `endsAtMs`, never accumulated from an in-memory tick.
 */
async function materializeRunningTimerInternal(
	nowMs: number,
): Promise<PracticeState | null> {
	const runtime = await timerRuntime.loadTimerRuntime();

	if (!runtime || !runtime.isRunning) {
		sessionState.isRunning = false;
		sessionState.isPaused = runtime?.isPaused ?? sessionState.isPaused;
		stopTicker();
		if (!sessionState.state) {
			sessionState.state = await db.loadState();
		}
		return sessionState.state;
	}

	const currentLaDate = getLosAngelesDateString(new Date(nowMs));

	if (runtime.sessionDate && runtime.sessionDate !== currentLaDate) {
		await resolvePriorDayRollover(runtime, nowMs);
		return sessionState.state;
	}

	const targetDate = runtime.sessionDate ?? currentLaDate;
	let state =
		sessionState.state && sessionState.state.session.date === targetDate
			? sessionState.state
			: await db.loadState();

	const currentTask = state.session.tasks.find(
		(task) => task.id === runtime.taskId,
	);

	if (
		!currentTask ||
		currentTask.completedAt !== null ||
		state.session.done ||
		runtime.endsAtMs === null
	) {
		sessionState.state = state;
		await stopRuntimeSafely(state);
		return sessionState.state;
	}

	const remaining = timerRuntime.remainingSecondsFromDeadline(
		runtime.endsAtMs,
		nowMs,
	);

	if (remaining > 0) {
		const updatedSession: PracticeSession = {
			...state.session,
			tasks: state.session.tasks.map((task) =>
				task.id === currentTask.id
					? { ...task, remainingSeconds: remaining }
					: task,
			),
		};
		state = await db.saveState({ ...state, session: updatedSession });
		sessionState.state = state;
		sessionState.isRunning = true;
		sessionState.isPaused = false;
		ensureTickerRunning();
		await refreshToolbarAction(sessionState.state, true);
		return sessionState.state;
	}

	const { session: advancedSession, completedTaskId } =
		completeCurrentTaskAndAdvance(state.session);
	state = await db.saveState({ ...state, session: advancedSession });
	sessionState.state = state;
	sessionState.isRunning = false;
	sessionState.isPaused = !state.session.done;
	stopTicker();
	await timerRuntime.saveTimerRuntime(
		timerRuntime.stoppedRuntime(
			state.session.date,
			state.session.currentTaskId,
			sessionState.isPaused,
		),
	);
	await refreshToolbarAction(sessionState.state, false);
	if (completedTaskId) {
		await maybePlayCompletionAlarm();
	}
	return sessionState.state;
}

let materializationInFlight: Promise<PracticeState | null> | null = null;

/**
 * Single-flight wrapper: interval ticks, the Chrome alarm, initialization,
 * state reads, pause, and other runtime commands can all call this at
 * nearly the same moment. Only one `materializeRunningTimerInternal` may run
 * at a time; every caller that arrives while one is in flight gets that same
 * authoritative result instead of racing a second completion/save/alarm
 * transition. The slot is cleared in `finally` so a rejected materialization
 * can be retried by the next caller instead of being permanently stuck.
 */
export function materializeRunningTimer(
	nowMs = Date.now(),
): Promise<PracticeState | null> {
	if (!materializationInFlight) {
		materializationInFlight = materializeRunningTimerInternal(nowMs).finally(() => {
			materializationInFlight = null;
		});
	}
	return materializationInFlight;
}

async function performInitialization(): Promise<void> {
	await ensureSettingsLoaded();
	await db.initDB();
	sessionState.state = await db.loadState();
	await materializeRunningTimer(Date.now());
	await refreshToolbarAction(sessionState.state, sessionState.isRunning);
}

/**
 * Ensures background initialization has run exactly once, and lets every
 * caller (messages, alarms, context-menu clicks) await the same promise so
 * an early caller can never race an incomplete startup.
 */
export function ensureInitialized(): Promise<void> {
	if (!initPromise) {
		initPromise = performInitialization().catch((error) => {
			initPromise = null;
			throw error;
		});
	}
	return initPromise;
}

export async function getSessionState(): Promise<PracticeState | null> {
	await ensureInitialized();
	if (sessionState.isRunning) {
		await materializeRunningTimer(Date.now());
	}
	if (!sessionState.state) {
		sessionState.state = await db.loadState();
	}
	return sessionState.state;
}

/** Read-only: never mutates active background state, runtime, or toolbar. */
export async function readStateByDate(date: string): Promise<PracticeState> {
	await ensureInitialized();
	return db.loadStateByDate(date);
}

export async function listSessionSummaries(): Promise<PracticeSessionSummary[]> {
	await ensureInitialized();
	return db.listSessionSummaries();
}

export async function startSession(): Promise<PracticeState | null> {
	await ensureInitialized();
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
		await timerRuntime.saveTimerRuntime(
			timerRuntime.stoppedRuntime(sessionState.state.session.date, null, false),
		);
		await refreshToolbarAction(sessionState.state, false);
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

	const savedTask = sessionState.state.session.tasks.find(
		(task) => task.id === currentTask.id,
	);
	const remainingSeconds = Math.max(1, savedTask?.remainingSeconds ?? currentTask.duration * 60);
	const endsAtMs = Date.now() + remainingSeconds * 1000;

	sessionState.isRunning = true;
	sessionState.isPaused = false;
	await timerRuntime.saveTimerRuntime(
		timerRuntime.runningRuntime(sessionState.state.session.date, currentTask.id, endsAtMs),
	);
	ensureTickerRunning();
	await refreshToolbarAction(sessionState.state, true);

	return sessionState.state;
}

export async function pauseSession(): Promise<PracticeState | null> {
	await ensureInitialized();
	// Materialize elapsed time up to now first, in case a suspension occurred
	// since the deadline was set. The task may have completed while the
	// worker was asleep, in which case the session is stopped but not paused.
	await materializeRunningTimer(Date.now());

	stopTicker();
	sessionState.isRunning = false;
	sessionState.isPaused = !(sessionState.state?.session.done ?? false);

	if (sessionState.state) {
		sessionState.state = await db.saveState(sessionState.state);
	}

	await timerRuntime.saveTimerRuntime(
		timerRuntime.stoppedRuntime(
			sessionState.state?.session.date ?? null,
			sessionState.state?.session.currentTaskId ?? null,
			sessionState.isPaused,
		),
	);

	await refreshToolbarAction(sessionState.state, false);

	return sessionState.state;
}

export async function saveSession(
	state: PracticeState,
): Promise<PracticeState> {
	await ensureInitialized();
	sessionState.state = await db.saveState(state);
	await refreshToolbarAction(sessionState.state, sessionState.isRunning);
	return sessionState.state;
}

export async function newDay(
	template?: PracticeTemplateTask[],
): Promise<PracticeState> {
	await ensureInitialized();
	if (template) {
		sessionState.state = await db.newDay(template);
	} else {
		const currentTemplate = sessionState.state?.template || undefined;
		sessionState.state = await db.newDay(currentTemplate || []);
	}

	sessionState.isRunning = false;
	sessionState.isPaused = false;
	stopTicker();
	await timerRuntime.saveTimerRuntime(
		timerRuntime.stoppedRuntime(
			sessionState.state.session.date,
			sessionState.state.session.currentTaskId,
			false,
		),
	);
	await refreshToolbarAction(sessionState.state, sessionState.isRunning);

	return sessionState.state;
}

export async function resetToDefaults(): Promise<PracticeState> {
	await ensureInitialized();
	sessionState.state = await db.resetToDefaults();
	sessionState.isRunning = false;
	sessionState.isPaused = false;
	stopTicker();
	await timerRuntime.saveTimerRuntime(
		timerRuntime.stoppedRuntime(
			sessionState.state.session.date,
			sessionState.state.session.currentTaskId,
			false,
		),
	);
	await refreshToolbarAction(sessionState.state, sessionState.isRunning);

	return sessionState.state;
}

export async function editTemplate(
	template: PracticeTemplateTask[],
): Promise<PracticeState> {
	await ensureInitialized();
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
	await ensureInitialized();
	if (!sessionState.state) {
		sessionState.state = await db.loadState();
	}
	if (!sessionState.state) return null;

	stopTicker();
	sessionState.isRunning = false;

	const { session, completedTaskId } = completeCurrentTaskAndAdvance(
		sessionState.state.session,
	);
	sessionState.state = await db.saveState({ ...sessionState.state, session });
	sessionState.isPaused = !sessionState.state.session.done;

	await timerRuntime.saveTimerRuntime(
		timerRuntime.stoppedRuntime(
			sessionState.state.session.date,
			sessionState.state.session.currentTaskId,
			sessionState.isPaused,
		),
	);

	await refreshToolbarAction(sessionState.state, false);
	if (completedTaskId) {
		await maybePlayCompletionAlarm();
	}
	return sessionState.state;
}

export function handleBackgroundTickAlarm(alarm: chrome.alarms.Alarm): void {
	if (alarm.name !== BACKGROUND_TICK_ALARM) return;
	void materializeRunningTimer(Date.now()).catch((error) => {
		console.error("Failed to materialize running timer from alarm", error);
	});
}

export async function handleActionContextMenuClick(
	menuItemId: string,
	_checked?: boolean,
): Promise<void> {
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

export async function getRunningState(): Promise<{
	isRunning: boolean;
	isPaused: boolean;
}> {
	await ensureInitialized();
	if (sessionState.isRunning) {
		await materializeRunningTimer(Date.now());
	}
	return {
		isRunning: sessionState.isRunning,
		isPaused: sessionState.isPaused,
	};
}

export async function getCompletionAlarmSetting(): Promise<boolean> {
	await ensureSettingsLoaded();
	return sessionSettings.completionAlarmEnabled;
}

export async function setCompletionAlarmSetting(
	enabled: boolean,
): Promise<boolean> {
	await setCompletionAlarmEnabled(enabled);
	return sessionSettings.completionAlarmEnabled;
}
