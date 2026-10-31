import { useCallback, useEffect, useState } from "react";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";

const HIDDEN_KEY = "recordly.raw-hidden.v1";
function loadHidden(): string[] {
	try {
		const value = JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]");
		return Array.isArray(value)
			? value.filter((path): path is string => typeof path === "string")
			: [];
	} catch {
		return [];
	}
}
const NAMES_KEY = "recordly.raw-names.v1";
function loadNames(): Record<string, string> {
	try {
		const value = JSON.parse(localStorage.getItem(NAMES_KEY) || "{}");
		if (!value || typeof value !== "object" || Array.isArray(value)) return {};
		return Object.fromEntries(
			Object.entries(value).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		);
	} catch {
		return {};
	}
}
export function useRawLibrary(enabled: boolean) {
	const [entries, setEntries] = useState<ProjectLibraryEntry[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			const result = await window.electronAPI.listRecordings(true);
			if (!result.success) throw Error(result.error);
			const names = loadNames();
			setEntries(
				result.value
					.filter((entry) => !loadHidden().includes(entry.path))
					.map((rawSource) => ({
						path: rawSource.path,
						name: names[rawSource.path] || rawSource.name,
						createdAt: rawSource.createdAt,
						updatedAt: rawSource.createdAt,
						thumbnailPath: null,
						isCurrent: false,
						isInProjectsDirectory: false,
						rawSource,
					})),
			);
			setError(null);
		} catch (error) {
			setError(String(error));
		} finally {
			setLoading(false);
		}
	}, []);
	useEffect(() => {
		if (enabled) void refresh();
	}, [enabled, refresh]);
	const rename = async (path: string, name: string) => {
		localStorage.setItem(NAMES_KEY, JSON.stringify({ ...loadNames(), [path]: name }));
		setEntries((previous) =>
			previous.map((entry) => (entry.path === path ? { ...entry, name } : entry)),
		);
		return path;
	};
	const remove = async (paths: string[]) => {
		localStorage.setItem(HIDDEN_KEY, JSON.stringify([...new Set([...loadHidden(), ...paths])]));
		setEntries((previous) => previous.filter((entry) => !paths.includes(entry.path)));
		return paths;
	};
	return { entries, error, loading, refresh, rename, remove };
}
