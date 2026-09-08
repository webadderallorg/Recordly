import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";

export function validateIOSHelperFacts(facts, { architecture, signed = false }) {
	const errors = [];
	if (!facts.executable) errors.push("helper is not executable");
	if (facts.architecture !== architecture) errors.push("wrong helper architecture");
	if (!/^14\.0(?:\.0)?$/.test(facts.minimumOS ?? "")) errors.push("wrong deployment floor");
	if (facts.protocolVersion !== 1) errors.push("wrong control protocol");
	for (const key of ["NSCameraUsageDescription", "NSMicrophoneUsageDescription"]) {
		if (typeof facts.privacy?.[key] !== "string" || !facts.privacy[key].trim())
			errors.push(`missing ${key}`);
	}
	if (signed) {
		for (const key of [
			"com.apple.security.device.camera",
			"com.apple.security.device.audio-input",
		]) {
			if (facts.entitlements?.[key] !== true) errors.push(`missing signed ${key}`);
		}
		if (facts.entitlements?.["com.apple.security.get-task-allow"] === true)
			errors.push("debug entitlement in distribution");
	}
	return errors;
}

function run(binary, args) {
	return execFileSync(binary, args, {
		encoding: "utf8",
		timeout: 30_000,
		maxBuffer: 1024 * 1024,
	});
}
function parsePlist(xml) {
	const result = spawnSync("plutil", ["-convert", "json", "-o", "-", "-"], {
		input: xml,
		encoding: "utf8",
		timeout: 10_000,
	});
	if (result.status !== 0) throw new Error("Invalid helper privacy plist");
	return JSON.parse(result.stdout);
}

export function decodeMachOPlistSection(section) {
	const words = section
		.split(/\r?\n/)
		.flatMap((line) =>
			/^[0-9a-f]{8,16}\s/i.test(line) ? line.trim().split(/\s+/).slice(1) : [],
		);
	return Buffer.concat(
		words.map((word) => {
			if (/^[0-9a-f]{2}$/i.test(word)) return Buffer.from(word, "hex");
			if (!/^[0-9a-f]{8}$/i.test(word)) throw new Error("Invalid Mach-O section bytes");
			const data = Buffer.alloc(4);
			data.writeUInt32LE(Number.parseInt(word, 16));
			return data;
		}),
	);
}

export function inspectIOSHelper(binary, { architecture, signed = false, teamId } = {}) {
	accessSync(binary, constants.X_OK);
	const actualArch = run("lipo", ["-archs", binary]).trim();
	const minimumOS = run("vtool", ["-show-build", binary]).match(/minos\s+(\S+)/)?.[1];
	// otool prints bytes for Intel and little-endian 32-bit words for arm64.
	const section = run("otool", ["-X", "-s", "__TEXT", "__info_plist", binary]);
	const bytes = decodeMachOPlistSection(section);
	const end = bytes.indexOf("</plist>");
	if (end < 0) throw new Error("Missing embedded helper privacy plist");
	const privacy = parsePlist(bytes.subarray(0, end + 8));
	let protocolVersion = privacy.RecordlyCaptureProtocolVersion;
	const hostArch = process.arch === "arm64" ? "arm64" : "x86_64";
	if (actualArch === hostArch) {
		const smoke = JSON.parse(run(binary, ["--self-test"]));
		if (smoke.selfTest !== "passed") throw new Error("Helper self-test failed");
		protocolVersion = smoke.protocolVersion;
	}
	let entitlements;
	if (signed) {
		run("codesign", ["--verify", "--strict", binary]);
		const signature = spawnSync("codesign", ["--display", "--verbose=4", binary], {
			encoding: "utf8",
		});
		if (
			signature.status !== 0 ||
			(teamId && !signature.stderr.includes(`TeamIdentifier=${teamId}`)) ||
			!signature.stderr.includes("runtime")
		)
			throw new Error("Invalid helper distribution signature");
		const result = spawnSync(
			"codesign",
			["--display", "--entitlements", "-", "--xml", binary],
			{ encoding: "utf8" },
		);
		const output = result.stdout + result.stderr;
		const start = output.indexOf("<?xml");
		const stop = output.indexOf("</plist>", start);
		if (result.status !== 0 || start < 0 || stop < 0)
			throw new Error("Missing helper entitlements");
		entitlements = parsePlist(output.slice(start, stop + 8));
	}
	const errors = validateIOSHelperFacts(
		{
			executable: true,
			architecture: actualArch,
			minimumOS,
			protocolVersion,
			privacy,
			entitlements,
		},
		{ architecture, signed },
	);
	if (errors.length) throw new Error(errors.join("; "));
	return { architecture: actualArch, minimumOS, protocolVersion, signed };
}
