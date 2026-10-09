import { useEffect, useRef } from "react";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import { READ_ONLY_OPS, runEditorOp } from "./editorOps";
import { getEditorState } from "./editorOps/state";
import type { EditorOpContext } from "./editorOps/types";

type Input = {
	ready: boolean;
	duration: number;
	videoSourcePath: string | null;
	timeline: ReturnType<typeof useTimelineState>;
	appearance: ReturnType<typeof useAppearanceState>;
	history: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean };
	ids: EditorOpContext["ids"];
	adoptJoinedMedia: EditorOpContext["adoptJoinedMedia"];
	project?: EditorOpContext["project"];
	aspectRatio?: EditorOpContext["exportAspectRatio"];
	effectiveSpeedRegions?: EditorOpContext["effectiveSpeedRegions"];
	effectiveShowCursor?: EditorOpContext["effectiveShowCursor"];
};

type Editor = Input;

function runOp(op: string, payload: unknown, editor: Editor, live: () => Editor) {
	const startedOn = editor.videoSourcePath;
	const context = {
		assertSameRecording: () => {
			if (live().videoSourcePath !== startedOn) {
				throw new Error(
					"The editor loaded a different recording while this was running, so nothing was changed.",
				);
			}
		},
		duration: editor.duration,
		videoSourcePath: editor.videoSourcePath,
		timeline: editor.timeline,
		appearance: editor.appearance,
		history: editor.history,
		ids: editor.ids,
		adoptJoinedMedia: editor.adoptJoinedMedia,
		project: editor.project,
		exportAspectRatio: editor.aspectRatio,
		effectiveSpeedRegions: editor.effectiveSpeedRegions,
		effectiveShowCursor: editor.effectiveShowCursor,
	};
	if (op === "get_state") return getEditorState(context);
	return runEditorOp(op, payload, context);
}

export function useRemoteEditorBridge(input: Input) {
	const latestRef = useRef(input);
	latestRef.current = input;
	const runningRef = useRef<{ op: string; startedAt: number } | null>(null);

	useEffect(
		() =>
			window.electronAPI.onRemoteEditorRequest?.(async (request) => {
				const reply = (result: Omit<RemoteEditorResult, "id">) =>
					window.electronAPI.sendRemoteEditorResult({ id: request.id, ...result });
				const editor = latestRef.current;
				if (!editor.ready) {
					reply({ ok: false, error: "The editor is still loading the recording." });
					return;
				}
				const running = runningRef.current;
				const readOnly = READ_ONLY_OPS.has(request.op);
				if (running && !readOnly) {
					const seconds = Math.round((Date.now() - running.startedAt) / 1000);
					reply({
						ok: false,
						error: `The editor is still running ${running.op} (${seconds} s). Wait for it to finish, then try again.`,
					});
					return;
				}
				if (!readOnly) runningRef.current = { op: request.op, startedAt: Date.now() };
				try {
					reply({
						ok: true,
						data: await runOp(
							request.op,
							request.payload,
							latestRef.current,
							() => latestRef.current,
						),
					});
				} catch (error) {
					reply({
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					});
				} finally {
					if (!readOnly) runningRef.current = null;
				}
			}),
		[],
	);
}
