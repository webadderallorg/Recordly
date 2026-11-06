import { afterEach, expect, it, vi } from "vitest";
import {
	hasLibraryExport,
	readLibraryExportHistory,
	recordLibraryExport,
} from "./libraryExportHistory";
afterEach(() => vi.unstubAllGlobals());
it("stores positive export evidence durably without confusing projects sharing source media", () => {
	let saved: unknown = null;
	vi.stubGlobal("window", {
		electronAPI: {
			getAppSetting: () => saved,
			setAppSetting: (_key: string, value: unknown) => {
				saved = value;
				return true;
			},
		},
	});
	expect(
		recordLibraryExport({ projectId: "a", projectPath: "/p/a", sourcePath: "/r/s.mp4" }),
	).toBe(true);
	const { records } = readLibraryExportHistory();
	expect(hasLibraryExport(records, { projectId: "a" })).toBe(true);
	expect(hasLibraryExport(records, { projectId: "b", sourcePath: "/r/s.mp4" })).toBe(false);
	expect(hasLibraryExport(records, { sourcePath: "/r/s.mp4" }, true)).toBe(true);
});
it("retains evidence from an unsaved recording and fails closed for corrupt storage", () => {
	let saved: unknown = null;
	vi.stubGlobal("window", {
		electronAPI: {
			getAppSetting: () => saved,
			setAppSetting: (_key: string, v: unknown) => {
				saved = v;
				return true;
			},
		},
	});
	expect(recordLibraryExport({ sourcePath: "/r/a.mp4" })).toBe(true);
	expect(
		hasLibraryExport(readLibraryExportHistory().records, {
			projectId: "later",
			sourcePath: "/r/a.mp4",
		}),
	).toBe(true);
	saved = [];
	expect(readLibraryExportHistory().available).toBe(false);
	expect(recordLibraryExport({ projectId: "b" })).toBe(false);
	expect(recordLibraryExport({})).toBe(false);
});
