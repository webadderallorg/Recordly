import { saveAppSetting } from "@/lib/appSettings";
import type { EditorProjectData } from "../projectPersistence";

const KEY = "recordly.project-share-links.v1";
// A confirmed remote deletion must stay hidden even if native settings cannot be updated.
const deletedShareUrls = new Set<string>();
type NativeSettingsApi = Pick<Window["electronAPI"], "getAppSetting" | "setAppSetting"> &
	Partial<Pick<Window["electronAPI"], "getAppSettingWithStatus">>;
function getNativeSettingsApi(): NativeSettingsApi | null {
	const api = (
		globalThis as typeof globalThis & {
			electronAPI?: NativeSettingsApi;
		}
	).electronAPI;
	return typeof api?.getAppSetting === "function" && typeof api?.setAppSetting === "function"
		? api
		: null;
}
export type ProjectShareLink = {
	url: string;
	sharedAt: number;
	revision?: string;
	accountId?: string;
};
function readBrowserLinks(): Record<string, unknown> {
	// A corrupt browser cache must not prevent recording a new successful share.
	// Keep storage access errors distinct from malformed serialized cache data.
	const raw = localStorage.getItem(KEY);
	let value: unknown;
	try {
		value = JSON.parse(raw || "{}");
	} catch {
		return {};
	}
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function readLinks(): Record<string, ProjectShareLink> {
	const api = getNativeSettingsApi();
	let missingNativeKey = false;
	let stored: unknown;
	if (api) {
		// Packaged windows receive a new loopback origin on each launch. Native
		// settings keep links and their owner/revision metadata across those origins.
		let result: ReturnType<Window["electronAPI"]["getAppSettingWithStatus"]>;
		try {
			if (typeof api.getAppSettingWithStatus !== "function") throw new Error();
			result = api.getAppSettingWithStatus(KEY);
		} catch {
			throw new Error("Could not read share links from desktop settings");
		}
		if (result?.success !== true || typeof result.found !== "boolean")
			throw new Error("Could not read share links from desktop settings");
		missingNativeKey = !result.found;
		// A present null value is an explicit empty native value, never permission
		// to resurrect an older browser-origin snapshot.
		stored = result.found
			? (result.value ?? {})
			: readBrowserLinks();
	} else {
		stored = readBrowserLinks();
	}
	if (!stored || typeof stored !== "object" || Array.isArray(stored))
		throw new Error("Saved share links could not be read");
	const links = Object.fromEntries(
		Object.entries(stored).flatMap(([path, value]) => {
			const raw = typeof value === "string" ? { url: value, sharedAt: 0 } : value;
			if (!raw || typeof raw !== "object") return [];
			const entry = raw as Record<string, unknown>;
			if (
				!entry ||
				typeof entry !== "object" ||
				typeof entry.url !== "string" ||
				!/^https?:\/\//.test(entry.url) ||
				deletedShareUrls.has(entry.url)
			)
				return [];
			return [
				[
					path,
					{
						url: entry.url,
						sharedAt: typeof entry.sharedAt === "number" ? entry.sharedAt : 0,
						...(typeof entry.revision === "string" ? { revision: entry.revision } : {}),
						...(typeof entry.accountId === "string"
							? { accountId: entry.accountId }
							: {}),
					},
				],
			];
		}),
	);
	// Migrate an existing browser-origin snapshot once. An empty native map is
	// authoritative too, so deleted links cannot reappear from an older origin.
	if (missingNativeKey && !saveAppSetting(KEY, links))
		throw new Error("Could not migrate share links to desktop settings");
	return links;
}
function writeLinks(links: Record<string, ProjectShareLink>) {
	const nativeSettingsAvailable = getNativeSettingsApi() !== null;
	const savedNatively = saveAppSetting(KEY, links);
	try {
		localStorage.setItem(KEY, JSON.stringify(links));
	} catch (error) {
		if (!savedNatively) throw error;
	}
	if (nativeSettingsAvailable && !savedNatively)
		throw new Error("Could not save share links to desktop settings");
}
export function getProjectShare(path: string, accountId?: string): ProjectShareLink | undefined {
	try {
		const entry = readLinks()[path];
		return entry?.accountId && entry.accountId !== accountId ? undefined : entry;
	} catch {
		return undefined;
	}
}
export function getProjectShareLink(path: string): string | undefined {
	try {
		return getProjectShareLinkStrict(path);
	} catch {
		return undefined;
	}
}
/** Destructive eligibility must distinguish an absent link from unreadable storage. */
export function getProjectShareLinkStrict(path: string): string | undefined {
	return readLinks()[path]?.url;
}
export function isProjectShareStale(
	share: ProjectShareLink | undefined,
	revision?: string,
	updatedAt?: number,
): boolean {
	if (!share) return false;
	if (revision) return share.revision !== revision;
	return !share.sharedAt || (updatedAt !== undefined && updatedAt > share.sharedAt);
}
export function getProjectShareRevision(project: EditorProjectData | null): string | undefined {
	if (!project) return undefined;
	const text = JSON.stringify(
		{ videoPath: project.videoPath, editor: project.editor },
		(_, value) =>
			value && typeof value === "object" && !Array.isArray(value)
				? Object.fromEntries(
						Object.keys(value)
							.sort()
							.map((key) => [key, value[key]]),
					)
				: value,
	);
	let hash = 2166136261;
	for (let index = 0; index < text.length; index++)
		hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
	return `${text.length}:${hash >>> 0}`;
}
export function saveProjectShareLink(
	path: string,
	url: string,
	metadata: { revision?: string; accountId?: string } = {},
) {
	writeLinks({ ...readLinks(), [path]: { url, sharedAt: Date.now(), ...metadata } });
}
export function moveProjectShareLink(previous: string, next: string) {
	if (previous === next) return;
	const links = readLinks();
	if (!links[previous]) return;
	links[next] = links[previous];
	delete links[previous];
	writeLinks(links);
}
export function removeProjectShareLinks(paths: string[]) {
	const links = readLinks();
	for (const path of paths) delete links[path];
	writeLinks(links);
}

const deletedShareLinkListeners = new Set<(url: string) => void>();

export function isDeletedProjectShareLink(url: string): boolean {
	return deletedShareUrls.has(url);
}

/** Follow confirmed deletions in this renderer, including links not yet saved locally. */
export function subscribeDeletedProjectShareLinks(listener: (url: string) => void): () => void {
	deletedShareLinkListeners.add(listener);
	return () => {
		deletedShareLinkListeners.delete(listener);
	};
}

/** Remove every local alias for a confirmed deleted URL without disturbing regenerated links. */
export function removeProjectShareLinksByUrl(url: string): void {
	try {
		const links = readLinks();
		const matchingPaths = Object.keys(links).filter((path) => links[path].url === url);
		if (matchingPaths.length) {
			for (const path of matchingPaths) delete links[path];
			writeLinks(links);
		}
	} finally {
		// The service deletion succeeded even if local persistence is unavailable.
		deletedShareUrls.add(url);
		for (const listener of deletedShareLinkListeners) listener(url);
	}
}
