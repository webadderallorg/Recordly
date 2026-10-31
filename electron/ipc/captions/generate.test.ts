import { describe, expect, it } from "vitest";
import { isMissingWindowsWhisperRuntimeDependency } from "./runtimeErrors";

describe("isMissingWindowsWhisperRuntimeDependency", () => {
	it("recognizes the signed and unsigned STATUS_DLL_NOT_FOUND exit codes on Windows", () => {
		if (process.platform !== "win32") return;

		expect(isMissingWindowsWhisperRuntimeDependency({ code: -1073741515 })).toBe(true);
		expect(isMissingWindowsWhisperRuntimeDependency({ code: 3221225781 })).toBe(true);
	});

	it("does not classify ordinary Whisper failures as missing runtimes", () => {
		expect(isMissingWindowsWhisperRuntimeDependency({ code: 1 })).toBe(false);
		expect(isMissingWindowsWhisperRuntimeDependency(new Error("bad model"))).toBe(false);
	});
});
