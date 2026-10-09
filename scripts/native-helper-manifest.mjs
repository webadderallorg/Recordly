import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const MANIFEST_FILE_NAME = "helpers-manifest.json";

function getPlatformArchDir(platform, arch) {
	if (platform === "linux") {
		return arch === "arm64" ? "linux-arm64" : "linux-x64";
	}

	if (platform !== "win32") {
		throw new Error(`Unsupported native helper manifest platform: ${platform}`);
	}

	return arch === "arm64" ? "win32-arm64" : "win32-x64";
}

function hashBuffer(buffer) {
	return createHash("sha256").update(buffer).digest("hex");
}

function collectSourceFiles(sourceDir, rootDir = sourceDir) {
	const entries = readdirSync(sourceDir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		if (entry.name === "build" || entry.name === "bin") {
			continue;
		}

		const absolutePath = path.join(sourceDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectSourceFiles(absolutePath, rootDir));
			continue;
		}

		if (!entry.isFile()) {
			continue;
		}

		files.push(path.relative(rootDir, absolutePath).replaceAll("\\", "/"));
	}

	files.sort((left, right) => left.localeCompare(right));
	return files;
}

function hashSourceTree(sourceDir) {
	const hash = createHash("sha256");
	for (const relativePath of collectSourceFiles(sourceDir)) {
		const absolutePath = path.join(sourceDir, relativePath);
		hash.update(relativePath);
		hash.update("\n");
		hash.update(readFileSync(absolutePath));
		hash.update("\n");
	}

	return hash.digest("hex");
}

function hashFile(filePath) {
	return hashBuffer(readFileSync(filePath));
}

export function getNativeHelperManifestPath({
	projectRoot,
	platform = process.platform,
	arch = process.arch,
}) {
	return path.join(
		projectRoot,
		"electron",
		"native",
		"bin",
		getPlatformArchDir(platform, arch),
		MANIFEST_FILE_NAME,
	);
}

function readManifest(manifestPath, platform, arch) {
	if (!existsSync(manifestPath)) {
		return {
			version: 1,
			platform,
			arch,
			helpers: {},
		};
	}

	const manifestContent = JSON.parse(readFileSync(manifestPath, "utf8"));
	return {
		version: 1,
		platform,
		arch,
		helpers: {},
		...manifestContent,
	};
}

export function updateNativeHelperManifest({
	projectRoot,
	helperId,
	sourceDir,
	binaryPath,
	binaryName,
	platform = process.platform,
	arch = process.arch,
}) {
	const manifestPath = getNativeHelperManifestPath({ projectRoot, platform, arch });
	const manifestDir = path.dirname(manifestPath);
	mkdirSync(manifestDir, { recursive: true });

	const manifest = readManifest(manifestPath, platform, arch);
	manifest.helpers[helperId] = {
		binaryName,
		binarySha256: hashFile(binaryPath),
		sourceDir: path.relative(projectRoot, sourceDir).replaceAll("\\", "/"),
		sourceFingerprint: hashSourceTree(sourceDir),
		updatedAt: new Date().toISOString(),
	};

	writeFileSync(`${manifestPath}`, `${JSON.stringify(manifest, null, 2)}\n`);
	return manifestPath;
}

export function verifyNativeHelperManifest({
	projectRoot,
	helperId,
	sourceDir,
	binaryPath,
	binaryName,
	platform = process.platform,
	arch = process.arch,
}) {
	const manifestPath = getNativeHelperManifestPath({ projectRoot, platform, arch });
	if (!existsSync(manifestPath)) {
		return {
			ok: false,
			manifestPath,
			reasons: ["manifest missing"],
		};
	}

	if (!existsSync(binaryPath)) {
		return {
			ok: false,
			manifestPath,
			reasons: ["bundled helper missing"],
		};
	}

	const manifest = readManifest(manifestPath, platform, arch);
	const helperManifest = manifest.helpers?.[helperId];
	if (!helperManifest) {
		return {
			ok: false,
			manifestPath,
			reasons: [`${helperId} entry missing`],
		};
	}

	const reasons = [];
	if (helperManifest.binaryName !== binaryName) {
		reasons.push(
			`expected binary ${binaryName}, found ${helperManifest.binaryName ?? "unknown"}`,
		);
	}

	const expectedBinaryHash = helperManifest.binarySha256;
	const actualBinaryHash = hashFile(binaryPath);
	if (expectedBinaryHash !== actualBinaryHash) {
		reasons.push("binary hash mismatch");
	}

	const expectedSourceFingerprint = helperManifest.sourceFingerprint;
	const actualSourceFingerprint = hashSourceTree(sourceDir);
	if (expectedSourceFingerprint !== actualSourceFingerprint) {
		reasons.push("source fingerprint mismatch");
	}

	return {
		ok: reasons.length === 0,
		manifestPath,
		reasons,
	};
}

export function formatNativeHelperManifestWarning(helperLabel, verificationResult) {
	const reasonText = verificationResult.reasons.join(", ");
	return `[${helperLabel}] Bundled helper provenance check failed (${reasonText}). Rebuild the helper to refresh ${path.basename(verificationResult.manifestPath)}.`;
}
