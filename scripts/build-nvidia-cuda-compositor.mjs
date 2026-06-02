import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
	formatNativeHelperManifestWarning,
	updateNativeHelperManifest,
	verifyNativeHelperManifest,
} from "./native-helper-manifest.mjs";

const projectRoot = process.cwd();
const sourceDir = path.join(projectRoot, "electron", "native", "nvidia-cuda-compositor");
const buildDir = path.join(sourceDir, "build");
const bundledDir = path.join(
	projectRoot,
	"electron",
	"native",
	"bin",
	process.arch === "arm64" ? "win32-arm64" : "win32-x64",
);
const bundledExePath = path.join(bundledDir, "recordly-nvidia-cuda-compositor.exe");
const helperId = "recordly-nvidia-cuda-compositor";
const generatorArch = process.arch === "arm64" ? "ARM64" : "x64";
const videoCodecSdkRoot =
	process.env.RECORDLY_NVIDIA_VIDEO_CODEC_SDK_ROOT?.trim() ||
	path.join(projectRoot, ".tmp", "video-sdk-samples");

if (process.platform !== "win32") {
	console.log("[build-nvidia-cuda-compositor] Skipping NVIDIA CUDA compositor build.");
	process.exit(0);
}

if (!existsSync(path.join(sourceDir, "CMakeLists.txt"))) {
	console.error("[build-nvidia-cuda-compositor] CMakeLists.txt not found at", sourceDir);
	process.exit(1);
}

function fallbackToBundledHelperOrExit(reason) {
	if (existsSync(bundledExePath)) {
		const verification = verifyNativeHelperManifest({
			projectRoot,
			helperId,
			sourceDir,
			binaryPath: bundledExePath,
			binaryName: "recordly-nvidia-cuda-compositor.exe",
		});
		if (!verification.ok) {
			console.warn(
				formatNativeHelperManifestWarning("build-nvidia-cuda-compositor", verification),
			);
		}
		console.log(`[build-nvidia-cuda-compositor] ${reason}`);
		console.log(`[build-nvidia-cuda-compositor] Using bundled helper: ${bundledExePath}`);
		process.exit(0);
	}

	console.error(`[build-nvidia-cuda-compositor] ${reason}`);
	console.error(
		"[build-nvidia-cuda-compositor] No bundled helper is available; install CUDA Toolkit + NVIDIA Video Codec SDK or provide a staged helper.",
	);
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
	const vsEditions = ["Preview", "Community", "Professional", "Enterprise", "BuildTools"];
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

if (!existsSync(path.join(videoCodecSdkRoot, "Samples", "NvCodec"))) {
	fallbackToBundledHelperOrExit(
		`NVIDIA Video Codec SDK samples not found at ${videoCodecSdkRoot}. Set RECORDLY_NVIDIA_VIDEO_CODEC_SDK_ROOT to build from source.`,
	);
}

function replaceOrThrow(filePath, content, pattern, replacement, label) {
	const updated = content.replace(pattern, replacement);
	if (updated === content) {
		throw new Error(`Unable to patch ${label} in ${filePath}`);
	}
	return updated;
}

function patchNvDecoderForRecordlyCallbacks() {
	const nvDecoderDir = path.join(videoCodecSdkRoot, "Samples", "NvCodec", "NvDecoder");
	const headerPath = path.join(nvDecoderDir, "NvDecoder.h");
	const sourcePath = path.join(nvDecoderDir, "NvDecoder.cpp");

	let header = readFileSync(headerPath, "utf8");
	if (!header.includes("RecordlyMappedFrameHandler")) {
		header = replaceOrThrow(
			headerPath,
			header,
			/#include "nvcuvid\.h"\r?\n/,
			`#include "nvcuvid.h"

using RecordlyMappedFrameHandler = void (*)(CUdeviceptr, unsigned int, int, int, int, int64_t, void*);
using RecordlyDisplayFramePolicy = bool (*)(int, void*);
`,
			"NvDecoder callback aliases",
		);
		header = replaceOrThrow(
			headerPath,
			header,
			/ {4}int setReconfigParams\(const Rect \* pCropRect, const Dim \* pResizeDim\);\r?\n/,
			`    int setReconfigParams(const Rect * pCropRect, const Dim * pResizeDim);
    void SetMappedFrameHandler(RecordlyMappedFrameHandler handler, void* userData) { m_recordlyMappedFrameHandler = handler; m_recordlyMappedFrameUserData = userData; }
    void SetDisplayFramePolicy(RecordlyDisplayFramePolicy policy, void* userData) { m_recordlyDisplayFramePolicy = policy; m_recordlyDisplayFramePolicyUserData = userData; }
    int GetDisplayFrameCount() const { return m_nDisplayFrameCount; }
`,
			"NvDecoder public callback methods",
		);
		header = replaceOrThrow(
			headerPath,
			header,
			/ {4}int m_nDecodedFrame = 0, m_nDecodedFrameReturned = 0;\r?\n/,
			`    int m_nDecodedFrame = 0, m_nDecodedFrameReturned = 0;
    int m_nDisplayFrameCount = 0;
    RecordlyMappedFrameHandler m_recordlyMappedFrameHandler = nullptr;
    void* m_recordlyMappedFrameUserData = nullptr;
    RecordlyDisplayFramePolicy m_recordlyDisplayFramePolicy = nullptr;
    void* m_recordlyDisplayFramePolicyUserData = nullptr;
`,
			"NvDecoder callback state",
		);
		writeFileSync(headerPath, header);
	}

	let source = readFileSync(sourcePath, "utf8");
	if (!source.includes("Recordly mapped frame callback")) {
		source = replaceOrThrow(
			sourcePath,
			source,
			/ {4}if \(result == CUDA_SUCCESS && \(DecodeStatus\.decodeStatus == cuvidDecodeStatus_Error \|\| DecodeStatus\.decodeStatus == cuvidDecodeStatus_Error_Concealed\)\)\r?\n {4}\{\r?\n {8}printf\("Decode Error occurred for picture %d\\n", m_nPicNumInDecodeOrder\[pDispInfo->picture_index\]\);\r?\n {4}\}\r?\n {4}uint8_t \*pDecodedFrame = nullptr;\r?\n/,
			`    if (result == CUDA_SUCCESS && (DecodeStatus.decodeStatus == cuvidDecodeStatus_Error || DecodeStatus.decodeStatus == cuvidDecodeStatus_Error_Concealed))
    {
        printf("Decode Error occurred for picture %d\\n", m_nPicNumInDecodeOrder[pDispInfo->picture_index]);
    }

    const int displayFrameIndex = m_nDisplayFrameCount++;
    if (m_recordlyDisplayFramePolicy &&
        !m_recordlyDisplayFramePolicy(displayFrameIndex, m_recordlyDisplayFramePolicyUserData))
    {
        NVDEC_API_CALL(cuvidUnmapVideoFrame(m_hDecoder, dpSrcFrame));
        return 1;
    }

    // Recordly mapped frame callback keeps the CUDA helper from making an
    // extra device-to-device copy when the caller can consume mapped NV12.
    if (m_recordlyMappedFrameHandler)
    {
        m_recordlyMappedFrameHandler(
            dpSrcFrame,
            nSrcPitch,
            m_nWidth,
            m_nHeight,
            m_nSurfaceHeight,
            pDispInfo->timestamp,
            m_recordlyMappedFrameUserData);
        NVDEC_API_CALL(cuvidUnmapVideoFrame(m_hDecoder, dpSrcFrame));
        return 1;
    }

    uint8_t *pDecodedFrame = nullptr;
`,
			"NvDecoder mapped frame callback hook",
		);
		writeFileSync(sourcePath, source);
	}
}

try {
	patchNvDecoderForRecordlyCallbacks();
} catch (error) {
	fallbackToBundledHelperOrExit(
		`Failed to patch NVIDIA Video Codec SDK samples: ${error instanceof Error ? error.message : String(error)}`,
	);
}

const cmake = findCmake();
if (!cmake) {
	fallbackToBundledHelperOrExit(
		"CMake not found. Install Visual Studio with C++ CMake tools or standalone CMake.",
	);
}

mkdirSync(buildDir, { recursive: true });

function clearCmakeCache() {
	rmSync(path.join(buildDir, "CMakeCache.txt"), { force: true });
	rmSync(path.join(buildDir, "CMakeFiles"), { recursive: true, force: true });
}

console.log("[build-nvidia-cuda-compositor] Configuring CMake...");
try {
	clearCmakeCache();
	execSync(
		`${cmake} .. -G "Visual Studio 17 2022" -A ${generatorArch} -DRECORDLY_NVIDIA_VIDEO_CODEC_SDK_ROOT="${videoCodecSdkRoot}"`,
		{
			cwd: buildDir,
			stdio: "inherit",
			timeout: 120000,
		},
	);
} catch {
	console.log("[build-nvidia-cuda-compositor] VS 2022 generator not found, trying VS 2019...");
	try {
		clearCmakeCache();
		execSync(
			`${cmake} .. -G "Visual Studio 16 2019" -A ${generatorArch} -DRECORDLY_NVIDIA_VIDEO_CODEC_SDK_ROOT="${videoCodecSdkRoot}"`,
			{
				cwd: buildDir,
				stdio: "inherit",
				timeout: 120000,
			},
		);
	} catch (error) {
		fallbackToBundledHelperOrExit(
			`CMake configure failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

console.log("[build-nvidia-cuda-compositor] Building NVIDIA CUDA compositor...");
try {
	execSync(`${cmake} --build . --config Release`, {
		cwd: buildDir,
		stdio: "inherit",
		timeout: 300000,
	});
} catch (error) {
	fallbackToBundledHelperOrExit(
		`Build failed: ${error instanceof Error ? error.message : String(error)}`,
	);
}

const exePath = path.join(buildDir, "Release", "recordly-nvidia-cuda-compositor.exe");
if (!existsSync(exePath)) {
	console.error("[build-nvidia-cuda-compositor] Expected exe not found at", exePath);
	process.exit(1);
}

mkdirSync(bundledDir, { recursive: true });
copyFileSync(exePath, bundledExePath);
console.log(`[build-nvidia-cuda-compositor] Staged bundled helper: ${bundledExePath}`);
const manifestPath = updateNativeHelperManifest({
	projectRoot,
	helperId,
	sourceDir,
	binaryPath: bundledExePath,
	binaryName: "recordly-nvidia-cuda-compositor.exe",
});
console.log(`[build-nvidia-cuda-compositor] Updated helper manifest: ${manifestPath}`);
