import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Exercise the production service and stdin reader in a real Swift process.
// Only the device backend is simulated: CI must not request screen/mic access.
describe.skipIf(process.platform !== "darwin")("recorder process lifecycle", () => {
	let directory: string;
	let executable: string;
	beforeAll(() => {
		directory = mkdtempSync(join(tmpdir(), "recordly-lifecycle-"));
		executable = join(directory, "helper");
		const source = readFileSync(
			new URL("./ScreenCaptureKitRecorder.swift", import.meta.url),
			"utf8",
		);
		const service = source.slice(
			source.indexOf("final class RecorderService"),
			source.indexOf("guard CommandLine.arguments.count"),
		);
		const commands = source
			.slice(
				source.indexOf("let service = RecorderService()"),
				source.indexOf("if !service.waitUntilFinished()"),
			)
			.replace(
				"service.stop()",
				"service.stop()\n\tservice.drainCommandsForTest()\n\tcommandsFinished.signal()",
			);
		writeFileSync(
			join(directory, "main.swift"),
			`
import Foundation
final class ScreenCaptureRecorder {
    var output = ""
    func startCapture(configJSON: String) async throws {
        try await Task.sleep(nanoseconds: 50_000_000)
        if configJSON == "fail" { throw NSError(domain: "startup", code: 1) }
        output = configJSON
        try "recording".write(toFile: output, atomically: true, encoding: .utf8)
    }
    func stopCapture() async throws -> String {
        print("BACKEND_STOP")
        fflush(stdout)
        if output.isEmpty { throw NSError(domain: "inactive", code: 2) }
        try "finalized".write(toFile: output, atomically: true, encoding: .utf8)
        return output
    }
    func pauseCapture() async -> Bool { true }
    func resumeCapture() async -> Bool { true }
}
${service}
extension RecorderService {
    func drainCommandsForTest() { queue.sync {} }
}
let commandsFinished = DispatchSemaphore(value: 0)
${commands}
let success = service.waitUntilFinished()
// Wait for the reader to enqueue stop AND for the serialized operations to finish.
commandsFinished.wait()
exit(success ? 0 : 1)
`,
		);
		const build = spawnSync(
			"swiftc",
			[
				"-module-cache-path",
				join(directory, "cache"),
				join(directory, "main.swift"),
				"-o",
				executable,
			],
			{ encoding: "utf8", timeout: 60_000 },
		);
		expect(build.status, build.stderr).toBe(0);
	}, 60_000);
	afterAll(() => {
		if (directory) rmSync(directory, { recursive: true, force: true });
	});

	it.each([
		"",
		"stop\n",
		"pause\nresume\n",
		"stop\nstop\n",
	])("finalizes once with stdin %j", (input) => {
		const output = join(directory, "recording");
		const result = spawnSync(executable, [output], { input, encoding: "utf8", timeout: 5_000 });
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout.match(/BACKEND_STOP/g)).toHaveLength(1);
		expect(readFileSync(output, "utf8")).toBe("finalized");
	});

	it.each(["", "stop\n"])("exits cleanly after failed startup with stdin %j", (input) => {
		const result = spawnSync(executable, ["fail"], { input, encoding: "utf8", timeout: 5_000 });
		expect(result.signal, result.stderr).toBeNull();
		expect(result.status, result.stderr).toBe(1);
		expect(result.stderr).toContain("Error starting capture");
		expect(result.stdout).not.toContain("BACKEND_STOP");
	});
});
