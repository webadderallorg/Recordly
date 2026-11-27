import { ipcMain } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectedSource } from "../../types";
import type { RecordingHandlerContext } from "./handlerContext";

const mocks = vi.hoisted(() => ({
	isTrustedRenderer: vi.fn(() => true),
	beginHudCaptureProtection: vi.fn(),
	bringSelectedWindowForward: vi.fn(async () => null),
	isLinuxPortalCaptureEnabled: vi.fn(() => true),
	startLinuxPortalCapture: vi.fn(async () => "/tmp/recording.webm"),
	startMacCapture: vi.fn(async () => ({ success: true })),
	startWindowsCapture: vi.fn(async () => ({ success: true })),
}));

vi.mock("electron", () => ({
	ipcMain: { handle: vi.fn() },
}));
vi.mock("../../../trustedRenderer", () => ({
	isTrustedRenderer: mocks.isTrustedRenderer,
}));
vi.mock("../../../windows", () => ({
	beginHudCaptureProtection: mocks.beginHudCaptureProtection,
}));
vi.mock("../../register/sources", () => ({
	bringSelectedWindowForward: mocks.bringSelectedWindowForward,
}));
vi.mock("../linuxPortal", () => ({
	LinuxPortalSelectionCancelled: class extends Error {},
	isLinuxPortalCaptureEnabled: mocks.isLinuxPortalCaptureEnabled,
	startLinuxPortalCapture: mocks.startLinuxPortalCapture,
}));
vi.mock("./startMacCapture", () => ({
	startMacCapture: mocks.startMacCapture,
}));
vi.mock("./startWindowsCapture", () => ({
	startWindowsCapture: mocks.startWindowsCapture,
}));

import { LinuxPortalSelectionCancelled } from "../linuxPortal";
import { registerNativeStart } from "./nativeStart";

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
const trustedEvent = { sender: { id: 1 } } as unknown as Electron.IpcMainInvokeEvent;
const source: SelectedSource = { id: "screen:0:0", name: "Screen 1" };

function getStartHandler() {
	const handler = new Map(vi.mocked(ipcMain.handle).mock.calls).get(
		"start-native-screen-recording",
	);
	if (!handler) {
		throw new Error("start-native-screen-recording handler was not registered");
	}
	return handler;
}

describe("registerNativeStart", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(process, "platform", { value: "linux", configurable: true });
		mocks.isTrustedRenderer.mockReturnValue(true);
		mocks.isLinuxPortalCaptureEnabled.mockReturnValue(true);
		mocks.startLinuxPortalCapture.mockResolvedValue("/tmp/recording.webm");
		const context = {
			recordingProcessGuard: {
				wrap: <T extends (...args: never[]) => unknown>(fn: T) => fn,
				track: <T>(child: T) => child,
			},
			ownerRecovery: {
				sessionToken: 1,
				start: (_sender: unknown, fn: () => unknown) => fn(),
				captureExited: vi.fn(),
			},
		} as unknown as RecordingHandlerContext;
		registerNativeStart(context);
	});

	afterEach(() => {
		Object.defineProperty(process, "platform", originalPlatform);
	});

	it.each([
		"false",
		"true",
		1,
		0,
		{},
	])("rejects non-boolean capturesSystemAudio value %j on Linux portal start", async (badValue) => {
		const handler = getStartHandler();
		const result = await handler(trustedEvent, source, {
			capturesSystemAudio: badValue as unknown as boolean,
		});
		expect(result).toEqual({
			success: false,
			message: "Invalid capturesSystemAudio option for Linux portal capture",
		});
		expect(mocks.startLinuxPortalCapture).not.toHaveBeenCalled();
	});

	it("tells the renderer when the user dismissed the Linux portal", async () => {
		mocks.startLinuxPortalCapture.mockRejectedValueOnce(new LinuxPortalSelectionCancelled());
		await expect(getStartHandler()(trustedEvent, source)).resolves.toEqual({
			success: false,
			captureCancelled: true,
		});
	});

	it("passes boolean capturesSystemAudio cleanly on Linux portal start", async () => {
		const handler = getStartHandler();
		await expect(handler(trustedEvent, source, { capturesSystemAudio: true })).resolves.toEqual(
			{
				success: true,
				microphoneFallbackRequired: false,
			},
		);
		expect(mocks.startLinuxPortalCapture).toHaveBeenLastCalledWith(
			expect.objectContaining({ systemAudio: true }),
		);

		await expect(
			handler(trustedEvent, source, { capturesSystemAudio: false }),
		).resolves.toEqual({
			success: true,
			microphoneFallbackRequired: false,
		});
		expect(mocks.startLinuxPortalCapture).toHaveBeenLastCalledWith(
			expect.objectContaining({ systemAudio: false }),
		);

		await expect(handler(trustedEvent, source, undefined)).resolves.toEqual({
			success: true,
			microphoneFallbackRequired: false,
		});
		expect(mocks.startLinuxPortalCapture).toHaveBeenLastCalledWith(
			expect.objectContaining({ systemAudio: false }),
		);
	});
});
