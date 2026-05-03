import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import {
	formatNativeHelperManifestWarning,
	updateNativeHelperManifest,
	verifyNativeHelperManifest,
} from "./native-helper-manifest.mjs";

const projectRoot = process.cwd();
const sourceDir = path.join(projectRoot, "electron", "native", "gpu-export-probe");
const buildDir = path.join(sourceDir, "build");
const bundledDir = path.join(
	projectRoot,
	"electron",
	"native",
	"bin",
	process.arch === "arm64" ? "win32-arm64" : "win32-x64",
);
const bundledExePath = path.join(bundledDir, "recordly-gpu-export.exe");
const helperId = "recordly-gpu-export";
const generatorArch = process.arch === "arm64" ? "ARM64" : "x64";

if (process.platform !== "win32") {
	console.log("[build-windows-gpu-export] Skipping Windows GPU export helper build.");
	process.exit(0);
}

if (!existsSync(path.join(sourceDir, "CMakeLists.txt"))) {
	console.error("[build-windows-gpu-export] CMakeLists.txt not found at", sourceDir);
	process.exit(1);
}

function findCmake() {
	try {
		execSync("cmake --version", { stdio: "pipe" });
		return "cmake";
	} catch {
		// Continue probing common Windows install locations.
	}

	const standaloneCmakePaths = [
		path.join("C:", "Program Files", "CMake", "bin", "cmake.exe"),
		path.join("C:", "Program Files (x86)", "CMake", "bin", "cmake.exe"),
	];
	for (const cmakePath of standaloneCmakePaths) {
		if (existsSync(cmakePath)) {
			return `"${cmakePath}"`;
		}
	}

	const vsRoots = [
		path.join("C:", "Program Files", "Microsoft Visual Studio"),
		path.join("C:", "Program Files (x86)", "Microsoft Visual Studio"),
	];
	const vsEditions = ["Community", "Professional", "Enterprise", "BuildTools"];
	const vsVersions = ["2022", "2019"];
	for (const root of vsRoots) {
		for (const version of vsVersions) {
			for (const edition of vsEditions) {
				const cmakePath = path.join(
					root,
					version,
					edition,
					"Common7",
					"IDE",
					"CommonExtensions",
					"Microsoft",
					"CMake",
					"CMake",
					"bin",
					"cmake.exe",
				);
				if (existsSync(cmakePath)) {
					return `"${cmakePath}"`;
				}
			}
		}
	}

	return null;
}

const cmake = findCmake();
if (!cmake) {
	if (existsSync(bundledExePath)) {
		const verification = verifyNativeHelperManifest({
			projectRoot,
			helperId,
			sourceDir,
			binaryPath: bundledExePath,
			binaryName: "recordly-gpu-export.exe",
		});
		if (!verification.ok) {
			console.warn(formatNativeHelperManifestWarning("build-windows-gpu-export", verification));
		}
		console.log(`[build-windows-gpu-export] Using bundled helper: ${bundledExePath}`);
		process.exit(0);
	}

	console.error(
		"[build-windows-gpu-export] CMake not found. Install Visual Studio with C++ CMake tools or standalone CMake.",
	);
	process.exit(1);
}

mkdirSync(buildDir, { recursive: true });

function clearCmakeCache() {
	rmSync(path.join(buildDir, "CMakeCache.txt"), { force: true });
	rmSync(path.join(buildDir, "CMakeFiles"), { recursive: true, force: true });
}

console.log("[build-windows-gpu-export] Configuring CMake...");
try {
	clearCmakeCache();
	execSync(`${cmake} .. -G "Visual Studio 17 2022" -A ${generatorArch}`, {
		cwd: buildDir,
		stdio: "inherit",
		timeout: 120000,
	});
} catch {
	console.log("[build-windows-gpu-export] VS 2022 generator not found, trying VS 2019...");
	try {
		clearCmakeCache();
		execSync(`${cmake} .. -G "Visual Studio 16 2019" -A ${generatorArch}`, {
			cwd: buildDir,
			stdio: "inherit",
			timeout: 120000,
		});
	} catch (error) {
		console.error("[build-windows-gpu-export] CMake configure failed:", error.message);
		process.exit(1);
	}
}

console.log("[build-windows-gpu-export] Building Windows GPU export helper...");
try {
	execSync(`${cmake} --build . --config Release`, {
		cwd: buildDir,
		stdio: "inherit",
		timeout: 300000,
	});
} catch (error) {
	console.error("[build-windows-gpu-export] Build failed:", error.message);
	process.exit(1);
}

const exePath = path.join(buildDir, "Release", "gpu-export-probe.exe");
if (!existsSync(exePath)) {
	console.error("[build-windows-gpu-export] Expected exe not found at", exePath);
	process.exit(1);
}

mkdirSync(bundledDir, { recursive: true });
copyFileSync(exePath, bundledExePath);
console.log(`[build-windows-gpu-export] Staged bundled helper: ${bundledExePath}`);
const manifestPath = updateNativeHelperManifest({
	projectRoot,
	helperId,
	sourceDir,
	binaryPath: bundledExePath,
	binaryName: "recordly-gpu-export.exe",
});
console.log(`[build-windows-gpu-export] Updated helper manifest: ${manifestPath}`);
