import { afterEach, describe, expect, it } from "vitest";

import {
	isNvidiaCudaExportAvailable,
	loadInitialNvidiaCudaExportOptIn,
	NVIDIA_CUDA_EXPORT_OPT_IN_SETTING_KEY,
	resolveNvidiaCudaExportOptIn,
	saveNvidiaCudaExportOptIn,
} from "./useNvidiaCudaExportOptIn";

function stubElectronSettings(initialValues: Record<string, unknown> = {}) {
	const store = new Map(Object.entries(initialValues));

	Object.defineProperty(globalThis, "electronAPI", {
		configurable: true,
		value: {
			getAppSetting: (key: string) => (store.has(key) ? store.get(key) : null),
			setAppSetting: (key: string, value: unknown) => {
				store.set(key, value);
				return true;
			},
		} as Pick<Window["electronAPI"], "getAppSetting" | "setAppSetting">,
	});

	return store;
}

describe("nvidiaCudaExportOptIn", () => {
	afterEach(() => {
		Reflect.deleteProperty(globalThis, "electronAPI");
	});

	it("only treats explicit native CUDA availability as available", () => {
		expect(
			isNvidiaCudaExportAvailable({
				capabilities: { nvidiaCuda: { available: true } },
			}),
		).toBe(true);
		expect(
			isNvidiaCudaExportAvailable({
				capabilities: { nvidiaCuda: { available: false } },
			}),
		).toBe(false);
		expect(isNvidiaCudaExportAvailable({ capabilities: {} })).toBe(false);
		expect(isNvidiaCudaExportAvailable(null)).toBe(false);
	});

	it("requires both user request and runtime availability before enabling", () => {
		expect(resolveNvidiaCudaExportOptIn(true, true)).toBe(true);
		expect(resolveNvidiaCudaExportOptIn(true, false)).toBe(false);
		expect(resolveNvidiaCudaExportOptIn(false, true)).toBe(false);
		expect(resolveNvidiaCudaExportOptIn(false, false)).toBe(false);
	});

	it("loads and saves the local opt-in flag through app settings", () => {
		const store = stubElectronSettings({
			[NVIDIA_CUDA_EXPORT_OPT_IN_SETTING_KEY]: true,
		});

		expect(loadInitialNvidiaCudaExportOptIn()).toBe(true);
		expect(saveNvidiaCudaExportOptIn(false)).toBe(true);
		expect(store.get(NVIDIA_CUDA_EXPORT_OPT_IN_SETTING_KEY)).toBe(false);
	});

	it("defaults to disabled when the app setting is unavailable", () => {
		expect(loadInitialNvidiaCudaExportOptIn()).toBe(false);
	});
});
