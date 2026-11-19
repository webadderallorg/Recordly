import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { getPath: (name: string) => `/test/${name}`, setPath: vi.fn() },
}));
vi.mock("./instanceSession", () => ({ reserveInstanceSession: vi.fn() }));

describe("recording storage", () => {
	const storeDescriptor = Object.getOwnPropertyDescriptor(process, "windowsStore");
	afterEach(() => {
		if (storeDescriptor) Object.defineProperty(process, "windowsStore", storeDescriptor);
		else delete process.windowsStore;
		vi.unstubAllEnvs();
	});
	for (const store of [false, true]) {
		it(`keeps ${store ? "Store media outside disposable package data" : "existing direct-install paths"}`, async () => {
			vi.resetModules();
			vi.stubEnv("VITE_DEV_SERVER_URL", "");
			Object.defineProperty(process, "windowsStore", { configurable: true, value: store });
			const { RECORDINGS_DIR, USER_DATA_PATH } = await import("./appPaths");
			expect(USER_DATA_PATH).toBe("/test/userData");
			expect(RECORDINGS_DIR).toBe(
				store
					? path.join("/test/videos", "Recordly")
					: path.join("/test/userData", "recordings"),
			);
		});
	}
});
