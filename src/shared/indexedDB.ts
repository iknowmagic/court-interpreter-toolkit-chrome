import type {
	PracticeState,
	PracticeTemplateTask,
	PracticeSession,
} from "./practice";
import {
	DEFAULT_TEMPLATE,
	createFreshSession,
	getLosAngelesDateString,
	reconcileSessionWithTemplate,
} from "./practice";

const DB_NAME = "court-interpreter";
const DB_VERSION = 1;
const TEMPLATE_STORE = "templates";
const SESSIONS_STORE = "sessions";

let db: IDBDatabase | null = null;

export async function initDB(): Promise<IDBDatabase> {
	if (db) {
		return db;
	}

	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			db = request.result;
			resolve(db);
		};

		request.onupgradeneeded = (event) => {
			const database = (event.target as IDBOpenDBRequest).result;

			// Create stores if they don't exist
			if (!database.objectStoreNames.contains(TEMPLATE_STORE)) {
				database.createObjectStore(TEMPLATE_STORE, { keyPath: "key" });
			}

			if (!database.objectStoreNames.contains(SESSIONS_STORE)) {
				database.createObjectStore(SESSIONS_STORE, { keyPath: "date" });
			}
		};
	});
}

async function _getDB(): Promise<IDBDatabase> {
	if (!db) {
		return initDB();
	}
	return db;
}

async function saveTemplate(template: PracticeTemplateTask[]): Promise<void> {
	const database = await _getDB();
	const tx = database.transaction(TEMPLATE_STORE, "readwrite");
	const store = tx.objectStore(TEMPLATE_STORE);

	// Store the full template array under a single key
	const payload = {
		key: "current",
		tasks: template,
		updatedAt: new Date().toISOString(),
	};

	return new Promise((resolve, reject) => {
		const request = store.put(payload);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve();
	});
}

async function loadTemplate(): Promise<PracticeTemplateTask[]> {
	const database = await _getDB();
	const tx = database.transaction(TEMPLATE_STORE, "readonly");
	const store = tx.objectStore(TEMPLATE_STORE);

	return new Promise((resolve, reject) => {
		const request = store.get("current");
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const result = request.result;
			if (result && result.tasks && result.tasks.length > 0) {
				resolve(result.tasks);
			} else {
				// Initialize with defaults if not found
				saveTemplate(DEFAULT_TEMPLATE).then(() =>
					resolve([...DEFAULT_TEMPLATE]),
				);
			}
		};
	});
}

async function saveSession(session: PracticeSession): Promise<void> {
	const database = await _getDB();
	const tx = database.transaction(SESSIONS_STORE, "readwrite");
	const store = tx.objectStore(SESSIONS_STORE);

	const payload = {
		...session,
		updatedAt: new Date().toISOString(),
	};

	return new Promise((resolve, reject) => {
		const request = store.put(payload);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve();
	});
}

async function loadSession(date: string): Promise<PracticeSession | null> {
	const database = await _getDB();
	const tx = database.transaction(SESSIONS_STORE, "readonly");
	const store = tx.objectStore(SESSIONS_STORE);

	return new Promise((resolve, reject) => {
		const request = store.get(date);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const result = request.result;
			resolve(result || null);
		};
	});
}

async function listSessionDates(): Promise<string[]> {
	const database = await _getDB();
	const tx = database.transaction(SESSIONS_STORE, "readonly");
	const store = tx.objectStore(SESSIONS_STORE);

	return new Promise((resolve, reject) => {
		const request = store.getAllKeys();
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const keys = request.result as string[];
			resolve(keys.sort());
		};
	});
}

export async function loadState(): Promise<PracticeState> {
	const database = await _getDB();
	const template = await loadTemplate();
	const today = getLosAngelesDateString();
	const storedSession = await loadSession(today);

	if (!storedSession) {
		const session = createFreshSession(template, today);
		await saveSession(session);
		return { template, session };
	}

	const reconciledSession = reconcileSessionWithTemplate(
		template,
		storedSession,
	);
	if (JSON.stringify(reconciledSession) !== JSON.stringify(storedSession)) {
		await saveSession(reconciledSession);
	}

	return {
		template,
		session: reconciledSession,
	};
}

export async function loadStateByDate(date: string): Promise<PracticeState> {
	const template = await loadTemplate();
	const storedSession = await loadSession(date);

	if (!storedSession) {
		return {
			template,
			session: createFreshSession(template, date),
		};
	}

	const reconciledSession = reconcileSessionWithTemplate(
		template,
		storedSession,
	);
	if (JSON.stringify(reconciledSession) !== JSON.stringify(storedSession)) {
		await saveSession(reconciledSession);
	}

	return {
		template,
		session: reconciledSession,
	};
}

export async function saveState(state: PracticeState): Promise<PracticeState> {
	const template =
		state.template.length > 0 ? state.template : await loadTemplate();
	const session = reconcileSessionWithTemplate(template, state.session);

	await saveTemplate(template);
	await saveSession(session);

	return { template, session };
}

export async function newDay(
	template: PracticeTemplateTask[],
): Promise<PracticeState> {
	const normalizedTemplate =
		template.length > 0 ? template : await loadTemplate();
	const session = createFreshSession(
		normalizedTemplate,
		getLosAngelesDateString(),
	);

	await saveTemplate(normalizedTemplate);
	await saveSession(session);

	return { template: normalizedTemplate, session };
}

export async function resetToDefaults(): Promise<PracticeState> {
	const session = createFreshSession(
		DEFAULT_TEMPLATE,
		getLosAngelesDateString(),
	);

	await saveTemplate(DEFAULT_TEMPLATE);
	await saveSession(session);

	return { template: [...DEFAULT_TEMPLATE], session };
}
