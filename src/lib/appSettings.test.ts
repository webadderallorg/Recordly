import { afterEach, describe, expect, it, vi } from "vitest";

import { loadAppSetting, readAppSetting, saveAppSetting } from "./appSettings";

function stubElectronSettings(
	api: Partial<Pick<Window["electronAPI"], "getAppSetting" | "setAppSetting">>,
) {
	Object.defineProperty(globalThis, "electronAPI", {
		configurable: true,
		value: api,
	});
}

describe("appSettings", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		Reflect.deleteProperty(globalThis, "electronAPI");
	});

	it("reports a missing key separately from a missing bridge", () => {
		expect(readAppSetting("theme")).toEqual({ status: "unavailable" });
		expect(loadAppSetting("theme")).toBeNull();
		expect(saveAppSetting("theme", "dark")).toBe(false);
	});

	it("distinguishes an absent key from a stored value", () => {
		stubElectronSettings({
			getAppSetting: () => undefined,
			setAppSetting: () => true,
		});

		expect(readAppSetting("theme")).toEqual({ status: "missing" });
		expect(loadAppSetting("theme")).toBeNull();

		stubElectronSettings({
			getAppSetting: () => "dark",
			setAppSetting: () => true,
		});

		expect(readAppSetting("theme")).toEqual({ status: "found", value: "dark" });
		expect(loadAppSetting<string>("theme")).toBe("dark");
	});

	it("logs a failed IPC read instead of treating it as an absent key", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const failure = new Error("renderer bridge closed");
		stubElectronSettings({
			getAppSetting: () => {
				throw failure;
			},
			setAppSetting: () => true,
		});

		expect(readAppSetting("theme")).toEqual({ status: "error", error: failure });
		errorSpy.mockClear();
		expect(loadAppSetting("theme")).toBeNull();
		expect(errorSpy).toHaveBeenCalledTimes(1);
		expect(errorSpy.mock.calls[0]?.[0]).toContain("theme");
	});

	it("returns the boolean reported by the settings IPC result", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		stubElectronSettings({
			getAppSetting: () => null,
			setAppSetting: () => true,
		});
		expect(saveAppSetting("theme", "dark")).toBe(true);
		expect(errorSpy).not.toHaveBeenCalled();

		stubElectronSettings({
			getAppSetting: () => null,
			setAppSetting: () => false,
		});
		expect(saveAppSetting("theme", "dark")).toBe(false);
		expect(errorSpy).toHaveBeenCalledTimes(1);

		stubElectronSettings({
			getAppSetting: () => null,
			setAppSetting: () => undefined as unknown as boolean,
		});
		expect(saveAppSetting("theme", "dark")).toBe(false);
	});

	it("returns false and logs when the settings bridge throws on write", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		stubElectronSettings({
			getAppSetting: () => null,
			setAppSetting: () => {
				throw new Error("main process gone");
			},
		});

		expect(saveAppSetting("theme", "dark")).toBe(false);
		expect(errorSpy).toHaveBeenCalledTimes(1);
	});
});
