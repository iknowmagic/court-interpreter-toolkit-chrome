import { formatLosAngelesTimestamp, type PracticeSession } from "../shared/practice";

export interface CompletionResult {
	session: PracticeSession;
	/** Id of the task that was newly completed by this call, or null if nothing changed. */
	completedTaskId: string | null;
}

/**
 * Completes the current task (if not already complete) and selects the next
 * incomplete task, without starting it. Shared by timer expiry and the Done
 * command so the two paths cannot drift apart.
 */
export function completeCurrentTaskAndAdvance(
	session: PracticeSession,
): CompletionResult {
	if (session.done || session.tasks.length === 0) {
		return { session, completedTaskId: null };
	}

	const currentTask =
		session.tasks.find((task) => task.id === session.currentTaskId) ??
		session.tasks[0] ??
		null;

	if (!currentTask) {
		return {
			session: { ...session, done: true, currentTaskId: null },
			completedTaskId: null,
		};
	}

	const wasAlreadyComplete = currentTask.completedAt !== null;
	const tasks = session.tasks.map((task) =>
		task.id === currentTask.id && !wasAlreadyComplete
			? { ...task, completedAt: formatLosAngelesTimestamp(), remainingSeconds: 0 }
			: task,
	);

	const currentTaskIndex = tasks.findIndex((task) => task.id === currentTask.id);
	const nextTask =
		tasks.slice(currentTaskIndex + 1).find((task) => task.completedAt === null) ??
		tasks.find((task) => task.completedAt === null) ??
		null;

	const done = !nextTask;
	const currentTaskId = nextTask
		? nextTask.id
		: (tasks[tasks.length - 1]?.id ?? currentTask.id ?? null);

	return {
		session: { ...session, tasks, done, currentTaskId },
		completedTaskId: wasAlreadyComplete ? null : currentTask.id,
	};
}
