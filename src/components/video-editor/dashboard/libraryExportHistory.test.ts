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
			getAppSettingWithStatus: () => ({ success: true, found: saved !== null, value: saved }),
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
			getAppSettingWithStatus: () => ({ success: true, found: saved !== null, value: saved }),
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

it("distinguishes a missing history from a failed native read and never writes after failure", () => {
	const write = vi.fn();
	const read = vi.fn<Window["electronAPI"]["getAppSettingWithStatus"]>(() => ({
		success: true,
		found: false,
		value: null,
	}));
	vi.stubGlobal("window", {
		electronAPI: {
			getAppSetting: () => null,
			getAppSettingWithStatus: read,
			setAppSetting: write,
		},
	});
	expect(readLibraryExportHistory()).toEqual({ available: true, records: {} });
	read.mockReturnValue({ success: false, value: null });
	expect(readLibraryExportHistory()).toEqual({ available: false, records: {} });
	expect(recordLibraryExport({ projectId: "previously-exported" })).toBe(false);
	expect(write).not.toHaveBeenCalled();
});

it("does not treat a legacy getter's null fallback as an empty persistent history", () => {
	vi.stubGlobal("window", { electronAPI: { getAppSetting: () => null } });
	expect(readLibraryExportHistory()).toEqual({ available: false, records: {} });
});
