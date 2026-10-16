import { describe, expect, it, vi } from "vitest";
import { createRecordingShortcutDispatcher } from "./recordingShortcutDispatch";

function setup() {
	const hud = {
		isDestroyed: () => false,
		isVisible: vi.fn(() => false),
		isMinimized: () => false,
		hide: vi.fn(),
		webContents: { isLoadingMainFrame: () => false, send: vi.fn() },
	};
	const deps = {
		getHud: () => hud,
		showHud: vi.fn(),
		getRecordingSession: vi.fn((): number | null => 1),
		confirmDiscard: vi.fn(async () => true),
	};
	return { hud, deps, dispatch: createRecordingShortcutDispatcher(deps) };
}
describe("global recording shortcut routing", () => {
	it("restores the HUD and dispatches the existing source picker only while idle", async () => {
		const { hud, deps, dispatch } = setup();
		await dispatch("openCapturePicker");
		expect(deps.showHud).not.toHaveBeenCalled();
		deps.getRecordingSession.mockReturnValue(null);
		await dispatch("openCapturePicker");
		expect(deps.showHud).toHaveBeenCalledOnce();
		expect(hud.webContents.send).toHaveBeenCalledWith(
			"recording-shortcut",
			"openCapturePicker",
		);
	});
	it("sends commands to the capture owner while its HUD is hidden", async () => {
		const { hud, dispatch } = setup();
		await dispatch("toggleRecording");
		await dispatch("togglePause");
		expect(hud.webContents.send.mock.calls).toEqual([
			["recording-shortcut", "toggleRecording"],
			["recording-shortcut", "togglePause"],
		]);
	});
	it("restores hidden controls or hides visible controls without changing protection", async () => {
		const { hud, deps, dispatch } = setup();
		await dispatch("toggleHud");
		expect(deps.showHud).toHaveBeenCalledOnce();
		hud.isVisible.mockReturnValue(true);
		await dispatch("toggleHud");
		expect(hud.hide).toHaveBeenCalledOnce();
		expect(hud.webContents.send).not.toHaveBeenCalled();
	});
	it("requires confirmation and ignores cancel when idle", async () => {
		const { hud, deps, dispatch } = setup();
		deps.confirmDiscard.mockResolvedValue(false);
		await dispatch("cancelRecording");
		expect(hud.webContents.send).not.toHaveBeenCalled();
		deps.getRecordingSession.mockReturnValue(null);
		await dispatch("cancelRecording");
		expect(deps.confirmDiscard).toHaveBeenCalledOnce();
	});
	it("does not discard a new take or queue repeated commands during confirmation", async () => {
		const { hud, deps, dispatch } = setup();
		let resolve!: (value: boolean) => void;
		deps.confirmDiscard.mockImplementation(
			() =>
				new Promise<boolean>((done) => {
					resolve = done;
				}),
		);
		const pending = dispatch("cancelRecording");
		await dispatch("cancelRecording");
		await dispatch("toggleRecording");
		deps.getRecordingSession.mockReturnValue(2);
		resolve(true);
		await pending;
		expect(deps.confirmDiscard).toHaveBeenCalledOnce();
		expect(hud.webContents.send).not.toHaveBeenCalled();
	});
	it("dispatches a confirmed discard for the same session", async () => {
		const { hud, dispatch } = setup();
		await dispatch("cancelRecording");
		expect(hud.webContents.send).toHaveBeenCalledWith("recording-shortcut", "cancelRecording");
	});
});
