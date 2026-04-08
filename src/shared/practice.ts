export const TIME_ZONE = "America/Los_Angeles";

export interface PracticeTemplateTask {
	id: string;
	name: string;
	duration: number;
}

export interface PracticeSessionTask extends PracticeTemplateTask {
	note: string;
	completedAt: string | null;
	remainingSeconds: number;
}

export interface PracticeSession {
	date: string;
	currentTaskId: string | null;
	done: boolean;
	tasks: PracticeSessionTask[];
}

export interface PracticeState {
	template: PracticeTemplateTask[];
	session: PracticeSession;
}

export interface PracticeBridge {
	loadState(): Promise<PracticeState>;
	loadStateByDate(date: string): Promise<PracticeState>;
	listSessionDates(): Promise<string[]>;
	saveState(state: PracticeState): Promise<PracticeState>;
	newDay(template: PracticeTemplateTask[]): Promise<PracticeState>;
	resetToDefaults(): Promise<PracticeState>;
}

export const DEFAULT_TEMPLATE: PracticeTemplateTask[] = [
	{ id: "shadowing", name: "Shadowing", duration: 5 },
	{ id: "vocab-1", name: "Vocabulary Drills", duration: 5 },
	{ id: "sight-translation", name: "Sight Translation", duration: 10 },
	{ id: "vocab-2", name: "Vocabulary Drills", duration: 5 },
	{ id: "consecutive", name: "Consecutive", duration: 10 },
	{ id: "vocab-3", name: "Vocabulary Drills", duration: 5 },
	{ id: "simultaneous", name: "Simultaneous", duration: 10 },
	{ id: "vocab-4", name: "Vocabulary Drills", duration: 5 },
];

export function getLosAngelesDateString(date = new Date()): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: TIME_ZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
}

export function formatLosAngelesDateLabel(date = new Date()): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone: TIME_ZONE,
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	}).format(date);
}

export function formatLosAngelesClock(date = new Date()): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone: TIME_ZONE,
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
}

export function formatLosAngelesTimestamp(date = new Date()): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone: TIME_ZONE,
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).format(date);
}

export function formatDuration(seconds: number): string {
	const safeSeconds = Math.max(0, seconds);
	const minutes = Math.floor(safeSeconds / 60);
	const remainingSeconds = safeSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function createTaskId(prefix = "task"): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function createFreshSession(
	template: PracticeTemplateTask[],
	date = getLosAngelesDateString(),
): PracticeSession {
	const tasks = template.map((task) => ({
		...task,
		note: "",
		completedAt: null,
		remainingSeconds: task.duration * 60,
	}));

	return {
		date,
		currentTaskId: tasks[0]?.id ?? null,
		done: tasks.length === 0,
		tasks,
	};
}

export function reconcileSessionWithTemplate(
	template: PracticeTemplateTask[],
	session: PracticeSession,
): PracticeSession {
	const tasksById = new Map(session.tasks.map((task) => [task.id, task]));
	const nextTasks = template.map((templateTask) => {
		const existing = tasksById.get(templateTask.id);

		if (!existing) {
			return {
				...templateTask,
				note: "",
				completedAt: null,
				remainingSeconds: templateTask.duration * 60,
			};
		}

		return {
			...templateTask,
			note: existing.note ?? "",
			completedAt: existing.completedAt ?? null,
			remainingSeconds: existing.completedAt
				? 0
				: Math.max(0, existing.remainingSeconds),
		};
	});

	const activeTaskId =
		session.currentTaskId &&
		nextTasks.some((task) => task.id === session.currentTaskId)
			? session.currentTaskId
			: (nextTasks[
					Math.min(
						Math.max(
							0,
							session.tasks.findIndex(
								(task) => task.id === session.currentTaskId,
							),
						),
						Math.max(0, nextTasks.length - 1),
					)
				]?.id ??
				nextTasks[0]?.id ??
				null);

	const done =
		nextTasks.length === 0 ||
		nextTasks.every((task) => task.completedAt !== null) ||
		session.done;

	return {
		date: session.date,
		currentTaskId: activeTaskId,
		done,
		tasks: nextTasks,
	};
}
