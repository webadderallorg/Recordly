import { execSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
const nvEncHeadersRoot =
	process.env.RECORDLY_NVENC_HEADERS_ROOT?.trim() ||
	path.join(projectRoot, ".tmp", "nv-codec-headers");
// nvEncodeAPI.h 13.x is required for Blackwell-era NVENC; the public
// Video Codec SDK samples repo still ships the legacy 8.1 header which fails
// with NV_ENC_ERR_INVALID_PARAM (error 8) on current drivers. Pin the FFmpeg
// nv-codec-headers release that provides API 13.0.
const NVENC_HEADERS_TAG = "n13.0.19.1";
const NVENC_HEADERS_INCLUDE = path.join(nvEncHeadersRoot, "include", "ffnvcodec");

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

function findCudaToolkitRoot() {
	const candidates = [
		process.env.CUDA_PATH,
		...Object.entries(process.env)
			.filter(([name]) => /^CUDA_PATH_V\d+_\d+$/.test(name))
			.map(([, value]) => value),
	];
	const cudaInstallRoot = path.join(
		"C:",
		"Program Files",
		"NVIDIA GPU Computing Toolkit",
		"CUDA",
	);
	if (existsSync(cudaInstallRoot)) {
		candidates.push(
			...readdirSync(cudaInstallRoot)
				.sort()
				.reverse()
				.map((version) => path.join(cudaInstallRoot, version)),
		);
	}

	return (
		candidates
			.filter((candidate) => typeof candidate === "string" && candidate.length > 0)
			.map((candidate) => path.normalize(candidate))
			.find((candidate) => existsSync(path.join(candidate, "bin", "nvcc.exe"))) ?? null
	);
}

function ensureNvEncHeaders() {
	if (existsSync(path.join(NVENC_HEADERS_INCLUDE, "nvEncodeAPI.h"))) {
		return;
	}
	console.log(`[build-nvidia-cuda-compositor] Cloning nv-codec-headers ${NVENC_HEADERS_TAG}...`);
	execSync(
		`git clone --depth 1 --branch ${NVENC_HEADERS_TAG} https://github.com/FFmpeg/nv-codec-headers.git "${nvEncHeadersRoot}"`,
		{ stdio: "inherit" },
	);
	if (!existsSync(path.join(NVENC_HEADERS_INCLUDE, "nvEncodeAPI.h"))) {
		fallbackToBundledHelperOrExit(
			`nv-codec-headers ${NVENC_HEADERS_TAG} could not be staged; a Blackwell-compatible nvEncodeAPI.h is required.`,
		);
	}
	// The legacy samples checkout ships nvEncodeAPI.h 8.1; the compiler picks the
	// quoted include from the NvEncoder directory first, so the 13.0 header must
	// replace it to build the encoder library against the current API.
	const samplesHeader = path.join(
		videoCodecSdkRoot,
		"Samples",
		"NvCodec",
		"NvEncoder",
		"nvEncodeAPI.h",
	);
	const versionLine = readFileSync(path.join(NVENC_HEADERS_INCLUDE, "nvEncodeAPI.h"), "utf8")
		.split(/\r?\n/)
		.find((line) => line.includes("NVENCAPI_MAJOR_VERSION"));
	if (existsSync(samplesHeader) && !/NVENCAPI_MAJOR_VERSION 13/.test(versionLine ?? "")) {
		copyFileSync(path.join(NVENC_HEADERS_INCLUDE, "nvEncodeAPI.h"), samplesHeader);
	}
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
	ensureNvEncHeaders();
} catch (error) {
	fallbackToBundledHelperOrExit(
		`Failed to stage nv-codec-headers: ${error instanceof Error ? error.message : String(error)}`,
	);
}

// The samples NvEncoder library predates nvEncodeAPI 13.x; patch the few API
// incompatibilities so it compiles against the staged header.
function patchNvEncoderForNvEnc13Headers() {
	const nvEncoderDir = path.join(videoCodecSdkRoot, "Samples", "NvCodec", "NvEncoder");
	const sourcePath = path.join(nvEncoderDir, "NvEncoder.cpp");
	let source = readFileSync(sourcePath, "utf8");

	if (!source.includes("nvEncEncodePicture API failed: ")) {
		source = replaceOrThrow(
			sourcePath,
			source,
			/if \(pIntializeParams->presetGUID != NV_ENC_PRESET_LOSSLESS_DEFAULT_GUID\r?\n(?:\s+)&& pIntializeParams->presetGUID != NV_ENC_PRESET_LOSSLESS_HP_GUID\)\r?\n(?:\s+)\{\r?\n(?:\s+)pIntializeParams->encodeConfig->rcParams\.constQP = \{ 28, 31, 25 \};\r?\n(?:\s+)\}/,
			"    pIntializeParams->encodeConfig->rcParams.constQP = { 28, 31, 25 };",
			"NVENC 13 lossless preset GUID check",
		);
		source = replaceOrThrow(
			sourcePath,
			source,
			/pIntializeParams->encodeConfig->encodeCodecConfig\.hevcConfig\.pixelBitDepthMinus8 =\r?\n(?:\s+)\(m_eBufferFormat == NV_ENC_BUFFER_FORMAT_YUV420_10BIT \|\| m_eBufferFormat == NV_ENC_BUFFER_FORMAT_YUV444_10BIT \) \? 2 : 0;\r?\n/,
			"",
			"NVENC 13 HEVC bit depth field removal",
		);
		source = replaceOrThrow(
			sourcePath,
			source,
			/bool yuv10BitFormat = \(m_eBufferFormat == NV_ENC_BUFFER_FORMAT_YUV420_10BIT \|\| m_eBufferFormat == NV_ENC_BUFFER_FORMAT_YUV444_10BIT\) \? true : false;\r?\n(?:\s+)if \(yuv10BitFormat && pEncoderParams->encodeConfig->encodeCodecConfig\.hevcConfig\.pixelBitDepthMinus8 != 2\)\r?\n(?:\s+)\{\r?\n(?:\s+)NVENC_THROW_ERROR\("Invalid PixelBitdepth", NV_ENC_ERR_INVALID_PARAM\);\r?\n(?:\s+)\}\r?\n\r?\n/,
			"",
			"NVENC 13 HEVC bit depth check removal",
		);
		source = replaceOrThrow(
			sourcePath,
			source,
			/NV_ENC_PRESET_DEFAULT_GUID/,
			"NV_ENC_PRESET_P4_GUID",
			"NVENC 13 default preset GUID",
		);
		source = replaceOrThrow(
			sourcePath,
			source,
			/"nvEncEncodePicture API failed"/,
			'"nvEncEncodePicture API failed: " + std::to_string(nvStatus)',
			"NVENC encode-picture error detail",
		);
		writeFileSync(sourcePath, source);
	}
}

try {
	patchNvEncoderForNvEnc13Headers();
} catch (error) {
	fallbackToBundledHelperOrExit(
		`Failed to patch NVIDIA NvEncoder for NVENC 13 headers: ${error instanceof Error ? error.message : String(error)}`,
	);
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

const cudaToolkitRoot = findCudaToolkitRoot();
if (!cudaToolkitRoot) {
	fallbackToBundledHelperOrExit(
		"CUDA Toolkit not found. Install CUDA Toolkit or set CUDA_PATH before building.",
	);
}

mkdirSync(buildDir, { recursive: true });

function clearCmakeCache() {
	rmSync(path.join(buildDir, "CMakeCache.txt"), { force: true });
	rmSync(path.join(buildDir, "CMakeFiles"), { recursive: true, force: true });
}

console.log("[build-nvidia-cuda-compositor] Configuring CMake...");
try {
	configureWithWindowsCmakeGenerator({
		prefix: "build-nvidia-cuda-compositor",
		clearCache: clearCmakeCache,
		configure: (generator, toolset) =>
			execSync(
				`${cmake} .. -G "${generator}" -A ${generatorArch} -T "${[
					toolset,
					`cuda=${cudaToolkitRoot}`,
					"host=x64",
				]
					.filter(Boolean)
					.join(
						",",
					)}" -DCMAKE_CUDA_COMPILER="${path.join(cudaToolkitRoot, "bin", "nvcc.exe")}" -DCUDAToolkit_ROOT="${cudaToolkitRoot}" -DRECORDLY_NVIDIA_VIDEO_CODEC_SDK_ROOT="${videoCodecSdkRoot}"`,
				{
					cwd: buildDir,
					stdio: "inherit",
					timeout: 120000,
				},
			),
	});
} catch (error) {
	fallbackToBundledHelperOrExit(
		`CMake configure failed: ${error instanceof Error ? error.message : String(error)}`,
	);
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
