import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Compile the production matching functions and run them against a fixed
// device list, so no real microphone or permission prompt is involved.
describe.skipIf(process.platform !== "darwin")("recorder microphone selection", () => {
	let directory: string;
	let executable: string;
	beforeAll(() => {
		directory = mkdtempSync(join(tmpdir(), "recordly-microphone-"));
		executable = join(directory, "matcher");
		const source = readFileSync(
			new URL("./ScreenCaptureKitRecorder.swift", import.meta.url),
			"utf8",
		);
		const matching = source.slice(
			source.indexOf("private static func matchMicrophoneDeviceID"),
			source.indexOf("private func supportsNativeMicrophoneCapture"),
		);
		writeFileSync(
			join(directory, "main.swift"),
			`
import Foundation
enum Matcher {
${matching}
}
extension Matcher {
    static func run(_ arguments: [String]) -> String? {
        switch arguments[0] {
        case "undecorated":
            return undecoratedMicrophoneName(forLabel: arguments[1])
        default:
            return matchMicrophoneDeviceID(
                label: arguments[1],
                deviceId: arguments[2],
                devices: [
                    (name: "Shure MV7", uniqueID: "usb-mv7"),
                    (name: "MacBook Pro Microphone", uniqueID: "built-in"),
                    (name: "Foo", uniqueID: "foo"),
                    (name: "Foo (Pro)", uniqueID: "foo-pro"),
                ]
            )
        }
    }
}
print(Matcher.run(Array(CommandLine.arguments.dropFirst())) ?? "<none>")
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

	const run = (...args: string[]) => {
		const result = spawnSync(executable, args, { encoding: "utf8", timeout: 5_000 });
		expect(result.status, result.stderr).toBe(0);
		return result.stdout.trim();
	};

	it.each([
		["Shure MV7 (14ed:1012)", "Shure MV7"],
		["Mic (Built-in)", "Mic"],
		["Name (A) (B)", "Name (A)"],
		["(Only)", "<none>"],
		["Plain", "<none>"],
		["Mic (unclosed", "<none>"],
		["", "<none>"],
	])("strips the Chromium suffix from %j", (label, expected) => {
		expect(run("undecorated", label)).toBe(expected);
	});

	it.each([
		// Chromium's deviceId is a per-origin hash that never matches a uniqueID.
		["Shure MV7 (14ed:1012)", "d4488ddaa3f0f10c", "usb-mv7"],
		["Foo (Pro)", "", "foo-pro"],
		["Shure MV7", "built-in", "usb-mv7"],
		["Foo (USB)", "built-in", "built-in"],
		["Foo (USB)", "", "foo"],
		["Default - MacBook Pro Microphone (Built-in)", "default", "<none>"],
		["Unknown Mic (Virtual)", "", "<none>"],
		["", "", "<none>"],
	])("resolves label %j with device ID %j to %j", (label, deviceId, expected) => {
		expect(run("match", label, deviceId)).toBe(expected);
	});
});
