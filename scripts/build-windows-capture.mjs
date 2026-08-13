import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import {
	formatNativeHelperManifestWarning,
	updateNativeHelperManifest,
	verifyNativeHelperManifest,
} from "./native-helper-manifest.mjs";
import {
	configureWithWindowsCmakeGenerator,
	WINDOWS_VISUAL_STUDIO_INSTALL_DIRS,
} from "./windows-cmake-generators.mjs";

const projectRoot = process.cwd();
const sourceDir = path.join(projectRoot, "electron", "native", "wgc-capture");
const buildDir = path.join(sourceDir, "build");
const bundledDir = path.join(
	projectRoot,
	"electron",
	"native",
	"bin",
	process.arch === "arm64" ? "win32-arm64" : "win32-x64",
);
const bundledExePath = path.join(bundledDir, "wgc-capture.exe");
const helperId = "wgc-capture";
const generatorArch = process.arch === "arm64" ? "ARM64" : "x64";

if (process.platform !== "win32") {
	console.log(
		"[build-windows-capture] Skipping native Windows capture build: host platform is not Windows.",
	);
	process.exit(0);
}

if (!existsSync(path.join(sourceDir, "CMakeLists.txt"))) {
	console.error("[build-windows-capture] CMakeLists.txt not found at", sourceDir);
	process.exit(1);
}

function findCmake() {
	// Check PATH first
	try {
		execSync("cmake --version", { stdio: "pipe" });
		return "cmake";
	} catch {
		// not on PATH
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

	// VS 2022 bundled CMake
	const vsRoots = [
		path.join("C:", "Program Files", "Microsoft Visual Studio"),
		path.join("C:", "Program Files (x86)", "Microsoft Visual Studio"),
	];
	const vsEditions = ["Community", "Professional", "Enterprise", "BuildTools"];
	const vsVersions = WINDOWS_VISUAL_STUDIO_INSTALL_DIRS;
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
			binaryName: "wgc-capture.exe",
		});
		if (!verification.ok) {
			console.warn(formatNativeHelperManifestWarning("build-windows-capture", verification));
		}
		console.log(`[build-windows-capture] Using bundled helper: ${bundledExePath}`);
		process.exit(0);
	}

	console.error(
		"[build-windows-capture] CMake not found. Install Visual Studio with C++ CMake tools or standalone CMake.",
	);
	process.exit(1);
}

mkdirSync(buildDir, { recursive: true });
const cacheFile = path.join(buildDir, "CMakeCache.txt");
const cacheDir = path.join(buildDir, "CMakeFiles");

function clearCmakeCache() {
	rmSync(cacheFile, { force: true });
	rmSync(cacheDir, { recursive: true, force: true });
}

console.log("[build-windows-capture] Configuring CMake...");
try {
	configureWithWindowsCmakeGenerator({
		prefix: "build-windows-capture",
		clearCache: clearCmakeCache,
		configure: (generator, toolset) =>
			execSync(`${cmake} .. -G "${generator}" -A ${generatorArch}${toolset ? ` -T ${toolset}` : ""}`, {
				cwd: buildDir,
				stdio: "inherit",
				timeout: 120000,
			}),
	});
} catch (error) {
	console.error("[build-windows-capture] CMake configure failed:", error.message);
	process.exit(1);
}

console.log("[build-windows-capture] Building native Windows capture helper...");
try {
	execSync(`${cmake} --build . --config Release`, {
		cwd: buildDir,
		stdio: "inherit",
		timeout: 300000,
	});
} catch (error) {
	console.error("[build-windows-capture] Build failed:", error.message);
	process.exit(1);
}

const exePath = path.join(buildDir, "Release", "wgc-capture.exe");
if (existsSync(exePath)) {
	console.log(`[build-windows-capture] Built successfully: ${exePath}`);
	mkdirSync(bundledDir, { recursive: true });
	copyFileSync(exePath, bundledExePath);
	console.log(`[build-windows-capture] Staged bundled helper: ${bundledExePath}`);
	const manifestPath = updateNativeHelperManifest({
		projectRoot,
		helperId,
		sourceDir,
		binaryPath: bundledExePath,
		binaryName: "wgc-capture.exe",
	});
	console.log(`[build-windows-capture] Updated helper manifest: ${manifestPath}`);
} else {
	console.error("[build-windows-capture] Expected exe not found at", exePath);
	process.exit(1);
}
