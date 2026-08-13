const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/;

export const REQUIRED_MACOS_ENTITLEMENTS = Object.freeze([
	"com.apple.security.cs.allow-jit",
	"com.apple.security.cs.allow-unsigned-executable-memory",
	"com.apple.security.cs.disable-library-validation",
	"com.apple.security.device.audio-input",
	"com.apple.security.device.camera",
]);

const ALLOWED_MACOS_ENTITLEMENTS = new Set(REQUIRED_MACOS_ENTITLEMENTS);

function readCodeSignValue(details, key) {
	const prefix = `${key}=`;
	return details
		.split(/\r?\n/)
		.find((line) => line.startsWith(prefix))
		?.slice(prefix.length)
		.trim();
}

export function assertValidAppleTeamId(teamId) {
	if (!TEAM_ID_PATTERN.test(teamId)) {
		throw new Error("APPLE_TEAM_ID must be exactly 10 uppercase letters or digits");
	}
}

export function collectCodeSigningMetadataErrors(details, expectedTeamId) {
	const errors = [];
	const authorities = details
		.split(/\r?\n/)
		.filter((line) => line.startsWith("Authority="))
		.map((line) => line.slice("Authority=".length).trim());
	const identifier = readCodeSignValue(details, "Identifier");
	const teamIdentifier = readCodeSignValue(details, "TeamIdentifier");
	const timestamp = readCodeSignValue(details, "Timestamp");
	const codeDirectory = details.split(/\r?\n/).find((line) => line.startsWith("CodeDirectory "));

	if (identifier !== "dev.recordly.app") {
		errors.push(`unexpected bundle identifier: ${identifier ?? "missing"}`);
	}

	if (!authorities[0]?.startsWith("Developer ID Application:")) {
		errors.push("the leaf signing authority is not Developer ID Application");
	}

	if (teamIdentifier !== expectedTeamId) {
		errors.push(`unexpected TeamIdentifier: ${teamIdentifier ?? "missing"}`);
	}

	if (!timestamp || timestamp.toLowerCase() === "none") {
		errors.push("secure signing timestamp is missing");
	}

	if (!codeDirectory?.includes("runtime")) {
		errors.push("hardened runtime flag is missing");
	}

	return errors;
}

export function collectEntitlementErrors(entitlements) {
	const errors = [];

	for (const entitlement of REQUIRED_MACOS_ENTITLEMENTS) {
		if (entitlements[entitlement] !== true) {
			errors.push(`required entitlement is missing or disabled: ${entitlement}`);
		}
	}

	for (const entitlement of Object.keys(entitlements).sort()) {
		if (ALLOWED_MACOS_ENTITLEMENTS.has(entitlement)) {
			continue;
		}

		if (
			entitlement === "com.apple.security.get-task-allow" &&
			entitlements[entitlement] === true
		) {
			errors.push("distribution build must not enable com.apple.security.get-task-allow");
			continue;
		}

		errors.push(`unexpected root application entitlement: ${entitlement}`);
	}

	return errors;
}

export function expectedMachOArchitecture(filePath, buildArch) {
	const normalizedPath = filePath.replaceAll("\\", "/");
	if (normalizedPath.includes("/darwin-arm64/")) {
		return "arm64";
	}

	if (normalizedPath.includes("/darwin-x64/")) {
		return "x86_64";
	}

	return buildArch === "arm64" ? "arm64" : "x86_64";
}

export function parseLipoArchitectures(output) {
	const trimmed = output.trim();
	const architectureList = trimmed.match(/are:\s+(.+)$/i)?.[1];
	if (architectureList) {
		return architectureList.trim().split(/\s+/);
	}

	const singleArchitecture = trimmed.match(/architecture:\s+([^\s]+)$/i)?.[1];
	return singleArchitecture ? [singleArchitecture] : trimmed.split(/\s+/).filter(Boolean);
}

export function collectArchitectureErrors(filePath, lipoOutput, buildArch) {
	const expectedArchitecture = expectedMachOArchitecture(filePath, buildArch);
	const architectures = parseLipoArchitectures(lipoOutput);

	if (architectures.includes(expectedArchitecture)) {
		return [];
	}

	return [
		`${filePath} does not contain ${expectedArchitecture} (found: ${architectures.join(", ") || "none"})`,
	];
}
