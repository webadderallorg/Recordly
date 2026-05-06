#define NOMINMAX
#include <windows.h>
#include <codecapi.h>
#include <d3d11.h>
#include <d3dcompiler.h>
#include <dxgi1_2.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <wrl/client.h>
#include <wincodec.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <memory>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#ifdef RECORDLY_GPU_EXPORT_ENABLE_NVENC_SDK
#include "NvEncoder/NvEncoderD3D11.h"
#endif

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "d3dcompiler.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfreadwrite.lib")
#pragma comment(lib, "mf.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "windowscodecs.lib")

using Microsoft::WRL::ComPtr;

namespace {

struct Options {
    std::wstring inputPath;
    std::wstring outputPath = L"gpu-export-probe.mp4";
    UINT width = 1920;
    UINT height = 1080;
    UINT fps = 30;
    double seconds = 60.0;
    UINT bitrate = 12'000'000;
    bool shaderComposite = false;
    float radius = 32.0f;
    float shadow = 36.0f;
    float padding = 0.0f;
    LONG contentLeft = -1;
    LONG contentTop = -1;
    LONG contentWidth = 0;
    LONG contentHeight = 0;
    float backgroundR = 0.035f;
    float backgroundG = 0.035f;
    float backgroundB = 0.045f;
    float backgroundBlurPx = 0.0f;
    std::wstring backgroundImagePath;
    std::wstring webcamInputPath;
    LONG webcamLeft = -1;
    LONG webcamTop = -1;
    LONG webcamSize = 0;
    float webcamRadius = 18.0f;
    float webcamShadow = 0.0f;
    bool webcamMirror = false;
    double webcamTimeOffsetMs = 0.0;
    std::wstring cursorTelemetryPath;
    std::wstring cursorAtlasPath;
    std::wstring cursorAtlasMetadataPath;
    float cursorSize = 84.0f;
    std::wstring zoomTelemetryPath;
    std::wstring timelineMapPath;
    bool preferHighPerformanceAdapter = false;
    int adapterIndex = -1;
    bool fastEncoderTuning = false;
    UINT surfacePoolSize = 4;
    bool nvencSdk = false;
};

struct ShaderConstants {
    float outputWidth;
    float outputHeight;
    float radius;
    float shadowSize;
    float contentLeft;
    float contentTop;
    float contentRight;
    float contentBottom;
    float backgroundR;
    float backgroundG;
    float backgroundB;
    float backgroundA;
    float shadowR;
    float shadowG;
    float shadowB;
    float shadowA;
    float backgroundImageEnabled;
    float backgroundImageWidth;
    float backgroundImageHeight;
    float webcamEnabled;
    float webcamLeft;
    float webcamTop;
    float webcamRight;
    float webcamBottom;
    float webcamRadius;
    float webcamShadowSize;
    float webcamShadowA;
    float webcamMirror;
    float cursorEnabled;
    float cursorX;
    float cursorY;
    float cursorSize;
    float cursorAtlasEnabled;
    float cursorAtlasLeft;
    float cursorAtlasTop;
    float cursorAtlasRight;
    float cursorAtlasBottom;
    float cursorAtlasAnchorX;
    float cursorAtlasAnchorY;
    float cursorAtlasAspect;
    float cursorBounceScale;
    float backgroundBlurPx;
    float backgroundBlurPadding0;
    float backgroundBlurPadding1;
    float zoomEnabled;
    float zoomScale;
    float zoomX;
    float zoomY;
};

struct CursorSample {
    double timeMs = 0.0;
    float cx = 0.0f;
    float cy = 0.0f;
    int cursorTypeIndex = 0;
    float bounceScale = 1.0f;
};

struct CursorAtlasEntry {
    float x = 0.0f;
    float y = 0.0f;
    float width = 1.0f;
    float height = 1.0f;
    float anchorX = 0.0f;
    float anchorY = 0.0f;
    float aspectRatio = 1.0f;
    bool valid = false;
};

struct ZoomSample {
    double timeMs = 0.0;
    float scale = 1.0f;
    float x = 0.0f;
    float y = 0.0f;
};

struct TimelineSegment {
    double sourceStartMs = 0.0;
    double sourceEndMs = 0.0;
    double outputStartMs = 0.0;
    double outputEndMs = 0.0;
    double speed = 1.0;
};

struct Timer {
    std::chrono::steady_clock::time_point start = std::chrono::steady_clock::now();

    double elapsedMs() const {
        const auto now = std::chrono::steady_clock::now();
        return std::chrono::duration<double, std::milli>(now - start).count();
    }
};

std::wstring getArgValue(const std::vector<std::wstring>& args, const std::wstring& key) {
    for (size_t i = 0; i + 1 < args.size(); ++i) {
        if (args[i] == key) {
            return args[i + 1];
        }
    }
    return L"";
}

UINT parseUIntArg(const std::vector<std::wstring>& args, const std::wstring& key, UINT fallback) {
    const auto value = getArgValue(args, key);
    if (value.empty()) {
        return fallback;
    }

    try {
        return static_cast<UINT>(std::stoul(value));
    } catch (...) {
        return fallback;
    }
}

LONG parseLongArg(const std::vector<std::wstring>& args, const std::wstring& key, LONG fallback) {
    const auto value = getArgValue(args, key);
    if (value.empty()) {
        return fallback;
    }

    try {
        return static_cast<LONG>(std::stol(value));
    } catch (...) {
        return fallback;
    }
}

float parseFloatArg(const std::vector<std::wstring>& args, const std::wstring& key, float fallback) {
    const auto value = getArgValue(args, key);
    if (value.empty()) {
        return fallback;
    }

    try {
        return std::stof(value);
    } catch (...) {
        return fallback;
    }
}

double parseDoubleArg(const std::vector<std::wstring>& args, const std::wstring& key, double fallback) {
    const auto value = getArgValue(args, key);
    if (value.empty()) {
        return fallback;
    }

    try {
        return std::stod(value);
    } catch (...) {
        return fallback;
    }
}

bool hasArg(const std::vector<std::wstring>& args, const std::wstring& key) {
    return std::find(args.begin(), args.end(), key) != args.end();
}

bool parseHexColor(const std::wstring& value, float& red, float& green, float& blue) {
    std::wstring trimmed = value;
    trimmed.erase(
        std::remove_if(trimmed.begin(), trimmed.end(), [](wchar_t ch) {
            return ch == L' ' || ch == L'\t' || ch == L'\r' || ch == L'\n';
        }),
        trimmed.end());
    if (!trimmed.empty() && trimmed[0] == L'#') {
        trimmed.erase(trimmed.begin());
    }
    if (trimmed.size() != 6) {
        return false;
    }

    try {
        const auto number = std::stoul(trimmed, nullptr, 16);
        red = static_cast<float>((number >> 16) & 0xff) / 255.0f;
        green = static_cast<float>((number >> 8) & 0xff) / 255.0f;
        blue = static_cast<float>(number & 0xff) / 255.0f;
        return true;
    } catch (...) {
        return false;
    }
}

std::vector<TimelineSegment> loadTimelineMap(const std::wstring& path) {
    std::vector<TimelineSegment> segments;
    if (path.empty()) {
        return segments;
    }

    FILE* file = nullptr;
    if (_wfopen_s(&file, path.c_str(), L"rb") != 0 || !file) {
        std::cerr << "[gpu-export] Unable to open timeline map" << std::endl;
        return segments;
    }

    char line[512] = {};
    double expectedOutputStartMs = 0.0;
    while (fgets(line, sizeof(line), file)) {
        TimelineSegment segment;
        if (sscanf_s(
                line,
                "%lf,%lf,%lf,%lf,%lf",
                &segment.sourceStartMs,
                &segment.sourceEndMs,
                &segment.outputStartMs,
                &segment.outputEndMs,
                &segment.speed) != 5) {
            segments.clear();
            break;
        }
        if (
            !std::isfinite(segment.sourceStartMs) ||
            !std::isfinite(segment.sourceEndMs) ||
            !std::isfinite(segment.outputStartMs) ||
            !std::isfinite(segment.outputEndMs) ||
            !std::isfinite(segment.speed) ||
            segment.sourceEndMs <= segment.sourceStartMs ||
            segment.outputEndMs <= segment.outputStartMs ||
            segment.speed <= 0.0 ||
            std::abs(segment.outputStartMs - expectedOutputStartMs) > 2.0) {
            segments.clear();
            break;
        }
        expectedOutputStartMs = segment.outputEndMs;
        segments.push_back(segment);
    }
    fclose(file);
    return segments;
}

bool sourceToOutputMs(
    const std::vector<TimelineSegment>& segments,
    double sourceMs,
    double& outputMs) {
    if (segments.empty()) {
        outputMs = sourceMs;
        return true;
    }

    constexpr double kToleranceMs = 1.0;
    for (const auto& segment : segments) {
        if (sourceMs + kToleranceMs < segment.sourceStartMs) {
            return false;
        }
        if (sourceMs <= segment.sourceEndMs + kToleranceMs) {
            const double clampedSourceMs =
                std::min(segment.sourceEndMs, std::max(segment.sourceStartMs, sourceMs));
            outputMs = segment.outputStartMs + (clampedSourceMs - segment.sourceStartMs) / segment.speed;
            outputMs = std::min(segment.outputEndMs, std::max(segment.outputStartMs, outputMs));
            return true;
        }
    }

    return false;
}

double outputToSourceMs(const std::vector<TimelineSegment>& segments, double outputMs) {
    if (segments.empty()) {
        return outputMs;
    }

    for (const auto& segment : segments) {
        if (outputMs <= segment.outputEndMs + 1.0) {
            const double clampedOutputMs =
                std::min(segment.outputEndMs, std::max(segment.outputStartMs, outputMs));
            return segment.sourceStartMs + (clampedOutputMs - segment.outputStartMs) * segment.speed;
        }
    }

    return segments.back().sourceEndMs;
}

Options parseOptions(int argc, wchar_t** argv) {
    std::vector<std::wstring> args;
    args.reserve(static_cast<size_t>(argc));
    for (int i = 0; i < argc; ++i) {
        args.emplace_back(argv[i]);
    }

    Options options;
    const auto input = getArgValue(args, L"--input");
    if (!input.empty()) {
        options.inputPath = input;
    }
    const auto output = getArgValue(args, L"--output");
    if (!output.empty()) {
        options.outputPath = output;
    }
    options.width = parseUIntArg(args, L"--width", options.width);
    options.height = parseUIntArg(args, L"--height", options.height);
    options.fps = parseUIntArg(args, L"--fps", options.fps);
    options.seconds = parseDoubleArg(args, L"--seconds", options.seconds);
    options.bitrate = parseUIntArg(args, L"--bitrate", options.bitrate);
    options.shaderComposite = hasArg(args, L"--shader-composite");
    options.radius = parseFloatArg(args, L"--radius", options.radius);
    options.shadow = parseFloatArg(args, L"--shadow", options.shadow);
    options.padding = parseFloatArg(args, L"--padding", options.padding);
    options.backgroundBlurPx = std::max(
        0.0f,
        parseFloatArg(args, L"--background-blur", options.backgroundBlurPx));
    options.contentLeft = parseLongArg(args, L"--content-left", options.contentLeft);
    options.contentTop = parseLongArg(args, L"--content-top", options.contentTop);
    options.contentWidth = parseLongArg(args, L"--content-width", options.contentWidth);
    options.contentHeight = parseLongArg(args, L"--content-height", options.contentHeight);
    const auto backgroundColor = getArgValue(args, L"--background-color");
    if (!backgroundColor.empty()) {
        parseHexColor(
            backgroundColor,
            options.backgroundR,
            options.backgroundG,
            options.backgroundB);
    }
    const auto backgroundImage = getArgValue(args, L"--background-image");
    if (!backgroundImage.empty()) {
        options.backgroundImagePath = backgroundImage;
    }
    const auto webcamInput = getArgValue(args, L"--webcam-input");
    if (!webcamInput.empty()) {
        options.webcamInputPath = webcamInput;
    }
    options.webcamLeft = parseLongArg(args, L"--webcam-left", options.webcamLeft);
    options.webcamTop = parseLongArg(args, L"--webcam-top", options.webcamTop);
    options.webcamSize = parseLongArg(args, L"--webcam-size", options.webcamSize);
    options.webcamRadius = parseFloatArg(args, L"--webcam-radius", options.webcamRadius);
    options.webcamShadow = parseFloatArg(args, L"--webcam-shadow", options.webcamShadow);
    options.webcamMirror = hasArg(args, L"--webcam-mirror");
    options.webcamTimeOffsetMs = parseDoubleArg(
        args,
        L"--webcam-time-offset-ms",
        options.webcamTimeOffsetMs);
    const auto cursorTelemetry = getArgValue(args, L"--cursor-telemetry");
    if (!cursorTelemetry.empty()) {
        options.cursorTelemetryPath = cursorTelemetry;
    }
    const auto cursorAtlas = getArgValue(args, L"--cursor-atlas");
    if (!cursorAtlas.empty()) {
        options.cursorAtlasPath = cursorAtlas;
    }
    const auto cursorAtlasMetadata = getArgValue(args, L"--cursor-atlas-metadata");
    if (!cursorAtlasMetadata.empty()) {
        options.cursorAtlasMetadataPath = cursorAtlasMetadata;
    }
    options.cursorSize = parseFloatArg(args, L"--cursor-size", options.cursorSize);
    const auto zoomTelemetry = getArgValue(args, L"--zoom-telemetry");
    if (!zoomTelemetry.empty()) {
        options.zoomTelemetryPath = zoomTelemetry;
    }
    const auto timelineMap = getArgValue(args, L"--timeline-map");
    if (!timelineMap.empty()) {
        options.timelineMapPath = timelineMap;
    }
    options.preferHighPerformanceAdapter = hasArg(args, L"--prefer-high-performance-adapter");
    options.adapterIndex = static_cast<int>(parseLongArg(args, L"--adapter-index", options.adapterIndex));
    options.fastEncoderTuning = hasArg(args, L"--fast-encoder-tuning");
    options.nvencSdk = hasArg(args, L"--nvenc-sdk");
    options.surfacePoolSize = parseUIntArg(args, L"--surface-pool-size", options.surfacePoolSize);
    options.width = std::max<UINT>(2, options.width & ~1U);
    options.height = std::max<UINT>(2, options.height & ~1U);
    options.fps = std::max<UINT>(1, options.fps);
    options.seconds = std::max(0.001, options.seconds);
    options.surfacePoolSize = std::min<UINT>(32, std::max<UINT>(4, options.surfacePoolSize));
    options.radius = std::max(0.0f, options.radius);
    options.shadow = std::max(0.0f, options.shadow);
    options.webcamSize = std::max<LONG>(0, options.webcamSize & ~1L);
    options.webcamRadius = std::max(0.0f, options.webcamRadius);
    options.webcamShadow = std::max(0.0f, options.webcamShadow);
    options.cursorSize = std::max(0.0f, options.cursorSize);
    if (options.padding > 1.0f) {
        options.padding /= 100.0f;
    }
    options.padding = std::min(0.45f, std::max(0.0f, options.padding));
    return options;
}

std::string hrToHex(HRESULT hr) {
    std::ostringstream stream;
    stream << "0x" << std::hex << static_cast<unsigned long>(hr);
    return stream.str();
}

bool succeeded(HRESULT hr, const char* label) {
    if (SUCCEEDED(hr)) {
        return true;
    }
    std::cerr << "ERROR: " << label << " failed: " << hrToHex(hr) << std::endl;
    return false;
}

DWORD firstVideoStreamIndex() {
    return static_cast<DWORD>(MF_SOURCE_READER_FIRST_VIDEO_STREAM);
}

class GpuProbe {
public:
    bool initialize(const Options& options) {
        const Timer initializeTimer;
        options_ = options;
        loadCursorTelemetry();
        loadZoomTelemetry();
        timelineSegments_ = loadTimelineMap(options_.timelineMapPath);
        if (!options_.timelineMapPath.empty() && timelineSegments_.empty()) {
            std::cerr << "[gpu-export] Timeline map is invalid or empty" << std::endl;
            return false;
        }

        {
            const Timer timer;
            const HRESULT coInit = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
            coInitialized_ = SUCCEEDED(coInit);
            initCoInitializeMs_ = timer.elapsedMs();
            if (!coInitialized_ && coInit != RPC_E_CHANGED_MODE) {
                return succeeded(coInit, "CoInitializeEx");
            }
        }

        {
            const Timer timer;
            const HRESULT hr = MFStartup(MF_VERSION);
            initMfStartupMs_ = timer.elapsedMs();
            if (!succeeded(hr, "MFStartup")) {
                return false;
            }
            mfStarted_ = true;
        }

        {
            const Timer timer;
            if (!createD3DDevice()) {
                return false;
            }
            initD3DDeviceMs_ = timer.elapsedMs();
        }

        initSourceReaderMs_ = 0.0;
        if (!options_.inputPath.empty()) {
            const Timer timer;
            if (!createSourceReader()) {
                return false;
            }
            initSourceReaderMs_ = timer.elapsedMs();
        }

        initWebcamReaderMs_ = 0.0;
        if (hasWebcamOverlay()) {
            const Timer timer;
            if (!createWebcamSourceReader()) {
                return false;
            }
            initWebcamReaderMs_ = timer.elapsedMs();
        }

        {
            const Timer timer;
            if (!createVideoProcessor()) {
                return false;
            }
            initVideoProcessorMs_ = timer.elapsedMs();
        }

        {
            const Timer timer;
            if (!createTextures()) {
                return false;
            }
            initTexturesMs_ = timer.elapsedMs();
        }

        initShaderPipelineMs_ = 0.0;
        if (options_.shaderComposite) {
            const Timer timer;
            if (!createShaderPipeline()) {
                return false;
            }
            initShaderPipelineMs_ = timer.elapsedMs();
        }

        {
            const Timer timer;
            if (options_.nvencSdk ? !createNvencSdkEncoder() : !createSinkWriter()) {
                return false;
            }
            initSinkWriterMs_ = timer.elapsedMs();
        }

        initializeMs_ = initializeTimer.elapsedMs();
        return true;
    }

    bool run() {
        if (!options_.inputPath.empty()) {
            return runSourceVideo();
        }

        const UINT frameCount =
            static_cast<UINT>(std::ceil(static_cast<double>(options_.fps) * options_.seconds));
        const Timer totalTimer;
        double clearMs = 0;
        double processMs = 0;
        double writeMs = 0;

        for (UINT frameIndex = 0; frameIndex < frameCount; ++frameIndex) {
            const Timer clearTimer;
            renderSyntheticFrame(frameIndex);
            clearMs += clearTimer.elapsedMs();

            const Timer processTimer;
            if (!convertBgraToNv12(frameIndex)) {
                return false;
            }
            processMs += processTimer.elapsedMs();

            const Timer writeTimer;
            if (!writeFrame(frameIndex)) {
                return false;
            }
            writeMs += writeTimer.elapsedMs();
            emitProgress(frameIndex + 1, frameCount);
        }
        emitProgress(frameCount, frameCount, true);

        const Timer finalizeTimer;
        const bool finalized = options_.nvencSdk ? finalizeNvencSdk() : SUCCEEDED(sinkWriter_->Finalize());
        const double finalizeMs = finalizeTimer.elapsedMs();
        if (!finalized) {
            if (!options_.nvencSdk) {
                std::cerr << "ERROR: IMFSinkWriter::Finalize failed" << std::endl;
            }
            return false;
        }

        const double totalMs = totalTimer.elapsedMs();
        const double realtime = (options_.seconds * 1000.0) / totalMs;
        std::cout
            << "{"
            << "\"success\":true,"
            << "\"width\":" << options_.width << ","
            << "\"height\":" << options_.height << ","
            << "\"fps\":" << options_.fps << ","
            << "\"surfacePoolSize\":" << options_.surfacePoolSize << ","
            << "\"adapterIndex\":" << selectedAdapterIndex_ << ","
            << "\"adapterVendorId\":" << selectedAdapterVendorId_ << ","
            << "\"adapterDeviceId\":" << selectedAdapterDeviceId_ << ","
            << "\"adapterDedicatedVideoMemoryMB\":" << selectedAdapterDedicatedVideoMemoryMB_ << ","
            << "\"seconds\":" << options_.seconds << ","
            << "\"frames\":" << frameCount << ","
            << "\"initializeMs\":" << initializeMs_ << ","
            << "\"initCoInitializeMs\":" << initCoInitializeMs_ << ","
            << "\"initMfStartupMs\":" << initMfStartupMs_ << ","
            << "\"initD3DDeviceMs\":" << initD3DDeviceMs_ << ","
            << "\"initSourceReaderMs\":" << initSourceReaderMs_ << ","
            << "\"initWebcamReaderMs\":" << initWebcamReaderMs_ << ","
            << "\"initVideoProcessorMs\":" << initVideoProcessorMs_ << ","
            << "\"initTexturesMs\":" << initTexturesMs_ << ","
            << "\"initShaderPipelineMs\":" << initShaderPipelineMs_ << ","
            << "\"initSinkWriterMs\":" << initSinkWriterMs_ << ","
            << "\"encoderBackend\":\"" << (options_.nvencSdk ? "nvenc-sdk-d3d11" : "media-foundation") << "\","
            << "\"encoderTuningApplied\":" << (encoderTuningApplied_ ? "true" : "false") << ","
            << "\"nvencOutputBytes\":" << nvencOutputBytes_ << ","
            << "\"totalMs\":" << totalMs << ","
            << "\"clearMs\":" << clearMs << ","
            << "\"videoProcessMs\":" << processMs << ","
            << "\"writeSampleMs\":" << writeMs << ","
            << "\"finalizeMs\":" << finalizeMs << ","
            << "\"realtimeMultiplier\":" << realtime
            << "}" << std::endl;
        return true;
    }

    void emitProgress(UINT currentFrame, UINT totalFrames, bool force = false) {
        if (totalFrames == 0) {
            return;
        }

        const UINT cadence = std::max<UINT>(1, static_cast<UINT>(options_.fps));
        if (!force && currentFrame < totalFrames && (currentFrame % cadence) != 0) {
            return;
        }

        const double percentage =
            std::min(100.0, (static_cast<double>(currentFrame) / totalFrames) * 100.0);
        std::cerr
            << "PROGRESS {"
            << "\"currentFrame\":" << currentFrame << ","
            << "\"totalFrames\":" << totalFrames << ","
            << "\"percentage\":" << percentage
            << "}" << std::endl;
    }

    ~GpuProbe() {
        if (nvencOutputFile_) {
            std::fclose(nvencOutputFile_);
            nvencOutputFile_ = nullptr;
        }
#ifdef RECORDLY_GPU_EXPORT_ENABLE_NVENC_SDK
        nvencEncoder_.reset();
#endif
        sinkWriter_.Reset();
        sourceReader_.Reset();
        webcamReader_.Reset();
        pendingWebcamSample_.Reset();
        nv12Textures_.clear();
        nv12OutputViews_.clear();
        bgraNv12OutputViews_.clear();
        compositorConstants_.Reset();
        samplerState_.Reset();
        pixelShader_.Reset();
        vertexShader_.Reset();
        backgroundShaderResourceView_.Reset();
        webcamShaderResourceView_.Reset();
        webcamOutputView_.Reset();
        webcamTexture_.Reset();
        contentShaderResourceView_.Reset();
        contentOutputView_.Reset();
        contentTexture_.Reset();
        bgraInputView_.Reset();
        bgraRenderTargetView_.Reset();
        bgraTexture_.Reset();
        bgraVideoProcessor_.Reset();
        bgraVideoProcessorEnumerator_.Reset();
        webcamVideoProcessor_.Reset();
        webcamVideoProcessorEnumerator_.Reset();
        videoProcessor_.Reset();
        videoProcessorEnumerator_.Reset();
        videoContext_.Reset();
        videoDevice_.Reset();
        deviceContext_.Reset();
        device_.Reset();
        deviceManager_.Reset();
        if (mfStarted_) {
            MFShutdown();
        }
        if (coInitialized_) {
            CoUninitialize();
        }
    }

private:
    void captureSelectedAdapterInfo(IDXGIAdapter1* adapter) {
        if (!adapter) {
            return;
        }

        DXGI_ADAPTER_DESC1 desc = {};
        if (FAILED(adapter->GetDesc1(&desc))) {
            return;
        }
        selectedAdapterVendorId_ = desc.VendorId;
        selectedAdapterDeviceId_ = desc.DeviceId;
        selectedAdapterDedicatedVideoMemoryMB_ =
            static_cast<UINT64>(desc.DedicatedVideoMemory / (1024 * 1024));
    }

    ComPtr<IDXGIAdapter1> selectHighPerformanceAdapter() {
        ComPtr<IDXGIFactory1> factory;
        HRESULT hr = CreateDXGIFactory1(IID_PPV_ARGS(&factory));
        if (FAILED(hr)) {
            return nullptr;
        }

        ComPtr<IDXGIAdapter1> bestAdapter;
        SIZE_T bestDedicatedMemory = 0;
        for (UINT index = 0;; ++index) {
            ComPtr<IDXGIAdapter1> adapter;
            hr = factory->EnumAdapters1(index, &adapter);
            if (hr == DXGI_ERROR_NOT_FOUND) {
                break;
            }
            if (FAILED(hr)) {
                continue;
            }

            DXGI_ADAPTER_DESC1 desc = {};
            if (FAILED(adapter->GetDesc1(&desc))) {
                continue;
            }
            if ((desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) != 0) {
                continue;
            }
            if (!bestAdapter || desc.DedicatedVideoMemory > bestDedicatedMemory) {
                bestDedicatedMemory = desc.DedicatedVideoMemory;
                bestAdapter = adapter;
            }
        }

        return bestAdapter;
    }

    ComPtr<IDXGIAdapter1> selectAdapterByIndex(UINT requestedIndex) {
        ComPtr<IDXGIFactory1> factory;
        HRESULT hr = CreateDXGIFactory1(IID_PPV_ARGS(&factory));
        if (FAILED(hr)) {
            return nullptr;
        }

        ComPtr<IDXGIAdapter1> adapter;
        hr = factory->EnumAdapters1(requestedIndex, &adapter);
        if (FAILED(hr)) {
            return nullptr;
        }
        return adapter;
    }

    bool createD3DDevice() {
        const D3D_FEATURE_LEVEL levels[] = {
            D3D_FEATURE_LEVEL_11_1,
            D3D_FEATURE_LEVEL_11_0,
        };
        D3D_FEATURE_LEVEL selectedLevel = D3D_FEATURE_LEVEL_11_0;
        UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT;
        ComPtr<IDXGIAdapter1> preferredAdapter;
        if (options_.adapterIndex >= 0) {
            preferredAdapter = selectAdapterByIndex(static_cast<UINT>(options_.adapterIndex));
            if (!preferredAdapter) {
                std::cerr << "ERROR: adapter index " << options_.adapterIndex << " was not found" << std::endl;
                return false;
            }
            selectedAdapterIndex_ = options_.adapterIndex;
        } else if (options_.preferHighPerformanceAdapter) {
            preferredAdapter = selectHighPerformanceAdapter();
        }

        HRESULT hr = D3D11CreateDevice(
            preferredAdapter.Get(),
            preferredAdapter ? D3D_DRIVER_TYPE_UNKNOWN : D3D_DRIVER_TYPE_HARDWARE,
            nullptr,
            flags,
            levels,
            ARRAYSIZE(levels),
            D3D11_SDK_VERSION,
            &device_,
            &selectedLevel,
            &deviceContext_);
        if (!succeeded(hr, "D3D11CreateDevice")) {
            return false;
        }

        ComPtr<IDXGIDevice> dxgiDevice;
        if (SUCCEEDED(device_.As(&dxgiDevice))) {
            ComPtr<IDXGIAdapter> adapter;
            if (SUCCEEDED(dxgiDevice->GetAdapter(&adapter))) {
                ComPtr<IDXGIAdapter1> adapter1;
                if (SUCCEEDED(adapter.As(&adapter1))) {
                    captureSelectedAdapterInfo(adapter1.Get());
                }
            }
        }

        hr = device_.As(&videoDevice_);
        if (!succeeded(hr, "Query ID3D11VideoDevice")) {
            return false;
        }
        hr = deviceContext_.As(&videoContext_);
        if (!succeeded(hr, "Query ID3D11VideoContext")) {
            return false;
        }

        UINT resetToken = 0;
        hr = MFCreateDXGIDeviceManager(&resetToken, &deviceManager_);
        if (!succeeded(hr, "MFCreateDXGIDeviceManager")) {
            return false;
        }
        hr = deviceManager_->ResetDevice(device_.Get(), resetToken);
        if (!succeeded(hr, "IMFDXGIDeviceManager::ResetDevice")) {
            return false;
        }

        return true;
    }

    bool createVideoProcessor() {
        D3D11_VIDEO_PROCESSOR_CONTENT_DESC desc = {};
        desc.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
        desc.InputFrameRate.Numerator = options_.fps;
        desc.InputFrameRate.Denominator = 1;
        desc.InputWidth = sourceWidth_;
        desc.InputHeight = sourceHeight_;
        desc.OutputFrameRate.Numerator = options_.fps;
        desc.OutputFrameRate.Denominator = 1;
        desc.OutputWidth = options_.width;
        desc.OutputHeight = options_.height;
        desc.Usage = D3D11_VIDEO_USAGE_PLAYBACK_NORMAL;

        HRESULT hr = videoDevice_->CreateVideoProcessorEnumerator(&desc, &videoProcessorEnumerator_);
        if (!succeeded(hr, "CreateVideoProcessorEnumerator")) {
            return false;
        }
        hr = videoDevice_->CreateVideoProcessor(videoProcessorEnumerator_.Get(), 0, &videoProcessor_);
        if (!succeeded(hr, "CreateVideoProcessor")) {
            return false;
        }

        RECT rect = {
            0,
            0,
            static_cast<LONG>(sourceWidth_),
            static_cast<LONG>(sourceHeight_),
        };
        RECT outputRect = {
            0,
            0,
            static_cast<LONG>(options_.width),
            static_cast<LONG>(options_.height),
        };
        RECT contentRect = getContentRect();
        videoContext_->VideoProcessorSetStreamSourceRect(videoProcessor_.Get(), 0, TRUE, &rect);
        videoContext_->VideoProcessorSetStreamDestRect(videoProcessor_.Get(), 0, TRUE, &contentRect);
        videoContext_->VideoProcessorSetOutputTargetRect(videoProcessor_.Get(), TRUE, &outputRect);
        videoContext_->VideoProcessorSetStreamAutoProcessingMode(videoProcessor_.Get(), 0, FALSE);
        D3D11_VIDEO_COLOR background = {};
        background.RGBA.A = 1.0f;
        background.RGBA.R = 0.04f;
        background.RGBA.G = 0.04f;
        background.RGBA.B = 0.05f;
        videoContext_->VideoProcessorSetOutputBackgroundColor(
            videoProcessor_.Get(),
            FALSE,
            &background);

        D3D11_VIDEO_PROCESSOR_CONTENT_DESC bgraDesc = {};
        bgraDesc.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
        bgraDesc.InputFrameRate.Numerator = options_.fps;
        bgraDesc.InputFrameRate.Denominator = 1;
        bgraDesc.InputWidth = options_.width;
        bgraDesc.InputHeight = options_.height;
        bgraDesc.OutputFrameRate.Numerator = options_.fps;
        bgraDesc.OutputFrameRate.Denominator = 1;
        bgraDesc.OutputWidth = options_.width;
        bgraDesc.OutputHeight = options_.height;
        bgraDesc.Usage = D3D11_VIDEO_USAGE_PLAYBACK_NORMAL;

        hr = videoDevice_->CreateVideoProcessorEnumerator(
            &bgraDesc,
            &bgraVideoProcessorEnumerator_);
        if (!succeeded(hr, "Create BGRA video processor enumerator")) {
            return false;
        }
        hr = videoDevice_->CreateVideoProcessor(
            bgraVideoProcessorEnumerator_.Get(),
            0,
            &bgraVideoProcessor_);
        if (!succeeded(hr, "Create BGRA video processor")) {
            return false;
        }

        RECT bgraRect = {
            0,
            0,
            static_cast<LONG>(options_.width),
            static_cast<LONG>(options_.height),
        };
        videoContext_->VideoProcessorSetStreamSourceRect(
            bgraVideoProcessor_.Get(),
            0,
            TRUE,
            &bgraRect);
        videoContext_->VideoProcessorSetStreamDestRect(
            bgraVideoProcessor_.Get(),
            0,
            TRUE,
            &bgraRect);
        videoContext_->VideoProcessorSetOutputTargetRect(
            bgraVideoProcessor_.Get(),
            TRUE,
            &bgraRect);
        videoContext_->VideoProcessorSetStreamAutoProcessingMode(
            bgraVideoProcessor_.Get(),
            0,
            FALSE);

        if (hasWebcamOverlay()) {
            D3D11_VIDEO_PROCESSOR_CONTENT_DESC webcamDesc = {};
            webcamDesc.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
            webcamDesc.InputFrameRate.Numerator = options_.fps;
            webcamDesc.InputFrameRate.Denominator = 1;
            webcamDesc.InputWidth = webcamWidth_;
            webcamDesc.InputHeight = webcamHeight_;
            webcamDesc.OutputFrameRate.Numerator = options_.fps;
            webcamDesc.OutputFrameRate.Denominator = 1;
            webcamDesc.OutputWidth = options_.width;
            webcamDesc.OutputHeight = options_.height;
            webcamDesc.Usage = D3D11_VIDEO_USAGE_PLAYBACK_NORMAL;

            hr = videoDevice_->CreateVideoProcessorEnumerator(
                &webcamDesc,
                &webcamVideoProcessorEnumerator_);
            if (!succeeded(hr, "Create webcam video processor enumerator")) {
                return false;
            }
            hr = videoDevice_->CreateVideoProcessor(
                webcamVideoProcessorEnumerator_.Get(),
                0,
                &webcamVideoProcessor_);
            if (!succeeded(hr, "Create webcam video processor")) {
                return false;
            }

            RECT webcamSourceRect = {
                0,
                0,
                static_cast<LONG>(webcamWidth_),
                static_cast<LONG>(webcamHeight_),
            };
            RECT webcamOutputRect = {
                0,
                0,
                static_cast<LONG>(options_.width),
                static_cast<LONG>(options_.height),
            };
            RECT webcamDestRect = getWebcamRect();
            videoContext_->VideoProcessorSetStreamSourceRect(
                webcamVideoProcessor_.Get(),
                0,
                TRUE,
                &webcamSourceRect);
            videoContext_->VideoProcessorSetStreamDestRect(
                webcamVideoProcessor_.Get(),
                0,
                TRUE,
                &webcamDestRect);
            videoContext_->VideoProcessorSetOutputTargetRect(
                webcamVideoProcessor_.Get(),
                TRUE,
                &webcamOutputRect);
            videoContext_->VideoProcessorSetStreamAutoProcessingMode(
                webcamVideoProcessor_.Get(),
                0,
                FALSE);
        }
        return true;
    }

    bool createTextures() {
        HRESULT hr = S_OK;
        if (options_.inputPath.empty() || options_.shaderComposite) {
            D3D11_TEXTURE2D_DESC bgraDesc = {};
            bgraDesc.Width = options_.width;
            bgraDesc.Height = options_.height;
            bgraDesc.MipLevels = 1;
            bgraDesc.ArraySize = 1;
            bgraDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
            bgraDesc.SampleDesc.Count = 1;
            bgraDesc.Usage = D3D11_USAGE_DEFAULT;
            bgraDesc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;

            hr = device_->CreateTexture2D(&bgraDesc, nullptr, &bgraTexture_);
            if (!succeeded(hr, "Create BGRA texture")) {
                return false;
            }
            hr = device_->CreateRenderTargetView(bgraTexture_.Get(), nullptr, &bgraRenderTargetView_);
            if (!succeeded(hr, "Create BGRA render target view")) {
                return false;
            }

            D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC inputViewDesc = {};
            inputViewDesc.FourCC = 0;
            inputViewDesc.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;
            inputViewDesc.Texture2D.MipSlice = 0;
            inputViewDesc.Texture2D.ArraySlice = 0;
            hr = videoDevice_->CreateVideoProcessorInputView(
                bgraTexture_.Get(),
                bgraVideoProcessorEnumerator_.Get(),
                &inputViewDesc,
                &bgraInputView_);
            if (!succeeded(hr, "Create video processor input view")) {
                return false;
            }
        }

        if (options_.shaderComposite) {
            D3D11_TEXTURE2D_DESC contentDesc = {};
            contentDesc.Width = options_.width;
            contentDesc.Height = options_.height;
            contentDesc.MipLevels = 1;
            contentDesc.ArraySize = 1;
            contentDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
            contentDesc.SampleDesc.Count = 1;
            contentDesc.Usage = D3D11_USAGE_DEFAULT;
            contentDesc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;

            hr = device_->CreateTexture2D(&contentDesc, nullptr, &contentTexture_);
            if (!succeeded(hr, "Create compositor content texture")) {
                return false;
            }

            D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC contentOutputDesc = {};
            contentOutputDesc.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
            contentOutputDesc.Texture2D.MipSlice = 0;
            hr = videoDevice_->CreateVideoProcessorOutputView(
                contentTexture_.Get(),
                videoProcessorEnumerator_.Get(),
                &contentOutputDesc,
                &contentOutputView_);
            if (!succeeded(hr, "Create compositor content output view")) {
                return false;
            }

            D3D11_SHADER_RESOURCE_VIEW_DESC srvDesc = {};
            srvDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
            srvDesc.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D;
            srvDesc.Texture2D.MipLevels = 1;
            hr = device_->CreateShaderResourceView(
                contentTexture_.Get(),
                &srvDesc,
                &contentShaderResourceView_);
            if (!succeeded(hr, "Create compositor content shader resource view")) {
                return false;
            }

            if (hasWebcamOverlay()) {
                D3D11_TEXTURE2D_DESC webcamDesc = contentDesc;
                hr = device_->CreateTexture2D(&webcamDesc, nullptr, &webcamTexture_);
                if (!succeeded(hr, "Create compositor webcam texture")) {
                    return false;
                }

                D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC webcamOutputDesc = {};
                webcamOutputDesc.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
                webcamOutputDesc.Texture2D.MipSlice = 0;
                hr = videoDevice_->CreateVideoProcessorOutputView(
                    webcamTexture_.Get(),
                    webcamVideoProcessorEnumerator_.Get(),
                    &webcamOutputDesc,
                    &webcamOutputView_);
                if (!succeeded(hr, "Create compositor webcam output view")) {
                    return false;
                }

                hr = device_->CreateShaderResourceView(
                    webcamTexture_.Get(),
                    &srvDesc,
                    &webcamShaderResourceView_);
                if (!succeeded(hr, "Create compositor webcam shader resource view")) {
                    return false;
                }
            }
        }

        D3D11_TEXTURE2D_DESC nv12Desc = {};
        nv12Desc.Width = options_.width;
        nv12Desc.Height = options_.height;
        nv12Desc.MipLevels = 1;
        nv12Desc.ArraySize = 1;
        nv12Desc.Format = DXGI_FORMAT_NV12;
        nv12Desc.SampleDesc.Count = 1;
        nv12Desc.Usage = D3D11_USAGE_DEFAULT;
        nv12Desc.BindFlags = D3D11_BIND_RENDER_TARGET;
        nv12Desc.MiscFlags = D3D11_RESOURCE_MISC_SHARED;

        D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC outputViewDesc = {};
        outputViewDesc.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
        outputViewDesc.Texture2D.MipSlice = 0;

        const size_t surfaceCount = static_cast<size_t>(options_.surfacePoolSize);
        nv12Textures_.reserve(surfaceCount);
        nv12OutputViews_.reserve(surfaceCount);
        bgraNv12OutputViews_.reserve(surfaceCount);

        for (size_t index = 0; index < surfaceCount; ++index) {
            ComPtr<ID3D11Texture2D> texture;
            hr = device_->CreateTexture2D(&nv12Desc, nullptr, &texture);
            if (!succeeded(hr, "Create NV12 texture")) {
                return false;
            }

            ComPtr<ID3D11VideoProcessorOutputView> outputView;
            hr = videoDevice_->CreateVideoProcessorOutputView(
                texture.Get(),
                videoProcessorEnumerator_.Get(),
                &outputViewDesc,
                &outputView);
            if (!succeeded(hr, "Create video processor output view")) {
                return false;
            }

            ComPtr<ID3D11VideoProcessorOutputView> bgraOutputView;
            hr = videoDevice_->CreateVideoProcessorOutputView(
                texture.Get(),
                bgraVideoProcessorEnumerator_.Get(),
                &outputViewDesc,
                &bgraOutputView);
            if (!succeeded(hr, "Create BGRA video processor output view")) {
                return false;
            }

            nv12Textures_.push_back(texture);
            nv12OutputViews_.push_back(outputView);
            bgraNv12OutputViews_.push_back(bgraOutputView);
        }

        return true;
    }

    bool compileShader(
        const char* source,
        const char* entryPoint,
        const char* target,
        ID3DBlob** bytecode) {
        ComPtr<ID3DBlob> errors;
        const HRESULT hr = D3DCompile(
            source,
            std::strlen(source),
            nullptr,
            nullptr,
            nullptr,
            entryPoint,
            target,
            D3DCOMPILE_ENABLE_STRICTNESS,
            0,
            bytecode,
            &errors);
        if (FAILED(hr)) {
            if (errors) {
                std::cerr
                    << "ERROR: D3DCompile "
                    << target
                    << " failed: "
                    << static_cast<const char*>(errors->GetBufferPointer())
                    << std::endl;
            }
            return succeeded(hr, "D3DCompile");
        }
        return true;
    }

    bool createBgraShaderResource(
        UINT width,
        UINT height,
        const std::uint8_t* pixels,
        UINT stride,
        ComPtr<ID3D11ShaderResourceView>& shaderResourceView) {
        D3D11_TEXTURE2D_DESC desc = {};
        desc.Width = width;
        desc.Height = height;
        desc.MipLevels = 1;
        desc.ArraySize = 1;
        desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
        desc.SampleDesc.Count = 1;
        desc.Usage = D3D11_USAGE_DEFAULT;
        desc.BindFlags = D3D11_BIND_SHADER_RESOURCE;

        D3D11_SUBRESOURCE_DATA data = {};
        data.pSysMem = pixels;
        data.SysMemPitch = stride;

        ComPtr<ID3D11Texture2D> texture;
        HRESULT hr = device_->CreateTexture2D(&desc, &data, &texture);
        if (!succeeded(hr, "Create BGRA shader texture")) {
            return false;
        }

        D3D11_SHADER_RESOURCE_VIEW_DESC srvDesc = {};
        srvDesc.Format = desc.Format;
        srvDesc.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D;
        srvDesc.Texture2D.MipLevels = 1;
        hr = device_->CreateShaderResourceView(
            texture.Get(),
            &srvDesc,
            &shaderResourceView);
        return succeeded(hr, "Create BGRA shader resource view");
    }

    bool loadWicBgraShaderResource(
        const std::wstring& imagePath,
        ComPtr<ID3D11ShaderResourceView>& shaderResourceView,
        UINT& width,
        UINT& height,
        const char* label) {
        ComPtr<IWICImagingFactory> factory;
        HRESULT hr = CoCreateInstance(
            CLSID_WICImagingFactory,
            nullptr,
            CLSCTX_INPROC_SERVER,
            IID_PPV_ARGS(&factory));
        if (!succeeded(hr, "Create WIC imaging factory")) {
            return false;
        }

        ComPtr<IWICBitmapDecoder> decoder;
        hr = factory->CreateDecoderFromFilename(
            imagePath.c_str(),
            nullptr,
            GENERIC_READ,
            WICDecodeMetadataCacheOnLoad,
            &decoder);
        if (!succeeded(hr, label)) {
            return false;
        }

        ComPtr<IWICBitmapFrameDecode> frame;
        hr = decoder->GetFrame(0, &frame);
        if (!succeeded(hr, "Get WIC frame")) {
            return false;
        }

        ComPtr<IWICFormatConverter> converter;
        hr = factory->CreateFormatConverter(&converter);
        if (!succeeded(hr, "Create WIC format converter")) {
            return false;
        }
        hr = converter->Initialize(
            frame.Get(),
            GUID_WICPixelFormat32bppBGRA,
            WICBitmapDitherTypeNone,
            nullptr,
            0.0,
            WICBitmapPaletteTypeCustom);
        if (!succeeded(hr, "Initialize WIC format converter")) {
            return false;
        }

        hr = converter->GetSize(&width, &height);
        if (!succeeded(hr, "Get WIC image size")) {
            return false;
        }
        if (width == 0 || height == 0) {
            std::cerr << "ERROR: WIC image has an invalid size." << std::endl;
            return false;
        }

        const UINT stride = width * 4;
        std::vector<std::uint8_t> pixels(static_cast<size_t>(stride) * height);
        hr = converter->CopyPixels(
            nullptr,
            stride,
            static_cast<UINT>(pixels.size()),
            pixels.data());
        if (!succeeded(hr, "Copy WIC image pixels")) {
            return false;
        }

        return createBgraShaderResource(
            width,
            height,
            pixels.data(),
            stride,
            shaderResourceView);
    }

    bool createSolidBackgroundTexture() {
        const std::uint8_t pixel[] = {
            static_cast<std::uint8_t>(std::round(options_.backgroundB * 255.0f)),
            static_cast<std::uint8_t>(std::round(options_.backgroundG * 255.0f)),
            static_cast<std::uint8_t>(std::round(options_.backgroundR * 255.0f)),
            255,
        };
        backgroundImageWidth_ = 1;
        backgroundImageHeight_ = 1;
        hasBackgroundImage_ = false;
        return createBgraShaderResource(
            1,
            1,
            pixel,
            4,
            backgroundShaderResourceView_);
    }

    bool createBackgroundTexture() {
        if (options_.backgroundImagePath.empty()) {
            return createSolidBackgroundTexture();
        }

        if (!loadWicBgraShaderResource(
            options_.backgroundImagePath,
            backgroundShaderResourceView_,
            backgroundImageWidth_,
            backgroundImageHeight_,
            "Create WIC background decoder")) {
            return false;
        }

        hasBackgroundImage_ = true;
        return true;
    }

    bool loadCursorAtlasMetadata() {
        for (auto& entry : cursorAtlasEntries_) {
            entry = CursorAtlasEntry{};
        }
        if (options_.cursorAtlasMetadataPath.empty()) {
            return false;
        }

        FILE* file = nullptr;
        if (_wfopen_s(&file, options_.cursorAtlasMetadataPath.c_str(), L"rb") != 0 || !file) {
            std::cerr << "[gpu-export] Unable to open cursor atlas metadata file" << std::endl;
            return false;
        }

        char line[256];
        bool sawEntry = false;
        while (std::fgets(line, sizeof(line), file)) {
            int index = 0;
            CursorAtlasEntry entry;
            if (sscanf_s(
                line,
                "%d,%f,%f,%f,%f,%f,%f,%f",
                &index,
                &entry.x,
                &entry.y,
                &entry.width,
                &entry.height,
                &entry.anchorX,
                &entry.anchorY,
                &entry.aspectRatio) != 8) {
                continue;
            }
            if (
                index < 0 ||
                index >= static_cast<int>(cursorAtlasEntries_.size()) ||
                !std::isfinite(entry.x) ||
                !std::isfinite(entry.y) ||
                !std::isfinite(entry.width) ||
                !std::isfinite(entry.height) ||
                !std::isfinite(entry.anchorX) ||
                !std::isfinite(entry.anchorY) ||
                !std::isfinite(entry.aspectRatio) ||
                entry.width <= 0.0f ||
                entry.height <= 0.0f) {
                continue;
            }
            entry.valid = true;
            cursorAtlasEntries_[static_cast<size_t>(index)] = entry;
            sawEntry = true;
        }
        std::fclose(file);
        return sawEntry;
    }

    bool createCursorAtlasTexture() {
        if (options_.cursorAtlasPath.empty() || options_.cursorAtlasMetadataPath.empty()) {
            hasCursorAtlas_ = false;
            return true;
        }

        if (!loadCursorAtlasMetadata()) {
            hasCursorAtlas_ = false;
            return true;
        }

        if (!loadWicBgraShaderResource(
            options_.cursorAtlasPath,
            cursorAtlasShaderResourceView_,
            cursorAtlasWidth_,
            cursorAtlasHeight_,
            "Create WIC cursor atlas decoder")) {
            hasCursorAtlas_ = false;
            return true;
        }

        hasCursorAtlas_ = true;
        return true;
    }

    bool createShaderPipeline() {
        static const char* vertexShaderSource = R"(
struct VSOut {
    float4 position : SV_POSITION;
    float2 uv : TEXCOORD0;
};

VSOut main(uint vertexId : SV_VertexID) {
    float2 positions[3] = {
        float2(-1.0, -1.0),
        float2(-1.0,  3.0),
        float2( 3.0, -1.0)
    };

    VSOut output;
    float2 position = positions[vertexId];
    output.position = float4(position, 0.0, 1.0);
    output.uv = float2((position.x + 1.0) * 0.5, 1.0 - ((position.y + 1.0) * 0.5));
    return output;
}
)";

        static const char* pixelShaderSource = R"(
cbuffer CompositorConstants : register(b0) {
    float outputWidth;
    float outputHeight;
    float radius;
    float shadowSize;
    float contentLeft;
    float contentTop;
    float contentRight;
    float contentBottom;
    float backgroundR;
    float backgroundG;
    float backgroundB;
    float backgroundA;
    float shadowR;
    float shadowG;
    float shadowB;
    float shadowA;
    float backgroundImageEnabled;
    float backgroundImageWidth;
    float backgroundImageHeight;
    float webcamEnabled;
    float webcamLeft;
    float webcamTop;
    float webcamRight;
    float webcamBottom;
    float webcamRadius;
    float webcamShadowSize;
    float webcamShadowA;
    float webcamMirror;
    float cursorEnabled;
    float cursorX;
    float cursorY;
    float cursorSize;
    float cursorAtlasEnabled;
    float cursorAtlasLeft;
    float cursorAtlasTop;
    float cursorAtlasRight;
    float cursorAtlasBottom;
    float cursorAtlasAnchorX;
    float cursorAtlasAnchorY;
    float cursorAtlasAspect;
    float cursorBounceScale;
    float backgroundBlurPx;
    float backgroundBlurPadding0;
    float backgroundBlurPadding1;
    float zoomEnabled;
    float zoomScale;
    float zoomX;
    float zoomY;
};

Texture2D contentTexture : register(t0);
Texture2D backgroundTexture : register(t1);
Texture2D webcamTexture : register(t2);
Texture2D cursorAtlasTexture : register(t3);
SamplerState linearSampler : register(s0);

struct PSIn {
    float4 position : SV_POSITION;
    float2 uv : TEXCOORD0;
};

float roundedBoxDistance(float2 p, float2 halfSize, float cornerRadius) {
    float2 q = abs(p) - halfSize + cornerRadius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - cornerRadius;
}

float cross2(float2 a, float2 b) {
    return a.x * b.y - a.y * b.x;
}

float insideTriangle(float2 p, float2 a, float2 b, float2 c) {
    float ab = cross2(b - a, p - a);
    float bc = cross2(c - b, p - b);
    float ca = cross2(a - c, p - c);
    return (ab >= 0.0 && bc >= 0.0 && ca >= 0.0) ||
        (ab <= 0.0 && bc <= 0.0 && ca <= 0.0) ? 1.0 : 0.0;
}

float cursorArrowMask(float2 p, float scale) {
    float2 a = float2(0.0, 0.0) * scale;
    float2 b = float2(0.0, 58.0) * scale;
    float2 c = float2(15.0, 44.0) * scale;
    float2 d = float2(25.0, 66.0) * scale;
    float2 e = float2(37.0, 61.0) * scale;
    float2 f = float2(27.0, 40.0) * scale;
    float2 g = float2(45.0, 40.0) * scale;

    return max(
        insideTriangle(p, a, b, c),
        max(
            insideTriangle(p, a, c, g),
            max(
                insideTriangle(p, c, d, e),
                insideTriangle(p, c, e, f)
            )
        )
    );
}

float sampleCursorAtlasAlpha(float2 cursorLocal, float cursorWidth, float cursorHeight) {
    float2 cursorUv = float2(
        cursorLocal.x / cursorWidth + cursorAtlasAnchorX,
        cursorLocal.y / cursorHeight + cursorAtlasAnchorY
    );
    if (
        cursorUv.x < 0.0 || cursorUv.x > 1.0 ||
        cursorUv.y < 0.0 || cursorUv.y > 1.0
    ) {
        return 0.0;
    }

    float2 atlasMin = float2(cursorAtlasLeft, cursorAtlasTop);
    float2 atlasMax = float2(cursorAtlasRight, cursorAtlasBottom);
    return cursorAtlasTexture.Sample(linearSampler, lerp(atlasMin, atlasMax, cursorUv)).a;
}

float sampleCursorAtlasShadow(float2 cursorLocal, float cursorWidth, float cursorHeight) {
    float2 shadowLocal = cursorLocal - float2(0.0, 2.0);
    float alpha = sampleCursorAtlasAlpha(shadowLocal, cursorWidth, cursorHeight) * 0.20;
    alpha += sampleCursorAtlasAlpha(shadowLocal - float2(1.5, 0.0), cursorWidth, cursorHeight) * 0.06;
    alpha += sampleCursorAtlasAlpha(shadowLocal + float2(1.5, 0.0), cursorWidth, cursorHeight) * 0.06;
    alpha += sampleCursorAtlasAlpha(shadowLocal - float2(0.0, 1.5), cursorWidth, cursorHeight) * 0.04;
    alpha += sampleCursorAtlasAlpha(shadowLocal + float2(0.0, 1.5), cursorWidth, cursorHeight) * 0.04;
    return saturate(alpha);
}

float2 getBackgroundCoverUv(float2 uv) {
    float2 backgroundUv = uv;
    float outputAspect = outputWidth / outputHeight;
    float backgroundAspect = backgroundImageWidth / backgroundImageHeight;
    if (backgroundAspect > outputAspect) {
        backgroundUv.x = 0.5 + ((backgroundUv.x - 0.5) * (outputAspect / backgroundAspect));
    } else {
        backgroundUv.y = 0.5 + ((backgroundUv.y - 0.5) * (backgroundAspect / outputAspect));
    }
    return saturate(backgroundUv);
}

float4 sampleBackground(float2 uv) {
    if (backgroundImageEnabled <= 0.5) {
        return float4(backgroundR, backgroundG, backgroundB, backgroundA);
    }

    float2 backgroundUv = getBackgroundCoverUv(uv);
    float safeBlur = min(max(backgroundBlurPx, 0.0), 96.0);
    if (safeBlur <= 0.001) {
        return backgroundTexture.Sample(linearSampler, backgroundUv);
    }

    float2 texel = float2(1.0 / max(outputWidth, 1.0), 1.0 / max(outputHeight, 1.0));
    float2 r1 = texel * safeBlur * 0.35;
    float2 r2 = texel * safeBlur * 0.70;
    float4 color = backgroundTexture.Sample(linearSampler, backgroundUv) * 0.20;
    color += backgroundTexture.Sample(linearSampler, saturate(backgroundUv + float2( r1.x, 0.0))) * 0.10;
    color += backgroundTexture.Sample(linearSampler, saturate(backgroundUv + float2(-r1.x, 0.0))) * 0.10;
    color += backgroundTexture.Sample(linearSampler, saturate(backgroundUv + float2(0.0,  r1.y))) * 0.10;
    color += backgroundTexture.Sample(linearSampler, saturate(backgroundUv + float2(0.0, -r1.y))) * 0.10;
    color += backgroundTexture.Sample(linearSampler, saturate(backgroundUv + float2( r2.x,  r2.y))) * 0.05;
    color += backgroundTexture.Sample(linearSampler, saturate(backgroundUv + float2(-r2.x,  r2.y))) * 0.05;
    color += backgroundTexture.Sample(linearSampler, saturate(backgroundUv + float2( r2.x, -r2.y))) * 0.05;
    color += backgroundTexture.Sample(linearSampler, saturate(backgroundUv + float2(-r2.x, -r2.y))) * 0.05;
    color += backgroundTexture.Sample(linearSampler, saturate(backgroundUv + float2( r2.x, 0.0))) * 0.05;
    color += backgroundTexture.Sample(linearSampler, saturate(backgroundUv + float2(-r2.x, 0.0))) * 0.05;
    color += backgroundTexture.Sample(linearSampler, saturate(backgroundUv + float2(0.0,  r2.y))) * 0.05;
    color += backgroundTexture.Sample(linearSampler, saturate(backgroundUv + float2(0.0, -r2.y))) * 0.05;
    return color;
}

float4 main(PSIn input) : SV_Target {
    float2 outputSize = float2(outputWidth, outputHeight);
    float2 pixel = input.uv * outputSize;
    float safeZoomScale = max(zoomScale, 0.01);
    float2 zoomOffset = float2(zoomX, zoomY);
    float2 contentPixel = zoomEnabled > 0.5
        ? (pixel - zoomOffset) / safeZoomScale
        : pixel;
    float2 rectMin = float2(contentLeft, contentTop);
    float2 rectMax = float2(contentRight, contentBottom);
    float2 halfSize = max((rectMax - rectMin) * 0.5, float2(1.0, 1.0));
    float2 center = (rectMin + rectMax) * 0.5;
    float distanceToRect = roundedBoxDistance(contentPixel - center, halfSize, radius);

    float contentAlpha = 1.0 - smoothstep(-0.75, 0.75, distanceToRect);
    float outsideAlpha = smoothstep(-0.75, 0.75, distanceToRect);
    float shadowAlpha =
        (1.0 - smoothstep(0.0, max(shadowSize, 1.0), max(distanceToRect, 0.0))) *
        outsideAlpha *
        shadowA;

    float4 background = sampleBackground(input.uv);
    float4 shadow = float4(shadowR, shadowG, shadowB, shadowAlpha);
    float4 content = contentTexture.Sample(linearSampler, saturate(contentPixel / outputSize));

    float3 withShadow = lerp(background.rgb, shadow.rgb, saturate(shadow.a));
    float3 rgb = lerp(withShadow, content.rgb, saturate(contentAlpha));
    if (webcamEnabled > 0.5) {
        float2 webcamMin = float2(webcamLeft, webcamTop);
        float2 webcamMax = float2(webcamRight, webcamBottom);
        float webcamInfluence = max(webcamShadowSize, 1.0) + 2.0;
        bool nearWebcam =
            pixel.x >= webcamMin.x - webcamInfluence &&
            pixel.x <= webcamMax.x + webcamInfluence &&
            pixel.y >= webcamMin.y - webcamInfluence &&
            pixel.y <= webcamMax.y + webcamInfluence;
        if (nearWebcam) {
            float2 webcamHalfSize = max((webcamMax - webcamMin) * 0.5, float2(1.0, 1.0));
            float2 webcamCenter = (webcamMin + webcamMax) * 0.5;
            float webcamDistance =
                roundedBoxDistance(pixel - webcamCenter, webcamHalfSize, webcamRadius);
            float webcamAlpha = 1.0 - smoothstep(-0.75, 0.75, webcamDistance);
            float webcamOutsideAlpha = smoothstep(-0.75, 0.75, webcamDistance);
            float webcamShadowAlpha =
                (1.0 - smoothstep(0.0, max(webcamShadowSize, 1.0), max(webcamDistance, 0.0))) *
                webcamOutsideAlpha *
                webcamShadowA;
            rgb = lerp(rgb, shadow.rgb, saturate(webcamShadowAlpha));

            if (webcamAlpha > 0.001) {
                float2 webcamUv = input.uv;
                if (webcamMirror > 0.5) {
                    float mirroredX = webcamLeft + (webcamRight - pixel.x);
                    webcamUv.x = mirroredX / outputWidth;
                }
                float4 webcam = webcamTexture.Sample(linearSampler, saturate(webcamUv));
                rgb = lerp(rgb, webcam.rgb, saturate(webcamAlpha));
            }
        }
    }
    if (cursorEnabled > 0.5) {
        float safeBounceScale = max(cursorBounceScale, 0.1);
        float cursorHeight = max(cursorSize, 1.0) * safeBounceScale;
        float cursorWidth = cursorHeight * max(cursorAtlasAspect, 0.01);
        float2 cursorPixel = float2(cursorX, cursorY);
        if (zoomEnabled > 0.5) {
            cursorPixel = cursorPixel * safeZoomScale + zoomOffset;
        }
        float2 cursorLocal = pixel - cursorPixel;
        if (cursorAtlasEnabled > 0.5) {
            float shadowAlpha = sampleCursorAtlasShadow(cursorLocal, cursorWidth, cursorHeight);
            rgb = lerp(rgb, float3(0.0, 0.0, 0.0), shadowAlpha);

            float2 cursorUv = float2(
                cursorLocal.x / cursorWidth + cursorAtlasAnchorX,
                cursorLocal.y / cursorHeight + cursorAtlasAnchorY
            );
            if (
                cursorUv.x >= 0.0 && cursorUv.x <= 1.0 &&
                cursorUv.y >= 0.0 && cursorUv.y <= 1.0
            ) {
                float2 atlasMin = float2(cursorAtlasLeft, cursorAtlasTop);
                float2 atlasMax = float2(cursorAtlasRight, cursorAtlasBottom);
                float4 cursorSample = cursorAtlasTexture.Sample(
                    linearSampler,
                    lerp(atlasMin, atlasMax, cursorUv)
                );
                rgb = lerp(rgb, cursorSample.rgb, saturate(cursorSample.a));
            }
        } else {
        float scale = max(cursorSize, 1.0) / 72.0;
        float cursorExtent = max(cursorSize, 1.0) * safeBounceScale * 1.15 + 8.0;
        if (abs(cursorLocal.x) <= cursorExtent && abs(cursorLocal.y) <= cursorExtent) {
            float shadowMask = cursorArrowMask(cursorLocal - float2(3.0, 3.0), scale);
            rgb = lerp(rgb, float3(0.0, 0.0, 0.0), shadowMask * 0.35);
            float outlineMask = cursorArrowMask(cursorLocal / 1.08, scale * 1.08);
            rgb = lerp(rgb, float3(0.0, 0.0, 0.0), outlineMask * 0.75);
            float cursorMask = cursorArrowMask(cursorLocal, scale);
            rgb = lerp(rgb, float3(1.0, 1.0, 1.0), cursorMask * 0.95);
        }
        }
    }
    return float4(rgb, 1.0);
}
)";

        ComPtr<ID3DBlob> vertexBytecode;
        if (!compileShader(vertexShaderSource, "main", "vs_5_0", &vertexBytecode)) {
            return false;
        }
        HRESULT hr = device_->CreateVertexShader(
            vertexBytecode->GetBufferPointer(),
            vertexBytecode->GetBufferSize(),
            nullptr,
            &vertexShader_);
        if (!succeeded(hr, "CreateVertexShader")) {
            return false;
        }

        ComPtr<ID3DBlob> pixelBytecode;
        if (!compileShader(pixelShaderSource, "main", "ps_5_0", &pixelBytecode)) {
            return false;
        }
        hr = device_->CreatePixelShader(
            pixelBytecode->GetBufferPointer(),
            pixelBytecode->GetBufferSize(),
            nullptr,
            &pixelShader_);
        if (!succeeded(hr, "CreatePixelShader")) {
            return false;
        }

        D3D11_BUFFER_DESC constantDesc = {};
        constantDesc.ByteWidth = sizeof(ShaderConstants);
        constantDesc.Usage = D3D11_USAGE_DEFAULT;
        constantDesc.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
        hr = device_->CreateBuffer(&constantDesc, nullptr, &compositorConstants_);
        if (!succeeded(hr, "Create compositor constant buffer")) {
            return false;
        }

        D3D11_SAMPLER_DESC samplerDesc = {};
        samplerDesc.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
        samplerDesc.AddressU = D3D11_TEXTURE_ADDRESS_CLAMP;
        samplerDesc.AddressV = D3D11_TEXTURE_ADDRESS_CLAMP;
        samplerDesc.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
        samplerDesc.MaxLOD = D3D11_FLOAT32_MAX;
        hr = device_->CreateSamplerState(&samplerDesc, &samplerState_);
        if (!succeeded(hr, "Create compositor sampler state")) {
            return false;
        }
        return createBackgroundTexture() && createCursorAtlasTexture();
    }

    bool createSinkWriter() {
        ComPtr<IMFAttributes> attributes;
        HRESULT hr = MFCreateAttributes(&attributes, 4);
        if (!succeeded(hr, "MFCreateAttributes")) {
            return false;
        }
        attributes->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE);
        attributes->SetUINT32(MF_SINK_WRITER_DISABLE_THROTTLING, TRUE);
        attributes->SetUnknown(MF_SINK_WRITER_D3D_MANAGER, deviceManager_.Get());

        hr = MFCreateSinkWriterFromURL(options_.outputPath.c_str(), nullptr, attributes.Get(), &sinkWriter_);
        if (!succeeded(hr, "MFCreateSinkWriterFromURL")) {
            return false;
        }

        ComPtr<IMFMediaType> outputType;
        hr = MFCreateMediaType(&outputType);
        if (!succeeded(hr, "MFCreateMediaType output")) {
            return false;
        }
        outputType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
        outputType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
        outputType->SetUINT32(MF_MT_AVG_BITRATE, options_.bitrate);
        outputType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
        MFSetAttributeSize(outputType.Get(), MF_MT_FRAME_SIZE, options_.width, options_.height);
        MFSetAttributeRatio(outputType.Get(), MF_MT_FRAME_RATE, options_.fps, 1);
        MFSetAttributeRatio(outputType.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);

        hr = sinkWriter_->AddStream(outputType.Get(), &streamIndex_);
        if (!succeeded(hr, "IMFSinkWriter::AddStream")) {
            return false;
        }

        ComPtr<IMFMediaType> inputType;
        hr = MFCreateMediaType(&inputType);
        if (!succeeded(hr, "MFCreateMediaType input")) {
            return false;
        }
        inputType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
        inputType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12);
        inputType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
        inputType->SetUINT32(MF_MT_DEFAULT_STRIDE, options_.width);
        MFSetAttributeSize(inputType.Get(), MF_MT_FRAME_SIZE, options_.width, options_.height);
        MFSetAttributeRatio(inputType.Get(), MF_MT_FRAME_RATE, options_.fps, 1);
        MFSetAttributeRatio(inputType.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);

        ComPtr<IMFAttributes> encoderAttributes;
        if (options_.fastEncoderTuning && SUCCEEDED(MFCreateAttributes(&encoderAttributes, 8))) {
            encoderAttributes->SetUINT32(CODECAPI_AVLowLatencyMode, TRUE);
            encoderAttributes->SetUINT32(CODECAPI_AVEncCommonQualityVsSpeed, 0);
            encoderAttributes->SetUINT32(
                CODECAPI_AVEncCommonRateControlMode,
                eAVEncCommonRateControlMode_LowDelayVBR);
            encoderAttributes->SetUINT32(CODECAPI_AVEncCommonMeanBitRate, options_.bitrate);
            encoderAttributes->SetUINT32(
                CODECAPI_AVEncCommonMaxBitRate,
                static_cast<UINT>(std::min<uint64_t>(
                    0xffffffffu,
                    static_cast<uint64_t>(options_.bitrate) * 3 / 2)));
            encoderAttributes->SetUINT32(CODECAPI_AVEncMPVDefaultBPictureCount, 0);
            encoderAttributes->SetUINT32(CODECAPI_AVEncH264CABACEnable, FALSE);
        }

        hr = sinkWriter_->SetInputMediaType(streamIndex_, inputType.Get(), encoderAttributes.Get());
        encoderTuningApplied_ = SUCCEEDED(hr) && encoderAttributes;
        if (FAILED(hr) && encoderAttributes) {
            hr = sinkWriter_->SetInputMediaType(streamIndex_, inputType.Get(), nullptr);
            encoderTuningApplied_ = false;
        }
        if (!succeeded(hr, "IMFSinkWriter::SetInputMediaType")) {
            return false;
        }
        hr = sinkWriter_->BeginWriting();
        return succeeded(hr, "IMFSinkWriter::BeginWriting");
    }

    bool createNvencSdkEncoder() {
#ifdef RECORDLY_GPU_EXPORT_ENABLE_NVENC_SDK
        try {
            nvencEncoder_ = std::make_unique<NvEncoderD3D11>(
                device_.Get(),
                options_.width,
                options_.height,
                NV_ENC_BUFFER_FORMAT_NV12);

            NV_ENC_INITIALIZE_PARAMS initializeParams = {NV_ENC_INITIALIZE_PARAMS_VER};
            NV_ENC_CONFIG encodeConfig = {NV_ENC_CONFIG_VER};
            initializeParams.encodeConfig = &encodeConfig;
            nvencEncoder_->CreateDefaultEncoderParams(
                &initializeParams,
                NV_ENC_CODEC_H264_GUID,
                NV_ENC_PRESET_HP_GUID);

            initializeParams.frameRateNum = options_.fps;
            initializeParams.frameRateDen = 1;
            initializeParams.enableEncodeAsync = 1;
            encodeConfig.profileGUID = NV_ENC_H264_PROFILE_HIGH_GUID;
            encodeConfig.gopLength = options_.fps * 2;
            encodeConfig.frameIntervalP = 1;
            encodeConfig.rcParams.rateControlMode = NV_ENC_PARAMS_RC_VBR;
            encodeConfig.rcParams.averageBitRate = options_.bitrate;
            encodeConfig.rcParams.maxBitRate = static_cast<uint32_t>(std::min<uint64_t>(
                0xffffffffu,
                static_cast<uint64_t>(options_.bitrate) * 3 / 2));
            encodeConfig.rcParams.vbvBufferSize = options_.bitrate;
            encodeConfig.rcParams.vbvInitialDelay = options_.bitrate;
            encodeConfig.encodeCodecConfig.h264Config.idrPeriod = encodeConfig.gopLength;

            nvencEncoder_->CreateEncoder(&initializeParams);

            if (_wfopen_s(&nvencOutputFile_, options_.outputPath.c_str(), L"wb") != 0 || !nvencOutputFile_) {
                std::cerr << "[gpu-export] Failed to open NVENC SDK output" << std::endl;
                return false;
            }
            encoderTuningApplied_ = true;
            return true;
        } catch (const std::exception& error) {
            std::cerr << "[gpu-export] NVENC SDK init failed: " << error.what() << std::endl;
            return false;
        }
#else
        std::cerr << "[gpu-export] --nvenc-sdk requested, but this build was not compiled with NVENC SDK support"
                  << std::endl;
        return false;
#endif
    }

    bool createSourceReaderForPath(
        const std::wstring& path,
        ComPtr<IMFSourceReader>& reader,
        UINT& width,
        UINT& height,
        const char* label) {
        ComPtr<IMFAttributes> attributes;
        HRESULT hr = MFCreateAttributes(&attributes, 4);
        if (!succeeded(hr, "MFCreateAttributes source reader")) {
            return false;
        }
        const bool useD3DSourceReader = !options_.preferHighPerformanceAdapter || options_.nvencSdk;
        if (useD3DSourceReader) {
            attributes->SetUnknown(MF_SOURCE_READER_D3D_MANAGER, deviceManager_.Get());
        }
        attributes->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE);
        attributes->SetUINT32(
            MF_SOURCE_READER_DISABLE_DXVA,
            useD3DSourceReader ? FALSE : TRUE);
        if (options_.preferHighPerformanceAdapter && !useD3DSourceReader) {
            attributes->SetUINT32(MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, TRUE);
        }

        hr = MFCreateSourceReaderFromURL(path.c_str(), attributes.Get(), &reader);
        if (!succeeded(hr, label)) {
            return false;
        }

        ComPtr<IMFMediaType> mediaType;
        hr = MFCreateMediaType(&mediaType);
        if (!succeeded(hr, "MFCreateMediaType source output")) {
            return false;
        }
        mediaType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
        mediaType->SetGUID(
            MF_MT_SUBTYPE,
            (options_.preferHighPerformanceAdapter && !options_.nvencSdk) ? MFVideoFormat_RGB32 : MFVideoFormat_NV12);
        hr = reader->SetCurrentMediaType(
            firstVideoStreamIndex(),
            nullptr,
            mediaType.Get());
        if (!succeeded(hr, "IMFSourceReader::SetCurrentMediaType")) {
            return false;
        }

        ComPtr<IMFMediaType> currentType;
        hr = reader->GetCurrentMediaType(firstVideoStreamIndex(), &currentType);
        if (!succeeded(hr, "IMFSourceReader::GetCurrentMediaType")) {
            return false;
        }

        UINT32 detectedWidth = 0;
        UINT32 detectedHeight = 0;
        hr = MFGetAttributeSize(currentType.Get(), MF_MT_FRAME_SIZE, &detectedWidth, &detectedHeight);
        if (!succeeded(hr, "MFGetAttributeSize source frame")) {
            return false;
        }
        width = std::max<UINT>(2, detectedWidth & ~1U);
        height = std::max<UINT>(2, detectedHeight & ~1U);
        return true;
    }

    bool createSourceReader() {
        return createSourceReaderForPath(
            options_.inputPath,
            sourceReader_,
            sourceWidth_,
            sourceHeight_,
            "MFCreateSourceReaderFromURL input");
    }

    bool createWebcamSourceReader() {
        return createSourceReaderForPath(
            options_.webcamInputPath,
            webcamReader_,
            webcamWidth_,
            webcamHeight_,
            "MFCreateSourceReaderFromURL webcam");
    }

    bool hasWebcamOverlay() const {
        return !options_.webcamInputPath.empty() &&
            options_.webcamLeft >= 0 &&
            options_.webcamTop >= 0 &&
            options_.webcamSize >= 2;
    }

    bool hasCursorOverlay() const {
        return !cursorSamples_.empty() && options_.cursorSize > 0.0f;
    }

    bool hasZoomOverlay() const {
        return !zoomSamples_.empty();
    }

    void loadCursorTelemetry() {
        cursorSamples_.clear();
        if (options_.cursorTelemetryPath.empty()) {
            return;
        }

        FILE* file = nullptr;
        if (_wfopen_s(&file, options_.cursorTelemetryPath.c_str(), L"rb") != 0 || !file) {
            std::cerr << "[gpu-export] Unable to open cursor telemetry file" << std::endl;
            return;
        }

        char line[256];
        while (std::fgets(line, sizeof(line), file)) {
            double timeMs = 0.0;
            float cx = 0.0f;
            float cy = 0.0f;
            int cursorTypeIndex = 0;
            float bounceScale = 1.0f;
            const int parsed = sscanf_s(
                line,
                "%lf,%f,%f,%d,%f",
                &timeMs,
                &cx,
                &cy,
                &cursorTypeIndex,
                &bounceScale);
            if (parsed < 3) {
                continue;
            }
            if (!std::isfinite(timeMs) || !std::isfinite(cx) || !std::isfinite(cy)) {
                continue;
            }
            cursorSamples_.push_back(CursorSample{
                std::max(0.0, timeMs),
                std::min(1.0f, std::max(0.0f, cx)),
                std::min(1.0f, std::max(0.0f, cy)),
                std::min(8, std::max(0, cursorTypeIndex)),
                std::isfinite(bounceScale)
                    ? std::min(2.0f, std::max(0.1f, bounceScale))
                    : 1.0f,
            });
        }
        std::fclose(file);

        std::sort(cursorSamples_.begin(), cursorSamples_.end(), [](const auto& left, const auto& right) {
            return left.timeMs < right.timeMs;
        });
    }

    CursorSample getCursorSampleAt(double timeMs) const {
        if (cursorSamples_.empty()) {
            return {};
        }
        if (timeMs <= cursorSamples_.front().timeMs) {
            return cursorSamples_.front();
        }
        if (timeMs >= cursorSamples_.back().timeMs) {
            return cursorSamples_.back();
        }

        const auto upper = std::upper_bound(
            cursorSamples_.begin(),
            cursorSamples_.end(),
            timeMs,
            [](double value, const CursorSample& sample) {
                return value < sample.timeMs;
            });
        const auto& b = *upper;
        const auto& a = *(upper - 1);
        const double span = std::max(1.0, b.timeMs - a.timeMs);
        const float t = static_cast<float>((timeMs - a.timeMs) / span);
        return CursorSample{
            timeMs,
            a.cx + (b.cx - a.cx) * t,
            a.cy + (b.cy - a.cy) * t,
            a.cursorTypeIndex,
            a.bounceScale + (b.bounceScale - a.bounceScale) * t,
        };
    }

    const CursorAtlasEntry* getCursorAtlasEntry(int cursorTypeIndex) const {
        if (!hasCursorAtlas_ || cursorAtlasWidth_ == 0 || cursorAtlasHeight_ == 0) {
            return nullptr;
        }

        const size_t index = static_cast<size_t>(
            std::min(8, std::max(0, cursorTypeIndex)));
        if (index >= cursorAtlasEntries_.size() || !cursorAtlasEntries_[index].valid) {
            return nullptr;
        }

        return &cursorAtlasEntries_[index];
    }

    void loadZoomTelemetry() {
        zoomSamples_.clear();
        if (options_.zoomTelemetryPath.empty()) {
            return;
        }

        FILE* file = nullptr;
        if (_wfopen_s(&file, options_.zoomTelemetryPath.c_str(), L"rb") != 0 || !file) {
            std::cerr << "[gpu-export] Unable to open zoom telemetry file" << std::endl;
            return;
        }

        char line[256];
        while (std::fgets(line, sizeof(line), file)) {
            double timeMs = 0.0;
            float scale = 1.0f;
            float x = 0.0f;
            float y = 0.0f;
            if (sscanf_s(line, "%lf,%f,%f,%f", &timeMs, &scale, &x, &y) != 4) {
                continue;
            }
            if (!std::isfinite(timeMs) || !std::isfinite(scale) || !std::isfinite(x) || !std::isfinite(y)) {
                continue;
            }
            zoomSamples_.push_back(ZoomSample{
                std::max(0.0, timeMs),
                std::max(0.01f, scale),
                x,
                y,
            });
        }
        std::fclose(file);

        std::sort(zoomSamples_.begin(), zoomSamples_.end(), [](const auto& left, const auto& right) {
            return left.timeMs < right.timeMs;
        });
    }

    ZoomSample getZoomSampleAt(double timeMs) const {
        if (zoomSamples_.empty()) {
            return {};
        }
        if (timeMs <= zoomSamples_.front().timeMs) {
            return zoomSamples_.front();
        }
        if (timeMs >= zoomSamples_.back().timeMs) {
            return zoomSamples_.back();
        }

        const auto upper = std::upper_bound(
            zoomSamples_.begin(),
            zoomSamples_.end(),
            timeMs,
            [](double value, const ZoomSample& sample) {
                return value < sample.timeMs;
            });
        const auto& b = *upper;
        const auto& a = *(upper - 1);
        const double span = std::max(1.0, b.timeMs - a.timeMs);
        const float t = static_cast<float>((timeMs - a.timeMs) / span);
        return ZoomSample{
            timeMs,
            a.scale + (b.scale - a.scale) * t,
            a.x + (b.x - a.x) * t,
            a.y + (b.y - a.y) * t,
        };
    }

    RECT getWebcamRect() const {
        if (!hasWebcamOverlay()) {
            return {0, 0, 0, 0};
        }

        const LONG left = std::min<LONG>(
            std::max<LONG>(0, options_.webcamLeft),
            static_cast<LONG>(options_.width) - 2);
        const LONG top = std::min<LONG>(
            std::max<LONG>(0, options_.webcamTop),
            static_cast<LONG>(options_.height) - 2);
        const LONG size = std::min<LONG>(
            options_.webcamSize & ~1L,
            std::min<LONG>(
                static_cast<LONG>(options_.width) - left,
                static_cast<LONG>(options_.height) - top));
        const LONG safeSize = std::max<LONG>(2, size);
        return {left, top, left + safeSize, top + safeSize};
    }

    RECT getContentRect() const {
        if (
            options_.contentLeft >= 0 &&
            options_.contentTop >= 0 &&
            options_.contentWidth >= 2 &&
            options_.contentHeight >= 2
        ) {
            const LONG left = std::min<LONG>(
                std::max<LONG>(0, options_.contentLeft),
                static_cast<LONG>(options_.width) - 2);
            const LONG top = std::min<LONG>(
                std::max<LONG>(0, options_.contentTop),
                static_cast<LONG>(options_.height) - 2);
            const LONG width = std::min<LONG>(
                options_.contentWidth & ~1L,
                static_cast<LONG>(options_.width) - left);
            const LONG height = std::min<LONG>(
                options_.contentHeight & ~1L,
                static_cast<LONG>(options_.height) - top);
            return {
                left,
                top,
                left + std::max<LONG>(2, width),
                top + std::max<LONG>(2, height),
            };
        }

        const double availableWidth =
            static_cast<double>(options_.width) * (1.0 - (2.0 * options_.padding));
        const double availableHeight =
            static_cast<double>(options_.height) * (1.0 - (2.0 * options_.padding));
        const double scale = std::min(
            availableWidth / static_cast<double>(sourceWidth_),
            availableHeight / static_cast<double>(sourceHeight_));
        const LONG contentWidth = static_cast<LONG>(
            std::max<UINT>(2, static_cast<UINT>(sourceWidth_ * scale) & ~1U));
        const LONG contentHeight = static_cast<LONG>(
            std::max<UINT>(2, static_cast<UINT>(sourceHeight_ * scale) & ~1U));
        const LONG x = (static_cast<LONG>(options_.width) - contentWidth) / 2;
        const LONG y = (static_cast<LONG>(options_.height) - contentHeight) / 2;
        return {x, y, x + contentWidth, y + contentHeight};
    }

    void renderSyntheticFrame(UINT frameIndex) {
        const float t = static_cast<float>(frameIndex % options_.fps) / static_cast<float>(options_.fps);
        const float color[4] = {
            0.05f + 0.45f * t,
            0.18f,
            0.42f + 0.3f * (1.0f - t),
            1.0f,
        };
        deviceContext_->ClearRenderTargetView(bgraRenderTargetView_.Get(), color);
    }

    bool convertBgraToNv12(UINT frameIndex) {
        const size_t surfaceIndex = static_cast<size_t>(frameIndex) % nv12OutputViews_.size();
        D3D11_VIDEO_PROCESSOR_STREAM stream = {};
        stream.Enable = TRUE;
        stream.OutputIndex = 0;
        stream.InputFrameOrField = 0;
        stream.PastFrames = 0;
        stream.FutureFrames = 0;
        stream.pInputSurface = bgraInputView_.Get();

        const HRESULT hr = videoContext_->VideoProcessorBlt(
            bgraVideoProcessor_.Get(),
            bgraNv12OutputViews_[surfaceIndex].Get(),
            frameIndex,
            1,
            &stream);
        if (!succeeded(hr, "VideoProcessorBlt")) {
            return false;
        }
        return true;
    }

    bool convertSourceTextureToNv12(
        ID3D11Texture2D* texture,
        UINT subresourceIndex,
        UINT frameIndex) {
        ComPtr<ID3D11VideoProcessorInputView> inputView;
        D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC inputViewDesc = {};
        inputViewDesc.FourCC = 0;
        inputViewDesc.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;
        inputViewDesc.Texture2D.MipSlice = 0;
        inputViewDesc.Texture2D.ArraySlice = subresourceIndex;

        HRESULT hr = videoDevice_->CreateVideoProcessorInputView(
            texture,
            videoProcessorEnumerator_.Get(),
            &inputViewDesc,
            &inputView);
        if (!succeeded(hr, "Create source video processor input view")) {
            return false;
        }

        const size_t surfaceIndex = static_cast<size_t>(frameIndex) % nv12OutputViews_.size();
        D3D11_VIDEO_PROCESSOR_STREAM stream = {};
        stream.Enable = TRUE;
        stream.OutputIndex = 0;
        stream.InputFrameOrField = 0;
        stream.pInputSurface = inputView.Get();

        hr = videoContext_->VideoProcessorBlt(
            videoProcessor_.Get(),
            nv12OutputViews_[surfaceIndex].Get(),
            frameIndex,
            1,
            &stream);
        if (!succeeded(hr, "VideoProcessorBlt source")) {
            return false;
        }
        return true;
    }

    bool convertSourceTextureToBgra(
        ID3D11Texture2D* texture,
        UINT subresourceIndex,
        UINT frameIndex) {
        ComPtr<ID3D11VideoProcessorInputView> inputView;
        D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC inputViewDesc = {};
        inputViewDesc.FourCC = 0;
        inputViewDesc.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;
        inputViewDesc.Texture2D.MipSlice = 0;
        inputViewDesc.Texture2D.ArraySlice = subresourceIndex;

        HRESULT hr = videoDevice_->CreateVideoProcessorInputView(
            texture,
            videoProcessorEnumerator_.Get(),
            &inputViewDesc,
            &inputView);
        if (!succeeded(hr, "Create source BGRA video processor input view")) {
            return false;
        }

        D3D11_VIDEO_PROCESSOR_STREAM stream = {};
        stream.Enable = TRUE;
        stream.OutputIndex = 0;
        stream.InputFrameOrField = 0;
        stream.pInputSurface = inputView.Get();

        hr = videoContext_->VideoProcessorBlt(
            videoProcessor_.Get(),
            contentOutputView_.Get(),
            frameIndex,
            1,
            &stream);
        if (!succeeded(hr, "VideoProcessorBlt source BGRA")) {
            return false;
        }
        return true;
    }

    bool ensureNv12UploadTexture(
        ComPtr<ID3D11Texture2D>& texture,
        UINT width,
        UINT height,
        const char* label) {
        if (texture) {
            return true;
        }

        D3D11_TEXTURE2D_DESC desc = {};
        desc.Width = width;
        desc.Height = height;
        desc.MipLevels = 1;
        desc.ArraySize = 1;
        desc.Format = DXGI_FORMAT_NV12;
        desc.SampleDesc.Count = 1;
        desc.Usage = D3D11_USAGE_DEFAULT;
        desc.BindFlags = D3D11_BIND_DECODER | D3D11_BIND_SHADER_RESOURCE;

        const HRESULT hr = device_->CreateTexture2D(&desc, nullptr, &texture);
        return succeeded(hr, label);
    }

    bool uploadNv12BufferToTexture(
        IMFMediaBuffer* buffer,
        ComPtr<ID3D11Texture2D>& texture,
        UINT width,
        UINT height,
        const char* label) {
        if (!ensureNv12UploadTexture(texture, width, height, label)) {
            return false;
        }

        const DWORD expectedLength = width * height * 3 / 2;
        ComPtr<IMF2DBuffer> buffer2D;
        HRESULT hr = buffer->QueryInterface(IID_PPV_ARGS(&buffer2D));
        if (SUCCEEDED(hr)) {
            DWORD contiguousLength = 0;
            hr = buffer2D->GetContiguousLength(&contiguousLength);
            if (SUCCEEDED(hr) && contiguousLength >= expectedLength) {
                uploadPaddedScratch_.resize(contiguousLength);
                hr = buffer2D->ContiguousCopyTo(uploadPaddedScratch_.data(), contiguousLength);
                if (!succeeded(hr, "IMF2DBuffer::ContiguousCopyTo")) {
                    return false;
                }

                const UINT nv12Rows = height + (height / 2);
                const UINT sourcePitch =
                    contiguousLength % nv12Rows == 0
                        ? contiguousLength / nv12Rows
                        : width;
                if (sourcePitch < width) {
                    std::cerr << "ERROR: Unsupported contiguous NV12 pitch." << std::endl;
                    return false;
                }

                uploadScratch_.resize(expectedLength);
                const BYTE* yPlane = uploadPaddedScratch_.data();
                const BYTE* uvPlane = uploadPaddedScratch_.data() + (sourcePitch * height);
                BYTE* yOut = uploadScratch_.data();
                BYTE* uvOut = uploadScratch_.data() + (width * height);
                for (UINT row = 0; row < height; row += 1) {
                    std::memcpy(yOut + (row * width), yPlane + (row * sourcePitch), width);
                }
                for (UINT row = 0; row < height / 2; row += 1) {
                    std::memcpy(uvOut + (row * width), uvPlane + (row * sourcePitch), width);
                }

                deviceContext_->UpdateSubresource(
                    texture.Get(),
                    0,
                    nullptr,
                    uploadScratch_.data(),
                    width,
                    expectedLength);
                return true;
            }

            BYTE* scanline0 = nullptr;
            LONG pitch = 0;
            hr = buffer2D->Lock2D(&scanline0, &pitch);
            if (!succeeded(hr, "IMF2DBuffer::Lock2D")) {
                return false;
            }
            if (pitch <= 0 || static_cast<UINT>(pitch) < width) {
                buffer2D->Unlock2D();
                std::cerr << "ERROR: Unsupported NV12 pitch." << std::endl;
                return false;
            }

            uploadScratch_.resize(expectedLength);
            const BYTE* yPlane = scanline0;
            const BYTE* uvPlane = scanline0 + (pitch * height);
            BYTE* yOut = uploadScratch_.data();
            BYTE* uvOut = uploadScratch_.data() + (width * height);
            for (UINT row = 0; row < height; row += 1) {
                std::memcpy(yOut + (row * width), yPlane + (row * pitch), width);
            }
            for (UINT row = 0; row < height / 2; row += 1) {
                std::memcpy(uvOut + (row * width), uvPlane + (row * pitch), width);
            }
            buffer2D->Unlock2D();

            deviceContext_->UpdateSubresource(
                texture.Get(),
                0,
                nullptr,
                uploadScratch_.data(),
                width,
                expectedLength);
            return true;
        }

        BYTE* data = nullptr;
        DWORD maxLength = 0;
        DWORD currentLength = 0;
        hr = buffer->Lock(&data, &maxLength, &currentLength);
        if (!succeeded(hr, "IMFMediaBuffer::Lock")) {
            return false;
        }
        if (currentLength < expectedLength) {
            buffer->Unlock();
            std::cerr << "ERROR: NV12 buffer shorter than expected." << std::endl;
            return false;
        }
        deviceContext_->UpdateSubresource(texture.Get(), 0, nullptr, data, width, expectedLength);
        buffer->Unlock();
        return true;
    }

    bool ensureBgraUploadTexture(
        ComPtr<ID3D11Texture2D>& texture,
        UINT width,
        UINT height,
        const char* label) {
        if (texture) {
            return true;
        }

        D3D11_TEXTURE2D_DESC desc = {};
        desc.Width = width;
        desc.Height = height;
        desc.MipLevels = 1;
        desc.ArraySize = 1;
        desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
        desc.SampleDesc.Count = 1;
        desc.Usage = D3D11_USAGE_DEFAULT;
        desc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;

        const HRESULT hr = device_->CreateTexture2D(&desc, nullptr, &texture);
        return succeeded(hr, label);
    }

    bool uploadBgraBufferToTexture(
        IMFMediaBuffer* buffer,
        ComPtr<ID3D11Texture2D>& texture,
        UINT width,
        UINT height,
        const char* label) {
        if (!ensureBgraUploadTexture(texture, width, height, label)) {
            return false;
        }

        const DWORD rowBytes = width * 4;
        const DWORD expectedLength = rowBytes * height;
        ComPtr<IMF2DBuffer> buffer2D;
        HRESULT hr = buffer->QueryInterface(IID_PPV_ARGS(&buffer2D));
        if (SUCCEEDED(hr)) {
            BYTE* scanline0 = nullptr;
            LONG pitch = 0;
            hr = buffer2D->Lock2D(&scanline0, &pitch);
            if (!succeeded(hr, "IMF2DBuffer::Lock2D BGRA")) {
                return false;
            }

            const LONG absPitch = pitch < 0 ? -pitch : pitch;
            if (absPitch < static_cast<LONG>(rowBytes)) {
                buffer2D->Unlock2D();
                std::cerr << "ERROR: Unsupported BGRA pitch." << std::endl;
                return false;
            }

            uploadScratch_.resize(expectedLength);
            for (UINT row = 0; row < height; row += 1) {
                const BYTE* sourceRow = pitch > 0
                    ? scanline0 + (row * pitch)
                    : scanline0 + ((height - 1 - row) * absPitch);
                std::memcpy(uploadScratch_.data() + (row * rowBytes), sourceRow, rowBytes);
            }
            buffer2D->Unlock2D();

            deviceContext_->UpdateSubresource(
                texture.Get(),
                0,
                nullptr,
                uploadScratch_.data(),
                rowBytes,
                expectedLength);
            return true;
        }

        BYTE* data = nullptr;
        DWORD maxLength = 0;
        DWORD currentLength = 0;
        hr = buffer->Lock(&data, &maxLength, &currentLength);
        if (!succeeded(hr, "IMFMediaBuffer::Lock BGRA")) {
            return false;
        }
        if (currentLength < expectedLength) {
            buffer->Unlock();
            std::cerr << "ERROR: BGRA buffer shorter than expected." << std::endl;
            return false;
        }
        deviceContext_->UpdateSubresource(
            texture.Get(),
            0,
            nullptr,
            data,
            rowBytes,
            expectedLength);
        buffer->Unlock();
        return true;
    }

    bool convertWebcamTextureToBgra(
        ID3D11Texture2D* texture,
        UINT subresourceIndex,
        UINT frameIndex) {
        ComPtr<ID3D11VideoProcessorInputView> inputView;
        D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC inputViewDesc = {};
        inputViewDesc.FourCC = 0;
        inputViewDesc.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;
        inputViewDesc.Texture2D.MipSlice = 0;
        inputViewDesc.Texture2D.ArraySlice = subresourceIndex;

        HRESULT hr = videoDevice_->CreateVideoProcessorInputView(
            texture,
            webcamVideoProcessorEnumerator_.Get(),
            &inputViewDesc,
            &inputView);
        if (!succeeded(hr, "Create webcam video processor input view")) {
            return false;
        }

        D3D11_VIDEO_PROCESSOR_STREAM stream = {};
        stream.Enable = TRUE;
        stream.OutputIndex = 0;
        stream.InputFrameOrField = 0;
        stream.pInputSurface = inputView.Get();

        hr = videoContext_->VideoProcessorBlt(
            webcamVideoProcessor_.Get(),
            webcamOutputView_.Get(),
            frameIndex,
            1,
            &stream);
        if (!succeeded(hr, "VideoProcessorBlt webcam BGRA")) {
            return false;
        }
        webcamFrameReady_ = true;
        return true;
    }

    bool convertWebcamSampleToBgra(
        IMFSample* sample,
        UINT frameIndex) {
        ComPtr<IMFMediaBuffer> buffer;
        HRESULT hr = sample->GetBufferByIndex(0, &buffer);
        if (!succeeded(hr, "IMFSample::GetBufferByIndex webcam")) {
            return false;
        }

        ComPtr<IMFDXGIBuffer> dxgiBuffer;
        hr = buffer.As(&dxgiBuffer);
        if (FAILED(hr)) {
            if (options_.preferHighPerformanceAdapter) {
                if (!uploadBgraBufferToTexture(
                        buffer.Get(),
                        webcamUploadBgraTexture_,
                        webcamWidth_,
                        webcamHeight_,
                        "Create webcam BGRA upload texture")) {
                    return false;
                }
                return convertWebcamTextureToBgra(webcamUploadBgraTexture_.Get(), 0, frameIndex);
            } else {
                if (!uploadNv12BufferToTexture(
                        buffer.Get(),
                        webcamUploadTexture_,
                        webcamWidth_,
                        webcamHeight_,
                        "Create webcam NV12 upload texture")) {
                    return false;
                }
                return convertWebcamTextureToBgra(webcamUploadTexture_.Get(), 0, frameIndex);
            }
        }

        ComPtr<ID3D11Texture2D> webcamTexture;
        hr = dxgiBuffer->GetResource(IID_PPV_ARGS(&webcamTexture));
        if (!succeeded(hr, "IMFDXGIBuffer::GetResource webcam")) {
            return false;
        }
        UINT subresourceIndex = 0;
        dxgiBuffer->GetSubresourceIndex(&subresourceIndex);
        return convertWebcamTextureToBgra(webcamTexture.Get(), subresourceIndex, frameIndex);
    }

    bool readWebcamFrameForTimestamp(LONGLONG outputTimestamp, UINT frameIndex) {
        if (!hasWebcamOverlay() || webcamEnded_) {
            return true;
        }

        const LONGLONG targetTimestamp = std::max<LONGLONG>(
            0,
            outputTimestamp - static_cast<LONGLONG>(options_.webcamTimeOffsetMs * 10'000.0));

        if (pendingWebcamSample_) {
            const LONGLONG pendingTimestamp = std::max<LONGLONG>(
                0,
                pendingWebcamTimestamp_ - webcamFirstTimestamp_);
            if (pendingTimestamp > targetTimestamp && webcamFrameReady_) {
                return true;
            }
            if (!convertWebcamSampleToBgra(pendingWebcamSample_.Get(), frameIndex)) {
                return false;
            }
            pendingWebcamSample_.Reset();
            if (pendingTimestamp >= targetTimestamp) {
                return true;
            }
        }

        while (true) {
            DWORD streamIndex = 0;
            DWORD flags = 0;
            LONGLONG timestamp = 0;
            ComPtr<IMFSample> sample;

            const HRESULT hr = webcamReader_->ReadSample(
                firstVideoStreamIndex(),
                0,
                &streamIndex,
                &flags,
                &timestamp,
                &sample);
            if (!succeeded(hr, "IMFSourceReader::ReadSample webcam")) {
                return false;
            }
            if (flags & MF_SOURCE_READERF_ENDOFSTREAM) {
                webcamEnded_ = true;
                return true;
            }
            if (!sample) {
                return true;
            }
            if (webcamFirstTimestamp_ < 0) {
                webcamFirstTimestamp_ = timestamp;
            }

            const LONGLONG adjustedTimestamp = std::max<LONGLONG>(
                0,
                timestamp - webcamFirstTimestamp_);
            if (adjustedTimestamp > targetTimestamp && webcamFrameReady_) {
                pendingWebcamSample_ = sample;
                pendingWebcamTimestamp_ = timestamp;
                return true;
            }
            if (!convertWebcamSampleToBgra(sample.Get(), frameIndex)) {
                return false;
            }
            if (adjustedTimestamp >= targetTimestamp) {
                return true;
            }
        }
    }

    bool renderShaderComposite(LONGLONG outputTimestamp) {
        const RECT contentRect = getContentRect();
        const RECT webcamRect = getWebcamRect();
        const bool webcamEnabled = hasWebcamOverlay() && webcamFrameReady_;
        const bool cursorEnabled = hasCursorOverlay();
        const bool zoomEnabled = hasZoomOverlay();
        const ZoomSample zoom = zoomEnabled
            ? getZoomSampleAt(static_cast<double>(outputTimestamp) / 10'000.0)
            : ZoomSample{};
        const CursorSample cursor = cursorEnabled
            ? getCursorSampleAt(static_cast<double>(outputTimestamp) / 10'000.0)
            : CursorSample{};
        const CursorAtlasEntry* cursorAtlasEntry = cursorEnabled
            ? getCursorAtlasEntry(cursor.cursorTypeIndex)
            : nullptr;
        const bool cursorAtlasEnabled = cursorAtlasEntry != nullptr;
        const float cursorX = cursorEnabled
            ? static_cast<float>(contentRect.left) +
                cursor.cx * static_cast<float>(contentRect.right - contentRect.left)
            : 0.0f;
        const float cursorY = cursorEnabled
            ? static_cast<float>(contentRect.top) +
                cursor.cy * static_cast<float>(contentRect.bottom - contentRect.top)
            : 0.0f;
        const ShaderConstants constants = {
            static_cast<float>(options_.width),
            static_cast<float>(options_.height),
            std::min(options_.radius, static_cast<float>(
                std::min(contentRect.right - contentRect.left, contentRect.bottom - contentRect.top)) * 0.5f),
            options_.shadow,
            static_cast<float>(contentRect.left),
            static_cast<float>(contentRect.top),
            static_cast<float>(contentRect.right),
            static_cast<float>(contentRect.bottom),
            options_.backgroundR,
            options_.backgroundG,
            options_.backgroundB,
            1.0f,
            0.0f,
            0.0f,
            0.0f,
            0.42f,
            hasBackgroundImage_ ? 1.0f : 0.0f,
            static_cast<float>(backgroundImageWidth_),
            static_cast<float>(backgroundImageHeight_),
            webcamEnabled ? 1.0f : 0.0f,
            static_cast<float>(webcamRect.left),
            static_cast<float>(webcamRect.top),
            static_cast<float>(webcamRect.right),
            static_cast<float>(webcamRect.bottom),
            webcamEnabled ? std::min(options_.webcamRadius, static_cast<float>(
                std::min(webcamRect.right - webcamRect.left, webcamRect.bottom - webcamRect.top)) * 0.5f) : 0.0f,
            webcamEnabled ? options_.webcamShadow : 0.0f,
            webcamEnabled ? 0.42f : 0.0f,
            options_.webcamMirror ? 1.0f : 0.0f,
            cursorEnabled ? 1.0f : 0.0f,
            cursorX,
            cursorY,
            options_.cursorSize,
            cursorAtlasEnabled ? 1.0f : 0.0f,
            cursorAtlasEnabled
                ? cursorAtlasEntry->x / static_cast<float>(cursorAtlasWidth_)
                : 0.0f,
            cursorAtlasEnabled
                ? cursorAtlasEntry->y / static_cast<float>(cursorAtlasHeight_)
                : 0.0f,
            cursorAtlasEnabled
                ? (cursorAtlasEntry->x + cursorAtlasEntry->width) /
                    static_cast<float>(cursorAtlasWidth_)
                : 1.0f,
            cursorAtlasEnabled
                ? (cursorAtlasEntry->y + cursorAtlasEntry->height) /
                    static_cast<float>(cursorAtlasHeight_)
                : 1.0f,
            cursorAtlasEnabled ? cursorAtlasEntry->anchorX : 0.0f,
            cursorAtlasEnabled ? cursorAtlasEntry->anchorY : 0.0f,
            cursorAtlasEnabled ? cursorAtlasEntry->aspectRatio : 1.0f,
            cursorEnabled ? cursor.bounceScale : 1.0f,
            hasBackgroundImage_ ? options_.backgroundBlurPx : 0.0f,
            0.0f,
            0.0f,
            zoomEnabled ? 1.0f : 0.0f,
            zoomEnabled ? zoom.scale : 1.0f,
            zoomEnabled ? zoom.x : 0.0f,
            zoomEnabled ? zoom.y : 0.0f,
        };

        deviceContext_->UpdateSubresource(compositorConstants_.Get(), 0, nullptr, &constants, 0, 0);

        const float clearColor[4] = {constants.backgroundR, constants.backgroundG, constants.backgroundB, 1.0f};
        deviceContext_->ClearRenderTargetView(bgraRenderTargetView_.Get(), clearColor);

        D3D11_VIEWPORT viewport = {};
        viewport.Width = static_cast<float>(options_.width);
        viewport.Height = static_cast<float>(options_.height);
        viewport.MinDepth = 0.0f;
        viewport.MaxDepth = 1.0f;

        ID3D11RenderTargetView* renderTargets[] = {bgraRenderTargetView_.Get()};
        deviceContext_->OMSetRenderTargets(1, renderTargets, nullptr);
        deviceContext_->RSSetViewports(1, &viewport);
        deviceContext_->IASetInputLayout(nullptr);
        deviceContext_->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
        deviceContext_->VSSetShader(vertexShader_.Get(), nullptr, 0);
        deviceContext_->PSSetShader(pixelShader_.Get(), nullptr, 0);
        ID3D11Buffer* constantBuffers[] = {compositorConstants_.Get()};
        deviceContext_->PSSetConstantBuffers(0, 1, constantBuffers);
        ID3D11ShaderResourceView* shaderResources[] = {
            contentShaderResourceView_.Get(),
            backgroundShaderResourceView_.Get(),
            webcamShaderResourceView_ ? webcamShaderResourceView_.Get() : contentShaderResourceView_.Get(),
            cursorAtlasShaderResourceView_
                ? cursorAtlasShaderResourceView_.Get()
                : backgroundShaderResourceView_.Get(),
        };
        deviceContext_->PSSetShaderResources(0, 4, shaderResources);
        ID3D11SamplerState* samplers[] = {samplerState_.Get()};
        deviceContext_->PSSetSamplers(0, 1, samplers);
        deviceContext_->Draw(3, 0);

        ID3D11ShaderResourceView* nullResources[] = {nullptr, nullptr, nullptr, nullptr};
        deviceContext_->PSSetShaderResources(0, 4, nullResources);
        return true;
    }

    bool writeNvencSdkPackets(const std::vector<std::vector<uint8_t>>& packets) {
        if (!nvencOutputFile_) {
            return false;
        }
        for (const auto& packet : packets) {
            if (packet.empty()) {
                continue;
            }
            const size_t written = std::fwrite(packet.data(), 1, packet.size(), nvencOutputFile_);
            if (written != packet.size()) {
                std::cerr << "[gpu-export] Failed to write NVENC SDK packet" << std::endl;
                return false;
            }
            nvencOutputBytes_ += packet.size();
        }
        return true;
    }

    bool writeNvencSdkFrame(UINT frameIndex) {
#ifdef RECORDLY_GPU_EXPORT_ENABLE_NVENC_SDK
        if (!nvencEncoder_) {
            std::cerr << "[gpu-export] NVENC SDK encoder is not initialized" << std::endl;
            return false;
        }
        try {
            const size_t surfaceIndex = static_cast<size_t>(frameIndex) % nv12Textures_.size();
            const NvEncInputFrame* inputFrame = nvencEncoder_->GetNextInputFrame();
            auto* encoderTexture = reinterpret_cast<ID3D11Texture2D*>(inputFrame->inputPtr);
            deviceContext_->CopyResource(encoderTexture, nv12Textures_[surfaceIndex].Get());
            deviceContext_->Flush();

            std::vector<std::vector<uint8_t>> packets;
            nvencEncoder_->EncodeFrame(packets);
            return writeNvencSdkPackets(packets);
        } catch (const std::exception& error) {
            std::cerr << "[gpu-export] NVENC SDK encode failed: " << error.what() << std::endl;
            return false;
        }
#else
        (void)frameIndex;
        return false;
#endif
    }

    bool finalizeNvencSdk() {
#ifdef RECORDLY_GPU_EXPORT_ENABLE_NVENC_SDK
        if (!nvencEncoder_) {
            return true;
        }
        try {
            std::vector<std::vector<uint8_t>> packets;
            nvencEncoder_->EndEncode(packets);
            if (!writeNvencSdkPackets(packets)) {
                return false;
            }
            nvencEncoder_->DestroyEncoder();
            nvencEncoder_.reset();
            if (nvencOutputFile_) {
                std::fclose(nvencOutputFile_);
                nvencOutputFile_ = nullptr;
            }
            return true;
        } catch (const std::exception& error) {
            std::cerr << "[gpu-export] NVENC SDK finalize failed: " << error.what() << std::endl;
            return false;
        }
#else
        return false;
#endif
    }

    bool writeFrame(
        UINT frameIndex,
        LONGLONG sampleTimeOverride = -1,
        LONGLONG sampleDurationOverride = -1) {
        if (options_.nvencSdk) {
            return writeNvencSdkFrame(frameIndex);
        }

        const size_t surfaceIndex = static_cast<size_t>(frameIndex) % nv12Textures_.size();
        ComPtr<IMFMediaBuffer> buffer;
        HRESULT hr = MFCreateDXGISurfaceBuffer(
            __uuidof(ID3D11Texture2D),
            nv12Textures_[surfaceIndex].Get(),
            0,
            FALSE,
            &buffer);
        if (!succeeded(hr, "MFCreateDXGISurfaceBuffer")) {
            return false;
        }
        const DWORD nv12ByteLength = options_.width * options_.height * 3 / 2;
        hr = buffer->SetCurrentLength(nv12ByteLength);
        if (!succeeded(hr, "IMFMediaBuffer::SetCurrentLength")) {
            return false;
        }

        ComPtr<IMFSample> sample;
        hr = MFCreateSample(&sample);
        if (!succeeded(hr, "MFCreateSample")) {
            return false;
        }
        hr = sample->AddBuffer(buffer.Get());
        if (!succeeded(hr, "IMFSample::AddBuffer")) {
            return false;
        }

        const LONGLONG defaultSampleTime =
            static_cast<LONGLONG>(frameIndex) * 10'000'000LL / options_.fps;
        const LONGLONG defaultSampleDuration = 10'000'000LL / options_.fps;
        const LONGLONG sampleTime =
            sampleTimeOverride >= 0 ? sampleTimeOverride : defaultSampleTime;
        const LONGLONG sampleDuration =
            sampleDurationOverride > 0 ? sampleDurationOverride : defaultSampleDuration;
        sample->SetSampleTime(sampleTime);
        sample->SetSampleDuration(sampleDuration);

        hr = sinkWriter_->WriteSample(streamIndex_, sample.Get());
        return succeeded(hr, "IMFSinkWriter::WriteSample");
    }

    bool runSourceVideo() {
        const UINT maxFrames = std::max(
            static_cast<UINT>(std::ceil(static_cast<double>(options_.fps) * options_.seconds * 4.0)),
            static_cast<UINT>(std::ceil(options_.seconds * 240.0)));
        const Timer totalTimer;
        double readMs = 0;
        double processMs = 0;
        double writeMs = 0;
        UINT frameIndex = 0;
        bool sawDxgiSurface = false;
        LONGLONG firstSourceTimestamp = -1;
        LONGLONG lastOutputTimestamp = 0;
        const LONGLONG maxOutputTimestamp =
            static_cast<LONGLONG>(options_.seconds * 10'000'000.0);
        const LONGLONG outputFrameDuration = 10'000'000LL / options_.fps;
        LONGLONG nextOutputTimestamp = 0;
        const UINT expectedOutputFrames = std::max<UINT>(
            1,
            static_cast<UINT>(std::ceil(options_.seconds * static_cast<double>(options_.fps))));

        while (frameIndex < maxFrames && frameIndex < expectedOutputFrames) {
            DWORD streamIndex = 0;
            DWORD flags = 0;
            LONGLONG timestamp = 0;
            ComPtr<IMFSample> sample;

            const Timer readTimer;
            HRESULT hr = sourceReader_->ReadSample(
                firstVideoStreamIndex(),
                0,
                &streamIndex,
                &flags,
                &timestamp,
                &sample);
            readMs += readTimer.elapsedMs();
            if (!succeeded(hr, "IMFSourceReader::ReadSample")) {
                return false;
            }
            if (flags & MF_SOURCE_READERF_ENDOFSTREAM) {
                break;
            }
            if (!sample) {
                continue;
            }
            if (firstSourceTimestamp < 0) {
                firstSourceTimestamp = timestamp;
            }
            const LONGLONG sourceTimestamp = std::max<LONGLONG>(0, timestamp - firstSourceTimestamp);
            const double sourceTimestampMs = static_cast<double>(sourceTimestamp) / 10'000.0;
            double mappedOutputMs = sourceTimestampMs;
            if (!sourceToOutputMs(timelineSegments_, mappedOutputMs, mappedOutputMs)) {
                continue;
            }
            const LONGLONG outputTimestamp =
                static_cast<LONGLONG>(std::llround(mappedOutputMs * 10'000.0));
            if (
                (timelineSegments_.empty() && outputTimestamp >= maxOutputTimestamp) ||
                (!timelineSegments_.empty() && outputTimestamp > maxOutputTimestamp + outputFrameDuration)
            ) {
                break;
            }
            const LONGLONG sampleWindowEnd = outputTimestamp + (outputFrameDuration / 2);
            const bool timelineSampleNearEnd =
                !timelineSegments_.empty() &&
                sourceTimestampMs >=
                    (timelineSegments_.back().sourceEndMs - std::max(1.0, 2000.0 / options_.fps));
            const UINT expectedFramesForSample = timelineSegments_.empty()
                ? expectedOutputFrames
                : timelineSampleNearEnd
                    ? expectedOutputFrames
                : std::min<UINT>(
                    expectedOutputFrames,
                    static_cast<UINT>(std::floor(
                        (static_cast<double>(outputTimestamp) / 10'000'000.0) *
                        static_cast<double>(options_.fps))) + 1);
            if (sampleWindowEnd < nextOutputTimestamp) {
                continue;
            }

            ComPtr<IMFMediaBuffer> buffer;
            hr = sample->GetBufferByIndex(0, &buffer);
            if (!succeeded(hr, "IMFSample::GetBufferByIndex")) {
                return false;
            }

            ComPtr<IMFDXGIBuffer> dxgiBuffer;
            hr = buffer.As(&dxgiBuffer);
            if (FAILED(hr)) {
                ID3D11Texture2D* uploadedSourceTexture = nullptr;
                if (options_.preferHighPerformanceAdapter) {
                    if (!uploadBgraBufferToTexture(
                            buffer.Get(),
                            sourceUploadBgraTexture_,
                            sourceWidth_,
                            sourceHeight_,
                            "Create source BGRA upload texture")) {
                        return false;
                    }
                    uploadedSourceTexture = sourceUploadBgraTexture_.Get();
                } else {
                    if (!uploadNv12BufferToTexture(
                            buffer.Get(),
                            sourceUploadTexture_,
                            sourceWidth_,
                            sourceHeight_,
                            "Create source NV12 upload texture")) {
                        return false;
                    }
                    uploadedSourceTexture = sourceUploadTexture_.Get();
                }

                while (
                    frameIndex < maxFrames &&
                    frameIndex < expectedOutputFrames &&
                    (
                        timelineSegments_.empty()
                            ? (nextOutputTimestamp <= sampleWindowEnd &&
                               nextOutputTimestamp < maxOutputTimestamp)
                            : (frameIndex < expectedFramesForSample)
                    )
                ) {
                    const LONGLONG overlayTimestamp = timelineSegments_.empty()
                        ? nextOutputTimestamp
                        : static_cast<LONGLONG>(std::llround(
                            outputToSourceMs(
                                timelineSegments_,
                                static_cast<double>(nextOutputTimestamp) / 10'000.0) *
                            10'000.0));
                    const Timer processTimer;
                    if (options_.shaderComposite) {
                        if (!convertSourceTextureToBgra(uploadedSourceTexture, 0, frameIndex)) {
                            return false;
                        }
                        if (!readWebcamFrameForTimestamp(overlayTimestamp, frameIndex)) {
                            return false;
                        }
                        if (!renderShaderComposite(overlayTimestamp)) {
                            return false;
                        }
                        if (!convertBgraToNv12(frameIndex)) {
                            return false;
                        }
                    } else if (!convertSourceTextureToNv12(uploadedSourceTexture, 0, frameIndex)) {
                        return false;
                    }
                    processMs += processTimer.elapsedMs();

                    const Timer writeTimer;
                    lastOutputTimestamp = nextOutputTimestamp;
                    if (!writeFrame(frameIndex, nextOutputTimestamp, outputFrameDuration)) {
                        return false;
                    }
                    writeMs += writeTimer.elapsedMs();
                    frameIndex++;
                    nextOutputTimestamp += outputFrameDuration;
                    emitProgress(std::min(frameIndex, expectedOutputFrames), expectedOutputFrames);
                }

                continue;
            }
            sawDxgiSurface = true;

            ComPtr<ID3D11Texture2D> sourceTexture;
            hr = dxgiBuffer->GetResource(IID_PPV_ARGS(&sourceTexture));
            if (!succeeded(hr, "IMFDXGIBuffer::GetResource")) {
                return false;
            }
            UINT subresourceIndex = 0;
            dxgiBuffer->GetSubresourceIndex(&subresourceIndex);

            while (
                frameIndex < maxFrames &&
                frameIndex < expectedOutputFrames &&
                (
                    timelineSegments_.empty()
                        ? (nextOutputTimestamp <= sampleWindowEnd &&
                           nextOutputTimestamp < maxOutputTimestamp)
                        : (frameIndex < expectedFramesForSample)
                )
            ) {
                const LONGLONG overlayTimestamp = timelineSegments_.empty()
                    ? nextOutputTimestamp
                    : static_cast<LONGLONG>(std::llround(
                        outputToSourceMs(
                            timelineSegments_,
                            static_cast<double>(nextOutputTimestamp) / 10'000.0) *
                        10'000.0));
                const Timer processTimer;
                if (options_.shaderComposite) {
                    if (!convertSourceTextureToBgra(sourceTexture.Get(), subresourceIndex, frameIndex)) {
                        return false;
                    }
                    if (!readWebcamFrameForTimestamp(overlayTimestamp, frameIndex)) {
                        return false;
                    }
                    if (!renderShaderComposite(overlayTimestamp)) {
                        return false;
                    }
                    if (!convertBgraToNv12(frameIndex)) {
                        return false;
                    }
                } else {
                    if (!convertSourceTextureToNv12(sourceTexture.Get(), subresourceIndex, frameIndex)) {
                        return false;
                    }
                }
                processMs += processTimer.elapsedMs();

                const Timer writeTimer;
                lastOutputTimestamp = nextOutputTimestamp;
                if (!writeFrame(frameIndex, nextOutputTimestamp, outputFrameDuration)) {
                    return false;
                }
                writeMs += writeTimer.elapsedMs();
                ++frameIndex;
                emitProgress(std::min(frameIndex, expectedOutputFrames), expectedOutputFrames);
                nextOutputTimestamp += outputFrameDuration;
            }
        }
        emitProgress(std::min(frameIndex, expectedOutputFrames), expectedOutputFrames, true);

        const Timer finalizeTimer;
        const bool finalized = options_.nvencSdk ? finalizeNvencSdk() : SUCCEEDED(sinkWriter_->Finalize());
        const double finalizeMs = finalizeTimer.elapsedMs();
        if (!finalized) {
            if (!options_.nvencSdk) {
                std::cerr << "ERROR: IMFSinkWriter::Finalize failed" << std::endl;
            }
            return false;
        }

        const double totalMs = totalTimer.elapsedMs();
        const double mediaMs =
            (static_cast<double>(lastOutputTimestamp) / 10'000.0) +
            (1000.0 / static_cast<double>(options_.fps));
        const double realtime = mediaMs / totalMs;
        std::cout
            << "{"
            << "\"success\":true,"
            << "\"mode\":\"source-video\","
            << "\"shaderComposite\":" << (options_.shaderComposite ? "true" : "false") << ","
            << "\"webcamOverlay\":" << (hasWebcamOverlay() ? "true" : "false") << ","
            << "\"cursorOverlay\":" << (hasCursorOverlay() ? "true" : "false") << ","
            << "\"cursorAtlas\":" << (hasCursorAtlas_ ? "true" : "false") << ","
            << "\"zoomOverlay\":" << (hasZoomOverlay() ? "true" : "false") << ","
            << "\"timelineMap\":" << (!timelineSegments_.empty() ? "true" : "false") << ","
            << "\"timelineSegments\":" << timelineSegments_.size() << ","
            << "\"gpuDecodeSurface\":" << (sawDxgiSurface ? "true" : "false") << ","
            << "\"sourceWidth\":" << sourceWidth_ << ","
            << "\"sourceHeight\":" << sourceHeight_ << ","
            << "\"width\":" << options_.width << ","
            << "\"height\":" << options_.height << ","
            << "\"fps\":" << options_.fps << ","
            << "\"surfacePoolSize\":" << options_.surfacePoolSize << ","
            << "\"adapterIndex\":" << selectedAdapterIndex_ << ","
            << "\"adapterVendorId\":" << selectedAdapterVendorId_ << ","
            << "\"adapterDeviceId\":" << selectedAdapterDeviceId_ << ","
            << "\"adapterDedicatedVideoMemoryMB\":" << selectedAdapterDedicatedVideoMemoryMB_ << ","
            << "\"frames\":" << frameIndex << ","
            << "\"mediaMs\":" << mediaMs << ","
            << "\"initializeMs\":" << initializeMs_ << ","
            << "\"initCoInitializeMs\":" << initCoInitializeMs_ << ","
            << "\"initMfStartupMs\":" << initMfStartupMs_ << ","
            << "\"initD3DDeviceMs\":" << initD3DDeviceMs_ << ","
            << "\"initSourceReaderMs\":" << initSourceReaderMs_ << ","
            << "\"initWebcamReaderMs\":" << initWebcamReaderMs_ << ","
            << "\"initVideoProcessorMs\":" << initVideoProcessorMs_ << ","
            << "\"initTexturesMs\":" << initTexturesMs_ << ","
            << "\"initShaderPipelineMs\":" << initShaderPipelineMs_ << ","
            << "\"initSinkWriterMs\":" << initSinkWriterMs_ << ","
            << "\"encoderBackend\":\"" << (options_.nvencSdk ? "nvenc-sdk-d3d11" : "media-foundation") << "\","
            << "\"encoderTuningApplied\":" << (encoderTuningApplied_ ? "true" : "false") << ","
            << "\"nvencOutputBytes\":" << nvencOutputBytes_ << ","
            << "\"totalMs\":" << totalMs << ","
            << "\"readMs\":" << readMs << ","
            << "\"videoProcessMs\":" << processMs << ","
            << "\"writeSampleMs\":" << writeMs << ","
            << "\"finalizeMs\":" << finalizeMs << ","
            << "\"realtimeMultiplier\":" << realtime
            << "}" << std::endl;
        return true;
    }

    Options options_;
    UINT sourceWidth_ = 1920;
    UINT sourceHeight_ = 1080;
    double initializeMs_ = 0.0;
    double initCoInitializeMs_ = 0.0;
    double initMfStartupMs_ = 0.0;
    double initD3DDeviceMs_ = 0.0;
    double initSourceReaderMs_ = 0.0;
    double initWebcamReaderMs_ = 0.0;
    double initVideoProcessorMs_ = 0.0;
    double initTexturesMs_ = 0.0;
    double initShaderPipelineMs_ = 0.0;
    double initSinkWriterMs_ = 0.0;
    UINT selectedAdapterVendorId_ = 0;
    UINT selectedAdapterDeviceId_ = 0;
    UINT64 selectedAdapterDedicatedVideoMemoryMB_ = 0;
    int selectedAdapterIndex_ = -1;
    bool coInitialized_ = false;
    bool mfStarted_ = false;
    DWORD streamIndex_ = 0;
    ComPtr<ID3D11Device> device_;
    ComPtr<ID3D11DeviceContext> deviceContext_;
    ComPtr<ID3D11VideoDevice> videoDevice_;
    ComPtr<ID3D11VideoContext> videoContext_;
    ComPtr<IMFDXGIDeviceManager> deviceManager_;
    ComPtr<IMFSourceReader> sourceReader_;
    ComPtr<IMFSourceReader> webcamReader_;
    ComPtr<ID3D11VideoProcessorEnumerator> videoProcessorEnumerator_;
    ComPtr<ID3D11VideoProcessor> videoProcessor_;
    ComPtr<ID3D11VideoProcessorEnumerator> bgraVideoProcessorEnumerator_;
    ComPtr<ID3D11VideoProcessor> bgraVideoProcessor_;
    ComPtr<ID3D11VideoProcessorEnumerator> webcamVideoProcessorEnumerator_;
    ComPtr<ID3D11VideoProcessor> webcamVideoProcessor_;
    ComPtr<ID3D11Texture2D> bgraTexture_;
    ComPtr<ID3D11RenderTargetView> bgraRenderTargetView_;
    ComPtr<ID3D11VideoProcessorInputView> bgraInputView_;
    ComPtr<ID3D11Texture2D> contentTexture_;
    ComPtr<ID3D11VideoProcessorOutputView> contentOutputView_;
    ComPtr<ID3D11ShaderResourceView> contentShaderResourceView_;
    ComPtr<ID3D11Texture2D> webcamTexture_;
    ComPtr<ID3D11VideoProcessorOutputView> webcamOutputView_;
    ComPtr<ID3D11ShaderResourceView> webcamShaderResourceView_;
    ComPtr<ID3D11ShaderResourceView> backgroundShaderResourceView_;
    ComPtr<ID3D11ShaderResourceView> cursorAtlasShaderResourceView_;
    ComPtr<ID3D11VertexShader> vertexShader_;
    ComPtr<ID3D11PixelShader> pixelShader_;
    ComPtr<ID3D11SamplerState> samplerState_;
    ComPtr<ID3D11Buffer> compositorConstants_;
    UINT backgroundImageWidth_ = 1;
    UINT backgroundImageHeight_ = 1;
    bool hasBackgroundImage_ = false;
    UINT cursorAtlasWidth_ = 1;
    UINT cursorAtlasHeight_ = 1;
    bool hasCursorAtlas_ = false;
    std::array<CursorAtlasEntry, 9> cursorAtlasEntries_;
    UINT webcamWidth_ = 640;
    UINT webcamHeight_ = 480;
    bool webcamFrameReady_ = false;
    bool webcamEnded_ = false;
    LONGLONG webcamFirstTimestamp_ = -1;
    LONGLONG pendingWebcamTimestamp_ = 0;
    ComPtr<IMFSample> pendingWebcamSample_;
    std::vector<CursorSample> cursorSamples_;
    std::vector<ZoomSample> zoomSamples_;
    ComPtr<ID3D11Texture2D> sourceUploadTexture_;
    ComPtr<ID3D11Texture2D> webcamUploadTexture_;
    ComPtr<ID3D11Texture2D> sourceUploadBgraTexture_;
    ComPtr<ID3D11Texture2D> webcamUploadBgraTexture_;
    std::vector<BYTE> uploadScratch_;
    std::vector<BYTE> uploadPaddedScratch_;
    std::vector<TimelineSegment> timelineSegments_;
    std::vector<ComPtr<ID3D11Texture2D>> nv12Textures_;
    std::vector<ComPtr<ID3D11VideoProcessorOutputView>> nv12OutputViews_;
    std::vector<ComPtr<ID3D11VideoProcessorOutputView>> bgraNv12OutputViews_;
    ComPtr<IMFSinkWriter> sinkWriter_;
#ifdef RECORDLY_GPU_EXPORT_ENABLE_NVENC_SDK
    std::unique_ptr<NvEncoderD3D11> nvencEncoder_;
#endif
    FILE* nvencOutputFile_ = nullptr;
    uint64_t nvencOutputBytes_ = 0;
    bool encoderTuningApplied_ = false;
};

} // namespace

int wmain(int argc, wchar_t** argv) {
    const Options options = parseOptions(argc, argv);
    GpuProbe probe;
    if (!probe.initialize(options)) {
        std::cerr << "{\"success\":false,\"phase\":\"initialize\"}" << std::endl;
        return 1;
    }
    if (!probe.run()) {
        std::cerr << "{\"success\":false,\"phase\":\"run\"}" << std::endl;
        return 1;
    }
    return 0;
}
