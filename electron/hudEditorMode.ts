/** An editor may stay open behind the HUD while a new capture is prepared. */
export function isHudInEditorMode(
	editorCount: number,
	preparingRecording: boolean,
	recording: boolean,
) {
	return editorCount > 0 && !preparingRecording && !recording;
}
