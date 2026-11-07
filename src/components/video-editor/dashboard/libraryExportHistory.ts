import { fromFileUrl } from "../projectMediaPaths";

const KEY = "recordly.library-export-history.v1";
export type LibraryExportIdentity = {
	projectId?: string;
	projectPath?: string;
	sourcePath?: string;
};
type History = Record<string, number>;
const pathKey = (value: string) => fromFileUrl(value).replace(/\\/g, "/");
const identityKeys = (identity: LibraryExportIdentity) =>
	[
		identity.projectId ? `project:${identity.projectId}` : null,
		identity.projectPath ? `path:${pathKey(identity.projectPath)}` : null,
		identity.sourcePath ? `source:${pathKey(identity.sourcePath)}` : null,
		!identity.projectId && !identity.projectPath && identity.sourcePath
			? `unassigned:${pathKey(identity.sourcePath)}`
			: null,
	].filter((key): key is string => Boolean(key));

export function readLibraryExportHistory(): { available: boolean; records: History } {
	try {
		const api = typeof window !== "undefined" ? window.electronAPI : undefined;
		let raw: unknown;
		if (typeof api?.getAppSettingWithStatus === "function") {
			const result = api.getAppSettingWithStatus(KEY);
			if (result?.success !== true) return { available: false, records: {} };
			raw = result.value;
		} else if (typeof api?.getAppSetting === "function") {
			// The legacy getter maps failed native reads to null, so null is not evidence
			// of an empty history. Never use that ambiguity for cleanup suggestions.
			return { available: false, records: {} };
		} else {
			raw = JSON.parse(localStorage.getItem(KEY) || "null");
		}
		if (raw === null || raw === undefined) return { available: true, records: {} };
		if (
			typeof raw !== "object" ||
			Array.isArray(raw) ||
			Object.values(raw).some(
				(time) => typeof time !== "number" || !Number.isFinite(time) || time <= 0,
			)
		)
			return { available: false, records: {} };
		return { available: true, records: raw as History };
	} catch {
		return { available: false, records: {} };
	}
}

/** Positive evidence only: call after the exported file has actually been saved. */
export function recordLibraryExport(identity: LibraryExportIdentity): boolean {
	const keys = identityKeys(identity);
	if (!keys.length) return false;
	const history = readLibraryExportHistory();
	if (!history.available) return false;
	const records = { ...history.records };
	for (const key of keys) records[key] = Date.now();
	try {
		if (
			typeof window !== "undefined" &&
			typeof window.electronAPI?.setAppSetting === "function"
		)
			return window.electronAPI.setAppSetting(KEY, records);
		localStorage.setItem(KEY, JSON.stringify(records));
		return true;
	} catch {
		return false;
	}
}

export function hasLibraryExport(
	records: History,
	identity: LibraryExportIdentity,
	raw = false,
): boolean {
	const source = identity.sourcePath ? pathKey(identity.sourcePath) : null;
	return Boolean(
		(identity.projectId && records[`project:${identity.projectId}`]) ||
			(identity.projectPath && records[`path:${pathKey(identity.projectPath)}`]) ||
			(source && records[`unassigned:${source}`]) ||
			(raw && source && records[`source:${source}`]),
	);
}
