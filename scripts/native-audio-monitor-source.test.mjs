import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("native audio output monitor wiring", () => {
	it("builds the monitor source and exposes its command-line mode", () => {
		const cmake = fs.readFileSync(
			path.join(repoRoot, "electron/native/wgc-capture/CMakeLists.txt"),
			"utf8",
		);
		const main = fs.readFileSync(
			path.join(repoRoot, "electron/native/wgc-capture/src/main.cpp"),
			"utf8",
		);

		expect(cmake).toContain("src/audio_level_monitor.cpp");
		expect(main).toContain('#include "audio_level_monitor.h"');
		expect(main).toContain('std::string(argv[1]) == "--monitor-audio-outputs"');
		expect(main).toContain("runAudioOutputLevelMonitor()");
	});
});
