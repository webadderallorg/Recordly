import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestMissingRecordingPermissions } from "./recordingPermissions";

describe("requestMissingRecordingPermissions", () => {
	let api: Record<string, ReturnType<typeof vi.fn>>;
	beforeEach(() => {
		api = {
			getPlatform: vi.fn().mockResolvedValue("darwin"),
			getScreenRecordingPermissionStatus: vi
				.fn()
				.mockResolvedValue({ success: true, status: "denied" }),
			getAccessibilityPermissionStatus: vi
				.fn()
				.mockResolvedValue({ success: true, trusted: false }),
			openScreenRecordingPreferences: vi.fn().mockResolvedValue({ success: true }),
			requestAccessibilityPermission: vi.fn().mockResolvedValue({ success: true }),
		};
		vi.stubGlobal("window", { electronAPI: api });
	});
	afterEach(() => vi.unstubAllGlobals());

	it("asks for Screen Recording first and leaves Accessibility for the next attempt", async () => {
		await requestMissingRecordingPermissions();
		expect(api.openScreenRecordingPreferences).toHaveBeenCalledOnce();
		expect(api.requestAccessibilityPermission).not.toHaveBeenCalled();
	});

	it("prompts for Accessibility once Screen Recording is granted", async () => {
		api.getScreenRecordingPermissionStatus.mockResolvedValue({
			success: true,
			status: "granted",
		});
		await requestMissingRecordingPermissions();
		expect(api.openScreenRecordingPreferences).not.toHaveBeenCalled();
		expect(api.requestAccessibilityPermission).toHaveBeenCalledOnce();
	});

	it("reports when Screen Recording settings cannot open", async () => {
		api.openScreenRecordingPreferences.mockResolvedValue({
			success: false,
			error: "Settings unavailable",
		});
		await expect(requestMissingRecordingPermissions()).rejects.toThrow("Settings unavailable");
	});

	it("does nothing outside macOS", async () => {
		api.getPlatform.mockResolvedValue("win32");
		await requestMissingRecordingPermissions();
		expect(api.getScreenRecordingPermissionStatus).not.toHaveBeenCalled();
	});
});
