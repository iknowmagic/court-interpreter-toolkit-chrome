export interface PersistedTimerRuntime {
	version: 1;
	isRunning: boolean;
	isPaused: boolean;
	sessionDate: string | null;
	taskId: string | null;
	endsAtMs: number | null;
}

export const TIMER_RUNTIME_STORAGE_KEY = "session-manager-runtime-v1";

export function isValidPersistedTimerRuntime(
	raw: unknown,
): raw is PersistedTimerRuntime {
	if (!raw || typeof raw !== "object") return false;
	const value = raw as Record<string, unknown>;

	if (value.version !== 1) return false;
	if (typeof value.isRunning !== "boolean") return false;
	if (typeof value.isPaused !== "boolean") return false;
	if (value.sessionDate !== null && typeof value.sessionDate !== "string")
		return false;
	if (value.taskId !== null && typeof value.taskId !== "string") return false;
	if (value.endsAtMs !== null && typeof value.endsAtMs !== "number")
		return false;
	if (
		value.isRunning &&
		(value.endsAtMs === null || !Number.isFinite(value.endsAtMs as number))
	) {
		return false;
	}

	return true;
}

export async function loadTimerRuntime(): Promise<PersistedTimerRuntime | null> {
	if (!chrome.storage?.local) return null;

	try {
		const stored = await chrome.storage.local.get(TIMER_RUNTIME_STORAGE_KEY);
		const raw = stored[TIMER_RUNTIME_STORAGE_KEY];
		if (!isValidPersistedTimerRuntime(raw)) return null;
		return raw;
	} catch (error) {
		console.error("Failed to load persisted timer runtime", error);
		return null;
	}
}

export async function saveTimerRuntime(
	runtime: PersistedTimerRuntime,
): Promise<void> {
	if (!chrome.storage?.local) return;

	try {
		await chrome.storage.local.set({ [TIMER_RUNTIME_STORAGE_KEY]: runtime });
	} catch (error) {
		console.error("Failed to persist timer runtime", error);
	}
}

export function runningRuntime(
	sessionDate: string,
	taskId: string,
	endsAtMs: number,
): PersistedTimerRuntime {
	return {
		version: 1,
		isRunning: true,
		isPaused: false,
		sessionDate,
		taskId,
		endsAtMs,
	};
}

export function stoppedRuntime(
	sessionDate: string | null,
	taskId: string | null,
	isPaused: boolean,
): PersistedTimerRuntime {
	return {
		version: 1,
		isRunning: false,
		isPaused,
		sessionDate,
		taskId,
		endsAtMs: null,
	};
}

export function remainingSecondsFromDeadline(
	endsAtMs: number,
	nowMs: number,
): number {
	return Math.max(0, Math.ceil((endsAtMs - nowMs) / 1000));
}
