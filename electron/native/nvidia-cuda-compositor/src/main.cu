#include <cuda.h>
#include <cuda_runtime.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <deque>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <memory>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#include "NvDecoder/NvDecoder.h"
#include "NvEncoder/NvEncoderCuda.h"
#include "Utils/Logger.h"

simplelogger::Logger* logger = simplelogger::LoggerFactory::CreateConsoleLogger(ERROR);

namespace {

struct TimelineSegment {
    double sourceStartMs = 0.0;
    double sourceEndMs = 0.0;
    double outputStartMs = 0.0;
    double outputEndMs = 0.0;
    double speed = 1.0;
};

// Renderer-prepared transparent RGBA overlay sidecar layer. The sidecar is a
// raw top-down RGBA stream with frameCount frames of width*height*4 bytes at
// the export frame rate. Layers are composited in the order they appear in
// options.overlayLayers (z-order) after the video layout and zoom blur, which
// matches the renderer contract (overlays are drawn above the blurred video).
struct OverlayLayerDescriptor {
    std::string path;
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;
    int frameCount = 0;
};

enum class OutputCodec {
    H264,
    HEVC,
};

struct Options {
    std::string inputPath;
    std::string outputPath = "recordly-nvidia-cuda-compositor.h264";
    OutputCodec outputCodec = OutputCodec::H264;
    std::string sourcePtsPath;
    std::string timelineMapPath;
    std::vector<TimelineSegment> timelineSegments;
    int width = 0;
    int height = 0;
    int fps = 30;
    int maxFrames = 0;
    int inputFrames = 0;
    int targetFrames = 0;
    int bitrateMbps = 18;
    std::string encodingMode = "balanced";
    bool postSelect = false;
    bool callbackEncode = false;
    bool streamSync = false;
    int prewarmMs = 0;
    int chunkMb = 4;
    int contentX = 0;
    int contentY = 0;
    int contentWidth = 0;
    int contentHeight = 0;
    int sourceCropX = 0;
    int sourceCropY = 0;
    int sourceCropWidth = 0;
    int sourceCropHeight = 0;
    int radius = 0;
    int backgroundY = 16;
    int backgroundU = 128;
    int backgroundV = 128;
    std::string backgroundNv12Path;
    int shadowOffsetY = 0;
    int shadowIntensityPct = 0;
    std::string webcamNv12Path;
    std::string webcamAnnexbPath;
    int webcamInputFrames = 0;
    int webcamTargetFrames = 0;
    double webcamSourceDurationMs = 0.0;
    int webcamSourceWidth = 0;
    int webcamSourceHeight = 0;
    int webcamX = 0;
    int webcamY = 0;
    int webcamSize = 0;
    int webcamRadius = 0;
    double webcamTimeOffsetMs = 0.0;
    bool webcamMirror = false;
    std::string cursorSamplesPath;
    int cursorHeight = 0;
    std::string cursorAtlasRgbaPath;
    std::string cursorAtlasMetadataPath;
    int cursorAtlasWidth = 0;
    int cursorAtlasHeight = 0;
    std::string zoomSamplesPath;
    // Renderer-resolved temporal zoom motion blur plan (see temporalMotionBlur.ts):
    // the compositor derives per-frame sample offsets/weights from these three
    // values plus the output frame duration. 0 sample count disables temporal
    // blur so the existing spatial blur telemetry path is used.
    int temporalBlurSampleCount = 0;
    double temporalBlurShutterFraction = 0.0;
    double temporalBlurWeightPower = 1.0;
    std::vector<OverlayLayerDescriptor> overlayLayers;
};

constexpr int kMaxCursorAtlasEntries = 16;
constexpr int kWebcamPrefetchOutputFrames = 900;
// Bounded overlay frame ring: slots are keyed by the clamped frame index so
// single-frame layers and tail-repeated frames are read from disk once and
// served from the device slot for every following output frame. Two slots of
// head room give a two-frame read-ahead without unbounded memory; the depth is
// always prefetchSlots - 2 so the ring never overwrites the slot the current
// blend is reading.
constexpr int kOverlayPrefetchSlots = 4;
constexpr int kOverlayPrefetchDepth = kOverlayPrefetchSlots - 2;

[[noreturn]] void fail(const std::string& message) {
    throw std::runtime_error(message);
}

const char* outputCodecName(OutputCodec codec) {
    return codec == OutputCodec::HEVC ? "hevc" : "h264";
}

OutputCodec parseOutputCodec(const char* value) {
    const std::string codec = value;
    if (codec == "h264") {
        return OutputCodec::H264;
    }
    if (codec == "hevc") {
        return OutputCodec::HEVC;
    }
    fail("Unsupported --output-codec: " + codec + "; expected h264 or hevc");
}

void checkCuda(cudaError_t status, const char* expression) {
    if (status != cudaSuccess) {
        std::ostringstream stream;
        stream << expression << " failed: " << cudaGetErrorString(status);
        fail(stream.str());
    }
}

void checkCu(CUresult status, const char* expression) {
    if (status != CUDA_SUCCESS) {
        const char* name = nullptr;
        const char* message = nullptr;
        cuGetErrorName(status, &name);
        cuGetErrorString(status, &message);
        std::ostringstream stream;
        stream << expression << " failed: " << (name ? name : "CUDA_ERROR")
               << " (" << (message ? message : "no detail") << ")";
        fail(stream.str());
    }
}

int parsePositiveInt(const char* value, const char* name) {
    char* end = nullptr;
    const long parsed = std::strtol(value, &end, 10);
    if (!end || *end != '\0' || parsed <= 0 || parsed > 1000000) {
        std::ostringstream stream;
        stream << "Invalid " << name << ": " << value;
        fail(stream.str());
    }
    return static_cast<int>(parsed);
}

int parseNonNegativeInt(const char* value, const char* name) {
    char* end = nullptr;
    const long parsed = std::strtol(value, &end, 10);
    if (!end || *end != '\0' || parsed < 0 || parsed > 1000000) {
        std::ostringstream stream;
        stream << "Invalid " << name << ": " << value;
        fail(stream.str());
    }
    return static_cast<int>(parsed);
}

double parseFiniteDouble(const char* value, const char* name) {
    char* end = nullptr;
    const double parsed = std::strtod(value, &end);
    if (!end || *end != '\0' || !std::isfinite(parsed)) {
        std::ostringstream stream;
        stream << "Invalid " << name << ": " << value;
        fail(stream.str());
    }
    return parsed;
}

Options parseOptions(int argc, char** argv) {
    Options options;
    for (int index = 1; index < argc; ++index) {
        const std::string arg = argv[index];
        auto requireValue = [&](const char* name) -> const char* {
            if (index + 1 >= argc) {
                std::ostringstream stream;
                stream << "Missing value for " << name;
                fail(stream.str());
            }
            return argv[++index];
        };

        if (arg == "--input") {
            options.inputPath = requireValue("--input");
        } else if (arg == "--output") {
            options.outputPath = requireValue("--output");
        } else if (arg == "--output-codec") {
            options.outputCodec = parseOutputCodec(requireValue("--output-codec"));
        } else if (arg == "--source-pts") {
            options.sourcePtsPath = requireValue("--source-pts");
        } else if (arg == "--width") {
            options.width = parsePositiveInt(requireValue("--width"), "--width");
        } else if (arg == "--height") {
            options.height = parsePositiveInt(requireValue("--height"), "--height");
        } else if (arg == "--timeline-map") {
            options.timelineMapPath = requireValue("--timeline-map");
        } else if (arg == "--fps") {
            options.fps = parsePositiveInt(requireValue("--fps"), "--fps");
        } else if (arg == "--max-frames") {
            options.maxFrames = parsePositiveInt(requireValue("--max-frames"), "--max-frames");
        } else if (arg == "--input-frames") {
            options.inputFrames = parsePositiveInt(requireValue("--input-frames"), "--input-frames");
        } else if (arg == "--target-frames") {
            options.targetFrames = parsePositiveInt(requireValue("--target-frames"), "--target-frames");
        } else if (arg == "--bitrate-mbps") {
            options.bitrateMbps = parsePositiveInt(requireValue("--bitrate-mbps"), "--bitrate-mbps");
        } else if (arg == "--encoding-mode") {
            options.encodingMode = requireValue("--encoding-mode");
            if (
                options.encodingMode != "fast" &&
                options.encodingMode != "balanced" &&
                options.encodingMode != "quality") {
                fail("Unsupported --encoding-mode: " + options.encodingMode);
            }
        } else if (arg == "--post-select") {
            options.postSelect = true;
        } else if (arg == "--callback-encode") {
            options.callbackEncode = true;
        } else if (arg == "--stream-sync") {
            options.streamSync = true;
        } else if (arg == "--prewarm-ms") {
            options.prewarmMs = parsePositiveInt(requireValue("--prewarm-ms"), "--prewarm-ms");
        } else if (arg == "--chunk-mb") {
            options.chunkMb = parsePositiveInt(requireValue("--chunk-mb"), "--chunk-mb");
        } else if (arg == "--content-x") {
            options.contentX = parseNonNegativeInt(requireValue("--content-x"), "--content-x");
        } else if (arg == "--content-y") {
            options.contentY = parseNonNegativeInt(requireValue("--content-y"), "--content-y");
        } else if (arg == "--content-width") {
            options.contentWidth = parsePositiveInt(requireValue("--content-width"), "--content-width");
        } else if (arg == "--content-height") {
            options.contentHeight = parsePositiveInt(requireValue("--content-height"), "--content-height");
        } else if (arg == "--source-crop-x") {
            options.sourceCropX = parseNonNegativeInt(requireValue("--source-crop-x"), "--source-crop-x");
        } else if (arg == "--source-crop-y") {
            options.sourceCropY = parseNonNegativeInt(requireValue("--source-crop-y"), "--source-crop-y");
        } else if (arg == "--source-crop-width") {
            options.sourceCropWidth = parsePositiveInt(requireValue("--source-crop-width"), "--source-crop-width");
        } else if (arg == "--source-crop-height") {
            options.sourceCropHeight = parsePositiveInt(requireValue("--source-crop-height"), "--source-crop-height");
        } else if (arg == "--radius") {
            options.radius = parseNonNegativeInt(requireValue("--radius"), "--radius");
        } else if (arg == "--background-y") {
            options.backgroundY = parseNonNegativeInt(requireValue("--background-y"), "--background-y");
        } else if (arg == "--background-u") {
            options.backgroundU = parseNonNegativeInt(requireValue("--background-u"), "--background-u");
        } else if (arg == "--background-v") {
            options.backgroundV = parseNonNegativeInt(requireValue("--background-v"), "--background-v");
        } else if (arg == "--background-nv12") {
            options.backgroundNv12Path = requireValue("--background-nv12");
        } else if (arg == "--shadow-offset-y") {
            options.shadowOffsetY = parseNonNegativeInt(requireValue("--shadow-offset-y"), "--shadow-offset-y");
        } else if (arg == "--shadow-intensity-pct") {
            options.shadowIntensityPct = parseNonNegativeInt(requireValue("--shadow-intensity-pct"), "--shadow-intensity-pct");
        } else if (arg == "--webcam-nv12") {
            options.webcamNv12Path = requireValue("--webcam-nv12");
        } else if (arg == "--webcam-annexb") {
            options.webcamAnnexbPath = requireValue("--webcam-annexb");
        } else if (arg == "--webcam-input-frames") {
            options.webcamInputFrames = parsePositiveInt(requireValue("--webcam-input-frames"), "--webcam-input-frames");
        } else if (arg == "--webcam-target-frames") {
            options.webcamTargetFrames =
                parsePositiveInt(requireValue("--webcam-target-frames"), "--webcam-target-frames");
        } else if (arg == "--webcam-source-duration-ms") {
            options.webcamSourceDurationMs =
                parseFiniteDouble(requireValue("--webcam-source-duration-ms"), "--webcam-source-duration-ms");
        } else if (arg == "--webcam-source-width") {
            options.webcamSourceWidth = parsePositiveInt(requireValue("--webcam-source-width"), "--webcam-source-width");
        } else if (arg == "--webcam-source-height") {
            options.webcamSourceHeight =
                parsePositiveInt(requireValue("--webcam-source-height"), "--webcam-source-height");
        } else if (arg == "--webcam-x") {
            options.webcamX = parseNonNegativeInt(requireValue("--webcam-x"), "--webcam-x");
        } else if (arg == "--webcam-y") {
            options.webcamY = parseNonNegativeInt(requireValue("--webcam-y"), "--webcam-y");
        } else if (arg == "--webcam-size") {
            options.webcamSize = parsePositiveInt(requireValue("--webcam-size"), "--webcam-size");
        } else if (arg == "--webcam-radius") {
            options.webcamRadius = parseNonNegativeInt(requireValue("--webcam-radius"), "--webcam-radius");
        } else if (arg == "--webcam-time-offset-ms") {
            options.webcamTimeOffsetMs =
                parseFiniteDouble(requireValue("--webcam-time-offset-ms"), "--webcam-time-offset-ms");
        } else if (arg == "--webcam-mirror") {
            options.webcamMirror = true;
        } else if (arg == "--cursor-samples") {
            options.cursorSamplesPath = requireValue("--cursor-samples");
        } else if (arg == "--cursor-height") {
            options.cursorHeight = parsePositiveInt(requireValue("--cursor-height"), "--cursor-height");
        } else if (arg == "--cursor-atlas-rgba") {
            options.cursorAtlasRgbaPath = requireValue("--cursor-atlas-rgba");
        } else if (arg == "--cursor-atlas-metadata") {
            options.cursorAtlasMetadataPath = requireValue("--cursor-atlas-metadata");
        } else if (arg == "--cursor-atlas-width") {
            options.cursorAtlasWidth = parsePositiveInt(requireValue("--cursor-atlas-width"), "--cursor-atlas-width");
        } else if (arg == "--cursor-atlas-height") {
            options.cursorAtlasHeight =
                parsePositiveInt(requireValue("--cursor-atlas-height"), "--cursor-atlas-height");
        } else if (arg == "--zoom-samples") {
            options.zoomSamplesPath = requireValue("--zoom-samples");
        } else if (arg == "--temporal-blur-sample-count") {
            options.temporalBlurSampleCount =
                parsePositiveInt(requireValue("--temporal-blur-sample-count"), "--temporal-blur-sample-count");
        } else if (arg == "--temporal-blur-shutter-fraction") {
            options.temporalBlurShutterFraction = parseFiniteDouble(
                requireValue("--temporal-blur-shutter-fraction"),
                "--temporal-blur-shutter-fraction");
        } else if (arg == "--temporal-blur-weight-power") {
            options.temporalBlurWeightPower = parseFiniteDouble(
                requireValue("--temporal-blur-weight-power"),
                "--temporal-blur-weight-power");
        } else if (arg == "--overlay") {
            OverlayLayerDescriptor layer;
            layer.path = requireValue("--overlay");
            layer.x = parseNonNegativeInt(requireValue("--overlay"), "--overlay x");
            layer.y = parseNonNegativeInt(requireValue("--overlay"), "--overlay y");
            layer.width = parsePositiveInt(requireValue("--overlay"), "--overlay width");
            layer.height = parsePositiveInt(requireValue("--overlay"), "--overlay height");
            layer.frameCount =
                parsePositiveInt(requireValue("--overlay"), "--overlay frameCount");
            options.overlayLayers.push_back(layer);
        } else if (arg == "--help") {
            std::cout << "Usage: recordly-nvidia-cuda-compositor --input input.annexb.h264 "
                         "[--output out.h264] [--output-codec h264|hevc] "
                         "[--source-pts source-pts.csv] [--width N --height N] [--fps 30] "
                         "[--max-frames N] [--bitrate-mbps N] [--encoding-mode fast|balanced|quality] "
                         "[--post-select] [--callback-encode] [--stream-sync] [--prewarm-ms N] [--chunk-mb N] "
                         "[--content-x N --content-y N --content-width N --content-height N --radius N] "
                         "[--background-nv12 background.nv12] [--shadow-offset-y N --shadow-intensity-pct N] "
                         "[--webcam-nv12 webcam.nv12 --webcam-x N --webcam-y N --webcam-size N --webcam-radius N] "
                         "[--webcam-annexb webcam.h264 --webcam-input-frames N --webcam-target-frames N "
                         "--webcam-source-duration-ms N --webcam-time-offset-ms N] "
                         "[--cursor-samples cursor.tsv --cursor-height N] "
                         "[--cursor-atlas-rgba cursor.rgba --cursor-atlas-metadata cursor.tsv "
                         "--cursor-atlas-width N --cursor-atlas-height N] "
                         "[--zoom-samples zoom.csv] "
                         "[--temporal-blur-sample-count N --temporal-blur-shutter-fraction F "
                         "--temporal-blur-weight-power P] "
                         "[--overlay overlay.rgba x y width height frameCount]...\n";
            std::exit(0);
        } else {
            std::ostringstream stream;
            stream << "Unknown argument: " << arg;
            fail(stream.str());
        }
    }
    if (options.inputPath.empty()) {
        fail("--input is required");
    }
    if ((options.width > 0) != (options.height > 0)) {
        fail("--width and --height must be specified together");
    }
    if (options.width > 0 && (options.width % 2 != 0 || options.height % 2 != 0)) {
        fail("--width and --height must be even numbers for NV12 encoding");
    }
    for (const auto& layer : options.overlayLayers) {
        if (layer.width <= 0 || layer.height <= 0 || layer.frameCount <= 0) {
            fail("Invalid --overlay layer dimensions: " + layer.path);
        }
    }
    if (options.temporalBlurSampleCount > 0) {
        if (options.temporalBlurSampleCount < 3 || options.temporalBlurSampleCount > 61) {
            fail("Invalid --temporal-blur-sample-count: " +
                std::to_string(options.temporalBlurSampleCount));
        }
        if (!std::isfinite(options.temporalBlurShutterFraction) ||
            options.temporalBlurShutterFraction < 0.18 ||
            options.temporalBlurShutterFraction > 3.0) {
            fail("Invalid --temporal-blur-shutter-fraction");
        }
    }
    return options;
}

// The overlay canvas bounds depend on the output dimensions. With explicit
// --width/--height they are known at parse time; without them the canvas is
// resolved from the decoded source, so the caller validates with the resolved
// dimensions before the first frame is encoded.
void validateOverlayBounds(const Options& options, int outputWidth, int outputHeight) {
    for (const auto& layer : options.overlayLayers) {
        if (layer.x < 0 || layer.y < 0 ||
            layer.x + layer.width > outputWidth ||
            layer.y + layer.height > outputHeight) {
            fail("Overlay layer exceeds the output canvas: " + layer.path);
        }
    }
}

bool shouldEncodeFrame(int sourceFrameIndex, int encodedFrames, const Options& options) {
    if (options.inputFrames <= 0 || options.targetFrames <= 0) {
        return true;
    }
    if (encodedFrames >= options.targetFrames) {
        return false;
    }

    const int expectedEncodedFrames =
        ((sourceFrameIndex + 1) * options.targetFrames + options.inputFrames - 1) / options.inputFrames;
    return encodedFrames < expectedEncodedFrames;
}

bool hasStaticLayout(const Options& options) {
    return options.contentWidth > 0 && options.contentHeight > 0;
}

bool hasWebcamOverlay(const Options& options) {
    return (!options.webcamNv12Path.empty() || !options.webcamAnnexbPath.empty()) && options.webcamSize > 0;
}

int outputWidthForSource(const Options& options, int sourceWidth) {
    return options.width > 0 ? options.width : sourceWidth;
}

int outputHeightForSource(const Options& options, int sourceHeight) {
    return options.height > 0 ? options.height : sourceHeight;
}

std::vector<double> loadFramePts(const std::string& path) {
    std::vector<double> timestamps;
    if (path.empty()) {
        return timestamps;
    }

    std::ifstream input(path);
    if (!input) {
        fail("Failed to open source PTS sidecar: " + path);
    }

    std::string line;
    double lastTimestamp = -std::numeric_limits<double>::infinity();
    while (std::getline(input, line)) {
        if (line.empty()) {
            continue;
        }
        char* end = nullptr;
        const double timestamp = std::strtod(line.c_str(), &end);
        if (!end || *end != '\0' || !std::isfinite(timestamp) || timestamp < lastTimestamp) {
            fail("Invalid source PTS sidecar entry: " + line);
        }
        timestamps.push_back(timestamp);
        lastTimestamp = timestamp;
    }

    return timestamps;
}

std::vector<TimelineSegment> loadTimelineMap(const std::string& path) {
    std::vector<TimelineSegment> segments;
    if (path.empty()) {
        return segments;
    }

    std::ifstream input(path);
    if (!input) {
        fail("Failed to open timeline map: " + path);
    }

    std::string line;
    double expectedOutputStartMs = 0.0;
    while (std::getline(input, line)) {
        if (line.empty()) {
            continue;
        }
        TimelineSegment segment;
        if (std::sscanf(
                line.c_str(),
                "%lf,%lf,%lf,%lf,%lf",
                &segment.sourceStartMs,
                &segment.sourceEndMs,
                &segment.outputStartMs,
                &segment.outputEndMs,
                &segment.speed) != 5) {
            fail("Invalid timeline map row: " + line);
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
            fail("Invalid timeline map segment: " + line);
        }
        expectedOutputStartMs = segment.outputEndMs;
        segments.push_back(segment);
    }

    if (!path.empty() && segments.empty()) {
        fail("Timeline map is empty: " + path);
    }
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

int webcamFrameIndexForSourceTimeMs(double sourceTimeMs, const Options& options) {
    const double adjustedSourceMs = std::max(0.0, sourceTimeMs - options.webcamTimeOffsetMs);
    if (options.webcamInputFrames > 0) {
        const double durationMs = options.webcamSourceDurationMs > 0.0
            ? options.webcamSourceDurationMs
            : (options.webcamTargetFrames > 0 && options.fps > 0
                ? (static_cast<double>(options.webcamTargetFrames) * 1000.0) / options.fps
                : 0.0);
        if (durationMs > 0.0) {
            const double ratio = std::min(1.0, std::max(0.0, adjustedSourceMs / durationMs));
            const int index = ratio >= 1.0
                ? options.webcamInputFrames - 1
                : static_cast<int>(std::floor(ratio * options.webcamInputFrames));
            return std::max(0, std::min(options.webcamInputFrames - 1, index));
        }
    }
    return std::max(0, static_cast<int>(std::floor(adjustedSourceMs * options.fps / 1000.0)));
}

int webcamFrameIndexForOutputFrame(int outputFrameIndex, const Options& options) {
    const double outputTimeMs =
        static_cast<double>(std::max(0, outputFrameIndex)) * 1000.0 / static_cast<double>(options.fps);
    return webcamFrameIndexForSourceTimeMs(
        outputToSourceMs(options.timelineSegments, outputTimeMs),
        options);
}

int maxSelectedFramesForTimeline(int targetFrames, int maxFrames) {
    if (targetFrames <= 0) {
        return maxFrames > 0 ? maxFrames : std::numeric_limits<int>::max();
    }
    return maxFrames > 0 ? std::min(maxFrames, targetFrames) : targetFrames;
}

int expectedOutputFramesForSourceFrame(
    int sourceFrameIndex,
    int inputFrames,
    int targetFrames,
    int maxFrames,
    int fps,
    const std::vector<double>* sourcePts,
    const std::vector<TimelineSegment>* timelineSegments) {
    const int maxOutputFrames = maxSelectedFramesForTimeline(targetFrames, maxFrames);
    if (sourcePts && sourceFrameIndex >= 0 && sourceFrameIndex < static_cast<int>(sourcePts->size())) {
        const bool hasTimelineMap = timelineSegments && !timelineSegments->empty();
        if (!hasTimelineMap && inputFrames > 0 && sourceFrameIndex + 1 >= inputFrames) {
            return maxOutputFrames;
        }
        if (hasTimelineMap && inputFrames > 0 && sourceFrameIndex + 1 >= inputFrames) {
            return maxOutputFrames;
        }
        const double frameTimeSec = std::max(0.0, (*sourcePts)[sourceFrameIndex]);
        double outputTimeMs = frameTimeSec * 1000.0;
        if (hasTimelineMap && !sourceToOutputMs(*timelineSegments, outputTimeMs, outputTimeMs)) {
            return 0;
        }
        const int64_t expected =
            static_cast<int64_t>(std::floor((outputTimeMs / 1000.0) * fps)) + 1;
        return static_cast<int>(std::min<int64_t>(std::max<int64_t>(1, expected), maxOutputFrames));
    }
    if (inputFrames <= 0 || targetFrames <= 0) {
        return maxOutputFrames;
    }

    const int64_t expected =
        (static_cast<int64_t>(sourceFrameIndex + 1) * targetFrames + inputFrames - 1) / inputFrames;
    return static_cast<int>(std::min<int64_t>(expected, maxOutputFrames));
}

unsigned char clampByte(int value) {
    return static_cast<unsigned char>(std::max(0, std::min(255, value)));
}

struct FrameSelectionState {
    int inputFrames = 0;
    int targetFrames = 0;
    int maxFrames = 0;
    int sourceFrames = 0;
    int selectedFrames = 0;
    int fps = 30;
    const std::vector<double>* sourcePts = nullptr;
    const std::vector<TimelineSegment>* timelineSegments = nullptr;
};

bool shouldCopyDisplayFrame(int displayFrameIndex, void* userData) {
    auto* state = static_cast<FrameSelectionState*>(userData);
    state->sourceFrames = displayFrameIndex + 1;

    const int maxSelectedFrames =
        state->maxFrames > 0 ? std::min(state->maxFrames, state->targetFrames) : state->targetFrames;
    if (state->selectedFrames >= maxSelectedFrames) {
        return false;
    }

    // maxFrames is a smoke-test stop cap; it must not spread the sampled frames
    // across the full source because that hides the true first-window performance.
    const int expectedSelectedFrames = expectedOutputFramesForSourceFrame(
        displayFrameIndex,
        state->inputFrames,
        state->targetFrames,
        state->maxFrames,
        state->fps,
        state->sourcePts,
        state->timelineSegments);
    if (state->selectedFrames >= expectedSelectedFrames) {
        return false;
    }

    ++state->selectedFrames;
    return true;
}

double elapsedMs(std::chrono::steady_clock::time_point start, std::chrono::steady_clock::time_point end);
struct ProgressCounters {
    double decodeWallMs = 0.0;
    double encodeMs = 0.0;
    double compositeMs = 0.0;
    double compositeGpuMs = 0.0;
    double zoomBlurGpuMs = 0.0;
    double overlayBlendGpuMs = 0.0;
    double overlayUploadMs = 0.0;
    double nvencMs = 0.0;
    double packetWriteMs = 0.0;
    double webcamDecodeMs = 0.0;
    double webcamCopyMs = 0.0;
    int roiCompositeFrames = 0;
    int monolithicCompositeFrames = 0;
    int copyCompositeFrames = 0;
    int zoomBlurFrames = 0;
    int overlayBlendFrames = 0;
    int temporalBlurFrames = 0;
    int64_t temporalBlurSamplesTotal = 0;
    int temporalBlurBgPrecomposedFrames = 0;
    int temporalBlurStationaryFrames = 0;
    int temporalBgCacheBuilds = 0;
    int64_t temporalBgCacheHits = 0;
    int64_t overlayStaticRegionBlends = 0;
    int64_t overlayFileLoads = 0;
    int64_t overlayCacheHits = 0;
    int64_t overlayPinnedHits = 0;
    int64_t overlayReadWaits = 0;
    int64_t overlayPendingReadsPeak = 0;
    double overlayHostReadMs = 0.0;
    double overlayH2DEnqueueMs = 0.0;
};

struct ProgressReportState {
    std::chrono::steady_clock::time_point startedAt;
    std::chrono::steady_clock::time_point lastReportAt;
    const char* outputCodec = "h264";
    int lastReportedFrame = 0;
    ProgressCounters lastCounters;
};

void reportEncodingProgress(
    int encodedFrames,
    int totalFrames,
    ProgressReportState& state,
    const ProgressCounters& counters,
    bool force = false);

struct WebcamFrameCache {
    std::vector<unsigned char*> frames;
    double decodeMs = 0.0;
    double copyMs = 0.0;
    int sourceFrames = 0;
    int baseFrameIndex = 0;
    int decodedFrames = 0;
    int peakFrames = 0;
    int width = 0;
    int height = 0;

    ~WebcamFrameCache() {
        for (unsigned char* frame : frames) {
            cudaFree(frame);
        }
    }

    void pushFrame(unsigned char* frame) {
        frames.push_back(frame);
        decodedFrames = baseFrameIndex + static_cast<int>(frames.size());
        sourceFrames = decodedFrames;
        peakFrames = std::max(peakFrames, static_cast<int>(frames.size()));
    }

    void dropBefore(int minFrameIndex) {
        const int dropCount = std::min(
            std::max(0, minFrameIndex - baseFrameIndex),
            std::max(0, static_cast<int>(frames.size()) - 1));
        if (dropCount <= 0) {
            return;
        }
        for (int index = 0; index < dropCount; ++index) {
            cudaFree(frames[index]);
        }
        frames.erase(frames.begin(), frames.begin() + dropCount);
        baseFrameIndex += dropCount;
    }

    const unsigned char* frameAt(int frameIndex) const {
        if (frames.empty()) {
            return nullptr;
        }
        const int clampedFrameIndex =
            std::max(baseFrameIndex, std::min(frameIndex, baseFrameIndex + static_cast<int>(frames.size()) - 1));
        return frames[clampedFrameIndex - baseFrameIndex];
    }
};

struct CursorSample {
    double timeMs = 0.0;
    double cx = 0.0;
    double cy = 0.0;
    int typeIndex = 0;
    double bounceScale = 1.0;
    bool visible = true;
};

struct CursorPosition {
    bool visible = false;
    double cx = 0.0;
    double cy = 0.0;
    int typeIndex = 0;
    double bounceScale = 1.0;
};

struct CursorTrack {
    std::vector<CursorSample> samples;

    CursorPosition positionAt(double timeMs) const {
        if (samples.empty()) {
            return {};
        }
        if (timeMs <= samples.front().timeMs) {
            return {
                samples.front().visible,
                samples.front().cx,
                samples.front().cy,
                samples.front().typeIndex,
                samples.front().bounceScale,
            };
        }
        if (timeMs >= samples.back().timeMs) {
            return {
                samples.back().visible,
                samples.back().cx,
                samples.back().cy,
                samples.back().typeIndex,
                samples.back().bounceScale,
            };
        }

        int low = 0;
        int high = static_cast<int>(samples.size()) - 1;
        while (low < high - 1) {
            const int mid = (low + high) / 2;
            if (samples[mid].timeMs <= timeMs) {
                low = mid;
            } else {
                high = mid;
            }
        }

        const CursorSample& left = samples[low];
        const CursorSample& right = samples[high];
        const double span = right.timeMs - left.timeMs;
        if (span <= 0.0) {
            return {left.visible, left.cx, left.cy, left.typeIndex, left.bounceScale};
        }

        const double t = (timeMs - left.timeMs) / span;
        return {
            left.visible && right.visible,
            left.cx + (right.cx - left.cx) * t,
            left.cy + (right.cy - left.cy) * t,
            t < 0.5 ? left.typeIndex : right.typeIndex,
            left.bounceScale + (right.bounceScale - left.bounceScale) * t,
        };
    }
};

std::unique_ptr<CursorTrack> loadCursorTrack(const Options& options) {
    if (options.cursorSamplesPath.empty()) {
        return nullptr;
    }
    if (options.cursorHeight <= 0) {
        fail("--cursor-height is required with --cursor-samples");
    }

    std::ifstream input(options.cursorSamplesPath);
    if (!input) {
        fail("Failed to open cursor samples: " + options.cursorSamplesPath);
    }

    auto track = std::make_unique<CursorTrack>();
    std::string line;
    while (std::getline(input, line)) {
        if (line.empty()) {
            continue;
        }
        std::istringstream row(line);
        CursorSample sample;
        if (!(row >> sample.timeMs >> sample.cx >> sample.cy)) {
            continue;
        }
        if (!(row >> sample.typeIndex)) {
            sample.typeIndex = 0;
        }
        if (!(row >> sample.bounceScale)) {
            sample.bounceScale = 1.0;
        }
        int visible = 1;
        if (row >> visible) {
            sample.visible = visible != 0;
        }
        if (sample.cx < -1.0 || sample.cx > 2.0 || sample.cy < -1.0 || sample.cy > 2.0) {
            continue;
        }
        sample.typeIndex = std::max(0, std::min(kMaxCursorAtlasEntries - 1, sample.typeIndex));
        sample.bounceScale = std::max(0.5, std::min(2.0, sample.bounceScale));
        track->samples.push_back(sample);
    }
    if (track->samples.empty()) {
        fail("No cursor samples were loaded: " + options.cursorSamplesPath);
    }
    return track;
}

struct ZoomSample {
    double timeMs = 0.0;
    double scale = 1.0;
    double x = 0.0;
    double y = 0.0;
    // Renderer-equivalent radial zoom-blur parameters for the step that ends at
    // this sample. blurStrength is the ZoomBlurFilter strength (0 = no blur);
    // the center is in output pixels. The JS side computes these from the same
    // camera-step analysis the interactive renderer uses, so the native
    // compositor reproduces the spatial zoom blur without re-deriving it.
    double blurStrength = 0.0;
    double blurCenterX = 0.0;
    double blurCenterY = 0.0;
};

struct ZoomTrack {
    std::vector<ZoomSample> samples;

    ZoomSample sampleAt(double timeMs) const {
        if (samples.empty()) {
            return {};
        }
        if (timeMs <= samples.front().timeMs) {
            return samples.front();
        }
        if (timeMs >= samples.back().timeMs) {
            return samples.back();
        }

        int low = 0;
        int high = static_cast<int>(samples.size()) - 1;
        while (low < high - 1) {
            const int mid = (low + high) / 2;
            if (samples[mid].timeMs <= timeMs) {
                low = mid;
            } else {
                high = mid;
            }
        }

        const ZoomSample& left = samples[low];
        const ZoomSample& right = samples[high];
        const double span = right.timeMs - left.timeMs;
        if (span <= 0.0) {
            return left;
        }

        const double t = (timeMs - left.timeMs) / span;
        return {
            timeMs,
            left.scale + (right.scale - left.scale) * t,
            left.x + (right.x - left.x) * t,
            left.y + (right.y - left.y) * t,
            left.blurStrength + (right.blurStrength - left.blurStrength) * t,
            left.blurCenterX + (right.blurCenterX - left.blurCenterX) * t,
            left.blurCenterY + (right.blurCenterY - left.blurCenterY) * t,
        };
    }
};

struct TemporalBlurSample {
    double offsetUs = 0.0;
    double weight = 0.0;
};

// Mirrors buildTemporalSamplePlanUs from src/lib/exporter/temporalMotionBlur.ts:
// symmetric shutter window centered on the frame, cos-tapered weights normalized
// to sum to 1. The weight floor (0.22) and taper are part of the renderer's
// contract; the compositor must reproduce them so native output matches the
// configured high-level temporal sample plan.
std::vector<TemporalBlurSample> buildTemporalSamplePlan(
    int sampleCount,
    double shutterFraction,
    double weightCurvePower,
    double frameDurationUs) {
    const int safeSampleCount = std::max(1, sampleCount);
    if (safeSampleCount <= 1) {
        return {{0.0, 1.0}};
    }

    const double shutterWindowUs =
        std::max(1.0, frameDurationUs) * std::max(0.0, std::min(3.0, shutterFraction));
    const double startOffsetUs = -shutterWindowUs / 2.0;
    const double stepUs = shutterWindowUs / static_cast<double>(safeSampleCount - 1);
    std::vector<double> offsetsUs;
    offsetsUs.reserve(safeSampleCount);
    for (int index = 0; index < safeSampleCount; ++index) {
        offsetsUs.push_back(startOffsetUs + stepUs * static_cast<double>(index));
    }

    constexpr double kWeightFloor = 0.22;
    const double centerIndex = static_cast<double>(safeSampleCount - 1) / 2.0;
    std::vector<double> rawWeights;
    rawWeights.reserve(safeSampleCount);
    double totalWeight = 0.0;
    for (int index = 0; index < safeSampleCount; ++index) {
        const double normalizedDistance =
            std::abs(static_cast<double>(index) - centerIndex) / std::max(1.0, centerIndex);
        const double taperedWeight = std::cos(normalizedDistance * (3.14159265358979323846 / 2.0));
        const double rawWeight =
            kWeightFloor +
            (1.0 - kWeightFloor) *
                std::pow(std::max(0.0, taperedWeight), weightCurvePower);
        rawWeights.push_back(rawWeight);
        totalWeight += rawWeight;
    }

    std::vector<TemporalBlurSample> samples;
    samples.reserve(safeSampleCount);
    for (int index = 0; index < safeSampleCount; ++index) {
        samples.push_back({
            offsetsUs[index],
            totalWeight > 0.0 ? rawWeights[index] / totalWeight : 1.0 / safeSampleCount,
        });
    }
    return samples;
}

std::unique_ptr<ZoomTrack> loadZoomTrack(const Options& options) {
    if (options.zoomSamplesPath.empty()) {
        return nullptr;
    }

    std::ifstream input(options.zoomSamplesPath);
    if (!input) {
        fail("Failed to open zoom samples: " + options.zoomSamplesPath);
    }

    auto track = std::make_unique<ZoomTrack>();
    std::string line;
    while (std::getline(input, line)) {
        if (line.empty()) {
            continue;
        }
        std::replace(line.begin(), line.end(), ',', ' ');
        std::istringstream row(line);
        ZoomSample sample;
        if (!(row >> sample.timeMs >> sample.scale >> sample.x >> sample.y)) {
            continue;
        }
        if (!std::isfinite(sample.timeMs) || !std::isfinite(sample.scale) ||
            !std::isfinite(sample.x) || !std::isfinite(sample.y)) {
            continue;
        }
        // Optional renderer-computed zoom-blur fields (columns 5-7). Older
        // telemetry files with only timeMs/scale/x/y keep blurStrength = 0.
        if (!(row >> sample.blurStrength)) {
            sample.blurStrength = 0.0;
        } else if (!std::isfinite(sample.blurStrength)) {
            sample.blurStrength = 0.0;
        }
        if (!(row >> sample.blurCenterX)) {
            sample.blurCenterX = 0.0;
        } else if (!std::isfinite(sample.blurCenterX)) {
            sample.blurCenterX = 0.0;
        }
        if (!(row >> sample.blurCenterY)) {
            sample.blurCenterY = 0.0;
        } else if (!std::isfinite(sample.blurCenterY)) {
            sample.blurCenterY = 0.0;
        }
        sample.timeMs = std::max(0.0, sample.timeMs);
        sample.scale = std::max(0.01, sample.scale);
        sample.blurStrength = std::max(0.0, sample.blurStrength);
        track->samples.push_back(sample);
    }
    if (track->samples.empty()) {
        fail("No zoom samples were loaded: " + options.zoomSamplesPath);
    }
    std::sort(track->samples.begin(), track->samples.end(), [](const auto& left, const auto& right) {
        return left.timeMs < right.timeMs;
    });
    return track;
}

// Blend launch rectangle for a renderer-prepared RGBA overlay layer. Dynamic
// (multi-frame) layers always use the full layer rect; physical single-frame
// layers get a one-time alpha bound (see computeStaticAlphaBounds) so the blend
// kernel only visits pixels that can write, with the full rect as the fallback.
struct OverlayBlendRegion {
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;
    bool bounded = false;
};

OverlayBlendRegion fullOverlayBlendRegion(const OverlayLayerDescriptor& descriptor) {
    OverlayBlendRegion region;
    region.x = 0;
    region.y = 0;
    region.width = descriptor.width;
    region.height = descriptor.height;
    region.bounded = false;
    return region;
}

// Scans the first frame of a physical single-frame overlay layer for the
// bounding box of pixels with nonzero alpha, expanded by one pixel so every 2x2
// chroma block that touches an alpha pixel is inside the launch region. The
// bound is computed once per layer; pixels outside it have alpha == 0 for the
// whole layer, so the blend kernel writes nothing there and the bounded launch
// is bit-identical to the full-frame blend. A fully transparent layer gets an
// empty region (the blend launch is skipped entirely, which is also exact).
void computeStaticAlphaBounds(
    const unsigned char* rgba,
    int width,
    int height,
    OverlayBlendRegion& region) {
    int minX = width;
    int minY = height;
    int maxX = -1;
    int maxY = -1;
    for (int y = 0; y < height; ++y) {
        const unsigned char* row =
            rgba + static_cast<size_t>(y) * static_cast<size_t>(width) * 4;
        for (int x = 0; x < width; ++x) {
            if (row[x * 4 + 3] > 0) {
                minX = std::min(minX, x);
                minY = std::min(minY, y);
                maxX = std::max(maxX, x);
                maxY = std::max(maxY, y);
            }
        }
    }
    if (maxX < minX) {
        region = {0, 0, 0, 0, true};
        return;
    }
    region.x = std::max(0, minX - 1);
    region.y = std::max(0, minY - 1);
    region.width = std::min(width, maxX + 2) - region.x;
    region.height = std::min(height, maxY + 2) - region.y;
    region.bounded = true;
}

// Streaming source for renderer-prepared transparent RGBA overlay sidecars.
// Frames are raw top-down RGBA and are consumed sequentially by the output
// frame index. Each dynamic layer owns a bounded background reader thread that
// reads sidecar frames from disk into persistent pinned ring buffers while the
// encode thread keeps running, so the encode loop never blocks on file I/O.
// The encode thread only enqueues H2D copies (pinned -> device) on the
// compositor stream, ordered ahead of the blend kernels on the same stream, so
// the single per-frame cudaStreamSynchronize stays sufficient. The 4-slot ring
// semantics are unchanged: frame ordering, tail-repeat clamping, the read-once
// static cache, and bounded memory are all preserved.
class OverlayFrameSource {
public:
    explicit OverlayFrameSource(const std::vector<OverlayLayerDescriptor>& layers) {
        layers_.reserve(layers.size());
        for (const auto& descriptor : layers) {
            std::unique_ptr<LoadedLayer> layer = loadLayer(descriptor);
            if (layer->staticLayer) {
                // The constructor read of the static layer's single frame is a
                // disk read with an upload (synchronous), so it counts as a
                // file load like the streaming path counts its reads.
                ++fileLoads_;
            }
            layers_.push_back(std::move(layer));
        }
        // Start one reader thread per dynamic layer only after every layer is
        // fully built (vector is stable and static frames are staged), so a
        // reader can never observe a partially initialized layer.
        for (auto& layer : layers_) {
            if (!layer->staticLayer) {
                startReader(*layer);
            }
        }
    }

    ~OverlayFrameSource() {
        // Stop and join every reader before freeing the pinned buffers the
        // readers write into. Reader threads never touch CUDA, so joining is
        // safe while the primary context is current.
        for (auto& layer : layers_) {
            stopReader(*layer);
        }
        for (auto& layer : layers_) {
            for (int slot = 0; slot < kOverlayPrefetchSlots; ++slot) {
                if (layer->deviceFrames[slot]) {
                    cudaFree(layer->deviceFrames[slot]);
                }
                if (layer->pinnedFrames[slot]) {
                    cudaFreeHost(layer->pinnedFrames[slot]);
                }
            }
        }
    }

    bool empty() const {
        return layers_.empty();
    }

    size_t layerCount() const {
        return layers_.size();
    }

    // Total streaming-path overlay time (background host reads + H2D
    // enqueues). Static constructor staging is intentionally excluded, matching
    // the pre-background-reader semantics of uploadMs.
    double uploadMs() const {
        return hostReadMs() + h2dEnqueueMs();
    }

    // Wall time the background reader threads spent reading sidecar bytes from
    // disk (not the H2D transfer time).
    double hostReadMs() const {
        return static_cast<double>(hostReadUs_.load()) / 1000.0;
    }

    // Wall time the encode thread spent enqueuing H2D copies (cudaMemcpyAsync
    // API calls) on the compositor stream.
    double h2dEnqueueMs() const {
        return h2dEnqueueMs_;
    }

    // Number of overlay frames read from disk (one per unique requested frame;
    // static single-frame layers count their one constructor read).
    int64_t fileLoads() const {
        return fileLoads_.load();
    }

    // Number of times a requested overlay frame was already device-resident in
    // its ring slot, so neither a file read nor an H2D copy was needed. Static
    // single-frame layers, tail-repeated frames, and read-ahead frames all
    // count here.
    int64_t cacheHits() const {
        return cacheHits_;
    }

    // Number of times a requested overlay frame was already in pinned memory
    // (the background reader had finished the file read) and only the H2D
    // enqueue was needed.
    int64_t pinnedHits() const {
        return pinnedHits_;
    }

    // Number of times the encode thread had to wait for the background reader
    // to finish a file read before it could enqueue the H2D copy.
    int64_t readWaits() const {
        return readWaits_;
    }

    // Peak depth of the bounded background-reader queue across all layers.
    int64_t pendingReadsPeak() const {
        return pendingReadsPeak_.load();
    }

    const OverlayLayerDescriptor& descriptor(size_t index) const {
        return layers_[index]->descriptor;
    }

    // Blend launch rectangle for the layer. Dynamic (multi-frame) layers return
    // the full layer rect; physical single-frame layers return the one-time
    // alpha bound (or an empty rect for a fully transparent layer).
    OverlayBlendRegion blendRegion(size_t index) const {
        return layers_[index]->blendRegion;
    }

    // Prepares the overlay frame for the given output frame index for every
    // layer. Call this before launching the blend kernels: it waits (host-side)
    // only when the background reader has not finished the requested frame,
    // then enqueues the H2D copy on the compositor stream so blends stay
    // ordered. Slots are keyed by the clamped frame index inside a small
    // bounded ring, so a single-frame layer or a tail-repeated last frame is
    // read from disk once and served from its device slot for every following
    // output frame. This never syncs the compositor stream; the encode loop
    // keeps its single per-frame cudaStreamSynchronize.
    void beginFrame(int outputFrameIndex, cudaStream_t copyStream) {
        if (layers_.empty()) {
            return;
        }

        for (size_t index = 0; index < layers_.size(); ++index) {
            auto& layer = *layers_[index];
            const int frameIndex = clampedFrameIndex(layer, outputFrameIndex);
            const int slot = slotFor(frameIndex);
            if (layer.staticLayer) {
                // Static layers are fully staged in the constructor; slot 0 is
                // always device-resident for frame 0.
                ++cacheHits_;
                continue;
            }
            waitForFrame(layer, frameIndex, slot, copyStream);
        }
    }

    const unsigned char* frameDevicePtr(size_t layerIndex, int outputFrameIndex) const {
        const auto& layer = *layers_[layerIndex];
        return layer.deviceFrames[slotFor(clampedFrameIndex(layer, outputFrameIndex))];
    }

    // Must be called after beginFrame + the blend kernels are queued (after the
    // per-frame stream sync). Dispatches bounded background reads for the next
    // overlay frames so the following output frames do not stall on file I/O;
    // when a read-ahead frame's pinned data is already available it also
    // enqueues the H2D copy immediately so the transfer overlaps NVENC.
    // Read-ahead depth is bounded by the ring size minus one and never targets
    // the slot the current blend is reading, so the pipeline stays ordered with
    // bounded memory.
    void prefetchNextFrame(int outputFrameIndex, cudaStream_t copyStream) {
        if (layers_.empty()) {
            return;
        }

        for (size_t index = 0; index < layers_.size(); ++index) {
            auto& layer = *layers_[index];
            if (layer.staticLayer) {
                continue;
            }
            const int currentFrameIndex = clampedFrameIndex(layer, outputFrameIndex);
            const int currentSlot = slotFor(currentFrameIndex);
            for (int depth = 1; depth <= kOverlayPrefetchDepth; ++depth) {
                const int frameIndex = clampedFrameIndex(layer, outputFrameIndex + depth);
                if (frameIndex == currentFrameIndex || slotFor(frameIndex) == currentSlot) {
                    continue;
                }
                requestRead(layer, frameIndex, slotFor(frameIndex), copyStream);
            }
        }
    }

private:
    enum class SlotState {
        Empty,
        Reading,
        PinnedReady,
        DeviceReady,
    };

    struct LoadedLayer {
        OverlayLayerDescriptor descriptor;
        size_t frameBytes = 0;
        std::ifstream input;
        unsigned char* deviceFrames[kOverlayPrefetchSlots] = {};
        unsigned char* pinnedFrames[kOverlayPrefetchSlots] = {};
        int loadedSlots[kOverlayPrefetchSlots] = {};
        SlotState slotStates[kOverlayPrefetchSlots] = {};
        OverlayBlendRegion blendRegion;
        bool staticLayer = false;
        // Bounded background reader state (dynamic layers only). The pending
        // queue never holds more than one entry per ring slot, so it is bounded
        // by kOverlayPrefetchSlots; the reader thread is the only accessor of
        // input and pinnedFrames outside the constructor.
        std::mutex mutex;
        std::condition_variable cv;
        std::deque<std::pair<int, int>> pendingReads;
        bool stop = false;
        bool readerStarted = false;
        std::thread readerThread;
        std::string readError;
    };

    static int clampedFrameIndex(const LoadedLayer& layer, int outputFrameIndex) {
        return std::min(outputFrameIndex, std::max(0, layer.descriptor.frameCount - 1));
    }

    static int slotFor(int frameIndex) {
        return frameIndex % kOverlayPrefetchSlots;
    }

    static std::unique_ptr<LoadedLayer> loadLayer(const OverlayLayerDescriptor& descriptor) {
        std::unique_ptr<LoadedLayer> layer = std::make_unique<LoadedLayer>();
        layer->descriptor = descriptor;
        layer->frameBytes = static_cast<size_t>(descriptor.width) *
            static_cast<size_t>(descriptor.height) * 4;
        for (int slot = 0; slot < kOverlayPrefetchSlots; ++slot) {
            layer->loadedSlots[slot] = -1;
            layer->slotStates[slot] = SlotState::Empty;
        }

        layer->input.open(descriptor.path, std::ios::binary);
        if (!layer->input) {
            fail("Failed to open overlay layer: " + descriptor.path);
        }
        layer->input.seekg(0, std::ios::end);
        const std::streampos end = layer->input.tellg();
        layer->input.seekg(0, std::ios::beg);
        if (end < 0 ||
            static_cast<uint64_t>(end) < layer->frameBytes * static_cast<uint64_t>(descriptor.frameCount)) {
            fail("Overlay layer is truncated: " + descriptor.path);
        }

        for (int slot = 0; slot < kOverlayPrefetchSlots; ++slot) {
            checkCuda(cudaMalloc(&layer->deviceFrames[slot], layer->frameBytes), "cudaMalloc overlay frame");
            checkCuda(cudaMallocHost(&layer->pinnedFrames[slot], layer->frameBytes), "cudaMallocHost overlay frame");
        }

        // Physical single-frame layers are invariant for the whole export: read
        // the single frame once, compute the alpha bounds once, and stage the
        // device copy now so beginFrame serves it from slot 0 without a second
        // file read. The ring is keyed by the clamped frame index, which is
        // always 0 for a frameCount == 1 layer, so slot 0 stays valid forever.
        layer->staticLayer = descriptor.frameCount == 1;
        layer->blendRegion = fullOverlayBlendRegion(descriptor);
        if (layer->staticLayer) {
            layer->input.seekg(0, std::ios::beg);
            layer->input.read(
                reinterpret_cast<char*>(layer->pinnedFrames[0]),
                static_cast<std::streamsize>(layer->frameBytes));
            if (static_cast<size_t>(layer->input.gcount()) != layer->frameBytes) {
                fail("Failed to read overlay frame 0: " + descriptor.path);
            }
            computeStaticAlphaBounds(
                layer->pinnedFrames[0],
                descriptor.width,
                descriptor.height,
                layer->blendRegion);
            // Static staging (read + upload) is intentionally not timed: it is
            // a one-time constructor cost and the streaming-path timing metrics
            // (hostReadMs/h2dEnqueueMs) exclude it, matching the historical
            // uploadMs semantics.
            checkCuda(
                cudaMemcpy(
                    layer->deviceFrames[0],
                    layer->pinnedFrames[0],
                    layer->frameBytes,
                    cudaMemcpyHostToDevice),
                "cudaMemcpy overlay static frame 0");
            layer->loadedSlots[0] = 0;
            layer->slotStates[0] = SlotState::DeviceReady;
        }
        return layer;
    }

    void startReader(LoadedLayer& layer) {
        std::unique_lock<std::mutex> lock(layer.mutex);
        layer.readerStarted = true;
        layer.readerThread = std::thread(&OverlayFrameSource::readerLoop, this, &layer);
    }

    void stopReader(LoadedLayer& layer) {
        {
            std::unique_lock<std::mutex> lock(layer.mutex);
            layer.stop = true;
        }
        layer.cv.notify_all();
        if (layer.readerStarted && layer.readerThread.joinable()) {
            layer.readerThread.join();
        }
    }

    // Background reader main loop: pops the oldest queued (slot, frameIndex)
    // read, performs the file read into the persistent pinned buffer, and
    // publishes the PinnedReady state. The queue is bounded (one entry per ring
    // slot) and the loop never touches CUDA, so cancellation is a simple stop
    // flag + join; a read failure is captured and re-thrown on the encode
    // thread at the next beginFrame.
    void readerLoop(LoadedLayer* layer) {
        while (true) {
            std::pair<int, int> request;
            {
                std::unique_lock<std::mutex> lock(layer->mutex);
                layer->cv.wait(lock, [&] {
                    return layer->stop || !layer->pendingReads.empty();
                });
                if (layer->stop) {
                    return;
                }
                request = layer->pendingReads.front();
                layer->pendingReads.pop_front();
            }
            readFrameIntoPinned(*layer, request.first, request.second);
        }
    }

    void readFrameIntoPinned(LoadedLayer& layer, int slot, int frameIndex) {
        const auto readStart = std::chrono::steady_clock::now();
        try {
            layer.input.seekg(
                static_cast<std::streamoff>(layer.frameBytes * static_cast<uint64_t>(frameIndex)),
                std::ios::beg);
            layer.input.read(
                reinterpret_cast<char*>(layer.pinnedFrames[slot]),
                static_cast<std::streamsize>(layer.frameBytes));
            if (static_cast<size_t>(layer.input.gcount()) != layer.frameBytes) {
                throw std::runtime_error(
                    "Failed to read overlay frame " + std::to_string(frameIndex) + ": " +
                    layer.descriptor.path);
            }
        } catch (const std::exception& error) {
            std::unique_lock<std::mutex> lock(layer.mutex);
            layer.readError = error.what();
            layer.stop = true;
            layer.cv.notify_all();
            return;
        }
        hostReadUs_ += static_cast<int64_t>(elapsedMs(readStart, std::chrono::steady_clock::now()) * 1000.0);
        ++fileLoads_;
        {
            std::unique_lock<std::mutex> lock(layer.mutex);
            layer.loadedSlots[slot] = frameIndex;
            layer.slotStates[slot] = SlotState::PinnedReady;
            layer.cv.notify_all();
        }
    }

    // Queues a background read for (slot, frameIndex) unless one is already in
    // flight/queued for that slot. A newer request supersedes a stale queued
    // target for the same slot (the older frame's blend already consumed its
    // device data, so overwriting the pinned buffer is safe). The queue is
    // bounded to one entry per ring slot; if it is full the request is dropped
    // and the caller's wait loop retries once the reader drains an entry.
    // Must be called with layer.mutex held.
    void requestReadLocked(LoadedLayer& layer, int frameIndex, int slot) {
        if (layer.slotStates[slot] == SlotState::Reading &&
            layer.loadedSlots[slot] == frameIndex) {
            return;
        }
        for (auto& entry : layer.pendingReads) {
            if (entry.first == slot) {
                if (entry.second != frameIndex) {
                    entry.second = frameIndex;
                }
                layer.cv.notify_one();
                return;
            }
        }
        if (layer.pendingReads.size() >= static_cast<size_t>(kOverlayPrefetchSlots)) {
            return;
        }
        layer.pendingReads.push_back({slot, frameIndex});
        pendingReadsPeak_.store(
            std::max(pendingReadsPeak_.load(), static_cast<int64_t>(layer.pendingReads.size())));
        layer.slotStates[slot] = SlotState::Reading;
        layer.loadedSlots[slot] = frameIndex;
        layer.cv.notify_one();
    }

    // Non-blocking read-ahead request (prefetch path): queues the background
    // read and, when the pinned data is already available, enqueues the H2D
    // copy immediately so it overlaps NVENC instead of the next beginFrame.
    void requestRead(LoadedLayer& layer, int frameIndex, int slot, cudaStream_t copyStream) {
        std::unique_lock<std::mutex> lock(layer.mutex);
        if (layer.slotStates[slot] == SlotState::DeviceReady &&
            layer.loadedSlots[slot] == frameIndex) {
            ++cacheHits_;
            return;
        }
        if (layer.slotStates[slot] == SlotState::PinnedReady &&
            layer.loadedSlots[slot] == frameIndex) {
            ++pinnedHits_;
            lock.unlock();
            enqueueH2D(layer, slot, copyStream);
            lock.lock();
            layer.slotStates[slot] = SlotState::DeviceReady;
            return;
        }
        requestReadLocked(layer, frameIndex, slot);
    }

    // Ensures the requested overlay frame's pinned data is available and its
    // H2D copy is enqueued on the compositor stream. Waits on the background
    // reader are host-side (condition variable) and never sync the stream; the
    // encode loop keeps its single per-frame cudaStreamSynchronize.
    void waitForFrame(LoadedLayer& layer, int frameIndex, int slot, cudaStream_t copyStream) {
        std::unique_lock<std::mutex> lock(layer.mutex);
        while (true) {
            if (layer.slotStates[slot] == SlotState::DeviceReady &&
                layer.loadedSlots[slot] == frameIndex) {
                ++cacheHits_;
                return;
            }
            if (layer.slotStates[slot] == SlotState::PinnedReady &&
                layer.loadedSlots[slot] == frameIndex) {
                ++pinnedHits_;
                lock.unlock();
                enqueueH2D(layer, slot, copyStream);
                lock.lock();
                layer.slotStates[slot] = SlotState::DeviceReady;
                return;
            }
            if (!layer.readError.empty()) {
                fail(layer.readError);
            }
            if (layer.stop) {
                fail("Overlay reader stopped before frame " + std::to_string(frameIndex));
            }
            requestReadLocked(layer, frameIndex, slot);
            ++readWaits_;
            layer.cv.wait(lock, [&] {
                return layer.stop || !layer.readError.empty() ||
                       (layer.slotStates[slot] == SlotState::PinnedReady &&
                        layer.loadedSlots[slot] == frameIndex) ||
                       (layer.slotStates[slot] == SlotState::DeviceReady &&
                        layer.loadedSlots[slot] == frameIndex);
            });
        }
    }

    // Enqueues the H2D copy for a PinnedReady slot on the compositor stream.
    // Main thread only; the transfer is ordered ahead of the blend kernels on
    // the same stream.
    void enqueueH2D(LoadedLayer& layer, int slot, cudaStream_t copyStream) {
        const auto enqueueStart = std::chrono::steady_clock::now();
        checkCuda(
            cudaMemcpyAsync(
                layer.deviceFrames[slot],
                layer.pinnedFrames[slot],
                layer.frameBytes,
                cudaMemcpyHostToDevice,
                copyStream),
            "cudaMemcpyAsync overlay frame");
        h2dEnqueueMs_ += elapsedMs(enqueueStart, std::chrono::steady_clock::now());
    }

    std::vector<std::unique_ptr<LoadedLayer>> layers_;
    std::atomic<int64_t> fileLoads_{0};
    std::atomic<int64_t> hostReadUs_{0};
    std::atomic<int64_t> pendingReadsPeak_{0};
    double h2dEnqueueMs_ = 0.0;
    int64_t cacheHits_ = 0;
    int64_t pinnedHits_ = 0;
    int64_t readWaits_ = 0;
};

struct CursorAtlasEntry {
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;
    double anchorX = 0.0;
    double anchorY = 0.0;
    double aspectRatio = 0.0;
    bool valid = false;
};

struct WebcamCacheState {
    WebcamFrameCache* cache = nullptr;
};

void cacheMappedWebcamFrame(
    CUdeviceptr dpSrcFrame,
    unsigned int nSrcPitch,
    int width,
    int height,
    int surfaceHeight,
    int64_t,
    void* userData) {
    auto* state = static_cast<WebcamCacheState*>(userData);
    if (state->cache->width == 0) {
        state->cache->width = width;
        state->cache->height = height;
    }
    if (width != state->cache->width || height != state->cache->height) {
        std::ostringstream stream;
        stream << "Decoded webcam frame size changed from " << state->cache->width << "x" << state->cache->height
               << " to " << width << "x" << height;
        fail(stream.str());
    }

    const auto copyStart = std::chrono::steady_clock::now();
    const size_t expectedBytes = static_cast<size_t>(width) * static_cast<size_t>(height) * 3 / 2;
    unsigned char* frame = nullptr;
    checkCuda(cudaMalloc(&frame, expectedBytes), "cudaMalloc webcam cached frame");

    CUDA_MEMCPY2D copy = {};
    copy.srcMemoryType = CU_MEMORYTYPE_DEVICE;
    copy.srcDevice = dpSrcFrame;
    copy.srcPitch = nSrcPitch;
    copy.dstMemoryType = CU_MEMORYTYPE_DEVICE;
    copy.dstDevice = reinterpret_cast<CUdeviceptr>(frame);
    copy.dstPitch = width;
    copy.WidthInBytes = width;
    copy.Height = height;
    checkCu(cuMemcpy2D(&copy), "cuMemcpy2D webcam luma");

    copy.srcDevice = dpSrcFrame + nSrcPitch * surfaceHeight;
    copy.dstDevice = reinterpret_cast<CUdeviceptr>(frame + width * height);
    copy.Height = height / 2;
    checkCu(cuMemcpy2D(&copy), "cuMemcpy2D webcam chroma");

    state->cache->pushFrame(frame);
    const auto copyEnd = std::chrono::steady_clock::now();
    state->cache->copyMs += elapsedMs(copyStart, copyEnd);
}

class WebcamStreamDecoder {
public:
    WebcamStreamDecoder(CUcontext context, const Options& options)
        : options_(options),
          chunk_(static_cast<size_t>(options.chunkMb) * 1024 * 1024) {
        if (options_.webcamInputFrames <= 0 || options_.webcamTargetFrames <= 0) {
            fail("--webcam-input-frames and --webcam-target-frames are required with --webcam-annexb");
        }
        if (options_.webcamSourceWidth <= 0 || options_.webcamSourceHeight <= 0) {
            fail("--webcam-source-width and --webcam-source-height are required with --webcam-annexb");
        }

        const int cropSide = std::min(options_.webcamSourceWidth, options_.webcamSourceHeight) & ~1;
        const int cropLeft = ((options_.webcamSourceWidth - cropSide) / 2) & ~1;
        const int cropTop = ((options_.webcamSourceHeight - cropSide) / 2) & ~1;
        crop_ = Rect{cropLeft, cropTop, cropLeft + cropSide, cropTop + cropSide};

        cacheState_.cache = &cache_;
        decoder_ =
            std::make_unique<NvDecoder>(context, 0, 0, true, cudaVideoCodec_H264, nullptr, true, true, &crop_, nullptr);
        decoder_->SetMappedFrameHandler(cacheMappedWebcamFrame, &cacheState_);

        input_.open(options_.webcamAnnexbPath, std::ios::binary);
        if (!input_) {
            fail("Failed to open webcam input: " + options_.webcamAnnexbPath);
        }
    }

    WebcamFrameCache* cache() {
        return &cache_;
    }

    void ensureFrame(int frameIndex) {
        if (frameIndex < 0) {
            return;
        }
        while (!flushed_ && cache_.decodedFrames <= frameIndex) {
            input_.read(reinterpret_cast<char*>(chunk_.data()), static_cast<std::streamsize>(chunk_.size()));
            const int bytesRead = static_cast<int>(input_.gcount());
            const auto decodeStart = std::chrono::steady_clock::now();
            if (bytesRead > 0) {
                decoder_->Decode(chunk_.data(), bytesRead, &frames_, &returnedFrames_);
            } else {
                decoder_->Decode(nullptr, 0, &frames_, &returnedFrames_);
                flushed_ = true;
            }
            const auto decodeEnd = std::chrono::steady_clock::now();
            cache_.decodeMs += elapsedMs(decodeStart, decodeEnd);
        }
        if (cache_.frames.empty()) {
            fail("No webcam frames were decoded");
        }
    }

    void dropBefore(int frameIndex) {
        cache_.dropBefore(frameIndex);
    }

private:
    const Options& options_;
    WebcamFrameCache cache_;
    WebcamCacheState cacheState_{};
    Rect crop_{};
    std::unique_ptr<NvDecoder> decoder_;
    std::ifstream input_;
    std::vector<uint8_t> chunk_;
    uint8_t** frames_ = nullptr;
    int returnedFrames_ = 0;
    bool flushed_ = false;
};

std::unique_ptr<WebcamStreamDecoder> createWebcamStreamDecoder(CUcontext context, const Options& options) {
    if (options.webcamAnnexbPath.empty()) {
        return nullptr;
    }
    return std::make_unique<WebcamStreamDecoder>(context, options);
}

__global__ void copyNv12Kernel(
    const unsigned char* src,
    int srcPitch,
    int srcWidth,
    int srcHeight,
    int srcSurfaceHeight,
    unsigned char* dst,
    int dstPitch,
    int dstChromaOffset,
    int dstWidth,
    int dstHeight) {
    const int x = blockIdx.x * blockDim.x + threadIdx.x;
    const int y = blockIdx.y * blockDim.y + threadIdx.y;
    if (x >= dstWidth || y >= dstHeight) {
        return;
    }

    const int sx = min(srcWidth - 1, (x * srcWidth) / dstWidth);
    const int sy = min(srcHeight - 1, (y * srcHeight) / dstHeight);
    dst[y * dstPitch + x] = src[sy * srcPitch + sx];

    if ((x % 2) == 0 && (y % 2) == 0) {
        const int suvX = min(srcWidth - 2, ((x * srcWidth) / dstWidth) & ~1);
        const int suvY = min((srcHeight / 2) - 1, (y * srcHeight / dstHeight) / 2);
        const unsigned char* srcUv = src + srcPitch * srcSurfaceHeight + suvY * srcPitch + suvX;
        unsigned char* dstUv = dst + dstChromaOffset + (y / 2) * dstPitch + x;
        dstUv[0] = srcUv[0];
        dstUv[1] = srcUv[1];
    }
}

__global__ void fillNv12Kernel(
    unsigned char* dst,
    int dstPitch,
    int dstChromaOffset,
    int dstWidth,
    int dstHeight,
    unsigned char yValue,
    unsigned char uValue,
    unsigned char vValue) {
    const int x = blockIdx.x * blockDim.x + threadIdx.x;
    const int y = blockIdx.y * blockDim.y + threadIdx.y;
    if (x >= dstWidth || y >= dstHeight) {
        return;
    }

    dst[y * dstPitch + x] = yValue;
    if ((x % 2) == 0 && (y % 2) == 0) {
        unsigned char* dstUv = dst + dstChromaOffset + (y / 2) * dstPitch + x;
        dstUv[0] = uValue;
        dstUv[1] = vValue;
    }
}

__device__ bool isInsideRoundedRect(
    int x,
    int y,
    int left,
    int top,
    int width,
    int height,
    int radius) {
    if (x < left || y < top || x >= left + width || y >= top + height) {
        return false;
    }
    if (radius <= 0) {
        return true;
    }

    const int right = left + width - 1;
    const int bottom = top + height - 1;
    const int innerLeft = left + radius;
    const int innerRight = right - radius;
    const int innerTop = top + radius;
    const int innerBottom = bottom - radius;
    if ((x >= innerLeft && x <= innerRight) || (y >= innerTop && y <= innerBottom)) {
        return true;
    }

    const int cx = x < innerLeft ? innerLeft : innerRight;
    const int cy = y < innerTop ? innerTop : innerBottom;
    const int dx = x - cx;
    const int dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
}

__global__ void overlayContentRectNv12Kernel(
    const unsigned char* src,
    int srcPitch,
    int srcWidth,
    int srcHeight,
    int srcSurfaceHeight,
    unsigned char* dst,
    int dstPitch,
    int dstChromaOffset,
    int dstWidth,
    int dstHeight,
    int contentX,
    int contentY,
    int contentWidth,
    int contentHeight,
    int sourceCropX,
    int sourceCropY,
    int sourceCropWidth,
    int sourceCropHeight) {
    const int localX = blockIdx.x * blockDim.x + threadIdx.x;
    const int localY = blockIdx.y * blockDim.y + threadIdx.y;
    if (localX >= contentWidth || localY >= contentHeight) {
        return;
    }

    const int x = contentX + localX;
    const int y = contentY + localY;
    if (x < 0 || y < 0 || x >= dstWidth || y >= dstHeight) {
        return;
    }

    const int cropWidth = max(1, min(sourceCropWidth > 0 ? sourceCropWidth : srcWidth, srcWidth - sourceCropX));
    const int cropHeight = max(1, min(sourceCropHeight > 0 ? sourceCropHeight : srcHeight, srcHeight - sourceCropY));
    const int cropX = max(0, min(sourceCropX, srcWidth - 1));
    const int cropY = max(0, min(sourceCropY, srcHeight - 1));
    const int srcX = min(srcWidth - 1, cropX + (localX * cropWidth) / contentWidth);
    const int srcY = min(srcHeight - 1, cropY + (localY * cropHeight) / contentHeight);
    dst[y * dstPitch + x] = src[srcY * srcPitch + srcX];

    if ((x % 2) == 0 && (y % 2) == 0) {
        const int localUvX = max(0, min(contentWidth - 1, localX + 1));
        const int localUvY = max(0, min(contentHeight - 1, localY + 1));
        const int srcUvX = min(srcWidth - 2, (cropX + ((localUvX * cropWidth) / contentWidth)) & ~1);
        const int srcUvY = min((srcHeight / 2) - 1, (cropY + ((localUvY * cropHeight) / contentHeight)) / 2);
        const unsigned char* srcUv = src + srcPitch * srcSurfaceHeight + srcUvY * srcPitch + srcUvX;
        unsigned char* dstUv = dst + dstChromaOffset + (y / 2) * dstPitch + x;
        dstUv[0] = srcUv[0];
        dstUv[1] = srcUv[1];
    }
}

__global__ void overlayContentTransformNv12Kernel(
    const unsigned char* src,
    int srcPitch,
    int srcWidth,
    int srcHeight,
    int srcSurfaceHeight,
    unsigned char* dst,
    int dstPitch,
    int dstChromaOffset,
    int dstWidth,
    int dstHeight,
    int regionX,
    int regionY,
    int regionWidth,
    int regionHeight,
    int contentX,
    int contentY,
    int contentWidth,
    int contentHeight,
    int radius,
    float zoomScale,
    float invZoomScale,
    float srcScaleX,
    float srcScaleY,
    int sourceCropX,
    int sourceCropY,
    float zoomX,
    float zoomY) {
    const int localX = blockIdx.x * blockDim.x + threadIdx.x;
    const int localY = blockIdx.y * blockDim.y + threadIdx.y;
    if (localX >= regionWidth || localY >= regionHeight) {
        return;
    }

    const int x = regionX + localX;
    const int y = regionY + localY;
    if (x < 0 || y < 0 || x >= dstWidth || y >= dstHeight) {
        return;
    }

    const float layoutXf = (static_cast<float>(x) - zoomX) * invZoomScale;
    const float layoutYf = (static_cast<float>(y) - zoomY) * invZoomScale;
    const int layoutX = __float2int_rd(layoutXf);
    const int layoutY = __float2int_rd(layoutYf);
    if (!isInsideRoundedRect(layoutX, layoutY, contentX, contentY, contentWidth, contentHeight, radius)) {
        return;
    }

    const float localContentX =
        fminf(static_cast<float>(contentWidth - 1), fmaxf(0.0f, layoutXf - contentX));
    const float localContentY =
        fminf(static_cast<float>(contentHeight - 1), fmaxf(0.0f, layoutYf - contentY));
    const int cropX = max(0, min(sourceCropX, srcWidth - 1));
    const int cropY = max(0, min(sourceCropY, srcHeight - 1));
    const int sx = min(srcWidth - 1, cropX + __float2int_rd(localContentX * srcScaleX));
    const int sy = min(srcHeight - 1, cropY + __float2int_rd(localContentY * srcScaleY));
    dst[y * dstPitch + x] = src[sy * srcPitch + sx];

    if ((x % 2) == 0 && (y % 2) == 0 && x + 1 < dstWidth && y + 1 < dstHeight) {
        const float uvLayoutXf = (static_cast<float>(x + 1) - zoomX) * invZoomScale;
        const float uvLayoutYf = (static_cast<float>(y + 1) - zoomY) * invZoomScale;
        const int uvLayoutX = __float2int_rd(uvLayoutXf);
        const int uvLayoutY = __float2int_rd(uvLayoutYf);
        if (isInsideRoundedRect(
                uvLayoutX,
                uvLayoutY,
                contentX,
                contentY,
                contentWidth,
                contentHeight,
                radius)) {
            const float uvLocalContentX =
                fminf(static_cast<float>(contentWidth - 1), fmaxf(0.0f, uvLayoutXf - contentX));
            const float uvLocalContentY =
                fminf(static_cast<float>(contentHeight - 1), fmaxf(0.0f, uvLayoutYf - contentY));
            const int suvX =
                min(srcWidth - 2, (cropX + __float2int_rd(uvLocalContentX * srcScaleX)) & ~1);
            const int suvY =
                min((srcHeight / 2) - 1, (cropY + __float2int_rd(uvLocalContentY * srcScaleY)) / 2);
            const unsigned char* srcUv = src + srcPitch * srcSurfaceHeight + suvY * srcPitch + suvX;
            unsigned char* dstUv = dst + dstChromaOffset + (y / 2) * dstPitch + x;
            dstUv[0] = srcUv[0];
            dstUv[1] = srcUv[1];
        }
    }
}

__global__ void restoreRoundedContentCornersNv12Kernel(
    unsigned char* dst,
    int dstPitch,
    int dstChromaOffset,
    int dstWidth,
    int dstHeight,
    int contentX,
    int contentY,
    int contentWidth,
    int contentHeight,
    int radius,
    unsigned char backgroundY,
    unsigned char backgroundU,
    unsigned char backgroundV,
    const unsigned char* background) {
    const int localX = blockIdx.x * blockDim.x + threadIdx.x;
    const int localY = blockIdx.y * blockDim.y + threadIdx.y;
    if (localX >= radius || localY >= radius) {
        return;
    }

    const int corner = blockIdx.z;
    const bool right = corner == 1 || corner == 3;
    const bool bottom = corner >= 2;
    const int x = right ? contentX + contentWidth - radius + localX : contentX + localX;
    const int y = bottom ? contentY + contentHeight - radius + localY : contentY + localY;
    if (x < 0 || y < 0 || x >= dstWidth || y >= dstHeight) {
        return;
    }

    if (!isInsideRoundedRect(x, y, contentX, contentY, contentWidth, contentHeight, radius)) {
        dst[y * dstPitch + x] = background ? background[y * dstWidth + x] : backgroundY;
    }

    if ((x % 2) == 0 && (y % 2) == 0 &&
        !isInsideRoundedRect(x + 1, y + 1, contentX, contentY, contentWidth, contentHeight, radius)) {
        unsigned char* dstUv = dst + dstChromaOffset + (y / 2) * dstPitch + x;
        if (background) {
            const unsigned char* bgUv = background + dstWidth * dstHeight + (y / 2) * dstWidth + x;
            dstUv[0] = bgUv[0];
            dstUv[1] = bgUv[1];
        } else {
            dstUv[0] = backgroundU;
            dstUv[1] = backgroundV;
        }
    }
}

__device__ bool pointInCursorPolygon(float x, float y, bool inner) {
    constexpr int kCount = 7;
    const float outerX[kCount] = {2.0f, 61.0f, 45.0f, 57.0f, 38.0f, 27.0f, 13.0f};
    const float outerY[kCount] = {2.0f, 61.0f, 63.0f, 91.0f, 95.0f, 67.0f, 79.0f};
    const float innerX[kCount] = {10.0f, 52.0f, 37.0f, 49.0f, 40.0f, 28.0f, 18.0f};
    const float innerY[kCount] = {11.0f, 53.0f, 53.0f, 78.0f, 83.0f, 57.0f, 66.0f};
    const float* px = inner ? innerX : outerX;
    const float* py = inner ? innerY : outerY;

    bool inside = false;
    for (int index = 0, previous = kCount - 1; index < kCount; previous = index++) {
        const bool crosses = ((py[index] > y) != (py[previous] > y)) &&
            (x < (px[previous] - px[index]) * (y - py[index]) / (py[previous] - py[index]) + px[index]);
        if (crosses) {
            inside = !inside;
        }
    }
    return inside;
}

__device__ int cursorMaskAt(
    int x,
    int y,
    int cursorX,
    int cursorY,
    int cursorWidth,
    int cursorHeight) {
    if (cursorWidth <= 0 || cursorHeight <= 0 || x < cursorX || y < cursorY ||
        x >= cursorX + cursorWidth || y >= cursorY + cursorHeight) {
        return 0;
    }

    const float localX = static_cast<float>(x - cursorX) * 64.0f / static_cast<float>(cursorWidth);
    const float localY = static_cast<float>(y - cursorY) * 96.0f / static_cast<float>(cursorHeight);
    if (pointInCursorPolygon(localX, localY, true)) {
        return 2;
    }
    if (pointInCursorPolygon(localX, localY, false)) {
        return 1;
    }
    return 0;
}

__device__ unsigned char clampByteDevice(int value) {
    return static_cast<unsigned char>(min(255, max(0, value)));
}

__device__ unsigned char blendByte(unsigned char base, unsigned char overlay, int alpha) {
    return static_cast<unsigned char>(
        (static_cast<int>(base) * (255 - alpha) + static_cast<int>(overlay) * alpha + 127) / 255);
}

__device__ bool sampleCursorAtlasNv12(
    const unsigned char* atlas,
    int atlasWidth,
    int atlasHeight,
    int entryX,
    int entryY,
    int entryWidth,
    int entryHeight,
    int cursorX,
    int cursorY,
    int cursorWidth,
    int cursorHeight,
    int x,
    int y,
    unsigned char* outY,
    unsigned char* outU,
    unsigned char* outV,
    int* outAlpha) {
    if (!atlas || cursorWidth <= 0 || cursorHeight <= 0 || entryWidth <= 0 || entryHeight <= 0 ||
        x < cursorX || y < cursorY || x >= cursorX + cursorWidth || y >= cursorY + cursorHeight) {
        return false;
    }

    const int localX = max(0, min(cursorWidth - 1, x - cursorX));
    const int localY = max(0, min(cursorHeight - 1, y - cursorY));
    const int sampleX = entryX + min(entryWidth - 1, (localX * entryWidth) / cursorWidth);
    const int sampleY = entryY + min(entryHeight - 1, (localY * entryHeight) / cursorHeight);
    if (sampleX < 0 || sampleY < 0 || sampleX >= atlasWidth || sampleY >= atlasHeight) {
        return false;
    }

    const int offset = (sampleY * atlasWidth + sampleX) * 4;
    const int alpha = atlas[offset + 3];
    if (alpha <= 0) {
        return false;
    }

    const int r = atlas[offset];
    const int g = atlas[offset + 1];
    const int b = atlas[offset + 2];
    *outY = clampByteDevice(((66 * r + 129 * g + 25 * b + 128) >> 8) + 16);
    *outU = clampByteDevice(((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128);
    *outV = clampByteDevice(((112 * r - 94 * g - 18 * b + 128) >> 8) + 128);
    *outAlpha = alpha;
    return true;
}

__device__ int sampleCursorAtlasAlpha(
    const unsigned char* atlas,
    int atlasWidth,
    int atlasHeight,
    int entryX,
    int entryY,
    int entryWidth,
    int entryHeight,
    int cursorX,
    int cursorY,
    int cursorWidth,
    int cursorHeight,
    int x,
    int y) {
    if (!atlas || cursorWidth <= 0 || cursorHeight <= 0 || entryWidth <= 0 || entryHeight <= 0 ||
        x < cursorX || y < cursorY || x >= cursorX + cursorWidth || y >= cursorY + cursorHeight) {
        return 0;
    }

    const int localX = max(0, min(cursorWidth - 1, x - cursorX));
    const int localY = max(0, min(cursorHeight - 1, y - cursorY));
    const int sampleX = entryX + min(entryWidth - 1, (localX * entryWidth) / cursorWidth);
    const int sampleY = entryY + min(entryHeight - 1, (localY * entryHeight) / cursorHeight);
    if (sampleX < 0 || sampleY < 0 || sampleX >= atlasWidth || sampleY >= atlasHeight) {
        return 0;
    }

    return atlas[(sampleY * atlasWidth + sampleX) * 4 + 3];
}

__device__ int sampleCursorAtlasShadowAlpha(
    const unsigned char* atlas,
    int atlasWidth,
    int atlasHeight,
    int entryX,
    int entryY,
    int entryWidth,
    int entryHeight,
    int cursorX,
    int cursorY,
    int cursorWidth,
    int cursorHeight,
    int x,
    int y) {
    int weightedAlpha = 0;
    weightedAlpha += sampleCursorAtlasAlpha(
        atlas,
        atlasWidth,
        atlasHeight,
        entryX,
        entryY,
        entryWidth,
        entryHeight,
        cursorX,
        cursorY + 2,
        cursorWidth,
        cursorHeight,
        x,
        y) * 20;
    weightedAlpha += sampleCursorAtlasAlpha(
        atlas,
        atlasWidth,
        atlasHeight,
        entryX,
        entryY,
        entryWidth,
        entryHeight,
        cursorX - 2,
        cursorY + 2,
        cursorWidth,
        cursorHeight,
        x,
        y) * 6;
    weightedAlpha += sampleCursorAtlasAlpha(
        atlas,
        atlasWidth,
        atlasHeight,
        entryX,
        entryY,
        entryWidth,
        entryHeight,
        cursorX + 2,
        cursorY + 2,
        cursorWidth,
        cursorHeight,
        x,
        y) * 6;
    weightedAlpha += sampleCursorAtlasAlpha(
        atlas,
        atlasWidth,
        atlasHeight,
        entryX,
        entryY,
        entryWidth,
        entryHeight,
        cursorX,
        cursorY,
        cursorWidth,
        cursorHeight,
        x,
        y) * 4;
    weightedAlpha += sampleCursorAtlasAlpha(
        atlas,
        atlasWidth,
        atlasHeight,
        entryX,
        entryY,
        entryWidth,
        entryHeight,
        cursorX,
        cursorY + 4,
        cursorWidth,
        cursorHeight,
        x,
        y) * 4;
    return min(255, weightedAlpha / 100);
}

__device__ __forceinline__ unsigned char temporalAccumulateByte(
    unsigned char current,
    unsigned char value,
    unsigned int weightFixed,
    int accumulateMode) {
    if (accumulateMode == 0) {
        // Legacy direct write (non-temporal composites).
        return value;
    }
    const int weighted = (static_cast<int>(weightFixed) * static_cast<int>(value) + 128) >> 8;
    if (accumulateMode == 1) {
        // First temporal sample: replace (the target is not pre-zeroed, so this
        // must not read stale buffer contents). Matches the previous
        // zero-fill + (weight * value + 128) >> 8 accumulate exactly.
        return static_cast<unsigned char>(min(255, weighted));
    }
    // Subsequent temporal samples: saturating accumulate into the target.
    return static_cast<unsigned char>(min(255, static_cast<int>(current) + weighted));
}

// Accumulates the temporal sample weights applied to the invariant background
// into one full-frame pass. Every pixel outside the transformed content
// bounding box maps outside the content rect for every temporal sample, so its
// per-sample composite value is always the background; the saturating weighted
// sum of the background is therefore identical for all samples and can be
// computed once per output frame. The term-for-term math reproduces the
// replace-then-saturate-accumulate chain of compositeStaticNv12Kernel exactly
// (same (weight * value + 128) >> 8 per sample, same saturation), including
// per-sample rounding, so pixels served by this pass are bit-identical to the
// previous per-sample full-frame composites.
__global__ void accumulateBackgroundNv12Kernel(
    unsigned char* dst,
    int dstPitch,
    int dstChromaOffset,
    int dstWidth,
    int dstHeight,
    unsigned char backgroundY,
    unsigned char backgroundU,
    unsigned char backgroundV,
    const unsigned char* background,
    const unsigned int* sampleWeights,
    int sampleCount) {
    const int x = blockIdx.x * blockDim.x + threadIdx.x;
    const int y = blockIdx.y * blockDim.y + threadIdx.y;
    if (x >= dstWidth || y >= dstHeight || sampleCount <= 0) {
        return;
    }

    const unsigned int bgY = background ? background[y * dstWidth + x] : backgroundY;
    unsigned int yAcc = (sampleWeights[0] * bgY + 128u) >> 8;
    for (int index = 1; index < sampleCount; ++index) {
        const unsigned int term = (sampleWeights[index] * bgY + 128u) >> 8;
        yAcc = min(255u, yAcc + term);
    }
    dst[y * dstPitch + x] = static_cast<unsigned char>(yAcc);

    if ((x % 2) == 0 && (y % 2) == 0) {
        unsigned int bgU = backgroundU;
        unsigned int bgV = backgroundV;
        if (background) {
            const unsigned char* bgUv = background + dstWidth * dstHeight + (y / 2) * dstWidth + x;
            bgU = bgUv[0];
            bgV = bgUv[1];
        }
        unsigned int uAcc = (sampleWeights[0] * bgU + 128u) >> 8;
        unsigned int vAcc = (sampleWeights[0] * bgV + 128u) >> 8;
        for (int index = 1; index < sampleCount; ++index) {
            const unsigned int uTerm = (sampleWeights[index] * bgU + 128u) >> 8;
            const unsigned int vTerm = (sampleWeights[index] * bgV + 128u) >> 8;
            uAcc = min(255u, uAcc + uTerm);
            vAcc = min(255u, vAcc + vTerm);
        }
        unsigned char* dstUv = dst + dstChromaOffset + (y / 2) * dstPitch + x;
        dstUv[0] = static_cast<unsigned char>(uAcc);
        dstUv[1] = static_cast<unsigned char>(vAcc);
    }
}

__global__ void compositeStaticNv12Kernel(
    const unsigned char* src,
    int srcPitch,
    int srcWidth,
    int srcHeight,
    int srcSurfaceHeight,
    unsigned char* dst,
    int dstPitch,
    int dstChromaOffset,
    int dstWidth,
    int dstHeight,
    int regionX,
    int regionY,
    int regionWidth,
    int regionHeight,
    int contentX,
    int contentY,
    int contentWidth,
    int contentHeight,
    int sourceCropX,
    int sourceCropY,
    int sourceCropWidth,
    int sourceCropHeight,
    int radius,
    unsigned char backgroundY,
    unsigned char backgroundU,
    unsigned char backgroundV,
    const unsigned char* background,
    int shadowOffsetY,
    int shadowIntensityPct,
    const unsigned char* webcam,
    int webcamX,
    int webcamY,
    int webcamSize,
    int webcamFrameWidth,
    int webcamFrameHeight,
    int webcamRadius,
    bool webcamMirror,
    bool cursorVisible,
    int cursorX,
    int cursorY,
    int cursorWidth,
    int cursorHeight,
    const unsigned char* cursorAtlasRgba,
    int cursorAtlasWidth,
    int cursorAtlasHeight,
    int cursorAtlasEntryX,
    int cursorAtlasEntryY,
    int cursorAtlasEntryWidth,
    int cursorAtlasEntryHeight,
    bool zoomEnabled,
    float zoomScale,
    float zoomX,
    float zoomY,
    unsigned int temporalWeightFixed,
    int temporalAccumulateMode) {
    const int localX = blockIdx.x * blockDim.x + threadIdx.x;
    const int localY = blockIdx.y * blockDim.y + threadIdx.y;
    if (localX >= regionWidth || localY >= regionHeight) {
        return;
    }
    const int x = regionX + localX;
    const int y = regionY + localY;
    if (x < 0 || y < 0 || x >= dstWidth || y >= dstHeight) {
        return;
    }

    const bool zoomActive = zoomEnabled && zoomScale > 0.01f;
    const float safeZoomScale = fmaxf(zoomScale, 0.01f);
    const float layoutXf = zoomActive ? (static_cast<float>(x) - zoomX) / safeZoomScale : static_cast<float>(x);
    const float layoutYf = zoomActive ? (static_cast<float>(y) - zoomY) / safeZoomScale : static_cast<float>(y);
    const int layoutX = static_cast<int>(floorf(layoutXf));
    const int layoutY = static_cast<int>(floorf(layoutYf));

    const int cropX = max(0, min(sourceCropX, srcWidth - 1));
    const int cropY = max(0, min(sourceCropY, srcHeight - 1));
    const int cropWidth = max(1, min(sourceCropWidth > 0 ? sourceCropWidth : srcWidth, srcWidth - cropX));
    const int cropHeight = max(1, min(sourceCropHeight > 0 ? sourceCropHeight : srcHeight, srcHeight - cropY));
    const bool inside = isInsideRoundedRect(layoutX, layoutY, contentX, contentY, contentWidth, contentHeight, radius);
    unsigned char outY = background ? background[y * dstWidth + x] : backgroundY;
    if (inside) {
        const float localX = fminf(static_cast<float>(contentWidth - 1), fmaxf(0.0f, layoutXf - contentX));
        const float localY = fminf(static_cast<float>(contentHeight - 1), fmaxf(0.0f, layoutYf - contentY));
        const int sx = min(srcWidth - 1, cropX + static_cast<int>((localX * cropWidth) / contentWidth));
        const int sy = min(srcHeight - 1, cropY + static_cast<int>((localY * cropHeight) / contentHeight));
        outY = src[sy * srcPitch + sx];
    } else {
        const bool shadowInside =
            shadowIntensityPct > 0 &&
            isInsideRoundedRect(
                layoutX,
                layoutY,
                contentX,
                contentY + shadowOffsetY,
                contentWidth,
                contentHeight,
                radius + 8);
        if (shadowInside) {
            const int darkenPct = min(75, max(0, shadowIntensityPct / 2));
            outY = static_cast<unsigned char>((static_cast<int>(outY) * (100 - darkenPct)) / 100);
        }
    }
    if (webcam && isInsideRoundedRect(x, y, webcamX, webcamY, webcamSize, webcamSize, webcamRadius)) {
        const int localX = max(0, min(webcamSize - 1, x - webcamX));
        const int localY = max(0, min(webcamSize - 1, y - webcamY));
        const int sampleX = min(webcamFrameWidth - 1, (localX * webcamFrameWidth) / webcamSize);
        const int sampleY = min(webcamFrameHeight - 1, (localY * webcamFrameHeight) / webcamSize);
        const int mirroredX = webcamMirror ? webcamFrameWidth - 1 - sampleX : sampleX;
        outY = webcam[sampleY * webcamFrameWidth + mirroredX];
    }
    unsigned char cursorYValue = 0;
    unsigned char cursorUValue = 128;
    unsigned char cursorVValue = 128;
    int cursorAlpha = 0;
    const int cursorShadowAlpha = cursorVisible && cursorAtlasRgba
        ? sampleCursorAtlasShadowAlpha(
            cursorAtlasRgba,
            cursorAtlasWidth,
            cursorAtlasHeight,
            cursorAtlasEntryX,
            cursorAtlasEntryY,
            cursorAtlasEntryWidth,
            cursorAtlasEntryHeight,
            cursorX,
            cursorY,
            cursorWidth,
            cursorHeight,
            x,
            y)
        : 0;
    if (cursorShadowAlpha > 0) {
        outY = blendByte(outY, 16, cursorShadowAlpha);
    }
    const bool cursorAtlasHit =
        cursorVisible &&
        sampleCursorAtlasNv12(
            cursorAtlasRgba,
            cursorAtlasWidth,
            cursorAtlasHeight,
            cursorAtlasEntryX,
            cursorAtlasEntryY,
            cursorAtlasEntryWidth,
            cursorAtlasEntryHeight,
            cursorX,
            cursorY,
            cursorWidth,
            cursorHeight,
            x,
            y,
            &cursorYValue,
            &cursorUValue,
            &cursorVValue,
            &cursorAlpha);
    if (cursorAtlasHit) {
        outY = blendByte(outY, cursorYValue, cursorAlpha);
    } else {
        const int cursorMask = cursorVisible && !cursorAtlasRgba
            ? cursorMaskAt(x, y, cursorX, cursorY, cursorWidth, cursorHeight)
            : 0;
        if (cursorMask == 1) {
            outY = 235;
        } else if (cursorMask == 2) {
            outY = 16;
        }
    }
    dst[y * dstPitch + x] = temporalAccumulateByte(
        dst[y * dstPitch + x],
        outY,
        temporalWeightFixed,
        temporalAccumulateMode);

    if ((x % 2) == 0 && (y % 2) == 0) {
        unsigned char* dstUv = dst + dstChromaOffset + (y / 2) * dstPitch + x;
        unsigned char outU = backgroundU;
        unsigned char outV = backgroundV;
        const float uvLayoutXf =
            zoomActive ? (static_cast<float>(x + 1) - zoomX) / safeZoomScale : static_cast<float>(x + 1);
        const float uvLayoutYf =
            zoomActive ? (static_cast<float>(y + 1) - zoomY) / safeZoomScale : static_cast<float>(y + 1);
        const int uvLayoutX = static_cast<int>(floorf(uvLayoutXf));
        const int uvLayoutY = static_cast<int>(floorf(uvLayoutYf));
        const bool uvInside = isInsideRoundedRect(
            uvLayoutX,
            uvLayoutY,
            contentX,
            contentY,
            contentWidth,
            contentHeight,
            radius);
        if (uvInside) {
            const float localX = fminf(static_cast<float>(contentWidth - 1), fmaxf(0.0f, uvLayoutXf - contentX));
            const float localY = fminf(static_cast<float>(contentHeight - 1), fmaxf(0.0f, uvLayoutYf - contentY));
            const int suvX =
                min(srcWidth - 2, (cropX + static_cast<int>((localX * cropWidth) / contentWidth)) & ~1);
            const int suvY =
                min((srcHeight / 2) - 1, (cropY + static_cast<int>(localY * cropHeight / contentHeight)) / 2);
            const unsigned char* srcUv = src + srcPitch * srcSurfaceHeight + suvY * srcPitch + suvX;
            outU = srcUv[0];
            outV = srcUv[1];
        } else {
            if (background) {
                const unsigned char* bgUv = background + dstWidth * dstHeight + (y / 2) * dstWidth + x;
                outU = bgUv[0];
                outV = bgUv[1];
            } else {
                outU = backgroundU;
                outV = backgroundV;
            }
        }
        if (webcam &&
            isInsideRoundedRect(
                x + 1,
                y + 1,
                webcamX,
                webcamY,
                webcamSize,
                webcamSize,
                webcamRadius)) {
            const int localX = max(0, min(webcamSize - 1, x + 1 - webcamX));
            const int localY = max(0, min(webcamSize - 1, y + 1 - webcamY));
            const int sampleX = min(webcamFrameWidth - 1, (localX * webcamFrameWidth) / webcamSize);
            const int sampleY = min(webcamFrameHeight - 1, (localY * webcamFrameHeight) / webcamSize);
            const int mirroredX = webcamMirror ? webcamFrameWidth - 1 - sampleX : sampleX;
            const int webcamUvX = min(webcamFrameWidth - 2, mirroredX & ~1);
            const int webcamUvY = min((webcamFrameHeight / 2) - 1, sampleY / 2);
            const unsigned char* webcamUv =
                webcam + webcamFrameWidth * webcamFrameHeight + webcamUvY * webcamFrameWidth + webcamUvX;
            outU = webcamUv[0];
            outV = webcamUv[1];
        }
        unsigned char cursorUvY = 0;
        unsigned char cursorUvU = 128;
        unsigned char cursorUvV = 128;
        int cursorUvAlpha = 0;
        const int cursorUvShadowAlpha = cursorVisible && cursorAtlasRgba
            ? sampleCursorAtlasShadowAlpha(
                cursorAtlasRgba,
                cursorAtlasWidth,
                cursorAtlasHeight,
                cursorAtlasEntryX,
                cursorAtlasEntryY,
                cursorAtlasEntryWidth,
                cursorAtlasEntryHeight,
                cursorX,
                cursorY,
                cursorWidth,
                cursorHeight,
                x + 1,
                y + 1)
            : 0;
        if (cursorUvShadowAlpha > 0) {
            outU = blendByte(outU, 128, cursorUvShadowAlpha);
            outV = blendByte(outV, 128, cursorUvShadowAlpha);
        }
        const bool cursorAtlasUvHit =
            cursorVisible &&
            sampleCursorAtlasNv12(
                cursorAtlasRgba,
                cursorAtlasWidth,
                cursorAtlasHeight,
                cursorAtlasEntryX,
                cursorAtlasEntryY,
                cursorAtlasEntryWidth,
                cursorAtlasEntryHeight,
                cursorX,
                cursorY,
                cursorWidth,
                cursorHeight,
                x + 1,
                y + 1,
                &cursorUvY,
                &cursorUvU,
                &cursorUvV,
                &cursorUvAlpha);
        if (cursorAtlasUvHit) {
            outU = blendByte(outU, cursorUvU, cursorUvAlpha);
            outV = blendByte(outV, cursorUvV, cursorUvAlpha);
        } else {
            const int cursorUvMask =
                cursorVisible && !cursorAtlasRgba
                    ? cursorMaskAt(x + 1, y + 1, cursorX, cursorY, cursorWidth, cursorHeight)
                    : 0;
            if (cursorUvMask > 0) {
                outU = 128;
                outV = 128;
            }
        }
        dstUv[0] = temporalAccumulateByte(
            dstUv[0],
            outU,
            temporalWeightFixed,
            temporalAccumulateMode);
        dstUv[1] = temporalAccumulateByte(
            dstUv[1],
            outV,
            temporalWeightFixed,
            temporalAccumulateMode);
    }
}

// Fused constant-transform temporal composition: evaluates the source + layout
// composite value exactly once per pixel (the same content/bg/shadow selection
// compositeStaticNv12Kernel makes for the temporal path, where webcam/cursor
// are applied afterward) and then applies the existing fixed-point weights in
// order: sample 0 replaces with (w0 * v + 128) >> 8 and later samples
// saturate-accumulate (w * v + 128) >> 8. This is only launched when the
// stationary shutter-window check proved every sample resolves to the same
// camera transform (bit-identical scale/x/y), so the per-sample composite value
// is identical for every sample and the term-for-term math reproduces the
// per-sample replace-then-accumulate chain exactly, including per-sample
// rounding and progressive saturation.
__global__ void compositeStaticStationaryNv12Kernel(
    const unsigned char* src,
    int srcPitch,
    int srcWidth,
    int srcHeight,
    int srcSurfaceHeight,
    unsigned char* dst,
    int dstPitch,
    int dstChromaOffset,
    int dstWidth,
    int dstHeight,
    int regionX,
    int regionY,
    int regionWidth,
    int regionHeight,
    int contentX,
    int contentY,
    int contentWidth,
    int contentHeight,
    int sourceCropX,
    int sourceCropY,
    int sourceCropWidth,
    int sourceCropHeight,
    int radius,
    unsigned char backgroundY,
    unsigned char backgroundU,
    unsigned char backgroundV,
    const unsigned char* background,
    int shadowOffsetY,
    int shadowIntensityPct,
    bool zoomEnabled,
    float zoomScale,
    float zoomX,
    float zoomY,
    const unsigned int* sampleWeights,
    int sampleCount) {
    const int localX = blockIdx.x * blockDim.x + threadIdx.x;
    const int localY = blockIdx.y * blockDim.y + threadIdx.y;
    if (localX >= regionWidth || localY >= regionHeight || sampleCount <= 0) {
        return;
    }
    const int x = regionX + localX;
    const int y = regionY + localY;
    if (x < 0 || y < 0 || x >= dstWidth || y >= dstHeight) {
        return;
    }

    const bool zoomActive = zoomEnabled && zoomScale > 0.01f;
    const float safeZoomScale = fmaxf(zoomScale, 0.01f);
    const float layoutXf =
        zoomActive ? (static_cast<float>(x) - zoomX) / safeZoomScale : static_cast<float>(x);
    const float layoutYf =
        zoomActive ? (static_cast<float>(y) - zoomY) / safeZoomScale : static_cast<float>(y);
    const int layoutX = static_cast<int>(floorf(layoutXf));
    const int layoutY = static_cast<int>(floorf(layoutYf));

    const int cropX = max(0, min(sourceCropX, srcWidth - 1));
    const int cropY = max(0, min(sourceCropY, srcHeight - 1));
    const int cropWidth = max(1, min(sourceCropWidth > 0 ? sourceCropWidth : srcWidth, srcWidth - cropX));
    const int cropHeight = max(1, min(sourceCropHeight > 0 ? sourceCropHeight : srcHeight, srcHeight - cropY));
    const bool inside =
        isInsideRoundedRect(layoutX, layoutY, contentX, contentY, contentWidth, contentHeight, radius);
    unsigned char outY = background ? background[y * dstWidth + x] : backgroundY;
    if (inside) {
        const float localX =
            fminf(static_cast<float>(contentWidth - 1), fmaxf(0.0f, layoutXf - contentX));
        const float localY =
            fminf(static_cast<float>(contentHeight - 1), fmaxf(0.0f, layoutYf - contentY));
        const int sx = min(srcWidth - 1, cropX + static_cast<int>((localX * cropWidth) / contentWidth));
        const int sy = min(srcHeight - 1, cropY + static_cast<int>((localY * cropHeight) / contentHeight));
        outY = src[sy * srcPitch + sx];
    } else {
        const bool shadowInside =
            shadowIntensityPct > 0 &&
            isInsideRoundedRect(
                layoutX,
                layoutY,
                contentX,
                contentY + shadowOffsetY,
                contentWidth,
                contentHeight,
                radius + 8);
        if (shadowInside) {
            const int darkenPct = min(75, max(0, shadowIntensityPct / 2));
            outY = static_cast<unsigned char>((static_cast<int>(outY) * (100 - darkenPct)) / 100);
        }
    }
    unsigned int yAcc = (sampleWeights[0] * outY + 128u) >> 8;
    for (int index = 1; index < sampleCount; ++index) {
        const unsigned int term = (sampleWeights[index] * outY + 128u) >> 8;
        yAcc = min(255u, yAcc + term);
    }
    dst[y * dstPitch + x] = static_cast<unsigned char>(yAcc);

    if ((x % 2) == 0 && (y % 2) == 0) {
        unsigned char* dstUv = dst + dstChromaOffset + (y / 2) * dstPitch + x;
        unsigned char outU = backgroundU;
        unsigned char outV = backgroundV;
        const float uvLayoutXf =
            zoomActive ? (static_cast<float>(x + 1) - zoomX) / safeZoomScale : static_cast<float>(x + 1);
        const float uvLayoutYf =
            zoomActive ? (static_cast<float>(y + 1) - zoomY) / safeZoomScale : static_cast<float>(y + 1);
        const int uvLayoutX = static_cast<int>(floorf(uvLayoutXf));
        const int uvLayoutY = static_cast<int>(floorf(uvLayoutYf));
        const bool uvInside = isInsideRoundedRect(
            uvLayoutX,
            uvLayoutY,
            contentX,
            contentY,
            contentWidth,
            contentHeight,
            radius);
        if (uvInside) {
            const float localX =
                fminf(static_cast<float>(contentWidth - 1), fmaxf(0.0f, uvLayoutXf - contentX));
            const float localY =
                fminf(static_cast<float>(contentHeight - 1), fmaxf(0.0f, uvLayoutYf - contentY));
            const int suvX =
                min(srcWidth - 2, (cropX + static_cast<int>((localX * cropWidth) / contentWidth)) & ~1);
            const int suvY =
                min((srcHeight / 2) - 1, (cropY + static_cast<int>(localY * cropHeight / contentHeight)) / 2);
            const unsigned char* srcUv = src + srcPitch * srcSurfaceHeight + suvY * srcPitch + suvX;
            outU = srcUv[0];
            outV = srcUv[1];
        } else if (background) {
            const unsigned char* bgUv = background + dstWidth * dstHeight + (y / 2) * dstWidth + x;
            outU = bgUv[0];
            outV = bgUv[1];
        }
        unsigned int uAcc = (sampleWeights[0] * outU + 128u) >> 8;
        unsigned int vAcc = (sampleWeights[0] * outV + 128u) >> 8;
        for (int index = 1; index < sampleCount; ++index) {
            const unsigned int uTerm = (sampleWeights[index] * outU + 128u) >> 8;
            const unsigned int vTerm = (sampleWeights[index] * outV + 128u) >> 8;
            uAcc = min(255u, uAcc + uTerm);
            vAcc = min(255u, vAcc + vTerm);
        }
        dstUv[0] = static_cast<unsigned char>(uAcc);
        dstUv[1] = static_cast<unsigned char>(vAcc);
    }
}

__global__ void overlayWebcamNv12Kernel(
    unsigned char* dst,
    int dstPitch,
    int dstChromaOffset,
    int dstWidth,
    int dstHeight,
    const unsigned char* webcam,
    int regionX,
    int regionY,
    int regionWidth,
    int regionHeight,
    int webcamX,
    int webcamY,
    int webcamSize,
    int webcamFrameWidth,
    int webcamFrameHeight,
    int webcamRadius,
    bool webcamMirror) {
    const int localX = blockIdx.x * blockDim.x + threadIdx.x;
    const int localY = blockIdx.y * blockDim.y + threadIdx.y;
    if (!webcam || localX >= regionWidth || localY >= regionHeight) {
        return;
    }

    const int x = regionX + localX;
    const int y = regionY + localY;
    if (x < 0 || y < 0 || x >= dstWidth || y >= dstHeight) {
        return;
    }

    if (isInsideRoundedRect(x, y, webcamX, webcamY, webcamSize, webcamSize, webcamRadius)) {
        const int webcamLocalX = max(0, min(webcamSize - 1, x - webcamX));
        const int webcamLocalY = max(0, min(webcamSize - 1, y - webcamY));
        const int sampleX = min(webcamFrameWidth - 1, (webcamLocalX * webcamFrameWidth) / webcamSize);
        const int sampleY = min(webcamFrameHeight - 1, (webcamLocalY * webcamFrameHeight) / webcamSize);
        const int mirroredX = webcamMirror ? webcamFrameWidth - 1 - sampleX : sampleX;
        dst[y * dstPitch + x] = webcam[sampleY * webcamFrameWidth + mirroredX];
    }

    if ((x % 2) == 0 && (y % 2) == 0 && x + 1 < dstWidth && y + 1 < dstHeight &&
        isInsideRoundedRect(x + 1, y + 1, webcamX, webcamY, webcamSize, webcamSize, webcamRadius)) {
        const int uvLocalX = max(0, min(webcamSize - 1, x + 1 - webcamX));
        const int uvLocalY = max(0, min(webcamSize - 1, y + 1 - webcamY));
        const int uvSampleX = min(webcamFrameWidth - 1, (uvLocalX * webcamFrameWidth) / webcamSize);
        const int uvSampleY = min(webcamFrameHeight - 1, (uvLocalY * webcamFrameHeight) / webcamSize);
        const int uvMirroredX = webcamMirror ? webcamFrameWidth - 1 - uvSampleX : uvSampleX;
        const int webcamUvX = min(webcamFrameWidth - 2, uvMirroredX & ~1);
        const int webcamUvY = min((webcamFrameHeight / 2) - 1, uvSampleY / 2);
        const unsigned char* webcamUv =
            webcam + webcamFrameWidth * webcamFrameHeight + webcamUvY * webcamFrameWidth + webcamUvX;
        unsigned char* dstUv = dst + dstChromaOffset + (y / 2) * dstPitch + x;
        dstUv[0] = webcamUv[0];
        dstUv[1] = webcamUv[1];
    }
}

__global__ void overlayCursorNv12Kernel(
    unsigned char* dst,
    int dstPitch,
    int dstChromaOffset,
    int dstWidth,
    int dstHeight,
    int regionX,
    int regionY,
    int regionWidth,
    int regionHeight,
    bool cursorVisible,
    int cursorX,
    int cursorY,
    int cursorWidth,
    int cursorHeight,
    const unsigned char* cursorAtlasRgba,
    int cursorAtlasWidth,
    int cursorAtlasHeight,
    int cursorAtlasEntryX,
    int cursorAtlasEntryY,
    int cursorAtlasEntryWidth,
    int cursorAtlasEntryHeight) {
    const int localX = blockIdx.x * blockDim.x + threadIdx.x;
    const int localY = blockIdx.y * blockDim.y + threadIdx.y;
    if (!cursorVisible || localX >= regionWidth || localY >= regionHeight) {
        return;
    }

    const int x = regionX + localX;
    const int y = regionY + localY;
    if (x < 0 || y < 0 || x >= dstWidth || y >= dstHeight) {
        return;
    }

    unsigned char outY = dst[y * dstPitch + x];
    unsigned char cursorYValue = 0;
    unsigned char cursorUValue = 128;
    unsigned char cursorVValue = 128;
    int cursorAlpha = 0;
    const int cursorShadowAlpha = cursorAtlasRgba
        ? sampleCursorAtlasShadowAlpha(
            cursorAtlasRgba,
            cursorAtlasWidth,
            cursorAtlasHeight,
            cursorAtlasEntryX,
            cursorAtlasEntryY,
            cursorAtlasEntryWidth,
            cursorAtlasEntryHeight,
            cursorX,
            cursorY,
            cursorWidth,
            cursorHeight,
            x,
            y)
        : 0;
    if (cursorShadowAlpha > 0) {
        outY = blendByte(outY, 16, cursorShadowAlpha);
    }
    const bool cursorAtlasHit =
        sampleCursorAtlasNv12(
            cursorAtlasRgba,
            cursorAtlasWidth,
            cursorAtlasHeight,
            cursorAtlasEntryX,
            cursorAtlasEntryY,
            cursorAtlasEntryWidth,
            cursorAtlasEntryHeight,
            cursorX,
            cursorY,
            cursorWidth,
            cursorHeight,
            x,
            y,
            &cursorYValue,
            &cursorUValue,
            &cursorVValue,
            &cursorAlpha);
    if (cursorAtlasHit) {
        outY = blendByte(outY, cursorYValue, cursorAlpha);
    } else {
        const int cursorMask = !cursorAtlasRgba
            ? cursorMaskAt(x, y, cursorX, cursorY, cursorWidth, cursorHeight)
            : 0;
        if (cursorMask == 1) {
            outY = 235;
        } else if (cursorMask == 2) {
            outY = 16;
        }
    }
    dst[y * dstPitch + x] = outY;

    if ((x % 2) == 0 && (y % 2) == 0 && x + 1 < dstWidth && y + 1 < dstHeight) {
        unsigned char* dstUv = dst + dstChromaOffset + (y / 2) * dstPitch + x;
        unsigned char cursorUvY = 0;
        unsigned char cursorUvU = 128;
        unsigned char cursorUvV = 128;
        int cursorUvAlpha = 0;
        const int cursorUvShadowAlpha = cursorAtlasRgba
            ? sampleCursorAtlasShadowAlpha(
                cursorAtlasRgba,
                cursorAtlasWidth,
                cursorAtlasHeight,
                cursorAtlasEntryX,
                cursorAtlasEntryY,
                cursorAtlasEntryWidth,
                cursorAtlasEntryHeight,
                cursorX,
                cursorY,
                cursorWidth,
                cursorHeight,
                x + 1,
                y + 1)
            : 0;
        if (cursorUvShadowAlpha > 0) {
            dstUv[0] = blendByte(dstUv[0], 128, cursorUvShadowAlpha);
            dstUv[1] = blendByte(dstUv[1], 128, cursorUvShadowAlpha);
        }
        const bool cursorAtlasUvHit =
            sampleCursorAtlasNv12(
                cursorAtlasRgba,
                cursorAtlasWidth,
                cursorAtlasHeight,
                cursorAtlasEntryX,
                cursorAtlasEntryY,
                cursorAtlasEntryWidth,
                cursorAtlasEntryHeight,
                cursorX,
                cursorY,
                cursorWidth,
                cursorHeight,
                x + 1,
                y + 1,
                &cursorUvY,
                &cursorUvU,
                &cursorUvV,
                &cursorUvAlpha);
        if (cursorAtlasUvHit) {
            dstUv[0] = blendByte(dstUv[0], cursorUvU, cursorUvAlpha);
            dstUv[1] = blendByte(dstUv[1], cursorUvV, cursorUvAlpha);
        } else {
            const int cursorUvMask =
                !cursorAtlasRgba ? cursorMaskAt(x + 1, y + 1, cursorX, cursorY, cursorWidth, cursorHeight) : 0;
            if (cursorUvMask > 0) {
                dstUv[0] = 128;
                dstUv[1] = 128;
            }
        }
    }
}

__device__ float zoomBlurHash01(int x, int y) {
    unsigned int value = static_cast<unsigned int>(x) * 747796405u +
        static_cast<unsigned int>(y) * 2891336453u + 0x9e3779b9u;
    value = value * 1664525u + 1013904223u;
    value ^= value >> 13;
    return static_cast<float>(value & 0x00ffffffu) / 16777216.0f;
}

// Spatial radial zoom blur equivalent to the renderer's ZoomBlurFilter applied
// to the transformed content. For each pixel the ray toward the blur center is
// sampled with a tent weight profile (4*(p-p^2)) over a fixed sample count,
// matching the pixi-filters zoom-blur shader with innerRadius=0/radius=-1 that
// the interactive renderer configures. Blur is restricted to the content region
// so webcam/cursor/background stay sharp, like the renderer's camera container.
// NV12 chroma is blurred at half resolution with the same radial ray.
__global__ void zoomBlurNv12Kernel(
    const unsigned char* src,
    int srcPitch,
    int srcChromaOffset,
    int dstWidth,
    int dstHeight,
    unsigned char* dst,
    int dstPitch,
    int dstChromaOffset,
    int regionLeft,
    int regionTop,
    int regionRight,
    int regionBottom,
    float centerX,
    float centerY,
    float strength) {
    constexpr int kZoomBlurSamples = 13;
    const int x = blockIdx.x * blockDim.x + threadIdx.x;
    const int y = blockIdx.y * blockDim.y + threadIdx.y;
    if (x < regionLeft || x >= regionRight || y < regionTop || y >= regionBottom ||
        x >= dstWidth || y >= dstHeight) {
        return;
    }

    const float dirX = centerX - static_cast<float>(x);
    const float dirY = centerY - static_cast<float>(y);
    const float offset = zoomBlurHash01(x, y);
    float total = 0.0f;
    float acc = 0.0f;
    for (int t = 0; t < kZoomBlurSamples; ++t) {
        const float percent = (static_cast<float>(t) + offset) / static_cast<float>(kZoomBlurSamples);
        const float weight = 4.0f * (percent - percent * percent);
        const int sx = static_cast<int>(static_cast<float>(x) + dirX * strength * percent);
        const int sy = static_cast<int>(static_cast<float>(y) + dirY * strength * percent);
        const int clampedX = min(regionRight - 1, max(regionLeft, sx));
        const int clampedY = min(regionBottom - 1, max(regionTop, sy));
        acc += weight * static_cast<float>(src[clampedY * srcPitch + clampedX]);
        total += weight;
    }
    dst[y * dstPitch + x] = static_cast<unsigned char>(acc / total + 0.5f);

    if ((x % 2) == 0 && (y % 2) == 0) {
        const int ux = x / 2;
        const int uy = y / 2;
        const int uLeft = regionLeft / 2;
        const int uTop = regionTop / 2;
        const int uRight = min(dstWidth / 2, (regionRight + 1) / 2);
        const int uBottom = min(dstHeight / 2, (regionBottom + 1) / 2);
        if (ux >= uLeft && ux < uRight && uy >= uTop && uy < uBottom) {
            const float uCenterX = centerX * 0.5f;
            const float uCenterY = centerY * 0.5f;
            const float uDirX = uCenterX - static_cast<float>(ux);
            const float uDirY = uCenterY - static_cast<float>(uy);
            const float uOffset = zoomBlurHash01(ux, uy);
            float uTotal = 0.0f;
            float uAcc = 0.0f;
            float vAcc = 0.0f;
            for (int t = 0; t < kZoomBlurSamples; ++t) {
                const float percent = (static_cast<float>(t) + uOffset) / static_cast<float>(kZoomBlurSamples);
                const float weight = 4.0f * (percent - percent * percent);
                const int sux = min(uRight - 1, max(uLeft, static_cast<int>(static_cast<float>(ux) + uDirX * strength * percent)));
                const int suy = min(uBottom - 1, max(uTop, static_cast<int>(static_cast<float>(uy) + uDirY * strength * percent)));
                const unsigned char* uv = src + srcChromaOffset + suy * srcPitch + sux * 2;
                uAcc += weight * static_cast<float>(uv[0]);
                vAcc += weight * static_cast<float>(uv[1]);
                uTotal += weight;
            }
            unsigned char* dstUv = dst + dstChromaOffset + uy * dstPitch + ux * 2;
            dstUv[0] = static_cast<unsigned char>(uAcc / uTotal + 0.5f);
            dstUv[1] = static_cast<unsigned char>(vAcc / uTotal + 0.5f);
        }
    }
}

__device__ void rgbaToNv12Yuv(int r, int g, int b, unsigned char& y, unsigned char& u, unsigned char& v) {
    y = clampByteDevice(((66 * r + 129 * g + 25 * b + 128) >> 8) + 16);
    u = clampByteDevice(((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128);
    v = clampByteDevice(((112 * r - 94 * g - 18 * b + 128) >> 8) + 128);
}

// Blends a transparent top-down RGBA overlay layer over the composed NV12
// frame. Luma is blended per pixel; chroma is averaged over the 2x2 block using
// only the pixels covered by the layer, then blended with the same average
// alpha. This reproduces the renderer contract: the overlay sidecar is drawn
// above the zoom-blurred video layout. The launch rectangle may be the full
// layer (dynamic layers) or a one-time alpha bound (static single-frame
// layers); threads are indexed by region-local coordinates and mapped back to
// layer-local coordinates, so a bounded launch visits exactly the pixels the
// full-frame launch could write.
__global__ void blendOverlayRgbaNv12Kernel(
    const unsigned char* overlay,
    int overlayWidth,
    int overlayHeight,
    unsigned char* dst,
    int dstPitch,
    int dstChromaOffset,
    int dstWidth,
    int dstHeight,
    int layerX,
    int layerY,
    int layerWidth,
    int layerHeight,
    int regionX,
    int regionY,
    int regionWidth,
    int regionHeight) {
    const int localX = blockIdx.x * blockDim.x + threadIdx.x;
    const int localY = blockIdx.y * blockDim.y + threadIdx.y;
    if (localX >= regionWidth || localY >= regionHeight) {
        return;
    }

    const int layerLocalX = regionX + localX;
    const int layerLocalY = regionY + localY;
    if (layerLocalX < 0 || layerLocalY < 0 ||
        layerLocalX >= layerWidth || layerLocalY >= layerHeight) {
        return;
    }

    const int x = layerX + layerLocalX;
    const int y = layerY + layerLocalY;
    if (x < 0 || y < 0 || x >= dstWidth || y >= dstHeight) {
        return;
    }

    const int pixelOffset = (layerLocalY * layerWidth + layerLocalX) * 4;
    const int alpha = overlay[pixelOffset + 3];
    if (alpha > 0) {
        const int r = overlay[pixelOffset];
        const int g = overlay[pixelOffset + 1];
        const int b = overlay[pixelOffset + 2];
        unsigned char overlayY = 0;
        unsigned char overlayU = 0;
        unsigned char overlayV = 0;
        rgbaToNv12Yuv(r, g, b, overlayY, overlayU, overlayV);
        unsigned char* yPtr = dst + y * dstPitch + x;
        *yPtr = blendByte(*yPtr, overlayY, alpha);
    }

    if ((x % 2) == 0 && (y % 2) == 0 && x + 1 < dstWidth && y + 1 < dstHeight) {
        int alphaSum = 0;
        int uSum = 0;
        int vSum = 0;
        int samples = 0;
        for (int dy = 0; dy < 2; ++dy) {
            for (int dx = 0; dx < 2; ++dx) {
                const int sampleX = x + dx;
                const int sampleY = y + dy;
                const int layerLocalX = sampleX - layerX;
                const int layerLocalY = sampleY - layerY;
                if (layerLocalX < 0 || layerLocalY < 0 ||
                    layerLocalX >= layerWidth || layerLocalY >= layerHeight) {
                    continue;
                }
                const int sampleOffset = (layerLocalY * layerWidth + layerLocalX) * 4;
                const int sampleAlpha = overlay[sampleOffset + 3];
                if (sampleAlpha <= 0) {
                    continue;
                }
                const int r = overlay[sampleOffset];
                const int g = overlay[sampleOffset + 1];
                const int b = overlay[sampleOffset + 2];
                unsigned char sampleYValue = 0;
                unsigned char sampleU = 0;
                unsigned char sampleV = 0;
                rgbaToNv12Yuv(r, g, b, sampleYValue, sampleU, sampleV);
                alphaSum += sampleAlpha;
                uSum += static_cast<int>(sampleU) * sampleAlpha;
                vSum += static_cast<int>(sampleV) * sampleAlpha;
                ++samples;
            }
        }
        if (samples > 0) {
            const int avgAlpha = alphaSum / samples;
            const int avgU = uSum / alphaSum;
            const int avgV = vSum / alphaSum;
            unsigned char* uvPtr = dst + dstChromaOffset + (y / 2) * dstPitch + x;
            uvPtr[0] = blendByte(
                uvPtr[0],
                static_cast<unsigned char>(clampByteDevice(avgU)),
                avgAlpha);
            uvPtr[1] = blendByte(
                uvPtr[1],
                static_cast<unsigned char>(clampByteDevice(avgV)),
                avgAlpha);
        }
    }
}

// Accumulates one weighted temporal sample into the composed frame using the
// renderer's cos-tapered shutter plan: dst = clamp(dst + (weightFixed*src)>>8).
// Weights are normalized to sum to 1, so the accumulation is a weighted average;
// NV12 chroma is accumulated per 2x2 block the same way the other blend kernels
// handle it. The target must start at zero (luma 0 / chroma 0) before the first
// sample.
__global__ void prewarmKernel(unsigned int* state, unsigned int seed) {
    const unsigned int index = blockIdx.x * blockDim.x + threadIdx.x;
    unsigned int value = seed ^ (index * 747796405u + 2891336453u);
    for (int iteration = 0; iteration < 256; ++iteration) {
        value = value * 1664525u + 1013904223u;
        value ^= value >> 13;
    }
    state[index] = value;
}

void prewarmCuda(int durationMs) {
    if (durationMs <= 0) {
        return;
    }

    constexpr int blockSize = 256;
    constexpr int blockCount = 256;
    unsigned int* state = nullptr;
    checkCuda(cudaMalloc(&state, blockSize * blockCount * sizeof(unsigned int)), "cudaMalloc prewarm");

    const auto start = std::chrono::steady_clock::now();
    int iteration = 0;
    while (elapsedMs(start, std::chrono::steady_clock::now()) < durationMs) {
        prewarmKernel<<<blockCount, blockSize>>>(state, static_cast<unsigned int>(iteration++));
        checkCuda(cudaGetLastError(), "prewarmKernel");
        checkCuda(cudaDeviceSynchronize(), "cudaDeviceSynchronize prewarm");
    }

    checkCuda(cudaFree(state), "cudaFree prewarm");
}

// Map the high-level encoding mode to the current NVENC preset family. The
// legacy HP/HQ preset GUIDs cannot initialize on Blackwell-era drivers; the
// P1/P4/P6 presets must be paired with a valid tuningInfo (see the nvEncodeAPI
// note: "Presets P1-P7 are only supported with valid
// NV_ENC_INITIALIZE_PARAMS::tuningInfo").
GUID getNvencPresetGuid(const std::string& encodingMode) {
    if (encodingMode == "fast") {
        return NV_ENC_PRESET_P1_GUID;
    }
    if (encodingMode == "quality") {
        return NV_ENC_PRESET_P6_GUID;
    }
    return NV_ENC_PRESET_P4_GUID;
}

NV_ENC_TUNING_INFO getNvencTuningInfo() {
    return NV_ENC_TUNING_INFO_HIGH_QUALITY;
}

uint32_t getNvencMaxBitrate(uint32_t bitrate, const std::string& encodingMode) {
    const uint64_t multiplier = encodingMode == "fast" ? 3 : 2;
    const uint64_t divisor = encodingMode == "fast" ? 2 : 1;
    return static_cast<uint32_t>(
        std::min<uint64_t>(0xffffffffu, (static_cast<uint64_t>(bitrate) * multiplier) / divisor));
}

uint32_t getNvencBufferSize(uint32_t bitrate, const std::string& encodingMode) {
    const uint64_t multiplier = encodingMode == "fast" ? 1 : 2;
    return static_cast<uint32_t>(
        std::min<uint64_t>(0xffffffffu, static_cast<uint64_t>(bitrate) * multiplier));
}

// NVENC capability/version diagnostics captured before encoder creation. The
// compositor never claims codec or rate-control support the device does not
// list; the probe result feeds a minimal-first NV_ENC_CONFIG so optional fields
// (custom VBV, AQ) are only enabled when the hardware reports them.
struct NvencCapabilityProbe {
    bool apiLoaded = false;
    bool sessionOpened = false;
    uint32_t driverMaxApiVersion = 0;
    uint32_t sdkApiVersion = NVENCAPI_VERSION;
    bool h264Supported = false;
    bool hevcSupported = false;
    int supportedRateControlModes = 0;
    bool customVbvBufferSizeSupported = false;
    bool asyncEncodeSupported = false;
    bool temporalAqSupported = false;
    int widthMax = 0;
    int heightMax = 0;
    int mbPerSecMax = 0;
    std::string deviceName;
    int cudaDriverVersion = 0;
    int cudaComputeMajor = 0;
    int cudaComputeMinor = 0;
    std::string error;
};

// Which optional NVENC fields were actually applied after the capability probe.
// Reported so diagnostics never claim a feature (AQ, custom VBV) the hardware
// did not accept.
struct NvencConfigUsed {
    bool customVbv = false;
    bool aq = false;
    std::string rcMode = "vbr";
};

#if defined(_WIN32)
NvencCapabilityProbe probeNvencCapabilities(CUcontext context, GUID requestedCodecGuid) {
    NvencCapabilityProbe probe;
    probe.apiLoaded = false;
    probe.sessionOpened = false;

    HMODULE module = LoadLibraryW(L"nvEncodeAPI64.dll");
    if (!module) {
        probe.error = "nvEncodeAPI64.dll could not be loaded";
        return probe;
    }

    typedef NVENCSTATUS(NVENCAPI* NvEncodeAPIGetMaxSupportedVersion_Type)(uint32_t*);
    typedef NVENCSTATUS(NVENCAPI* NvEncodeAPICreateInstance_Type)(NV_ENCODE_API_FUNCTION_LIST*);
    auto getMaxSupportedVersion = reinterpret_cast<NvEncodeAPIGetMaxSupportedVersion_Type>(
        GetProcAddress(module, "NvEncodeAPIGetMaxSupportedVersion"));
    auto createInstance = reinterpret_cast<NvEncodeAPICreateInstance_Type>(
        GetProcAddress(module, "NvEncodeAPICreateInstance"));
    if (!getMaxSupportedVersion || !createInstance) {
        probe.error = "NVENC API entry points not found";
        FreeLibrary(module);
        return probe;
    }

    NVENCSTATUS status = getMaxSupportedVersion(&probe.driverMaxApiVersion);
    if (status != NV_ENC_SUCCESS) {
        probe.error = "NvEncodeAPIGetMaxSupportedVersion failed: " + std::to_string(status);
        FreeLibrary(module);
        return probe;
    }
    probe.apiLoaded = true;

    NV_ENCODE_API_FUNCTION_LIST functionList = {NV_ENCODE_API_FUNCTION_LIST_VER};
    status = createInstance(&functionList);
    if (status != NV_ENC_SUCCESS) {
        probe.error = "NvEncodeAPICreateInstance failed: " + std::to_string(status);
        FreeLibrary(module);
        return probe;
    }

    // Open a real NVENC session so the capability reads reflect the actual
    // device. nvEncGetEncodeCaps requires a valid encoder handle; a null handle
    // makes every caps query fail, which would silently degrade the encoder
    // config to CBR without custom VBV or AQ. The session is opened against the
    // same CUDA primary context the runtime allocations and the export encoder
    // use and is destroyed before the real encoder session is created.
    NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS openParams = {NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS_VER};
    openParams.deviceType = NV_ENC_DEVICE_TYPE_CUDA;
    openParams.device = context;
    openParams.apiVersion = NVENCAPI_VERSION;
    void* encoder = nullptr;
    status = functionList.nvEncOpenEncodeSessionEx(&openParams, &encoder);
    if (status != NV_ENC_SUCCESS) {
        probe.error = "nvEncOpenEncodeSessionEx failed: " + std::to_string(status);
        FreeLibrary(module);
        return probe;
    }
    probe.sessionOpened = true;

    auto queryCaps = [&](GUID codecGuid, NV_ENC_CAPS cap, int* value) -> bool {
        NV_ENC_CAPS_PARAM capsParam = {NV_ENC_CAPS_PARAM_VER};
        capsParam.capsToQuery = cap;
        return functionList.nvEncGetEncodeCaps(encoder, codecGuid, &capsParam, value) ==
            NV_ENC_SUCCESS;
    };
    // Codec support is reported per codec: each query uses its own GUID so a
    // device that only lists H.264 never reports HEVC support and vice versa.
    int h264Value = 0;
    int hevcValue = 0;
    const bool h264CapsStatus = queryCaps(NV_ENC_CODEC_H264_GUID, NV_ENC_CAPS_NUM_MAX_BFRAMES, &h264Value);
    const bool hevcCapsStatus = queryCaps(NV_ENC_CODEC_HEVC_GUID, NV_ENC_CAPS_NUM_MAX_BFRAMES, &hevcValue);
    probe.h264Supported = h264CapsStatus;
    probe.hevcSupported = hevcCapsStatus;
    // Rate control / VBV / AQ / dimension caps are consumed by the encoder
    // config for the requested output codec, so query them against that codec
    // rather than always H.264.
    queryCaps(requestedCodecGuid, NV_ENC_CAPS_SUPPORTED_RATECONTROL_MODES, &probe.supportedRateControlModes);
    int customVbv = 0;
    int asyncEncode = 0;
    int temporalAq = 0;
    int widthMax = 0;
    int heightMax = 0;
    int mbPerSecMax = 0;
    queryCaps(requestedCodecGuid, NV_ENC_CAPS_SUPPORT_CUSTOM_VBV_BUF_SIZE, &customVbv);
    queryCaps(requestedCodecGuid, NV_ENC_CAPS_ASYNC_ENCODE_SUPPORT, &asyncEncode);
    queryCaps(requestedCodecGuid, NV_ENC_CAPS_SUPPORT_TEMPORAL_AQ, &temporalAq);
    queryCaps(requestedCodecGuid, NV_ENC_CAPS_WIDTH_MAX, &widthMax);
    queryCaps(requestedCodecGuid, NV_ENC_CAPS_HEIGHT_MAX, &heightMax);
    queryCaps(requestedCodecGuid, NV_ENC_CAPS_MB_PER_SEC_MAX, &mbPerSecMax);
    probe.customVbvBufferSizeSupported = customVbv != 0;
    probe.asyncEncodeSupported = asyncEncode != 0;
    probe.temporalAqSupported = temporalAq != 0;
    probe.widthMax = widthMax;
    probe.heightMax = heightMax;
    probe.mbPerSecMax = mbPerSecMax;

    char deviceName[256] = {};
    const CUresult deviceNameResult = cuDeviceGetName(deviceName, sizeof(deviceName), 0);
    if (deviceNameResult == CUDA_SUCCESS) {
        probe.deviceName = deviceName;
    }
    int computeMajor = 0;
    int computeMinor = 0;
    const CUresult computeResult =
        cuDeviceComputeCapability(&computeMajor, &computeMinor, 0);
    if (computeResult == CUDA_SUCCESS) {
        probe.cudaComputeMajor = computeMajor;
        probe.cudaComputeMinor = computeMinor;
    }
    cuDriverGetVersion(&probe.cudaDriverVersion);

    if (functionList.nvEncDestroyEncoder) {
        functionList.nvEncDestroyEncoder(encoder);
    }
    FreeLibrary(module);
    return probe;
}
#else
NvencCapabilityProbe probeNvencCapabilities(CUcontext, GUID) {
    NvencCapabilityProbe probe;
    probe.error = "NVENC probe is only implemented on Windows";
    return probe;
}
#endif

class NvencSink {
public:
    NvencSink(
        CUcontext context,
        int width,
        int height,
        int fps,
        uint32_t bitrate,
        const std::string& outputPath,
        Options layoutOptions,
        const WebcamFrameCache* webcamCache,
        const CursorTrack* cursorTrack,
        const ZoomTrack* zoomTrack,
        OverlayFrameSource* overlaySource,
        const NvencCapabilityProbe& capabilityProbe)
        : encoder_(context, width, height, NV_ENC_BUFFER_FORMAT_NV12),
          width_(width),
          height_(height),
          fps_(fps),
          layoutOptions_(layoutOptions),
          webcamCache_(webcamCache),
          cursorTrack_(cursorTrack),
          zoomTrack_(zoomTrack),
          overlaySource_(overlaySource) {
        loadBackgroundFrame();
        loadWebcamFrame();
        loadCursorAtlas();
        temporalBlurSampleCount_ = layoutOptions_.temporalBlurSampleCount;
        temporalBlurShutterFraction_ = layoutOptions_.temporalBlurShutterFraction;
        temporalBlurWeightPower_ = layoutOptions_.temporalBlurWeightPower;
        // The temporal sample plan depends only on the sample count, shutter
        // fraction, weight curve power, and frame duration; cache it once instead
        // of rebuilding the cos-tapered weights for every output frame.
        if (temporalBlurSampleCount_ >= 3) {
            temporalSamplePlan_ = buildTemporalSamplePlan(
                temporalBlurSampleCount_,
                temporalBlurShutterFraction_,
                temporalBlurWeightPower_,
                1000000.0 / static_cast<double>(fps_));
        }
        // Always use a non-blocking compositor stream: it keeps composite/zoom
        // blur/overlay kernels ordered without implicitly serializing against the
        // legacy default stream, and a single cudaStreamSynchronize before
        // NVENC's synchronous input copy is the only per-frame sync needed.
        checkCuda(cudaStreamCreateWithFlags(&copyStream_, cudaStreamNonBlocking), "cudaStreamCreateWithFlags");
        checkCuda(cudaEventCreate(&compositeStartEvent_), "cudaEventCreate compositeStart");
        checkCuda(cudaEventCreate(&compositeEndEvent_), "cudaEventCreate compositeEnd");
        checkCuda(cudaEventCreate(&blurStartEvent_), "cudaEventCreate blurStart");
        checkCuda(cudaEventCreate(&blurEndEvent_), "cudaEventCreate blurEnd");
        checkCuda(cudaEventCreate(&overlayStartEvent_), "cudaEventCreate overlayStart");
        checkCuda(cudaEventCreate(&overlayEndEvent_), "cudaEventCreate overlayEnd");

        // Query NVENC capability/version diagnostics before building the config.
        // Optional fields (custom VBV, AQ) are only enabled when the device
        // reports them, which avoids NV_ENC_ERR_INVALID_CALL (8) style failures on
        // hardware/driver combinations that do not support the requested fields.
        capabilityProbe_ = capabilityProbe;
        const bool vbrSupported =
            (capabilityProbe_.supportedRateControlModes & (1 << NV_ENC_PARAMS_RC_VBR)) != 0;
        const bool customVbvSupported = capabilityProbe_.customVbvBufferSizeSupported;
        const bool aqSupported = capabilityProbe_.temporalAqSupported;

        NV_ENC_INITIALIZE_PARAMS initializeParams = {NV_ENC_INITIALIZE_PARAMS_VER};
        NV_ENC_CONFIG encodeConfig = {NV_ENC_CONFIG_VER};
        initializeParams.encodeConfig = &encodeConfig;
        const GUID codecGuid = layoutOptions_.outputCodec == OutputCodec::HEVC
            ? NV_ENC_CODEC_HEVC_GUID
            : NV_ENC_CODEC_H264_GUID;
        // Build the encoder config explicitly instead of relying on
        // nvEncGetEncodePresetConfig: on current SDK/driver combos the preset
        // query can return an empty NV_ENC_CONFIG (rc=CONSTQP, no bitrate,
        // chromaFormatIDC=0), which makes nvEncInitializeEncoder fail with
        // NV_ENC_ERR_INVALID_PARAM (error 8) even for a valid NV12 export. The
        // explicit minimal config below is valid on every supported NVENC device.
        initializeParams.encodeGUID = codecGuid;
        initializeParams.presetGUID = getNvencPresetGuid(layoutOptions_.encodingMode);
        initializeParams.tuningInfo = getNvencTuningInfo();
        initializeParams.encodeWidth = static_cast<uint32_t>(width);
        initializeParams.encodeHeight = static_cast<uint32_t>(height);
        initializeParams.darWidth = static_cast<uint32_t>(width);
        initializeParams.darHeight = static_cast<uint32_t>(height);
        initializeParams.maxEncodeWidth = static_cast<uint32_t>(width);
        initializeParams.maxEncodeHeight = static_cast<uint32_t>(height);
        initializeParams.enablePTD = 1;
        initializeParams.frameRateNum = static_cast<uint32_t>(fps);
        initializeParams.frameRateDen = 1;
        // Async NVENC is the default on every supported device and is required for
        // the compositor's stream-ordered pipeline; the capability probe reports it
        // where available, but the sync fallback is never selected on failure.
        initializeParams.enableEncodeAsync = 1;
        encodeConfig.profileGUID = layoutOptions_.outputCodec == OutputCodec::HEVC
            ? NV_ENC_HEVC_PROFILE_MAIN_GUID
            : NV_ENC_H264_PROFILE_HIGH_GUID;
        encodeConfig.gopLength = static_cast<uint32_t>(fps * 2);
        encodeConfig.frameIntervalP = 1;
        // Minimal-first rate control: VBR when the device lists it, otherwise CBR.
        encodeConfig.rcParams.rateControlMode =
            vbrSupported ? NV_ENC_PARAMS_RC_VBR : NV_ENC_PARAMS_RC_CBR;
        encodeConfig.rcParams.averageBitRate = bitrate;
        nvencConfigUsed_.customVbv = customVbvSupported;
        if (customVbvSupported) {
            encodeConfig.rcParams.maxBitRate =
                getNvencMaxBitrate(bitrate, layoutOptions_.encodingMode);
            encodeConfig.rcParams.vbvBufferSize =
                getNvencBufferSize(bitrate, layoutOptions_.encodingMode);
            encodeConfig.rcParams.vbvInitialDelay = bitrate;
        }
        nvencConfigUsed_.aq = aqSupported && layoutOptions_.encodingMode != "fast";
        if (nvencConfigUsed_.aq) {
            encodeConfig.rcParams.enableAQ = 1;
            encodeConfig.rcParams.aqStrength =
                layoutOptions_.encodingMode == "quality" ? 10 : 8;
        }
        if (layoutOptions_.outputCodec == OutputCodec::HEVC) {
            encodeConfig.encodeCodecConfig.hevcConfig.idrPeriod = encodeConfig.gopLength;
            encodeConfig.encodeCodecConfig.hevcConfig.chromaFormatIDC = 1;
        } else {
            encodeConfig.encodeCodecConfig.h264Config.idrPeriod = encodeConfig.gopLength;
            encodeConfig.encodeCodecConfig.h264Config.chromaFormatIDC = 1;
        }
        encoder_.CreateEncoder(&initializeParams);
        nvencConfigUsed_.rcMode =
            encodeConfig.rcParams.rateControlMode == NV_ENC_PARAMS_RC_VBR ? "vbr" : "cbr";
        refreshCapabilityProbeFromEncoder();

        output_.open(outputPath, std::ios::binary);
        if (!output_) {
            fail("Failed to open output: " + outputPath);
        }
    }

    void encodeFrame(
        const unsigned char* srcFrame,
        int srcPitch,
        int srcWidth,
        int srcHeight,
        int srcSurfaceHeight,
        int outputFrameIndex) {
        const NvEncInputFrame* inputFrame = encoder_.GetNextInputFrame();
        const dim3 block(16, 16);
        const dim3 grid((width_ + block.x - 1) / block.x, (height_ + block.y - 1) / block.y);
        const double outputFrameTimeMs =
            static_cast<double>(outputFrameIndex) * 1000.0 / static_cast<double>(fps_);
        const double frameTimeMs =
            outputToSourceMs(layoutOptions_.timelineSegments, outputFrameTimeMs);
        const unsigned char* webcamFrame = selectWebcamFrame(frameTimeMs);
        const ZoomSample zoomSample = zoomTrack_ ? zoomTrack_->sampleAt(frameTimeMs) : ZoomSample{};
        const bool zoomEnabled = zoomTrack_ && zoomSample.scale > 0.01;
        const CursorPosition cursorPosition = cursorTrack_
            ? cursorTrack_->positionAt(frameTimeMs)
            : CursorPosition{};
        const CursorAtlasEntry* cursorEntry = cursorAtlasEntryFor(cursorPosition.typeIndex);
        const bool useCursorAtlas = cursorEntry && cursorAtlasDevice_;
        const int cursorHeight = layoutOptions_.cursorHeight > 0
            ? std::max(1, static_cast<int>(std::round(layoutOptions_.cursorHeight * cursorPosition.bounceScale)))
            : 0;
        const double cursorAspectRatio = useCursorAtlas ? cursorEntry->aspectRatio : (618.0 / 958.0);
        const int cursorWidth =
            cursorHeight > 0 ? std::max(1, static_cast<int>(std::round(cursorHeight * cursorAspectRatio))) : 0;
        const int cursorHotspotX = useCursorAtlas
            ? static_cast<int>(std::round(cursorWidth * cursorEntry->anchorX))
            : cursorWidth * 14 / 100;
        const int cursorHotspotY = useCursorAtlas
            ? static_cast<int>(std::round(cursorHeight * cursorEntry->anchorY))
            : cursorHeight * 6 / 100;
        const double cursorHotspotContentX =
            layoutOptions_.contentX + cursorPosition.cx * layoutOptions_.contentWidth;
        const double cursorHotspotContentY =
            layoutOptions_.contentY + cursorPosition.cy * layoutOptions_.contentHeight;
        const double cursorHotspotOutputX =
            zoomEnabled ? cursorHotspotContentX * zoomSample.scale + zoomSample.x : cursorHotspotContentX;
        const double cursorHotspotOutputY =
            zoomEnabled ? cursorHotspotContentY * zoomSample.scale + zoomSample.y : cursorHotspotContentY;
        const int cursorX = cursorPosition.visible
            ? static_cast<int>(std::round(cursorHotspotOutputX)) - cursorHotspotX
            : 0;
        const int cursorY = cursorPosition.visible
            ? static_cast<int>(std::round(cursorHotspotOutputY)) - cursorHotspotY
            : 0;
        const bool hasSourceCrop =
            layoutOptions_.sourceCropWidth >= 2 &&
            layoutOptions_.sourceCropHeight >= 2;
        const int sourceCropX = hasSourceCrop
            ? std::max(0, std::min(layoutOptions_.sourceCropX, srcWidth - 2)) & ~1
            : 0;
        const int sourceCropY = hasSourceCrop
            ? std::max(0, std::min(layoutOptions_.sourceCropY, srcHeight - 2)) & ~1
            : 0;
        const int sourceCropWidth = hasSourceCrop
            ? std::max(2, std::min(layoutOptions_.sourceCropWidth, srcWidth - sourceCropX)) & ~1
            : srcWidth;
        const int sourceCropHeight = hasSourceCrop
            ? std::max(2, std::min(layoutOptions_.sourceCropHeight, srcHeight - sourceCropY)) & ~1
            : srcHeight;
        const bool zoomChangesLayout =
            zoomTrack_ &&
            (std::abs(zoomSample.scale - 1.0) > 0.001 ||
             std::abs(zoomSample.x) > 0.5 ||
             std::abs(zoomSample.y) > 0.5);
        const float safeZoomScale = std::max(0.01f, static_cast<float>(zoomSample.scale));
        int blurRegionLeft = layoutOptions_.contentX;
        int blurRegionTop = layoutOptions_.contentY;
        int blurRegionRight = layoutOptions_.contentX + layoutOptions_.contentWidth;
        int blurRegionBottom = layoutOptions_.contentY + layoutOptions_.contentHeight;
        if (zoomChangesLayout) {
            blurRegionLeft = std::max(
                0,
                static_cast<int>(std::floor(layoutOptions_.contentX * safeZoomScale + zoomSample.x)));
            blurRegionTop = std::max(
                0,
                static_cast<int>(std::floor(layoutOptions_.contentY * safeZoomScale + zoomSample.y)));
            blurRegionRight = std::min(
                width_,
                static_cast<int>(std::ceil(
                    (layoutOptions_.contentX + layoutOptions_.contentWidth) * safeZoomScale +
                    zoomSample.x)));
            blurRegionBottom = std::min(
                height_,
                static_cast<int>(std::ceil(
                    (layoutOptions_.contentY + layoutOptions_.contentHeight) * safeZoomScale +
                    zoomSample.y)));
        }
        blurRegionRight = std::max(blurRegionLeft + 2, blurRegionRight);
        blurRegionBottom = std::max(blurRegionTop + 2, blurRegionBottom);
        const bool useFastRoiComposite =
            canUseFastRoiComposite(zoomChangesLayout);
        const bool useLayeredStaticRoiComposite =
            !useFastRoiComposite && canUseLayeredStaticRoiComposite(zoomChangesLayout);
        const bool useTemporalBlur = temporalBlurActive();
        const auto compositeStart = std::chrono::steady_clock::now();
        checkCuda(cudaEventRecord(compositeStartEvent_, copyStream_), "cudaEventRecord compositeStart");
        if (useTemporalBlur) {
            // Temporal zoom motion blur: re-composite the same decoded content at
            // the renderer's symmetric shutter sample offsets (cos-tapered weights)
            // with the camera transform interpolated from the zoom telemetry, then
            // accumulate the weighted samples. This reproduces the configured
            // high-level temporal sample plan natively instead of substituting the
            // spatial blur. Webcam/cursor are applied once afterward (sharp) and
            // the RGBA sidecar is blended last, so overlays stay crisp.
            compositeTemporalBlurSamples(
                static_cast<unsigned char*>(inputFrame->inputPtr),
                static_cast<int>(inputFrame->pitch),
                static_cast<int>(inputFrame->chromaOffsets[0]),
                srcFrame,
                srcPitch,
                srcWidth,
                srcHeight,
                srcSurfaceHeight,
                outputFrameTimeMs);
            applySharpOverlays(
                static_cast<unsigned char*>(inputFrame->inputPtr),
                static_cast<int>(inputFrame->pitch),
                static_cast<int>(inputFrame->chromaOffsets[0]),
                webcamFrame,
                cursorPosition,
                cursorX,
                cursorY,
                cursorWidth,
                cursorHeight,
                useCursorAtlas,
                cursorEntry,
                block);
            ++roiCompositeFrames_;
        } else if (useFastRoiComposite) {
            copyNv12Kernel<<<grid, block, 0, copyStream_>>>(
                srcFrame,
                srcPitch,
                srcWidth,
                srcHeight,
                srcSurfaceHeight,
                static_cast<unsigned char*>(inputFrame->inputPtr),
                static_cast<int>(inputFrame->pitch),
                static_cast<int>(inputFrame->chromaOffsets[0]),
                width_,
                height_);
            checkCuda(cudaGetLastError(), "copyNv12Kernel fast ROI base");

            if (webcamFrame && layoutOptions_.webcamSize > 0) {
                const int webcamRegionX = std::max(0, layoutOptions_.webcamX - 1);
                const int webcamRegionY = std::max(0, layoutOptions_.webcamY - 1);
                const int webcamRegionRight = std::min(
                    width_,
                    layoutOptions_.webcamX + layoutOptions_.webcamSize);
                const int webcamRegionBottom = std::min(
                    height_,
                    layoutOptions_.webcamY + layoutOptions_.webcamSize);
                const int webcamRegionWidth = webcamRegionRight - webcamRegionX;
                const int webcamRegionHeight = webcamRegionBottom - webcamRegionY;
                if (webcamRegionWidth > 0 && webcamRegionHeight > 0) {
                    const dim3 webcamGrid(
                        (webcamRegionWidth + block.x - 1) / block.x,
                        (webcamRegionHeight + block.y - 1) / block.y);
                    overlayWebcamNv12Kernel<<<webcamGrid, block, 0, copyStream_>>>(
                        static_cast<unsigned char*>(inputFrame->inputPtr),
                        static_cast<int>(inputFrame->pitch),
                        static_cast<int>(inputFrame->chromaOffsets[0]),
                        width_,
                        height_,
                        webcamFrame,
                        webcamRegionX,
                        webcamRegionY,
                        webcamRegionWidth,
                        webcamRegionHeight,
                        layoutOptions_.webcamX,
                        layoutOptions_.webcamY,
                        layoutOptions_.webcamSize,
                        webcamFrameWidth(),
                        webcamFrameHeight(),
                        layoutOptions_.webcamRadius,
                        layoutOptions_.webcamMirror);
                    checkCuda(cudaGetLastError(), "overlayWebcamNv12Kernel");
                }
            }

            if (cursorPosition.visible && cursorWidth > 0 && cursorHeight > 0) {
                const int cursorPadding = useCursorAtlas ? 4 : 2;
                const int regionX = std::max(0, cursorX - cursorPadding);
                const int regionY = std::max(0, cursorY - cursorPadding);
                const int regionRight = std::min(width_, cursorX + cursorWidth + cursorPadding);
                const int regionBottom = std::min(height_, cursorY + cursorHeight + cursorPadding);
                const int regionWidth = regionRight - regionX;
                const int regionHeight = regionBottom - regionY;
                if (regionWidth > 0 && regionHeight > 0) {
                    const dim3 cursorGrid(
                        (regionWidth + block.x - 1) / block.x,
                        (regionHeight + block.y - 1) / block.y);
                    overlayCursorNv12Kernel<<<cursorGrid, block, 0, copyStream_>>>(
                        static_cast<unsigned char*>(inputFrame->inputPtr),
                        static_cast<int>(inputFrame->pitch),
                        static_cast<int>(inputFrame->chromaOffsets[0]),
                        width_,
                        height_,
                        regionX,
                        regionY,
                        regionWidth,
                        regionHeight,
                        cursorPosition.visible,
                        cursorX,
                        cursorY,
                        cursorWidth,
                        cursorHeight,
                        useCursorAtlas ? cursorAtlasDevice_ : nullptr,
                        cursorAtlasWidth_,
                        cursorAtlasHeight_,
                        useCursorAtlas ? cursorEntry->x : 0,
                        useCursorAtlas ? cursorEntry->y : 0,
                        useCursorAtlas ? cursorEntry->width : 0,
                        useCursorAtlas ? cursorEntry->height : 0);
                    checkCuda(cudaGetLastError(), "overlayCursorNv12Kernel");
                }
            }
            ++roiCompositeFrames_;
        } else if (useLayeredStaticRoiComposite) {
            if (backgroundDevice_) {
                checkCuda(
                    cudaMemcpy2DAsync(
                        static_cast<unsigned char*>(inputFrame->inputPtr),
                        static_cast<size_t>(inputFrame->pitch),
                        backgroundDevice_,
                        static_cast<size_t>(width_),
                        static_cast<size_t>(width_),
                        static_cast<size_t>(height_),
                        cudaMemcpyDeviceToDevice,
                        copyStream_),
                    "cudaMemcpy2DAsync layered ROI background Y");
                checkCuda(
                    cudaMemcpy2DAsync(
                        static_cast<unsigned char*>(inputFrame->inputPtr) +
                            static_cast<int>(inputFrame->chromaOffsets[0]),
                        static_cast<size_t>(inputFrame->pitch),
                        backgroundDevice_ + width_ * height_,
                        static_cast<size_t>(width_),
                        static_cast<size_t>(width_),
                        static_cast<size_t>(height_ / 2),
                        cudaMemcpyDeviceToDevice,
                        copyStream_),
                    "cudaMemcpy2DAsync layered ROI background UV");
            } else {
                fillNv12Kernel<<<grid, block, 0, copyStream_>>>(
                    static_cast<unsigned char*>(inputFrame->inputPtr),
                    static_cast<int>(inputFrame->pitch),
                    static_cast<int>(inputFrame->chromaOffsets[0]),
                    width_,
                    height_,
                    clampByte(layoutOptions_.backgroundY),
                    clampByte(layoutOptions_.backgroundU),
                    clampByte(layoutOptions_.backgroundV));
                checkCuda(cudaGetLastError(), "fillNv12Kernel layered ROI background");
            }

            const float safeZoomScale = std::max(0.01f, static_cast<float>(zoomSample.scale));
            const float invZoomScale = 1.0f / safeZoomScale;
            const float srcScaleX =
                static_cast<float>(sourceCropWidth) / static_cast<float>(std::max(1, layoutOptions_.contentWidth));
            const float srcScaleY =
                static_cast<float>(sourceCropHeight) / static_cast<float>(std::max(1, layoutOptions_.contentHeight));
            const int transformedContentX = zoomChangesLayout
                ? static_cast<int>(std::floor(layoutOptions_.contentX * safeZoomScale + zoomSample.x))
                : layoutOptions_.contentX;
            const int transformedContentY = zoomChangesLayout
                ? static_cast<int>(std::floor(layoutOptions_.contentY * safeZoomScale + zoomSample.y))
                : layoutOptions_.contentY;
            const int transformedContentRight = zoomChangesLayout
                ? static_cast<int>(
                      std::ceil(
                          (layoutOptions_.contentX + layoutOptions_.contentWidth) *
                              safeZoomScale +
                          zoomSample.x))
                : layoutOptions_.contentX + layoutOptions_.contentWidth;
            const int transformedContentBottom = zoomChangesLayout
                ? static_cast<int>(
                      std::ceil(
                          (layoutOptions_.contentY + layoutOptions_.contentHeight) *
                              safeZoomScale +
                          zoomSample.y))
                : layoutOptions_.contentY + layoutOptions_.contentHeight;
            const int contentRegionLeft = std::max(0, transformedContentX);
            const int contentRegionTop = std::max(0, transformedContentY);
            const int contentRegionRight = std::min(width_, transformedContentRight);
            const int contentRegionBottom = std::min(height_, transformedContentBottom);
            const int contentRegionWidth = contentRegionRight - contentRegionLeft;
            const int contentRegionHeight = contentRegionBottom - contentRegionTop;
            if (contentRegionWidth > 0 && contentRegionHeight > 0) {
                const dim3 contentGrid(
                    (contentRegionWidth + block.x - 1) / block.x,
                    (contentRegionHeight + block.y - 1) / block.y);
                if (zoomChangesLayout) {
                    overlayContentTransformNv12Kernel<<<contentGrid, block, 0, copyStream_>>>(
                        srcFrame,
                        srcPitch,
                        srcWidth,
                        srcHeight,
                        srcSurfaceHeight,
                        static_cast<unsigned char*>(inputFrame->inputPtr),
                        static_cast<int>(inputFrame->pitch),
                        static_cast<int>(inputFrame->chromaOffsets[0]),
                        width_,
                        height_,
                        contentRegionLeft,
                        contentRegionTop,
                        contentRegionWidth,
                        contentRegionHeight,
                        layoutOptions_.contentX,
                        layoutOptions_.contentY,
                        layoutOptions_.contentWidth,
                        layoutOptions_.contentHeight,
                        layoutOptions_.radius,
                        safeZoomScale,
                        invZoomScale,
                        srcScaleX,
                        srcScaleY,
                        sourceCropX,
                        sourceCropY,
                        static_cast<float>(zoomSample.x),
                        static_cast<float>(zoomSample.y));
                    checkCuda(cudaGetLastError(), "overlayContentTransformNv12Kernel");
                } else {
                    overlayContentRectNv12Kernel<<<contentGrid, block, 0, copyStream_>>>(
                        srcFrame,
                        srcPitch,
                        srcWidth,
                        srcHeight,
                        srcSurfaceHeight,
                        static_cast<unsigned char*>(inputFrame->inputPtr),
                        static_cast<int>(inputFrame->pitch),
                        static_cast<int>(inputFrame->chromaOffsets[0]),
                        width_,
                        height_,
                        layoutOptions_.contentX,
                        layoutOptions_.contentY,
                        layoutOptions_.contentWidth,
                        layoutOptions_.contentHeight,
                        sourceCropX,
                        sourceCropY,
                        sourceCropWidth,
                        sourceCropHeight);
                    checkCuda(cudaGetLastError(), "overlayContentRectNv12Kernel");

                    const int cornerRadius = std::min(
                        layoutOptions_.radius,
                        std::min(layoutOptions_.contentWidth, layoutOptions_.contentHeight) / 2);
                    if (cornerRadius > 0) {
                        const dim3 cornerGrid(
                            (cornerRadius + block.x - 1) / block.x,
                            (cornerRadius + block.y - 1) / block.y,
                            4);
                        restoreRoundedContentCornersNv12Kernel<<<cornerGrid, block, 0, copyStream_>>>(
                            static_cast<unsigned char*>(inputFrame->inputPtr),
                            static_cast<int>(inputFrame->pitch),
                            static_cast<int>(inputFrame->chromaOffsets[0]),
                            width_,
                            height_,
                            layoutOptions_.contentX,
                            layoutOptions_.contentY,
                            layoutOptions_.contentWidth,
                            layoutOptions_.contentHeight,
                            cornerRadius,
                            clampByte(layoutOptions_.backgroundY),
                            clampByte(layoutOptions_.backgroundU),
                            clampByte(layoutOptions_.backgroundV),
                            backgroundDevice_);
                        checkCuda(cudaGetLastError(), "restoreRoundedContentCornersNv12Kernel");
                    }
                }
            }

            if (webcamFrame && layoutOptions_.webcamSize > 0) {
                const int webcamRegionX = std::max(0, layoutOptions_.webcamX - 1);
                const int webcamRegionY = std::max(0, layoutOptions_.webcamY - 1);
                const int webcamRegionRight = std::min(
                    width_,
                    layoutOptions_.webcamX + layoutOptions_.webcamSize);
                const int webcamRegionBottom = std::min(
                    height_,
                    layoutOptions_.webcamY + layoutOptions_.webcamSize);
                const int webcamRegionWidth = webcamRegionRight - webcamRegionX;
                const int webcamRegionHeight = webcamRegionBottom - webcamRegionY;
                if (webcamRegionWidth > 0 && webcamRegionHeight > 0) {
                    const dim3 webcamGrid(
                        (webcamRegionWidth + block.x - 1) / block.x,
                        (webcamRegionHeight + block.y - 1) / block.y);
                    overlayWebcamNv12Kernel<<<webcamGrid, block, 0, copyStream_>>>(
                        static_cast<unsigned char*>(inputFrame->inputPtr),
                        static_cast<int>(inputFrame->pitch),
                        static_cast<int>(inputFrame->chromaOffsets[0]),
                        width_,
                        height_,
                        webcamFrame,
                        webcamRegionX,
                        webcamRegionY,
                        webcamRegionWidth,
                        webcamRegionHeight,
                        layoutOptions_.webcamX,
                        layoutOptions_.webcamY,
                        layoutOptions_.webcamSize,
                        webcamFrameWidth(),
                        webcamFrameHeight(),
                        layoutOptions_.webcamRadius,
                        layoutOptions_.webcamMirror);
                    checkCuda(cudaGetLastError(), "overlayWebcamNv12Kernel layered ROI");
                }
            }

            if (cursorPosition.visible && cursorWidth > 0 && cursorHeight > 0) {
                const int cursorPadding = useCursorAtlas ? 4 : 2;
                const int regionX = std::max(0, cursorX - cursorPadding);
                const int regionY = std::max(0, cursorY - cursorPadding);
                const int regionRight = std::min(width_, cursorX + cursorWidth + cursorPadding);
                const int regionBottom = std::min(height_, cursorY + cursorHeight + cursorPadding);
                const int regionWidth = regionRight - regionX;
                const int regionHeight = regionBottom - regionY;
                if (regionWidth > 0 && regionHeight > 0) {
                    const dim3 cursorGrid(
                        (regionWidth + block.x - 1) / block.x,
                        (regionHeight + block.y - 1) / block.y);
                    overlayCursorNv12Kernel<<<cursorGrid, block, 0, copyStream_>>>(
                        static_cast<unsigned char*>(inputFrame->inputPtr),
                        static_cast<int>(inputFrame->pitch),
                        static_cast<int>(inputFrame->chromaOffsets[0]),
                        width_,
                        height_,
                        regionX,
                        regionY,
                        regionWidth,
                        regionHeight,
                        cursorPosition.visible,
                        cursorX,
                        cursorY,
                        cursorWidth,
                        cursorHeight,
                        useCursorAtlas ? cursorAtlasDevice_ : nullptr,
                        cursorAtlasWidth_,
                        cursorAtlasHeight_,
                        useCursorAtlas ? cursorEntry->x : 0,
                        useCursorAtlas ? cursorEntry->y : 0,
                        useCursorAtlas ? cursorEntry->width : 0,
                        useCursorAtlas ? cursorEntry->height : 0);
                    checkCuda(cudaGetLastError(), "overlayCursorNv12Kernel layered ROI");
                }
            }
            ++roiCompositeFrames_;
        } else if (hasStaticLayout(layoutOptions_)) {
            compositeStaticNv12Kernel<<<grid, block, 0, copyStream_>>>(
                srcFrame,
                srcPitch,
                srcWidth,
                srcHeight,
                srcSurfaceHeight,
                static_cast<unsigned char*>(inputFrame->inputPtr),
                static_cast<int>(inputFrame->pitch),
                static_cast<int>(inputFrame->chromaOffsets[0]),
                width_,
                height_,
                0,
                0,
                width_,
                height_,
                layoutOptions_.contentX,
                layoutOptions_.contentY,
                layoutOptions_.contentWidth,
                layoutOptions_.contentHeight,
                sourceCropX,
                sourceCropY,
                sourceCropWidth,
                sourceCropHeight,
                layoutOptions_.radius,
                clampByte(layoutOptions_.backgroundY),
                clampByte(layoutOptions_.backgroundU),
                clampByte(layoutOptions_.backgroundV),
                backgroundDevice_,
                layoutOptions_.shadowOffsetY,
                layoutOptions_.shadowIntensityPct,
                webcamFrame,
                layoutOptions_.webcamX,
                layoutOptions_.webcamY,
                layoutOptions_.webcamSize,
                webcamFrameWidth(),
                webcamFrameHeight(),
                layoutOptions_.webcamRadius,
                layoutOptions_.webcamMirror,
                cursorPosition.visible,
                cursorX,
                cursorY,
                cursorWidth,
                cursorHeight,
                useCursorAtlas ? cursorAtlasDevice_ : nullptr,
                cursorAtlasWidth_,
                cursorAtlasHeight_,
                useCursorAtlas ? cursorEntry->x : 0,
                useCursorAtlas ? cursorEntry->y : 0,
                useCursorAtlas ? cursorEntry->width : 0,
                useCursorAtlas ? cursorEntry->height : 0,
                zoomEnabled,
                static_cast<float>(zoomSample.scale),
                static_cast<float>(zoomSample.x),
                static_cast<float>(zoomSample.y),
                0,
                0);
            checkCuda(cudaGetLastError(), "compositeStaticNv12Kernel");
            ++monolithicCompositeFrames_;
        } else {
            copyNv12Kernel<<<grid, block, 0, copyStream_>>>(
                srcFrame,
                srcPitch,
                srcWidth,
                srcHeight,
                srcSurfaceHeight,
                static_cast<unsigned char*>(inputFrame->inputPtr),
                static_cast<int>(inputFrame->pitch),
                static_cast<int>(inputFrame->chromaOffsets[0]),
                width_,
                height_);
            checkCuda(cudaGetLastError(), "copyNv12Kernel");
            ++copyCompositeFrames_;
        }
        checkCuda(cudaEventRecord(compositeEndEvent_, copyStream_), "cudaEventRecord compositeEnd");
        if (!useTemporalBlur && zoomTrack_ && zoomSample.blurStrength > 0.001) {
            checkCuda(cudaEventRecord(blurStartEvent_, copyStream_), "cudaEventRecord blurStart");
            applyZoomBlurFrame(
                static_cast<unsigned char*>(inputFrame->inputPtr),
                static_cast<int>(inputFrame->pitch),
                static_cast<int>(inputFrame->chromaOffsets[0]),
                blurRegionLeft,
                blurRegionTop,
                blurRegionRight,
                blurRegionBottom,
                static_cast<float>(zoomSample.blurCenterX),
                static_cast<float>(zoomSample.blurCenterY),
                static_cast<float>(zoomSample.blurStrength));
            checkCuda(cudaEventRecord(blurEndEvent_, copyStream_), "cudaEventRecord blurEnd");
            zoomBlurRecorded_ = true;
        }
        if (overlaySource_ && !overlaySource_->empty()) {
            checkCuda(cudaEventRecord(overlayStartEvent_, copyStream_), "cudaEventRecord overlayStart");
            overlaySource_->beginFrame(outputFrameIndex, copyStream_);
            for (size_t layerIndex = 0; layerIndex < overlaySource_->layerCount(); ++layerIndex) {
                const auto& layer = overlaySource_->descriptor(layerIndex);
                const OverlayBlendRegion overlayRegion = overlaySource_->blendRegion(layerIndex);
                if (overlayRegion.width <= 0 || overlayRegion.height <= 0) {
                    // Fully transparent static layer: the bounded region is empty
                    // and the full-frame blend would write nothing either.
                    continue;
                }
                const dim3 overlayGrid(
                    (overlayRegion.width + block.x - 1) / block.x,
                    (overlayRegion.height + block.y - 1) / block.y);
                blendOverlayRgbaNv12Kernel<<<overlayGrid, block, 0, copyStream_>>>(
                    overlaySource_->frameDevicePtr(layerIndex, outputFrameIndex),
                    layer.width,
                    layer.height,
                    static_cast<unsigned char*>(inputFrame->inputPtr),
                    static_cast<int>(inputFrame->pitch),
                    static_cast<int>(inputFrame->chromaOffsets[0]),
                    width_,
                    height_,
                    layer.x,
                    layer.y,
                    layer.width,
                    layer.height,
                    overlayRegion.x,
                    overlayRegion.y,
                    overlayRegion.width,
                    overlayRegion.height);
                checkCuda(cudaGetLastError(), "blendOverlayRgbaNv12Kernel");
                if (overlayRegion.bounded) {
                    ++overlayStaticRegionBlends_;
                }
            }
            ++overlayBlendFrames_;
            checkCuda(cudaEventRecord(overlayEndEvent_, copyStream_), "cudaEventRecord overlayEnd");
            overlayRecorded_ = true;
        }
        // Single per-frame synchronization on the compositor stream. Composite,
        // zoom blur, and overlay blends are all queued on the copy stream, and
        // NVENC's synchronous input copy needs them complete, so one
        // cudaStreamSynchronize is both necessary and sufficient; the previous
        // double sync (and any global device sync) added a full round trip per
        // frame without improving correctness.
        checkCuda(cudaStreamSynchronize(copyStream_), "cudaStreamSynchronize frame");
        // The overlay read-ahead prefetch is dispatched after the required frame
        // sync. File reads run on the bounded background reader threads, so the
        // encode thread does not block on disk I/O; ready pinned frames get
        // their H2D copy enqueued here so the transfer overlaps NVENC. The
        // uploads stay ordered before the next frame's beginFrame/blend because
        // they are queued on the same non-blocking compositor stream, and the
        // bounded ring never targets the slot the current blend read, so the
        // next blend starts only after its frame is resident.
        if (overlaySource_ && !overlaySource_->empty()) {
            overlaySource_->prefetchNextFrame(outputFrameIndex, copyStream_);
        }
        accumulateStageGpuTime(compositeStartEvent_, compositeEndEvent_, compositeGpuMs_);
        if (zoomBlurRecorded_) {
            accumulateStageGpuTime(blurStartEvent_, blurEndEvent_, zoomBlurGpuMs_);
            zoomBlurRecorded_ = false;
        }
        if (overlayRecorded_) {
            accumulateStageGpuTime(overlayStartEvent_, overlayEndEvent_, overlayBlendGpuMs_);
            overlayRecorded_ = false;
        }
        const auto compositeEnd = std::chrono::steady_clock::now();
        compositeMs_ += elapsedMs(compositeStart, compositeEnd);

        std::vector<std::vector<uint8_t>> packets;
        const auto nvencStart = std::chrono::steady_clock::now();
        encoder_.EncodeFrame(packets);
        const auto nvencEnd = std::chrono::steady_clock::now();
        nvencMs_ += elapsedMs(nvencStart, nvencEnd);
        const auto writeStart = std::chrono::steady_clock::now();
        writePackets(packets);
        const auto writeEnd = std::chrono::steady_clock::now();
        packetWriteMs_ += elapsedMs(writeStart, writeEnd);
        ++frames_;
    }

    void finish() {
        std::vector<std::vector<uint8_t>> packets;
        encoder_.EndEncode(packets);
        writePackets(packets);
        encoder_.DestroyEncoder();
        output_.close();
        if (copyStream_) {
            checkCuda(cudaStreamDestroy(copyStream_), "cudaStreamDestroy");
            copyStream_ = nullptr;
        }
        cudaEvent_t stageEvents[] = {
            compositeStartEvent_,
            compositeEndEvent_,
            blurStartEvent_,
            blurEndEvent_,
            overlayStartEvent_,
            overlayEndEvent_,
        };
        for (cudaEvent_t& event : stageEvents) {
            if (event) {
                checkCuda(cudaEventDestroy(event), "cudaEventDestroy stage");
                event = nullptr;
            }
        }
        if (backgroundDevice_) {
            checkCuda(cudaFree(backgroundDevice_), "cudaFree backgroundDevice");
            backgroundDevice_ = nullptr;
        }
        if (webcamDevice_) {
            checkCuda(cudaFree(webcamDevice_), "cudaFree webcamDevice");
            webcamDevice_ = nullptr;
        }
        if (cursorAtlasDevice_) {
            checkCuda(cudaFree(cursorAtlasDevice_), "cudaFree cursorAtlasDevice");
            cursorAtlasDevice_ = nullptr;
        }
        if (zoomBlurScratch_) {
            checkCuda(cudaFree(zoomBlurScratch_), "cudaFree zoomBlurScratch");
            zoomBlurScratch_ = nullptr;
        }
        if (temporalWeightsDevice_) {
            checkCuda(cudaFree(temporalWeightsDevice_), "cudaFree temporalWeightsDevice");
            temporalWeightsDevice_ = nullptr;
            temporalWeightsDeviceCount_ = 0;
        }
        if (temporalBgCacheDevice_) {
            checkCuda(cudaFree(temporalBgCacheDevice_), "cudaFree temporalBgCacheDevice");
            temporalBgCacheDevice_ = nullptr;
        }
    }

    uint64_t outputBytes() const {
        return outputBytes_;
    }

    double compositeMs() const {
        return compositeMs_;
    }

    double nvencMs() const {
        return nvencMs_;
    }

    double packetWriteMs() const {
        return packetWriteMs_;
    }

    int roiCompositeFrames() const {
        return roiCompositeFrames_;
    }

    int monolithicCompositeFrames() const {
        return monolithicCompositeFrames_;
    }

    int copyCompositeFrames() const {
        return copyCompositeFrames_;
    }

    int zoomBlurFrames() const {
        return zoomBlurFrames_;
    }

    int overlayBlendFrames() const {
        return overlayBlendFrames_;
    }

    int temporalBlurFrames() const {
        return temporalBlurFrames_;
    }

    int temporalBlurBgPrecomposedFrames() const {
        return temporalBlurBgPrecomposedFrames_;
    }

    int temporalBlurStationaryFrames() const {
        return temporalBlurStationaryFrames_;
    }

    int temporalBgCacheBuilds() const {
        return temporalBgCacheBuilds_;
    }

    int64_t temporalBgCacheHits() const {
        return temporalBgCacheHits_;
    }

    int64_t overlayStaticRegionBlends() const {
        return overlayStaticRegionBlends_;
    }

    int64_t overlayFileLoads() const {
        return overlaySource_ ? overlaySource_->fileLoads() : 0;
    }

    int64_t overlayCacheHits() const {
        return overlaySource_ ? overlaySource_->cacheHits() : 0;
    }

    int64_t overlayPinnedHits() const {
        return overlaySource_ ? overlaySource_->pinnedHits() : 0;
    }

    int64_t overlayReadWaits() const {
        return overlaySource_ ? overlaySource_->readWaits() : 0;
    }

    int64_t overlayPendingReadsPeak() const {
        return overlaySource_ ? overlaySource_->pendingReadsPeak() : 0;
    }

    int64_t temporalBlurSamplesTotal() const {
        return temporalBlurSamplesTotal_;
    }

    const NvencCapabilityProbe& capabilityProbe() const {
        return capabilityProbe_;
    }

    const NvencConfigUsed& nvencConfigUsed() const {
        return nvencConfigUsed_;
    }

    double compositeGpuMs() const {
        return compositeGpuMs_;
    }

    double zoomBlurGpuMs() const {
        return zoomBlurGpuMs_;
    }

    double overlayBlendGpuMs() const {
        return overlayBlendGpuMs_;
    }

    double overlayUploadMs() const {
        return overlaySource_ ? overlaySource_->uploadMs() : 0.0;
    }

    double overlayHostReadMs() const {
        return overlaySource_ ? overlaySource_->hostReadMs() : 0.0;
    }

    double overlayH2DEnqueueMs() const {
        return overlaySource_ ? overlaySource_->h2dEnqueueMs() : 0.0;
    }

private:
    void refreshCapabilityProbeFromEncoder() {
        // The probe session can fail caps queries on some driver/GPU combos
        // (NV_ENC_ERR_ENCODER_NOT_INITIALIZED on the probe session even though
        // the real encoder session works). Re-query the caps through the live
        // encoder session so diagnostics report what the device truly supports
        // instead of conservative fallbacks. Codec support is re-queried per
        // codec (H.264 caps for h264Supported, HEVC caps for hevcSupported);
        // the rate-control/VBV/AQ/dimension caps are re-queried for the codec
        // the live encoder was created with.
        const GUID codecGuid = codecGuidForEncoder();
        auto queryCap = [&](GUID queryCodecGuid, NV_ENC_CAPS cap) -> int {
            return encoder_.GetCapabilityValue(queryCodecGuid, cap);
        };
        capabilityProbe_.h264Supported =
            queryCap(NV_ENC_CODEC_H264_GUID, NV_ENC_CAPS_NUM_MAX_BFRAMES) >= 0;
        capabilityProbe_.hevcSupported =
            queryCap(NV_ENC_CODEC_HEVC_GUID, NV_ENC_CAPS_NUM_MAX_BFRAMES) >= 0;
        const int rcModes = queryCap(codecGuid, NV_ENC_CAPS_SUPPORTED_RATECONTROL_MODES);
        if (rcModes >= 0) {
            capabilityProbe_.supportedRateControlModes = rcModes;
        }
        capabilityProbe_.customVbvBufferSizeSupported =
            queryCap(codecGuid, NV_ENC_CAPS_SUPPORT_CUSTOM_VBV_BUF_SIZE) > 0;
        capabilityProbe_.asyncEncodeSupported =
            queryCap(codecGuid, NV_ENC_CAPS_ASYNC_ENCODE_SUPPORT) > 0;
        capabilityProbe_.temporalAqSupported =
            queryCap(codecGuid, NV_ENC_CAPS_SUPPORT_TEMPORAL_AQ) > 0;
        capabilityProbe_.widthMax = queryCap(codecGuid, NV_ENC_CAPS_WIDTH_MAX);
        capabilityProbe_.heightMax = queryCap(codecGuid, NV_ENC_CAPS_HEIGHT_MAX);
        capabilityProbe_.mbPerSecMax = queryCap(codecGuid, NV_ENC_CAPS_MB_PER_SEC_MAX);
    }

    GUID codecGuidForEncoder() const {
        return layoutOptions_.outputCodec == OutputCodec::HEVC
            ? NV_ENC_CODEC_HEVC_GUID
            : NV_ENC_CODEC_H264_GUID;
    }

    void accumulateStageGpuTime(
        cudaEvent_t startEvent,
        cudaEvent_t endEvent,
        double& accumulator) {
        if (!startEvent || !endEvent) {
            return;
        }
        float elapsed = 0.0f;
        checkCuda(
            cudaEventElapsedTime(&elapsed, startEvent, endEvent),
            "cudaEventElapsedTime stage");
        accumulator += elapsed;
    }

    bool temporalBlurActive() const {
        return temporalBlurSampleCount_ > 0 &&
            zoomTrack_ != nullptr &&
            hasStaticLayout(layoutOptions_);
    }

    void compositeTemporalBlurSamples(
        unsigned char* target,
        int targetPitch,
        int targetChromaOffset,
        const unsigned char* srcFrame,
        int srcPitch,
        int srcWidth,
        int srcHeight,
        int srcSurfaceHeight,
        double outputFrameTimeMs) {
        const std::vector<TemporalBlurSample>& samples = temporalSamplePlan_;

        const dim3 block(16, 16);
        const dim3 grid((width_ + block.x - 1) / block.x, (height_ + block.y - 1) / block.y);

        const bool hasSourceCrop =
            layoutOptions_.sourceCropWidth >= 2 &&
            layoutOptions_.sourceCropHeight >= 2;
        const int sourceCropX = hasSourceCrop
            ? std::max(0, std::min(layoutOptions_.sourceCropX, srcWidth - 2)) & ~1
            : 0;
        const int sourceCropY = hasSourceCrop
            ? std::max(0, std::min(layoutOptions_.sourceCropY, srcHeight - 2)) & ~1
            : 0;
        const int sourceCropWidth = hasSourceCrop
            ? std::max(2, std::min(layoutOptions_.sourceCropWidth, srcWidth - sourceCropX)) & ~1
            : srcWidth;
        const int sourceCropHeight = hasSourceCrop
            ? std::max(2, std::min(layoutOptions_.sourceCropHeight, srcHeight - sourceCropY)) & ~1
            : srcHeight;

        // Fused composite + accumulate: the first sample replaces the target (the
        // NVENC input buffer is not pre-zeroed), later samples saturate-accumulate
        // the same (weight * value + 128) >> 8 math the previous two-pass
        // fill/composite/accumulate pipeline produced. One pass per sample and no
        // scratch buffer. The legacy path composites the full frame per sample;
        // the background-precompose path below restricts per-sample work to the
        // changing content region once the invariant background is accumulated.
        int bboxLeft = width_;
        int bboxTop = height_;
        int bboxRight = 0;
        int bboxBottom = 0;
        bool anyContentVisible = false;
        // Exact stationary shutter-window detection: when every sample resolves
        // to a bit-identical camera transform (scale/x/y), every pixel selects
        // the same source/layout value for every sample, so the weighted
        // temporal accumulation can evaluate source + layout once per pixel and
        // apply the existing fixed-point weights in order (see
        // compositeStaticStationaryNv12Kernel). Any double inequality is
        // enough to fall back to the per-sample paths; the comparison is exact
        // so the fused path can never be chosen when per-sample transforms
        // differ (even by one ULP).
        bool stationaryWindow = !samples.empty();
        double stationaryScale = 0.0;
        double stationaryX = 0.0;
        double stationaryY = 0.0;
        for (size_t index = 0; index < samples.size(); ++index) {
            const double sampleTimeMs = outputFrameTimeMs + samples[index].offsetUs / 1000.0;
            const ZoomSample sample = zoomTrack_ ? zoomTrack_->sampleAt(sampleTimeMs) : ZoomSample{};
            if (index == 0) {
                stationaryScale = sample.scale;
                stationaryX = sample.x;
                stationaryY = sample.y;
            } else if (
                sample.scale != stationaryScale ||
                sample.x != stationaryX ||
                sample.y != stationaryY) {
                stationaryWindow = false;
            }
            const float safeZoomScale = std::max(0.01f, static_cast<float>(sample.scale));
            const int transformedLeft = std::max(
                0,
                static_cast<int>(std::floor(layoutOptions_.contentX * safeZoomScale + sample.x)));
            const int transformedTop = std::max(
                0,
                static_cast<int>(std::floor(layoutOptions_.contentY * safeZoomScale + sample.y)));
            const int transformedRight = std::min(
                width_,
                static_cast<int>(std::ceil(
                    (layoutOptions_.contentX + layoutOptions_.contentWidth) * safeZoomScale +
                    sample.x)));
            const int transformedBottom = std::min(
                height_,
                static_cast<int>(std::ceil(
                    (layoutOptions_.contentY + layoutOptions_.contentHeight) * safeZoomScale +
                    sample.y)));
            if (transformedRight > transformedLeft && transformedBottom > transformedTop) {
                anyContentVisible = true;
                bboxLeft = std::min(bboxLeft, transformedLeft);
                bboxTop = std::min(bboxTop, transformedTop);
                bboxRight = std::max(bboxRight, transformedRight);
                bboxBottom = std::max(bboxBottom, transformedBottom);
            }
        }
        if (stationaryWindow) {
            // Every sample applies the identical transform, so sample 0's
            // transform (captured by the detection loop) is the per-sample
            // transform the original loop used for every sample. The fused
            // kernel reproduces the replace-then-accumulate chain exactly while
            // evaluating source + layout once.
            ensureTemporalWeightsDevice();
            const bool sampleZoomEnabled = zoomTrack_ && stationaryScale > 0.01;
            compositeStaticStationaryNv12Kernel<<<grid, block, 0, copyStream_>>>(
                srcFrame,
                srcPitch,
                srcWidth,
                srcHeight,
                srcSurfaceHeight,
                target,
                targetPitch,
                targetChromaOffset,
                width_,
                height_,
                0,
                0,
                width_,
                height_,
                layoutOptions_.contentX,
                layoutOptions_.contentY,
                layoutOptions_.contentWidth,
                layoutOptions_.contentHeight,
                sourceCropX,
                sourceCropY,
                sourceCropWidth,
                sourceCropHeight,
                layoutOptions_.radius,
                clampByte(layoutOptions_.backgroundY),
                clampByte(layoutOptions_.backgroundU),
                clampByte(layoutOptions_.backgroundV),
                backgroundDevice_,
                layoutOptions_.shadowOffsetY,
                layoutOptions_.shadowIntensityPct,
                sampleZoomEnabled,
                static_cast<float>(stationaryScale),
                static_cast<float>(stationaryX),
                static_cast<float>(stationaryY),
                temporalWeightsDevice_,
                static_cast<int>(samples.size()));
            checkCuda(cudaGetLastError(), "compositeStaticStationaryNv12Kernel");
            temporalBlurSamplesTotal_ += static_cast<int64_t>(samples.size());
            ++temporalBlurFrames_;
            ++temporalBlurStationaryFrames_;
            return;
        }

        // The region passed to the per-sample composite must cover the UV corner
        // pixels: a UV block at even x is decided by the corner (x + 1, y + 1),
        // which can map inside the content rect one pixel beyond the luma bbox
        // (e.g. at an odd bbox edge). Expand the bounding box by one pixel on
        // every side (clamped to the frame) so corner-driven chroma blocks get
        // the same per-sample content/bg selection the full-frame kernel makes.
        // Pixels inside the expansion that are background for every sample are
        // recomputed identically by the region kernel, so the expansion is
        // exact and only adds one boundary row/column of work.
        const int regionLeft = std::max(0, bboxLeft - 1);
        const int regionTop = std::max(0, bboxTop - 1);
        const int regionRight = std::min(width_, bboxRight + 1);
        const int regionBottom = std::min(height_, bboxBottom + 1);
        const int regionWidth = regionRight - regionLeft;
        const int regionHeight = regionBottom - regionTop;
        const bool useBackgroundPrecompose =
            !samples.empty() &&
            layoutOptions_.shadowIntensityPct == 0 &&
            (!anyContentVisible ||
             (regionWidth > 0 && regionHeight > 0 &&
              // Sample-count-aware break-even gate: the precompose path costs one
              // full-frame background pass plus sampleCount region passes, while
              // the per-sample path costs sampleCount full-frame passes, so
              // precompose wins when 1 + N*r < N with r the region/frame area
              // ratio, i.e. regionArea * N < frameArea * (N - 1). Both paths are
              // bit-identical; the gate only trades GPU work.
              static_cast<int64_t>(regionWidth) * regionHeight *
                      static_cast<int64_t>(samples.size()) <
                  static_cast<int64_t>(width_) * height_ *
                      static_cast<int64_t>(samples.size() - 1)));
        if (useBackgroundPrecompose) {
            compositeTemporalBlurSamplesWithBackgroundPrecompose(
                target,
                targetPitch,
                targetChromaOffset,
                srcFrame,
                srcPitch,
                srcWidth,
                srcHeight,
                srcSurfaceHeight,
                samples,
                block,
                sourceCropX,
                sourceCropY,
                sourceCropWidth,
                sourceCropHeight,
                regionLeft,
                regionTop,
                regionWidth,
                regionHeight,
                anyContentVisible,
                outputFrameTimeMs);
            ++temporalBlurFrames_;
            ++temporalBlurBgPrecomposedFrames_;
            return;
        }

        for (size_t index = 0; index < samples.size(); ++index) {
            const double sampleTimeMs = outputFrameTimeMs + samples[index].offsetUs / 1000.0;
            const ZoomSample sample = zoomTrack_ ? zoomTrack_->sampleAt(sampleTimeMs) : ZoomSample{};
            const bool sampleZoomEnabled = zoomTrack_ && sample.scale > 0.01;
            const unsigned int weightFixed = static_cast<unsigned int>(
                std::lround(samples[index].weight * 256.0));
            compositeStaticNv12Kernel<<<grid, block, 0, copyStream_>>>(
                srcFrame,
                srcPitch,
                srcWidth,
                srcHeight,
                srcSurfaceHeight,
                target,
                targetPitch,
                targetChromaOffset,
                width_,
                height_,
                0,
                0,
                width_,
                height_,
                layoutOptions_.contentX,
                layoutOptions_.contentY,
                layoutOptions_.contentWidth,
                layoutOptions_.contentHeight,
                sourceCropX,
                sourceCropY,
                sourceCropWidth,
                sourceCropHeight,
                layoutOptions_.radius,
                clampByte(layoutOptions_.backgroundY),
                clampByte(layoutOptions_.backgroundU),
                clampByte(layoutOptions_.backgroundV),
                backgroundDevice_,
                layoutOptions_.shadowOffsetY,
                layoutOptions_.shadowIntensityPct,
                nullptr,
                0,
                0,
                0,
                0,
                0,
                0,
                false,
                false,
                0,
                0,
                0,
                0,
                nullptr,
                0,
                0,
                0,
                0,
                0,
                0,
                sampleZoomEnabled,
                static_cast<float>(sample.scale),
                static_cast<float>(sample.x),
                static_cast<float>(sample.y),
                weightFixed,
                index == 0 ? 1 : 2);
            checkCuda(cudaGetLastError(), "compositeStaticNv12Kernel temporal sample");
            temporalBlurSamplesTotal_ += 1;
        }
        ++temporalBlurFrames_;
    }

    // Fast temporal-blur path: the invariant weighted background is accumulated
    // once per export into a persistent NV12 cache (see
    // ensureTemporalBackgroundCache); each output frame copies that cache into
    // the target and then composites only the changing content bounding box per
    // temporal sample. Pixels outside the bbox are outside the content rect for
    // every sample, so their per-sample value is always the background and the
    // cached accumulation is exact. Inside the bbox, sample 0 replaces the
    // cached background (the target is not pre-zeroed) and later samples
    // saturate-accumulate, preserving the exact replace-then-accumulate
    // contract of the per-sample full-frame composites term-for-term. The
    // cache copy is bit-identical to the previous per-frame accumulate because
    // accumulateBackgroundNv12Kernel replaces (never accumulates into) each
    // destination pixel.
    void compositeTemporalBlurSamplesWithBackgroundPrecompose(
        unsigned char* target,
        int targetPitch,
        int targetChromaOffset,
        const unsigned char* srcFrame,
        int srcPitch,
        int srcWidth,
        int srcHeight,
        int srcSurfaceHeight,
        const std::vector<TemporalBlurSample>& samples,
        const dim3& block,
        int sourceCropX,
        int sourceCropY,
        int sourceCropWidth,
        int sourceCropHeight,
        int regionLeft,
        int regionTop,
        int regionWidth,
        int regionHeight,
        bool anyContentVisible,
        double outputFrameTimeMs) {
        ensureTemporalWeightsDevice();
        ensureTemporalBackgroundCache();
        checkCuda(
            cudaMemcpy2DAsync(
                target,
                static_cast<size_t>(targetPitch),
                temporalBgCacheDevice_,
                static_cast<size_t>(width_),
                static_cast<size_t>(width_),
                static_cast<size_t>(height_),
                cudaMemcpyDeviceToDevice,
                copyStream_),
            "cudaMemcpy2DAsync temporal background cache Y");
        checkCuda(
            cudaMemcpy2DAsync(
                target + targetChromaOffset,
                static_cast<size_t>(targetPitch),
                temporalBgCacheDevice_ + static_cast<size_t>(width_) * static_cast<size_t>(height_),
                static_cast<size_t>(width_),
                static_cast<size_t>(width_),
                static_cast<size_t>(height_ / 2),
                cudaMemcpyDeviceToDevice,
                copyStream_),
            "cudaMemcpy2DAsync temporal background cache UV");
        ++temporalBgCacheHits_;

        if (!anyContentVisible || regionWidth <= 0 || regionHeight <= 0) {
            return;
        }
        const dim3 contentGrid(
            (regionWidth + block.x - 1) / block.x,
            (regionHeight + block.y - 1) / block.y);
        for (size_t index = 0; index < samples.size(); ++index) {
            const double sampleTimeMs = outputFrameTimeMs + samples[index].offsetUs / 1000.0;
            const ZoomSample sample = zoomTrack_ ? zoomTrack_->sampleAt(sampleTimeMs) : ZoomSample{};
            const bool sampleZoomEnabled = zoomTrack_ && sample.scale > 0.01;
            const unsigned int weightFixed = static_cast<unsigned int>(
                std::lround(samples[index].weight * 256.0));
            compositeStaticNv12Kernel<<<contentGrid, block, 0, copyStream_>>>(
                srcFrame,
                srcPitch,
                srcWidth,
                srcHeight,
                srcSurfaceHeight,
                target,
                targetPitch,
                targetChromaOffset,
                width_,
                height_,
                regionLeft,
                regionTop,
                regionWidth,
                regionHeight,
                layoutOptions_.contentX,
                layoutOptions_.contentY,
                layoutOptions_.contentWidth,
                layoutOptions_.contentHeight,
                sourceCropX,
                sourceCropY,
                sourceCropWidth,
                sourceCropHeight,
                layoutOptions_.radius,
                clampByte(layoutOptions_.backgroundY),
                clampByte(layoutOptions_.backgroundU),
                clampByte(layoutOptions_.backgroundV),
                backgroundDevice_,
                layoutOptions_.shadowOffsetY,
                layoutOptions_.shadowIntensityPct,
                nullptr,
                0,
                0,
                0,
                0,
                0,
                0,
                false,
                false,
                0,
                0,
                0,
                0,
                nullptr,
                0,
                0,
                0,
                0,
                0,
                0,
                sampleZoomEnabled,
                static_cast<float>(sample.scale),
                static_cast<float>(sample.x),
                static_cast<float>(sample.y),
                weightFixed,
                index == 0 ? 1 : 2);
            checkCuda(cudaGetLastError(), "compositeStaticNv12Kernel temporal sample region");
            temporalBlurSamplesTotal_ += 1;
        }
    }

    // Builds the persistent NV12 cache of the invariant weighted background
    // accumulation once per export. The accumulated background depends only on
    // the fixed sample weight plan and the fixed background (color or NV12
    // sidecar), so it is identical for every temporal-blur output frame; the
    // first precomposed frame fills the cache with the same
    // accumulateBackgroundNv12Kernel pass the previous code ran per frame, and
    // later frames copy the cache into the target instead of re-accumulating.
    // The cache is tightly packed (pitch == width), so the per-frame copy is
    // two ordered cudaMemcpy2DAsync calls on the compositor stream. The copy is
    // term-for-term identical to the per-frame accumulate because
    // accumulateBackgroundNv12Kernel replaces (never accumulates into) each
    // destination pixel.
    void ensureTemporalBackgroundCache() {
        if (temporalBgCacheDevice_) {
            return;
        }
        const size_t requiredBytes =
            static_cast<size_t>(width_) * static_cast<size_t>(height_) * 3 / 2;
        checkCuda(cudaMalloc(&temporalBgCacheDevice_, requiredBytes), "cudaMalloc temporalBgCacheDevice");
        const dim3 block(16, 16);
        const dim3 fullGrid((width_ + block.x - 1) / block.x, (height_ + block.y - 1) / block.y);
        accumulateBackgroundNv12Kernel<<<fullGrid, block, 0, copyStream_>>>(
            temporalBgCacheDevice_,
            width_,
            static_cast<int>(static_cast<size_t>(width_) * static_cast<size_t>(height_)),
            width_,
            height_,
            clampByte(layoutOptions_.backgroundY),
            clampByte(layoutOptions_.backgroundU),
            clampByte(layoutOptions_.backgroundV),
            backgroundDevice_,
            temporalWeightsDevice_,
            static_cast<int>(temporalSamplePlan_.size()));
        checkCuda(cudaGetLastError(), "accumulateBackgroundNv12Kernel cache build");
        ++temporalBgCacheBuilds_;
    }

    // Uploads the cos-tapered temporal sample weights to a device buffer once;
    // accumulateBackgroundNv12Kernel needs the whole plan resident for the
    // invariant-background pass and the stationary fused kernel needs it for
    // the in-order fixed-point accumulation.
    void ensureTemporalWeightsDevice() {
        const size_t count = temporalSamplePlan_.size();
        if (count == 0 || (temporalWeightsDevice_ && temporalWeightsDeviceCount_ == count)) {
            return;
        }
        if (temporalWeightsDevice_) {
            checkCuda(cudaFree(temporalWeightsDevice_), "cudaFree temporalWeightsDevice");
            temporalWeightsDevice_ = nullptr;
        }
        std::vector<unsigned int> weights(count);
        for (size_t index = 0; index < count; ++index) {
            weights[index] = static_cast<unsigned int>(
                std::lround(temporalSamplePlan_[index].weight * 256.0));
        }
        checkCuda(
            cudaMalloc(&temporalWeightsDevice_, count * sizeof(unsigned int)),
            "cudaMalloc temporalWeightsDevice");
        checkCuda(
            cudaMemcpy(
                temporalWeightsDevice_,
                weights.data(),
                count * sizeof(unsigned int),
                cudaMemcpyHostToDevice),
            "cudaMemcpy temporalWeightsDevice");
        temporalWeightsDeviceCount_ = count;
    }

    void applySharpOverlays(
        unsigned char* frame,
        int framePitch,
        int frameChromaOffset,
        const unsigned char* webcamFrame,
        const CursorPosition& cursorPosition,
        int cursorX,
        int cursorY,
        int cursorWidth,
        int cursorHeight,
        bool useCursorAtlas,
        const CursorAtlasEntry* cursorEntry,
        const dim3& block) {
        if (webcamFrame && layoutOptions_.webcamSize > 0) {
            const int webcamRegionX = std::max(0, layoutOptions_.webcamX - 1);
            const int webcamRegionY = std::max(0, layoutOptions_.webcamY - 1);
            const int webcamRegionRight =
                std::min(width_, layoutOptions_.webcamX + layoutOptions_.webcamSize);
            const int webcamRegionBottom =
                std::min(height_, layoutOptions_.webcamY + layoutOptions_.webcamSize);
            const int webcamRegionWidth = webcamRegionRight - webcamRegionX;
            const int webcamRegionHeight = webcamRegionBottom - webcamRegionY;
            if (webcamRegionWidth > 0 && webcamRegionHeight > 0) {
                const dim3 webcamGrid(
                    (webcamRegionWidth + block.x - 1) / block.x,
                    (webcamRegionHeight + block.y - 1) / block.y);
                overlayWebcamNv12Kernel<<<webcamGrid, block, 0, copyStream_>>>(
                    frame,
                    framePitch,
                    frameChromaOffset,
                    width_,
                    height_,
                    webcamFrame,
                    webcamRegionX,
                    webcamRegionY,
                    webcamRegionWidth,
                    webcamRegionHeight,
                    layoutOptions_.webcamX,
                    layoutOptions_.webcamY,
                    layoutOptions_.webcamSize,
                    webcamFrameWidth(),
                    webcamFrameHeight(),
                    layoutOptions_.webcamRadius,
                    layoutOptions_.webcamMirror);
                checkCuda(cudaGetLastError(), "overlayWebcamNv12Kernel sharp");
            }
        }

        if (cursorPosition.visible && cursorWidth > 0 && cursorHeight > 0) {
            const int cursorPadding = useCursorAtlas ? 4 : 2;
            const int regionX = std::max(0, cursorX - cursorPadding);
            const int regionY = std::max(0, cursorY - cursorPadding);
            const int regionRight = std::min(width_, cursorX + cursorWidth + cursorPadding);
            const int regionBottom = std::min(height_, cursorY + cursorHeight + cursorPadding);
            const int regionWidth = regionRight - regionX;
            const int regionHeight = regionBottom - regionY;
            if (regionWidth > 0 && regionHeight > 0) {
                const dim3 cursorGrid(
                    (regionWidth + block.x - 1) / block.x,
                    (regionHeight + block.y - 1) / block.y);
                overlayCursorNv12Kernel<<<cursorGrid, block, 0, copyStream_>>>(
                    frame,
                    framePitch,
                    frameChromaOffset,
                    width_,
                    height_,
                    regionX,
                    regionY,
                    regionWidth,
                    regionHeight,
                    cursorPosition.visible,
                    cursorX,
                    cursorY,
                    cursorWidth,
                    cursorHeight,
                    useCursorAtlas ? cursorAtlasDevice_ : nullptr,
                    cursorAtlasWidth_,
                    cursorAtlasHeight_,
                    useCursorAtlas ? cursorEntry->x : 0,
                    useCursorAtlas ? cursorEntry->y : 0,
                    useCursorAtlas ? cursorEntry->width : 0,
                    useCursorAtlas ? cursorEntry->height : 0);
                checkCuda(cudaGetLastError(), "overlayCursorNv12Kernel sharp");
            }
        }
    }

    void applyZoomBlurFrame(
        unsigned char* frame,
        int framePitch,
        int frameChromaOffset,
        int regionLeft,
        int regionTop,
        int regionRight,
        int regionBottom,
        float centerX,
        float centerY,
        float strength) {
        const size_t requiredBytes =
            static_cast<size_t>(framePitch) * static_cast<size_t>(height_) +
            static_cast<size_t>(framePitch) * static_cast<size_t>(height_ / 2);
        if (!zoomBlurScratch_ || zoomBlurScratchBytes_ < requiredBytes) {
            if (zoomBlurScratch_) {
                checkCuda(cudaFree(zoomBlurScratch_), "cudaFree zoomBlurScratch");
                zoomBlurScratch_ = nullptr;
                zoomBlurScratchBytes_ = 0;
            }
            checkCuda(cudaMalloc(&zoomBlurScratch_, requiredBytes), "cudaMalloc zoomBlurScratch");
            zoomBlurScratchBytes_ = requiredBytes;
        }

        const dim3 block(16, 16);
        const dim3 grid((width_ + block.x - 1) / block.x, (height_ + block.y - 1) / block.y);
        zoomBlurNv12Kernel<<<grid, block, 0, copyStream_>>>(
            frame,
            framePitch,
            frameChromaOffset,
            width_,
            height_,
            zoomBlurScratch_,
            framePitch,
            frameChromaOffset,
            regionLeft,
            regionTop,
            regionRight,
            regionBottom,
            centerX,
            centerY,
            strength);
        checkCuda(cudaGetLastError(), "zoomBlurNv12Kernel");

        checkCuda(
            cudaMemcpy2DAsync(
                frame,
                static_cast<size_t>(framePitch),
                zoomBlurScratch_,
                static_cast<size_t>(framePitch),
                static_cast<size_t>(width_),
                static_cast<size_t>(height_),
                cudaMemcpyDeviceToDevice,
                copyStream_),
            "cudaMemcpy2DAsync zoom blur Y");
        checkCuda(
            cudaMemcpy2DAsync(
                frame + frameChromaOffset,
                static_cast<size_t>(framePitch),
                zoomBlurScratch_ + static_cast<size_t>(framePitch) * static_cast<size_t>(height_),
                static_cast<size_t>(framePitch),
                static_cast<size_t>(width_),
                static_cast<size_t>(height_ / 2),
                cudaMemcpyDeviceToDevice,
                copyStream_),
            "cudaMemcpy2DAsync zoom blur UV");
        ++zoomBlurFrames_;
    }

    bool canUseFastRoiComposite(bool zoomChangesLayout) const {
        return hasStaticLayout(layoutOptions_) &&
            layoutOptions_.contentX == 0 &&
            layoutOptions_.contentY == 0 &&
            layoutOptions_.contentWidth == width_ &&
            layoutOptions_.contentHeight == height_ &&
            layoutOptions_.radius == 0 &&
            layoutOptions_.shadowIntensityPct == 0 &&
            backgroundDevice_ == nullptr &&
            layoutOptions_.sourceCropWidth <= 0 &&
            layoutOptions_.sourceCropHeight <= 0 &&
            !zoomChangesLayout;
    }

    bool canUseLayeredStaticRoiComposite(bool zoomChangesLayout) const {
        return hasStaticLayout(layoutOptions_) &&
            layoutOptions_.contentWidth > 0 &&
            layoutOptions_.contentHeight > 0 &&
            layoutOptions_.contentX < width_ &&
            layoutOptions_.contentY < height_ &&
            layoutOptions_.contentX + layoutOptions_.contentWidth > 0 &&
            layoutOptions_.contentY + layoutOptions_.contentHeight > 0 &&
            layoutOptions_.shadowIntensityPct == 0;
    }

    const unsigned char* selectWebcamFrame(double sourceTimeMs) const {
        if (webcamCache_ && !webcamCache_->frames.empty()) {
            return webcamCache_->frameAt(webcamFrameIndexForSourceTimeMs(sourceTimeMs, layoutOptions_));
        }
        return webcamDevice_;
    }

    int webcamFrameWidth() const {
        return webcamCache_ ? webcamCache_->width : layoutOptions_.webcamSize;
    }

    int webcamFrameHeight() const {
        return webcamCache_ ? webcamCache_->height : layoutOptions_.webcamSize;
    }

    void loadBackgroundFrame() {
        if (layoutOptions_.backgroundNv12Path.empty()) {
            return;
        }

        const size_t expectedBytes = static_cast<size_t>(width_) * static_cast<size_t>(height_) * 3 / 2;
        std::vector<unsigned char> bytes(expectedBytes);
        std::ifstream input(layoutOptions_.backgroundNv12Path, std::ios::binary);
        if (!input) {
            fail("Failed to open background NV12: " + layoutOptions_.backgroundNv12Path);
        }
        input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
        if (static_cast<size_t>(input.gcount()) != expectedBytes) {
            fail("Background NV12 has an unexpected size: " + layoutOptions_.backgroundNv12Path);
        }

        checkCuda(cudaMalloc(&backgroundDevice_, expectedBytes), "cudaMalloc backgroundDevice");
        checkCuda(
            cudaMemcpy(backgroundDevice_, bytes.data(), expectedBytes, cudaMemcpyHostToDevice),
            "cudaMemcpy backgroundDevice");
    }

    void loadWebcamFrame() {
        if (layoutOptions_.webcamNv12Path.empty()) {
            return;
        }

        const size_t expectedBytes =
            static_cast<size_t>(layoutOptions_.webcamSize) * static_cast<size_t>(layoutOptions_.webcamSize) * 3 / 2;
        std::vector<unsigned char> bytes(expectedBytes);
        std::ifstream input(layoutOptions_.webcamNv12Path, std::ios::binary);
        if (!input) {
            fail("Failed to open webcam NV12: " + layoutOptions_.webcamNv12Path);
        }
        input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
        if (static_cast<size_t>(input.gcount()) != expectedBytes) {
            fail("Webcam NV12 has an unexpected size: " + layoutOptions_.webcamNv12Path);
        }

        checkCuda(cudaMalloc(&webcamDevice_, expectedBytes), "cudaMalloc webcamDevice");
        checkCuda(
            cudaMemcpy(webcamDevice_, bytes.data(), expectedBytes, cudaMemcpyHostToDevice),
            "cudaMemcpy webcamDevice");
    }

    const CursorAtlasEntry* cursorAtlasEntryFor(int typeIndex) const {
        if (typeIndex < 0 || typeIndex >= kMaxCursorAtlasEntries) {
            return nullptr;
        }
        const CursorAtlasEntry& entry = cursorAtlasEntries_[typeIndex];
        return entry.valid ? &entry : nullptr;
    }

    void loadCursorAtlas() {
        if (layoutOptions_.cursorAtlasRgbaPath.empty()) {
            return;
        }
        if (layoutOptions_.cursorAtlasMetadataPath.empty() ||
            layoutOptions_.cursorAtlasWidth <= 0 ||
            layoutOptions_.cursorAtlasHeight <= 0) {
            fail("Cursor atlas requires metadata, width, and height");
        }

        std::ifstream metadata(layoutOptions_.cursorAtlasMetadataPath);
        if (!metadata) {
            fail("Failed to open cursor atlas metadata: " + layoutOptions_.cursorAtlasMetadataPath);
        }

        int loadedEntries = 0;
        int index = 0;
        CursorAtlasEntry entry;
        while (metadata >> index >> entry.x >> entry.y >> entry.width >> entry.height >>
               entry.anchorX >> entry.anchorY >> entry.aspectRatio) {
            if (index < 0 || index >= kMaxCursorAtlasEntries || entry.width <= 0 || entry.height <= 0) {
                continue;
            }
            entry.valid = true;
            cursorAtlasEntries_[index] = entry;
            ++loadedEntries;
        }
        if (loadedEntries == 0) {
            fail("No cursor atlas entries were loaded: " + layoutOptions_.cursorAtlasMetadataPath);
        }

        cursorAtlasWidth_ = layoutOptions_.cursorAtlasWidth;
        cursorAtlasHeight_ = layoutOptions_.cursorAtlasHeight;
        const size_t expectedBytes =
            static_cast<size_t>(cursorAtlasWidth_) * static_cast<size_t>(cursorAtlasHeight_) * 4;
        std::vector<unsigned char> bytes(expectedBytes);
        std::ifstream input(layoutOptions_.cursorAtlasRgbaPath, std::ios::binary);
        if (!input) {
            fail("Failed to open cursor atlas RGBA: " + layoutOptions_.cursorAtlasRgbaPath);
        }
        input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
        if (static_cast<size_t>(input.gcount()) != expectedBytes) {
            fail("Cursor atlas RGBA has an unexpected size: " + layoutOptions_.cursorAtlasRgbaPath);
        }

        checkCuda(cudaMalloc(&cursorAtlasDevice_, expectedBytes), "cudaMalloc cursorAtlasDevice");
        checkCuda(
            cudaMemcpy(cursorAtlasDevice_, bytes.data(), expectedBytes, cudaMemcpyHostToDevice),
            "cudaMemcpy cursorAtlasDevice");
    }

    void writePackets(const std::vector<std::vector<uint8_t>>& packets) {
        for (const auto& packet : packets) {
            if (packet.empty()) {
                continue;
            }
            output_.write(reinterpret_cast<const char*>(packet.data()), static_cast<std::streamsize>(packet.size()));
            outputBytes_ += packet.size();
        }
    }

    NvEncoderCuda encoder_;
    std::ofstream output_;
    int width_ = 0;
    int height_ = 0;
    int fps_ = 30;
    int frames_ = 0;
    uint64_t outputBytes_ = 0;
    double compositeMs_ = 0.0;
    double nvencMs_ = 0.0;
    double packetWriteMs_ = 0.0;
    int roiCompositeFrames_ = 0;
    int monolithicCompositeFrames_ = 0;
    int copyCompositeFrames_ = 0;
    int zoomBlurFrames_ = 0;
    int overlayBlendFrames_ = 0;
    int temporalBlurFrames_ = 0;
    int temporalBlurBgPrecomposedFrames_ = 0;
    int temporalBlurStationaryFrames_ = 0;
    int temporalBgCacheBuilds_ = 0;
    int64_t temporalBgCacheHits_ = 0;
    int64_t overlayStaticRegionBlends_ = 0;
    int64_t temporalBlurSamplesTotal_ = 0;
    bool zoomBlurRecorded_ = false;
    bool overlayRecorded_ = false;
    double compositeGpuMs_ = 0.0;
    double zoomBlurGpuMs_ = 0.0;
    double overlayBlendGpuMs_ = 0.0;
    NvencCapabilityProbe capabilityProbe_;
    NvencConfigUsed nvencConfigUsed_;
    int temporalBlurSampleCount_ = 0;
    double temporalBlurShutterFraction_ = 0.0;
    double temporalBlurWeightPower_ = 1.0;
    std::vector<TemporalBlurSample> temporalSamplePlan_;
    unsigned int* temporalWeightsDevice_ = nullptr;
    size_t temporalWeightsDeviceCount_ = 0;
    unsigned char* temporalBgCacheDevice_ = nullptr;
    Options layoutOptions_;
    unsigned char* backgroundDevice_ = nullptr;
    unsigned char* webcamDevice_ = nullptr;
    unsigned char* cursorAtlasDevice_ = nullptr;
    CursorAtlasEntry cursorAtlasEntries_[kMaxCursorAtlasEntries];
    int cursorAtlasWidth_ = 0;
    int cursorAtlasHeight_ = 0;
    const WebcamFrameCache* webcamCache_ = nullptr;
    const CursorTrack* cursorTrack_ = nullptr;
    const ZoomTrack* zoomTrack_ = nullptr;
    OverlayFrameSource* overlaySource_ = nullptr;
    cudaStream_t copyStream_ = nullptr;
    cudaEvent_t compositeStartEvent_ = nullptr;
    cudaEvent_t compositeEndEvent_ = nullptr;
    cudaEvent_t blurStartEvent_ = nullptr;
    cudaEvent_t blurEndEvent_ = nullptr;
    cudaEvent_t overlayStartEvent_ = nullptr;
    cudaEvent_t overlayEndEvent_ = nullptr;
    unsigned char* zoomBlurScratch_ = nullptr;
    size_t zoomBlurScratchBytes_ = 0;
};

struct CallbackEncodeState {
    CUcontext context = nullptr;
    const Options* options = nullptr;
    uint32_t bitrate = 0;
    std::unique_ptr<NvencSink>* sink = nullptr;
    double* decodeMs = nullptr;
    double* encodeMs = nullptr;
    int* encodedFrames = nullptr;
    int displayFrameIndex = 0;
    const WebcamFrameCache* webcamCache = nullptr;
    const CursorTrack* cursorTrack = nullptr;
    const ZoomTrack* zoomTrack = nullptr;
    OverlayFrameSource* overlaySource = nullptr;
    const NvencCapabilityProbe* capabilityProbe = nullptr;
    ProgressReportState* progress = nullptr;
    bool oneFramePerMappedDisplayFrame = false;
    int mappedFrames = 0;
    const std::vector<double>* sourcePts = nullptr;
    const std::vector<TimelineSegment>* timelineSegments = nullptr;
};

ProgressCounters collectProgressCounters(
    const NvencSink* sink,
    const WebcamFrameCache* webcamCache,
    double decodeWallMs,
    double encodeMs) {
    ProgressCounters counters;
    counters.decodeWallMs = decodeWallMs;
    counters.encodeMs = encodeMs;
    if (sink) {
        counters.compositeMs = sink->compositeMs();
        counters.compositeGpuMs = sink->compositeGpuMs();
        counters.zoomBlurGpuMs = sink->zoomBlurGpuMs();
        counters.overlayBlendGpuMs = sink->overlayBlendGpuMs();
        counters.overlayUploadMs = sink->overlayUploadMs();
        counters.nvencMs = sink->nvencMs();
        counters.packetWriteMs = sink->packetWriteMs();
        counters.roiCompositeFrames = sink->roiCompositeFrames();
        counters.monolithicCompositeFrames = sink->monolithicCompositeFrames();
        counters.copyCompositeFrames = sink->copyCompositeFrames();
        counters.zoomBlurFrames = sink->zoomBlurFrames();
        counters.overlayBlendFrames = sink->overlayBlendFrames();
        counters.temporalBlurFrames = sink->temporalBlurFrames();
        counters.temporalBlurSamplesTotal = sink->temporalBlurSamplesTotal();
        counters.temporalBlurBgPrecomposedFrames = sink->temporalBlurBgPrecomposedFrames();
        counters.temporalBlurStationaryFrames = sink->temporalBlurStationaryFrames();
        counters.temporalBgCacheBuilds = sink->temporalBgCacheBuilds();
        counters.temporalBgCacheHits = sink->temporalBgCacheHits();
        counters.overlayStaticRegionBlends = sink->overlayStaticRegionBlends();
        counters.overlayFileLoads = sink->overlayFileLoads();
        counters.overlayCacheHits = sink->overlayCacheHits();
        counters.overlayPinnedHits = sink->overlayPinnedHits();
        counters.overlayReadWaits = sink->overlayReadWaits();
        counters.overlayPendingReadsPeak = sink->overlayPendingReadsPeak();
        counters.overlayHostReadMs = sink->overlayHostReadMs();
        counters.overlayH2DEnqueueMs = sink->overlayH2DEnqueueMs();
    }
    if (webcamCache) {
        counters.webcamDecodeMs = webcamCache->decodeMs;
        counters.webcamCopyMs = webcamCache->copyMs;
    }
    return counters;
}

int maxCallbackOutputFrames(const Options& options) {
    int maxOutputFrames = options.targetFrames > 0
        ? options.targetFrames
        : std::numeric_limits<int>::max();
    if (options.maxFrames > 0) {
        maxOutputFrames = std::min(maxOutputFrames, options.maxFrames);
    }
    return maxOutputFrames;
}

bool shouldContinueEncoding(int encodedFrames, const Options& options) {
    return encodedFrames < maxCallbackOutputFrames(options);
}

int expectedCallbackOutputFramesForSourceFrame(
    int sourceFrameIndex,
    const Options& options,
    const std::vector<double>* sourcePts,
    const std::vector<TimelineSegment>* timelineSegments) {
    return expectedOutputFramesForSourceFrame(
        sourceFrameIndex,
        options.inputFrames,
        options.targetFrames,
        options.maxFrames,
        options.fps,
        sourcePts,
        timelineSegments);
}

void encodeMappedDisplayFrame(
    CUdeviceptr dpSrcFrame,
    unsigned int nSrcPitch,
    int width,
    int height,
    int surfaceHeight,
    int64_t,
    void* userData) {
    auto* state = static_cast<CallbackEncodeState*>(userData);
    ++state->mappedFrames;
    const int sourceFrameIndex = state->displayFrameIndex++;
    const int maxOutputFrames = maxCallbackOutputFrames(*state->options);
    if (*state->encodedFrames >= maxOutputFrames) {
        return;
    }
    const int expectedOutputFrames = state->oneFramePerMappedDisplayFrame
        ? *state->encodedFrames + 1
        : expectedCallbackOutputFramesForSourceFrame(
            sourceFrameIndex,
            *state->options,
            state->sourcePts,
            state->timelineSegments);
    if (*state->encodedFrames >= expectedOutputFrames) {
        return;
    }

    if (!*state->sink) {
        validateOverlayBounds(
            *state->options,
            outputWidthForSource(*state->options, width),
            outputHeightForSource(*state->options, height));
        *state->sink = std::make_unique<NvencSink>(
            state->context,
            outputWidthForSource(*state->options, width),
            outputHeightForSource(*state->options, height),
            state->options->fps,
            state->bitrate,
            state->options->outputPath,
            *state->options,
            state->webcamCache,
            state->cursorTrack,
            state->zoomTrack,
            state->overlaySource,
            state->capabilityProbe ? *state->capabilityProbe : NvencCapabilityProbe{});
    }

    while (*state->encodedFrames < expectedOutputFrames && *state->encodedFrames < maxOutputFrames) {
        const auto encodeStart = std::chrono::steady_clock::now();
        (*state->sink)->encodeFrame(
            reinterpret_cast<const unsigned char*>(dpSrcFrame),
            static_cast<int>(nSrcPitch),
            width,
            height,
            surfaceHeight,
            *state->encodedFrames);
        const auto encodeEnd = std::chrono::steady_clock::now();
        *state->encodeMs += elapsedMs(encodeStart, encodeEnd);
        ++*state->encodedFrames;
        if (state->progress) {
            const NvencSink* activeSink = state->sink && *state->sink ? state->sink->get() : nullptr;
            reportEncodingProgress(
                *state->encodedFrames,
                maxOutputFrames,
                *state->progress,
                collectProgressCounters(
                    activeSink,
                    state->webcamCache,
                    state->decodeMs ? *state->decodeMs : 0.0,
                    state->encodeMs ? *state->encodeMs : 0.0));
        }
    }
}

double elapsedMs(std::chrono::steady_clock::time_point start, std::chrono::steady_clock::time_point end) {
    return std::chrono::duration<double, std::milli>(end - start).count();
}

void reportEncodingProgress(
    int encodedFrames,
    int totalFrames,
    ProgressReportState& state,
    const ProgressCounters& counters,
    bool force) {
    if (totalFrames <= 0) {
        return;
    }

    const auto now = std::chrono::steady_clock::now();
    if (!force && encodedFrames < totalFrames && encodedFrames % 30 != 0 && elapsedMs(state.lastReportAt, now) < 500.0) {
        return;
    }

    const double percentage = std::min(100.0, std::max(0.0, static_cast<double>(encodedFrames) * 100.0 / totalFrames));
    const double elapsedSeconds = std::max(elapsedMs(state.startedAt, now) / 1000.0, 0.001);
    const double averageFps = encodedFrames > 0 ? static_cast<double>(encodedFrames) / elapsedSeconds : 0.0;
    const double intervalMs = std::max(elapsedMs(state.lastReportAt, now), 0.0);
    const int intervalFrames = std::max(0, encodedFrames - state.lastReportedFrame);
    const double instantFps =
        intervalMs > 0.0 && intervalFrames > 0 ? static_cast<double>(intervalFrames) * 1000.0 / intervalMs : 0.0;
    const double intervalEncodeMs = std::max(0.0, counters.encodeMs - state.lastCounters.encodeMs);
    const double intervalCompositeMs = std::max(0.0, counters.compositeMs - state.lastCounters.compositeMs);
    const double intervalCompositeGpuMs = std::max(0.0, counters.compositeGpuMs - state.lastCounters.compositeGpuMs);
    const double intervalZoomBlurGpuMs = std::max(0.0, counters.zoomBlurGpuMs - state.lastCounters.zoomBlurGpuMs);
    const double intervalOverlayBlendGpuMs = std::max(0.0, counters.overlayBlendGpuMs - state.lastCounters.overlayBlendGpuMs);
    const double intervalOverlayUploadMs = std::max(0.0, counters.overlayUploadMs - state.lastCounters.overlayUploadMs);
    const double intervalOverlayHostReadMs = std::max(
        0.0,
        counters.overlayHostReadMs - state.lastCounters.overlayHostReadMs);
    const double intervalOverlayH2DEnqueueMs = std::max(
        0.0,
        counters.overlayH2DEnqueueMs - state.lastCounters.overlayH2DEnqueueMs);
    const double intervalNvencMs = std::max(0.0, counters.nvencMs - state.lastCounters.nvencMs);
    const double intervalPacketWriteMs = std::max(0.0, counters.packetWriteMs - state.lastCounters.packetWriteMs);
    const double intervalWebcamDecodeMs = std::max(0.0, counters.webcamDecodeMs - state.lastCounters.webcamDecodeMs);
    const double intervalWebcamCopyMs = std::max(0.0, counters.webcamCopyMs - state.lastCounters.webcamCopyMs);
    const double intervalDecodeWallMs = std::max(0.0, counters.decodeWallMs - state.lastCounters.decodeWallMs);
    const double intervalPipelineWaitMs = std::max(0.0, intervalMs - intervalEncodeMs);
    const int intervalRoiCompositeFrames =
        std::max(0, counters.roiCompositeFrames - state.lastCounters.roiCompositeFrames);
    const int intervalMonolithicCompositeFrames =
        std::max(0, counters.monolithicCompositeFrames - state.lastCounters.monolithicCompositeFrames);
    const int intervalCopyCompositeFrames =
        std::max(0, counters.copyCompositeFrames - state.lastCounters.copyCompositeFrames);
    const int intervalZoomBlurFrames =
        std::max(0, counters.zoomBlurFrames - state.lastCounters.zoomBlurFrames);
    const int intervalOverlayBlendFrames =
        std::max(0, counters.overlayBlendFrames - state.lastCounters.overlayBlendFrames);
    const int intervalTemporalBlurFrames =
        std::max(0, counters.temporalBlurFrames - state.lastCounters.temporalBlurFrames);
    const int64_t intervalTemporalBlurSamples =
        std::max<int64_t>(0, counters.temporalBlurSamplesTotal - state.lastCounters.temporalBlurSamplesTotal);
    const int intervalTemporalBlurBgPrecomposedFrames = std::max(
        0,
        counters.temporalBlurBgPrecomposedFrames - state.lastCounters.temporalBlurBgPrecomposedFrames);
    const int intervalTemporalBlurStationaryFrames = std::max(
        0,
        counters.temporalBlurStationaryFrames - state.lastCounters.temporalBlurStationaryFrames);
    const int intervalTemporalBgCacheBuilds = std::max(
        0,
        counters.temporalBgCacheBuilds - state.lastCounters.temporalBgCacheBuilds);
    const int64_t intervalTemporalBgCacheHits = std::max<int64_t>(
        0,
        counters.temporalBgCacheHits - state.lastCounters.temporalBgCacheHits);
    const int64_t intervalOverlayStaticRegionBlends = std::max<int64_t>(
        0,
        counters.overlayStaticRegionBlends - state.lastCounters.overlayStaticRegionBlends);
    const int64_t intervalOverlayFileLoads =
        std::max<int64_t>(0, counters.overlayFileLoads - state.lastCounters.overlayFileLoads);
    const int64_t intervalOverlayCacheHits =
        std::max<int64_t>(0, counters.overlayCacheHits - state.lastCounters.overlayCacheHits);
    const int64_t intervalOverlayPinnedHits =
        std::max<int64_t>(0, counters.overlayPinnedHits - state.lastCounters.overlayPinnedHits);
    const int64_t intervalOverlayReadWaits =
        std::max<int64_t>(0, counters.overlayReadWaits - state.lastCounters.overlayReadWaits);
    std::cerr << std::fixed << std::setprecision(2)
              << "PROGRESS {\"outputCodec\":\"" << state.outputCodec
              << "\",\"currentFrame\":" << encodedFrames
              << ",\"totalFrames\":" << totalFrames
              << ",\"percentage\":" << percentage
              << ",\"averageFps\":" << averageFps
              << ",\"instantFps\":" << instantFps
              << ",\"intervalMs\":" << intervalMs
              << ",\"intervalFrames\":" << intervalFrames
              << ",\"intervalDecodeWallMs\":" << intervalDecodeWallMs
              << ",\"intervalEncodeMs\":" << intervalEncodeMs
              << ",\"intervalPipelineWaitMs\":" << intervalPipelineWaitMs
              << ",\"intervalCompositeMs\":" << intervalCompositeMs
              << ",\"intervalCompositeGpuMs\":" << intervalCompositeGpuMs
              << ",\"intervalZoomBlurGpuMs\":" << intervalZoomBlurGpuMs
              << ",\"intervalOverlayBlendGpuMs\":" << intervalOverlayBlendGpuMs
              << ",\"intervalOverlayUploadMs\":" << intervalOverlayUploadMs
              << ",\"intervalOverlayHostReadMs\":" << intervalOverlayHostReadMs
              << ",\"intervalOverlayH2DEnqueueMs\":" << intervalOverlayH2DEnqueueMs
              << ",\"intervalNvencMs\":" << intervalNvencMs
              << ",\"intervalPacketWriteMs\":" << intervalPacketWriteMs
              << ",\"intervalWebcamDecodeMs\":" << intervalWebcamDecodeMs
              << ",\"intervalWebcamCopyMs\":" << intervalWebcamCopyMs
              << ",\"intervalRoiCompositeFrames\":" << intervalRoiCompositeFrames
              << ",\"intervalMonolithicCompositeFrames\":" << intervalMonolithicCompositeFrames
              << ",\"intervalCopyCompositeFrames\":" << intervalCopyCompositeFrames
              << ",\"intervalZoomBlurFrames\":" << intervalZoomBlurFrames
              << ",\"intervalOverlayBlendFrames\":" << intervalOverlayBlendFrames
              << ",\"intervalTemporalBlurFrames\":" << intervalTemporalBlurFrames
              << ",\"intervalTemporalBlurSamples\":" << intervalTemporalBlurSamples
              << ",\"intervalTemporalBlurBgPrecomposedFrames\":" << intervalTemporalBlurBgPrecomposedFrames
              << ",\"intervalTemporalBlurStationaryFrames\":" << intervalTemporalBlurStationaryFrames
              << ",\"intervalTemporalBgCacheBuilds\":" << intervalTemporalBgCacheBuilds
              << ",\"intervalTemporalBgCacheHits\":" << intervalTemporalBgCacheHits
              << ",\"intervalOverlayStaticRegionBlends\":" << intervalOverlayStaticRegionBlends
              << ",\"intervalOverlayFileLoads\":" << intervalOverlayFileLoads
              << ",\"intervalOverlayCacheHits\":" << intervalOverlayCacheHits
              << ",\"intervalOverlayPinnedHits\":" << intervalOverlayPinnedHits
              << ",\"intervalOverlayReadWaits\":" << intervalOverlayReadWaits
              << ",\"overlayPendingReadsPeak\":" << counters.overlayPendingReadsPeak
              << "}" << std::endl;
    state.lastReportAt = now;
    state.lastReportedFrame = encodedFrames;
    state.lastCounters = counters;
}

} // namespace

int main(int argc, char** argv) {
    const char* requestedOutputCodec = "h264";
    NvencCapabilityProbe capabilityProbe;
    try {
        Options options = parseOptions(argc, argv);
        requestedOutputCodec = outputCodecName(options.outputCodec);
        options.timelineSegments = loadTimelineMap(options.timelineMapPath);
        if (!options.timelineSegments.empty() && !options.callbackEncode) {
            fail("Timeline-map CUDA export requires --callback-encode");
        }
        const uint32_t bitrate = static_cast<uint32_t>(options.bitrateMbps) * 1000U * 1000U;

        checkCuda(cudaSetDevice(0), "cudaSetDevice");
        checkCu(cuInit(0), "cuInit");
        CUdevice device = 0;
        checkCu(cuDeviceGet(&device, 0), "cuDeviceGet");
        // Use the primary context (shared with the CUDA runtime API used for
        // buffer allocation) rather than a separate cuCtxCreate context. NVENC
        // capability queries and the runtime allocations must see the same
        // primary context; a detached context causes caps queries to fail with
        // NV_ENC_ERR_ENCODER_NOT_INITIALIZED style errors on current drivers.
        CUcontext context = nullptr;
        checkCu(cuDevicePrimaryCtxRetain(&context, device), "cuDevicePrimaryCtxRetain");
        checkCu(cuCtxSetCurrent(context), "cuCtxSetCurrent");
        // Run the NVENC capability probe before any runtime-API prewarm work so
        // the caps query happens on a freshly current primary context. The probe
        // opens a real session and queries the caps for the requested output
        // codec, so the config decisions below consume real capability reads.
        capabilityProbe = probeNvencCapabilities(
            context,
            options.outputCodec == OutputCodec::HEVC ? NV_ENC_CODEC_HEVC_GUID : NV_ENC_CODEC_H264_GUID);
        prewarmCuda(options.prewarmMs);
        if (!capabilityProbe.apiLoaded || !capabilityProbe.sessionOpened) {
            std::cerr << "{\"success\":false,\"outputCodec\":\""
                      << requestedOutputCodec
                      << "\",\"backend\":\"nvidia-nvenc\",\"error\":\"NVENC capability probe failed: "
                      << capabilityProbe.error
                      << "\",\"noCpuFallback\":true}" << std::endl;
            return 1;
        }

        std::ifstream input(options.inputPath, std::ios::binary);
        if (!input) {
            fail("Failed to open input: " + options.inputPath);
        }

        std::unique_ptr<WebcamStreamDecoder> webcamStream = createWebcamStreamDecoder(context, options);
        const WebcamFrameCache* webcamCachePtr = webcamStream ? webcamStream->cache() : nullptr;
        std::unique_ptr<CursorTrack> cursorTrack = loadCursorTrack(options);
        const CursorTrack* cursorTrackPtr = cursorTrack.get();
        std::unique_ptr<ZoomTrack> zoomTrack = loadZoomTrack(options);
        const ZoomTrack* zoomTrackPtr = zoomTrack.get();
        std::unique_ptr<OverlayFrameSource> overlaySource =
            options.overlayLayers.empty()
                ? nullptr
                : std::make_unique<OverlayFrameSource>(options.overlayLayers);
        OverlayFrameSource* overlaySourcePtr = overlaySource.get();
        const std::vector<double> sourcePts = loadFramePts(options.sourcePtsPath);
        const bool useSourcePts =
            options.inputFrames > 0 &&
            sourcePts.size() >= static_cast<size_t>(options.inputFrames);
        if (!options.timelineSegments.empty() && !useSourcePts) {
            fail("Timeline-map CUDA export requires source frame PTS");
        }
        auto decoder = std::make_unique<NvDecoder>(context, 0, 0, true, cudaVideoCodec_H264, nullptr, true, true);
        std::unique_ptr<NvencSink> sink;
        const bool useDecoderFramePolicy =
            options.inputFrames > 0 &&
            options.targetFrames > 0 &&
            options.inputFrames >= options.targetFrames &&
            !useSourcePts &&
            !options.postSelect;
        FrameSelectionState selectionState{
            options.inputFrames,
            options.targetFrames,
            options.maxFrames,
            0,
            0,
            options.fps,
            useSourcePts ? &sourcePts : nullptr,
            options.timelineSegments.empty() ? nullptr : &options.timelineSegments,
        };
        if (useDecoderFramePolicy) {
            decoder->SetDisplayFramePolicy(shouldCopyDisplayFrame, &selectionState);
        }

        std::vector<uint8_t> chunk(static_cast<size_t>(options.chunkMb) * 1024 * 1024);
        uint8_t** frames = nullptr;
        int returnedFrames = 0;
        int sourceFrames = 0;
        int encodedFrames = 0;
        const auto totalStart = std::chrono::steady_clock::now();
        double decodeMs = 0.0;
        double encodeMs = 0.0;
        ProgressReportState progressState;
        progressState.startedAt = std::chrono::steady_clock::now();
        progressState.outputCodec = outputCodecName(options.outputCodec);
        progressState.lastReportAt = progressState.startedAt;
        const int progressTotalFrames = maxCallbackOutputFrames(options);
        reportEncodingProgress(0, progressTotalFrames, progressState, ProgressCounters{}, true);
        CallbackEncodeState callbackState{
            context,
            &options,
            bitrate,
            &sink,
            &decodeMs,
            &encodeMs,
            &encodedFrames,
            0,
            webcamCachePtr,
            cursorTrackPtr,
            zoomTrackPtr,
            overlaySourcePtr,
            &capabilityProbe,
            &progressState,
            useDecoderFramePolicy,
            0,
            useSourcePts ? &sourcePts : nullptr,
            options.timelineSegments.empty() ? nullptr : &options.timelineSegments,
        };
        if (options.callbackEncode) {
            decoder->SetMappedFrameHandler(encodeMappedDisplayFrame, &callbackState);
        }

        auto prepareWebcamFrames = [&]() {
            if (!webcamStream) {
                return;
            }
            int outputFrameIndex = encodedFrames + kWebcamPrefetchOutputFrames;
            if (options.maxFrames > 0) {
                outputFrameIndex = std::min(outputFrameIndex, options.maxFrames - 1);
            }
            if (options.targetFrames > 0) {
                outputFrameIndex = std::min(outputFrameIndex, options.targetFrames - 1);
            }
            webcamStream->ensureFrame(webcamFrameIndexForOutputFrame(outputFrameIndex, options));

            const int keepFromOutputFrame = std::max(0, encodedFrames - 8);
            webcamStream->dropBefore(webcamFrameIndexForOutputFrame(keepFromOutputFrame, options));
        };

        while (input && shouldContinueEncoding(encodedFrames, options)) {
            prepareWebcamFrames();
            input.read(reinterpret_cast<char*>(chunk.data()), static_cast<std::streamsize>(chunk.size()));
            const int bytesRead = static_cast<int>(input.gcount());
            if (bytesRead <= 0) {
                break;
            }

            const auto decodeStart = std::chrono::steady_clock::now();
            decoder->Decode(chunk.data(), bytesRead, &frames, &returnedFrames);
            const auto decodeEnd = std::chrono::steady_clock::now();
            decodeMs += elapsedMs(decodeStart, decodeEnd);

            for (int index = 0; index < returnedFrames; ++index) {
                if (!shouldContinueEncoding(encodedFrames, options)) {
                    break;
                }
                const int sourceFrameIndex = sourceFrames++;
                if (!useDecoderFramePolicy && !shouldEncodeFrame(sourceFrameIndex, encodedFrames, options)) {
                    continue;
                }
                if (!sink) {
                    validateOverlayBounds(
                        options,
                        outputWidthForSource(options, decoder->GetWidth()),
                        outputHeightForSource(options, decoder->GetHeight()));
                    sink = std::make_unique<NvencSink>(
                        context,
                        outputWidthForSource(options, decoder->GetWidth()),
                        outputHeightForSource(options, decoder->GetHeight()),
                        options.fps,
                        bitrate,
                        options.outputPath,
                        options,
                        webcamCachePtr,
                        cursorTrackPtr,
                        zoomTrackPtr,
                        overlaySourcePtr,
                        capabilityProbe);
                }
                const auto encodeStart = std::chrono::steady_clock::now();
                sink->encodeFrame(
                    frames[index],
                    decoder->GetDeviceFramePitch(),
                    decoder->GetWidth(),
                    decoder->GetHeight(),
                    decoder->GetHeight(),
                    encodedFrames);
                const auto encodeEnd = std::chrono::steady_clock::now();
                encodeMs += elapsedMs(encodeStart, encodeEnd);
                ++encodedFrames;
                reportEncodingProgress(
                    encodedFrames,
                    progressTotalFrames,
                    progressState,
                    collectProgressCounters(sink.get(), webcamCachePtr, decodeMs, encodeMs));
            }
        }

        if (shouldContinueEncoding(encodedFrames, options)) {
            const auto decodeStart = std::chrono::steady_clock::now();
            decoder->Decode(nullptr, 0, &frames, &returnedFrames);
            const auto decodeEnd = std::chrono::steady_clock::now();
            decodeMs += elapsedMs(decodeStart, decodeEnd);
            for (int index = 0; index < returnedFrames; ++index) {
                if (!shouldContinueEncoding(encodedFrames, options)) {
                    break;
                }
                const int sourceFrameIndex = sourceFrames++;
                if (!useDecoderFramePolicy && !shouldEncodeFrame(sourceFrameIndex, encodedFrames, options)) {
                    continue;
                }
                if (!sink) {
                    validateOverlayBounds(
                        options,
                        outputWidthForSource(options, decoder->GetWidth()),
                        outputHeightForSource(options, decoder->GetHeight()));
                    sink = std::make_unique<NvencSink>(
                        context,
                        outputWidthForSource(options, decoder->GetWidth()),
                        outputHeightForSource(options, decoder->GetHeight()),
                        options.fps,
                        bitrate,
                        options.outputPath,
                        options,
                        webcamCachePtr,
                        cursorTrackPtr,
                        zoomTrackPtr,
                        overlaySourcePtr,
                        capabilityProbe);
                }
                const auto encodeStart = std::chrono::steady_clock::now();
                sink->encodeFrame(
                    frames[index],
                    decoder->GetDeviceFramePitch(),
                    decoder->GetWidth(),
                    decoder->GetHeight(),
                    decoder->GetHeight(),
                    encodedFrames);
                const auto encodeEnd = std::chrono::steady_clock::now();
                encodeMs += elapsedMs(encodeStart, encodeEnd);
                ++encodedFrames;
                reportEncodingProgress(
                    encodedFrames,
                    progressTotalFrames,
                    progressState,
                    collectProgressCounters(sink.get(), webcamCachePtr, decodeMs, encodeMs));
            }
        }

        if (!sink) {
            fail("No decoded frames were produced");
        }
        const auto flushStart = std::chrono::steady_clock::now();
        sink->finish();
        const auto flushEnd = std::chrono::steady_clock::now();
        const auto totalEnd = std::chrono::steady_clock::now();
        reportEncodingProgress(
            encodedFrames,
            progressTotalFrames,
            progressState,
            collectProgressCounters(sink.get(), webcamCachePtr, decodeMs, encodeMs),
            true);

        const double totalMs = elapsedMs(totalStart, totalEnd);
        const double mediaMs = static_cast<double>(encodedFrames) * 1000.0 / options.fps;
        const double measuredFps = static_cast<double>(encodedFrames) / (totalMs / 1000.0);
        const double realtime = mediaMs / totalMs;
        const int reportedSourceFrames =
            useDecoderFramePolicy ? selectionState.sourceFrames :
            (options.callbackEncode ? decoder->GetDisplayFrameCount() : sourceFrames);
        const int mappedDisplayFrames = options.callbackEncode ? callbackState.mappedFrames : encodedFrames;
        const int selectedDisplayFrames =
            useDecoderFramePolicy ? selectionState.selectedFrames : mappedDisplayFrames;
        const int skippedDisplayFrames =
            useDecoderFramePolicy ? std::max(0, selectionState.sourceFrames - selectionState.selectedFrames) : 0;
        const double decodeOnlyApproxMs = options.callbackEncode ? std::max(0.0, decodeMs - encodeMs) : decodeMs;

        std::cout << std::fixed << std::setprecision(2)
                  << "{"
                  << "\"success\":true,"
                  << "\"mode\":\"nvdec-cuda-nvenc-annexb\","
                  << "\"outputCodec\":\"" << outputCodecName(options.outputCodec) << "\","
                  << "\"elementaryStreamFormat\":\""
                  << outputCodecName(options.outputCodec) << "\","
                  << "\"selectionStage\":\""
                  << (options.callbackEncode
                          ? (useDecoderFramePolicy ? "decoder-policy-mapped-callback" : "mapped-callback")
                          : (useDecoderFramePolicy ? "decoder" : "post"))
                  << "\","
                  << "\"sourceTimestampMode\":\"" << (useSourcePts ? "pts" : "ordinal") << "\","
                  << "\"timelineMap\":" << (!options.timelineSegments.empty() ? "true" : "false") << ","
                  << "\"timelineSegments\":" << options.timelineSegments.size() << ","
                  << "\"syncMode\":\"stream\","
                  << "\"prewarmMs\":" << options.prewarmMs << ","
                  << "\"chunkMb\":" << options.chunkMb << ","
                  << "\"width\":" << outputWidthForSource(options, decoder->GetWidth()) << ","
                  << "\"height\":" << outputHeightForSource(options, decoder->GetHeight()) << ","
                  << "\"fps\":" << options.fps << ","
                  << "\"encodingMode\":\"" << options.encodingMode << "\","
                  << "\"staticLayout\":" << (hasStaticLayout(options) ? "true" : "false") << ","
                  << "\"contentX\":" << options.contentX << ","
                  << "\"contentY\":" << options.contentY << ","
                  << "\"contentWidth\":" << options.contentWidth << ","
                  << "\"contentHeight\":" << options.contentHeight << ","
                  << "\"radius\":" << options.radius << ","
                  << "\"backgroundImage\":" << (!options.backgroundNv12Path.empty() ? "true" : "false") << ","
                  << "\"shadowOffsetY\":" << options.shadowOffsetY << ","
                  << "\"shadowIntensityPct\":" << options.shadowIntensityPct << ","
                  << "\"webcamOverlay\":" << (hasWebcamOverlay(options) ? "true" : "false") << ","
                  << "\"webcamX\":" << options.webcamX << ","
                  << "\"webcamY\":" << options.webcamY << ","
                  << "\"webcamSize\":" << options.webcamSize << ","
                  << "\"webcamRadius\":" << options.webcamRadius << ","
                  << "\"webcamStream\":" << (!options.webcamAnnexbPath.empty() ? "true" : "false") << ","
                  << "\"webcamMirror\":" << (options.webcamMirror ? "true" : "false") << ","
                  << "\"webcamTimeOffsetMs\":" << options.webcamTimeOffsetMs << ","
                  << "\"webcamSourceDurationMs\":" << options.webcamSourceDurationMs << ","
                  << "\"webcamCachedFrames\":" << (webcamCachePtr ? webcamCachePtr->frames.size() : 0) << ","
                  << "\"webcamPeakCachedFrames\":" << (webcamCachePtr ? webcamCachePtr->peakFrames : 0) << ","
                  << "\"webcamCacheBaseFrame\":" << (webcamCachePtr ? webcamCachePtr->baseFrameIndex : 0) << ","
                  << "\"webcamDecodedFrames\":" << (webcamCachePtr ? webcamCachePtr->decodedFrames : 0) << ","
                  << "\"webcamDecodeMs\":" << (webcamCachePtr ? webcamCachePtr->decodeMs : 0.0) << ","
                  << "\"webcamCopyMs\":" << (webcamCachePtr ? webcamCachePtr->copyMs : 0.0) << ","
                  << "\"cursorOverlay\":" << (cursorTrackPtr ? "true" : "false") << ","
                  << "\"cursorSamples\":" << (cursorTrackPtr ? cursorTrackPtr->samples.size() : 0) << ","
                  << "\"cursorHeight\":" << options.cursorHeight << ","
                  << "\"cursorAtlas\":" << (!options.cursorAtlasRgbaPath.empty() ? "true" : "false") << ","
                  << "\"zoomOverlay\":" << (zoomTrackPtr ? "true" : "false") << ","
                  << "\"zoomSamples\":" << (zoomTrackPtr ? zoomTrackPtr->samples.size() : 0) << ","
                  << "\"zoomBlurFrames\":" << (sink ? sink->zoomBlurFrames() : 0) << ","
                  << "\"overlayLayers\":" << options.overlayLayers.size() << ","
                  << "\"overlayBlendFrames\":" << (sink ? sink->overlayBlendFrames() : 0) << ","
                  << "\"temporalBlurFrames\":" << (sink ? sink->temporalBlurFrames() : 0) << ","
                  << "\"temporalBlurSamplesTotal\":" << (sink ? sink->temporalBlurSamplesTotal() : 0) << ","
                  << "\"temporalBlurBgPrecomposedFrames\":" << (sink ? sink->temporalBlurBgPrecomposedFrames() : 0) << ","
                  << "\"temporalBlurStationaryFrames\":" << (sink ? sink->temporalBlurStationaryFrames() : 0) << ","
                  << "\"temporalBgCacheBuilds\":" << (sink ? sink->temporalBgCacheBuilds() : 0) << ","
                  << "\"temporalBgCacheHits\":" << (sink ? sink->temporalBgCacheHits() : 0) << ","
                  << "\"overlayStaticRegionBlends\":" << (sink ? sink->overlayStaticRegionBlends() : 0) << ","
                  << "\"overlayFileLoads\":" << (sink ? sink->overlayFileLoads() : 0) << ","
                  << "\"overlayCacheHits\":" << (sink ? sink->overlayCacheHits() : 0) << ","
                  << "\"overlayPinnedHits\":" << (sink ? sink->overlayPinnedHits() : 0) << ","
                  << "\"overlayReadWaits\":" << (sink ? sink->overlayReadWaits() : 0) << ","
                  << "\"overlayPendingReadsPeak\":" << (sink ? sink->overlayPendingReadsPeak() : 0) << ","
                  << "\"nvencDiagnostics\":{"
                  << "\"deviceName\":\"" << (sink ? sink->capabilityProbe().deviceName : "") << "\","
                  << "\"cudaDriverVersion\":" << (sink ? sink->capabilityProbe().cudaDriverVersion : 0) << ","
                  << "\"cudaComputeMajor\":" << (sink ? sink->capabilityProbe().cudaComputeMajor : 0) << ","
                  << "\"cudaComputeMinor\":" << (sink ? sink->capabilityProbe().cudaComputeMinor : 0) << ","
                  << "\"sdkApiVersion\":" << (sink ? sink->capabilityProbe().sdkApiVersion : 0) << ","
                  << "\"driverMaxApiVersion\":" << (sink ? sink->capabilityProbe().driverMaxApiVersion : 0) << ","
                  << "\"h264Supported\":" << (sink && sink->capabilityProbe().h264Supported ? "true" : "false") << ","
                  << "\"hevcSupported\":" << (sink && sink->capabilityProbe().hevcSupported ? "true" : "false") << ","
                  << "\"supportedRateControlModes\":" << (sink ? sink->capabilityProbe().supportedRateControlModes : 0) << ","
                  << "\"customVbvSupported\":" << (sink && sink->capabilityProbe().customVbvBufferSizeSupported ? "true" : "false") << ","
                  << "\"asyncEncodeSupported\":" << (sink && sink->capabilityProbe().asyncEncodeSupported ? "true" : "false") << ","
                  << "\"temporalAqSupported\":" << (sink && sink->capabilityProbe().temporalAqSupported ? "true" : "false") << ","
                  << "\"widthMax\":" << (sink ? sink->capabilityProbe().widthMax : 0) << ","
                  << "\"heightMax\":" << (sink ? sink->capabilityProbe().heightMax : 0) << ","
                  << "\"mbPerSecMax\":" << (sink ? sink->capabilityProbe().mbPerSecMax : 0) << ","
                  << "\"probeError\":\"" << (sink ? sink->capabilityProbe().error : "") << "\","
                  << "\"rcModeUsed\":\"" << (sink ? sink->nvencConfigUsed().rcMode : "") << "\","
                  << "\"customVbvUsed\":" << (sink && sink->nvencConfigUsed().customVbv ? "true" : "false") << ","
                  << "\"aqUsed\":" << (sink && sink->nvencConfigUsed().aq ? "true" : "false") << "},"
                  << "\"sourceFrames\":" << reportedSourceFrames << ","
                  << "\"mappedDisplayFrames\":" << mappedDisplayFrames << ","
                  << "\"selectedDisplayFrames\":" << selectedDisplayFrames << ","
                  << "\"skippedDisplayFrames\":" << skippedDisplayFrames << ","
                  << "\"frames\":" << encodedFrames << ","
                  << "\"totalMs\":" << totalMs << ","
                  << "\"decodeMs\":" << decodeOnlyApproxMs << ","
                  << "\"decodeWallMs\":" << decodeMs << ","
                  << "\"encodeMs\":" << encodeMs << ","
                  << "\"compositeMs\":" << sink->compositeMs() << ","
                  << "\"compositeGpuMs\":" << sink->compositeGpuMs() << ","
                  << "\"zoomBlurGpuMs\":" << sink->zoomBlurGpuMs() << ","
                  << "\"overlayBlendGpuMs\":" << sink->overlayBlendGpuMs() << ","
                  << "\"overlayUploadMs\":" << sink->overlayUploadMs() << ","
                  << "\"overlayHostReadMs\":" << sink->overlayHostReadMs() << ","
                  << "\"overlayH2DEnqueueMs\":" << sink->overlayH2DEnqueueMs() << ","
                  << "\"roiCompositeFrames\":" << sink->roiCompositeFrames() << ","
                  << "\"monolithicCompositeFrames\":" << sink->monolithicCompositeFrames() << ","
                  << "\"copyCompositeFrames\":" << sink->copyCompositeFrames() << ","
                  << "\"nvencMs\":" << sink->nvencMs() << ","
                  << "\"packetWriteMs\":" << sink->packetWriteMs() << ","
                  << "\"flushMs\":" << elapsedMs(flushStart, flushEnd) << ","
                  << "\"measuredFps\":" << measuredFps << ","
                  << "\"realtimeMultiplier\":" << realtime << ","
                  << "\"outputBytes\":" << sink->outputBytes() << ","
                  << "\"outputPath\":\"" << options.outputPath << "\""
                  << "}" << std::endl;

        sink.reset();
        decoder.reset();
        webcamStream.reset();
        // OverlayFrameSource owns device/pinned buffers (cudaFree/cudaFreeHost in
        // its destructor); it must be destroyed while the primary context is still
        // current, before the context is released.
        overlaySource.reset();
        // The primary context is released, not destroyed.
        checkCu(cuDevicePrimaryCtxRelease(device), "cuDevicePrimaryCtxRelease");
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "{\"success\":false,\"outputCodec\":\""
                  << requestedOutputCodec
                  << "\",\"backend\":\"nvidia-nvenc\",\"error\":\""
                  << error.what()
                  << "\",\"nvencDiagnostics\":{"
                  << "\"deviceName\":\"" << capabilityProbe.deviceName << "\","
                  << "\"cudaDriverVersion\":" << capabilityProbe.cudaDriverVersion << ","
                  << "\"cudaComputeMajor\":" << capabilityProbe.cudaComputeMajor << ","
                  << "\"cudaComputeMinor\":" << capabilityProbe.cudaComputeMinor << ","
                  << "\"sdkApiVersion\":" << capabilityProbe.sdkApiVersion << ","
                  << "\"driverMaxApiVersion\":" << capabilityProbe.driverMaxApiVersion << ","
                  << "\"h264Supported\":" << (capabilityProbe.h264Supported ? "true" : "false") << ","
                  << "\"hevcSupported\":" << (capabilityProbe.hevcSupported ? "true" : "false") << ","
                  << "\"supportedRateControlModes\":" << capabilityProbe.supportedRateControlModes << ","
                  << "\"customVbvSupported\":" << (capabilityProbe.customVbvBufferSizeSupported ? "true" : "false") << ","
                  << "\"asyncEncodeSupported\":" << (capabilityProbe.asyncEncodeSupported ? "true" : "false") << ","
                  << "\"temporalAqSupported\":" << (capabilityProbe.temporalAqSupported ? "true" : "false") << ","
                  << "\"probeError\":\"" << capabilityProbe.error << "\"},"
                  << "\"noCpuFallback\":true}" << std::endl;
        return 1;
    }
}
