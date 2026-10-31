import { useCallback, useEffect, useRef } from "react";
import { resolveVideoUrl } from "../projectPersistence";
import type { useProjectState } from "../state/useProjectState";

/** Retry once through the permission-checked media API after a stale port/access failure. */
export function useVideoSourceRecovery(
	project: ReturnType<typeof useProjectState>,
	remount: () => void,
) {
	const attempted = useRef(false);
	const latest = useRef(project);
	latest.current = project;
	// biome-ignore lint/correctness/useExhaustiveDependencies: a different source gets its own recovery attempt.
	useEffect(() => {
		attempted.current = false;
	}, [project.videoSourcePath]);
	return useCallback(
		(message: string | null) => {
			const current = latest.current;
			const source = current.videoSourcePath;
			if (!source || attempted.current || !message?.startsWith("Failed to load video")) {
				current.setError(message);
				return;
			}
			attempted.current = true;
			void resolveVideoUrl(source)
				.then((url) => {
					if (latest.current.videoSourcePath !== source) return;
					latest.current.setVideoPath(url);
					remount();
				})
				.catch(() => {
					if (latest.current.videoSourcePath === source) latest.current.setError(message);
				});
		},
		[remount],
	);
}
