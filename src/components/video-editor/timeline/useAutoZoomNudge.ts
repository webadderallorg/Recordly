import { createContext, useEffect, useMemo, useState } from "react";
import type { ProjectEditorState } from "../projectPersistence";

export const AutoZoomNudgeContext = createContext(false);

export function useAutoZoomNudge(
	sourcePath: string | null,
	editor: Partial<ProjectEditorState>,
	ready: boolean,
) {
	const [session, setSession] = useState<{
		sourcePath: string;
		baseline: string;
		dismissed: boolean;
	} | null>(null);
	// Persisted controls exclude playback position and selection. Capture them only
	// after loading/initial clip creation, then latch off through undo and saves.
	const signature = useMemo(() => JSON.stringify(editor), [editor]);
	useEffect(() => {
		if (!sourcePath || !ready) return;
		setSession((previous) => {
			if (previous?.sourcePath !== sourcePath)
				return { sourcePath, baseline: signature, dismissed: false };
			if (!previous.dismissed && previous.baseline !== signature)
				return { ...previous, dismissed: true };
			return previous;
		});
	}, [sourcePath, signature, ready]);

	return Boolean(
		ready &&
			sourcePath &&
			session?.sourcePath === sourcePath &&
			!session.dismissed &&
			session.baseline === signature,
	);
}
