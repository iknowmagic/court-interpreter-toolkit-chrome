import type { PracticeSessionTask } from "@shared/practice";

export function findTask(
	tasks: PracticeSessionTask[],
	taskId: string | null,
): PracticeSessionTask | null {
	return taskId
		? (tasks.find((task) => task.id === taskId) ?? null)
		: (tasks[0] ?? null);
}

export function taskIndex(
	tasks: PracticeSessionTask[],
	taskId: string | null,
): number {
	return taskId ? tasks.findIndex((task) => task.id === taskId) : -1;
}

export function toDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function parseDateKey(dateKey: string): Date {
	const [year, month, day] = dateKey.split("-").map(Number);
	return new Date(year, month - 1, day);
}

export function monthLabel(date: Date): string {
	return new Intl.DateTimeFormat("en-US", { month: "short" }).format(date);
}

export interface CalendarCell {
	date: Date;
	dateKey: string;
	inMonth: boolean;
}

export function buildCalendarCells(monthDate: Date): CalendarCell[] {
	const firstOfMonth = new Date(
		monthDate.getFullYear(),
		monthDate.getMonth(),
		1,
	);
	const firstVisible = new Date(firstOfMonth);
	firstVisible.setDate(firstVisible.getDate() - firstVisible.getDay());

	const cells: CalendarCell[] = [];
	for (let index = 0; index < 42; index += 1) {
		const cellDate = new Date(firstVisible);
		cellDate.setDate(firstVisible.getDate() + index);
		cells.push({
			date: cellDate,
			dateKey: toDateKey(cellDate),
			inMonth: cellDate.getMonth() === monthDate.getMonth(),
		});
	}

	return cells;
}

export function describeError(error: unknown, fallback: string): string {
	console.error(fallback, error);
	if (error instanceof Error && error.message) return error.message;
	return fallback;
}
