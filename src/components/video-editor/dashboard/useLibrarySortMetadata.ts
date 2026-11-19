import { useEffect, useRef, useState } from "react";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import {
	libraryMediaKey,
	needsLibraryMediaInfo,
	readLibraryMediaInfo,
	type LibraryMediaInfo,
	type LibrarySort,
} from "./librarySort";

export function useLibrarySortMetadata(
	entries: ProjectLibraryEntry[],
	sort: LibrarySort,
	enabled: boolean,
) {
	const cache = useRef(new Map<string, LibraryMediaInfo>());
	const workers = useRef([Promise.resolve(), Promise.resolve()]);
	const [metadata, setMetadata] = useState(new Map<string, LibraryMediaInfo>());
	const [loading, setLoading] = useState(false);
	const mode = sort === "audio" ? "audio" : "duration";
	useEffect(() => {
		if (!enabled || !needsLibraryMediaInfo(sort)) {
			setLoading(false);
			return;
		}
		let cancelled = false;
		let index = 0;
		const next = new Map<string, LibraryMediaInfo>();
		const pending = entries.filter((entry) => {
			const key = libraryMediaKey(entry);
			const cached = cache.current.get(`${mode}:${key}`);
			if (cached) next.set(key, cached);
			return !cached;
		});
		setLoading(pending.length > 0);
		// Keep the current order while scanning, then apply the complete sort once.
		const worker = async () => {
			while (!cancelled && index < pending.length) {
				const entry = pending[index++];
				const key = libraryMediaKey(entry);
				const info = await readLibraryMediaInfo(entry, mode === "audio").catch(() => ({}));
				cache.current.set(`${mode}:${key}`, info);
				if (cache.current.size > 500)
					cache.current.delete(cache.current.keys().next().value!);
				next.set(key, info);
			}
		};
		// Reuse the same two slots across rapid sort changes; an in-flight IPC
		// cannot be cancelled, so a new scan waits for its slot instead.
		workers.current = workers.current.map((previous) => previous.then(worker, worker));
		void Promise.all(workers.current).then(() => {
			if (!cancelled) {
				setMetadata(next);
				setLoading(false);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [entries, mode, sort, enabled]);
	return { metadata, loading };
}
