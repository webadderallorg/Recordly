#include <cuda.h>
#include <cuda_runtime.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
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

struct Options {
    std::string inputPath;
    std::string outputPath = "recordly-nvidia-cuda-compositor.h264";
    std::string sourcePtsPath;
    std::string timelineMapPath;
    std::vector<TimelineSegment> timelineSegments;
    int fps = 30;
    int maxFrames = 0;
    int inputFrames = 0;
    int targetFrames = 0;
    int bitrateMbps = 18;
    bool postSelect = false;
    bool callbackEncode = false;
    bool streamSync = false;
    int prewarmMs = 0;
    int chunkMb = 4;
    int contentX = 0;
    int contentY = 0;
    int contentWidth = 0;
    int contentHeight = 0;
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
};

constexpr int kMaxCursorAtlasEntries = 16;
constexpr int kWebcamPrefetchOutputFrames = 900;

[[noreturn]] void fail(const std::string& message) {
    throw std::runtime_error(message);
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
        } else if (arg == "--source-pts") {
            options.sourcePtsPath = requireValue("--source-pts");
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
        } else if (arg == "--help") {
            std::cout << "Usage: recordly-nvidia-cuda-compositor --input input.annexb.h264 "
                         "[--output out.h264] [--source-pts source-pts.csv] [--fps 30] "
                         "[--max-frames N] [--bitrate-mbps N] "
                         "[--post-select] [--callback-encode] [--stream-sync] [--prewarm-ms N] [--chunk-mb N] "
                         "[--content-x N --content-y N --content-width N --content-height N --radius N] "
                         "[--background-nv12 background.nv12] [--shadow-offset-y N --shadow-intensity-pct N] "
                         "[--webcam-nv12 webcam.nv12 --webcam-x N --webcam-y N --webcam-size N --webcam-radius N] "
                         "[--webcam-annexb webcam.h264 --webcam-input-frames N --webcam-target-frames N "
                         "--webcam-source-duration-ms N --webcam-time-offset-ms N] "
                         "[--cursor-samples cursor.tsv --cursor-height N] "
                         "[--cursor-atlas-rgba cursor.rgba --cursor-atlas-metadata cursor.tsv "
                         "--cursor-atlas-width N --cursor-atlas-height N] "
                         "[--zoom-samples zoom.csv]\n";
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
    return options;
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
    double nvencMs = 0.0;
    double packetWriteMs = 0.0;
    double webcamDecodeMs = 0.0;
    double webcamCopyMs = 0.0;
    int roiCompositeFrames = 0;
    int monolithicCompositeFrames = 0;
    int copyCompositeFrames = 0;
};

struct ProgressReportState {
    std::chrono::steady_clock::time_point startedAt;
    std::chrono::steady_clock::time_point lastReportAt;
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
            return {true, samples.front().cx, samples.front().cy, samples.front().typeIndex, samples.front().bounceScale};
        }
        if (timeMs >= samples.back().timeMs) {
            return {true, samples.back().cx, samples.back().cy, samples.back().typeIndex, samples.back().bounceScale};
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
            return {true, left.cx, left.cy, left.typeIndex, left.bounceScale};
        }

        const double t = (timeMs - left.timeMs) / span;
        return {
            true,
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
        };
    }
};

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
        sample.timeMs = std::max(0.0, sample.timeMs);
        sample.scale = std::max(0.01, sample.scale);
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
    int contentHeight) {
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

    const int srcX = min(srcWidth - 1, (localX * srcWidth) / contentWidth);
    const int srcY = min(srcHeight - 1, (localY * srcHeight) / contentHeight);
    dst[y * dstPitch + x] = src[srcY * srcPitch + srcX];

    if ((x % 2) == 0 && (y % 2) == 0) {
        const int localUvX = max(0, min(contentWidth - 1, localX + 1));
        const int localUvY = max(0, min(contentHeight - 1, localY + 1));
        const int srcUvX = min(srcWidth - 2, ((localUvX * srcWidth) / contentWidth) & ~1);
        const int srcUvY = min((srcHeight / 2) - 1, ((localUvY * srcHeight) / contentHeight) / 2);
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
    const int sx = min(srcWidth - 1, __float2int_rd(localContentX * srcScaleX));
    const int sy = min(srcHeight - 1, __float2int_rd(localContentY * srcScaleY));
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
                min(srcWidth - 2, __float2int_rd(uvLocalContentX * srcScaleX) & ~1);
            const int suvY =
                min((srcHeight / 2) - 1, __float2int_rd(uvLocalContentY * srcScaleY) / 2);
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
    int contentX,
    int contentY,
    int contentWidth,
    int contentHeight,
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
    float zoomY) {
    const int x = blockIdx.x * blockDim.x + threadIdx.x;
    const int y = blockIdx.y * blockDim.y + threadIdx.y;
    if (x >= dstWidth || y >= dstHeight) {
        return;
    }

    const bool zoomActive = zoomEnabled && zoomScale > 0.01f;
    const float safeZoomScale = fmaxf(zoomScale, 0.01f);
    const float layoutXf = zoomActive ? (static_cast<float>(x) - zoomX) / safeZoomScale : static_cast<float>(x);
    const float layoutYf = zoomActive ? (static_cast<float>(y) - zoomY) / safeZoomScale : static_cast<float>(y);
    const int layoutX = static_cast<int>(floorf(layoutXf));
    const int layoutY = static_cast<int>(floorf(layoutYf));

    const bool inside = isInsideRoundedRect(layoutX, layoutY, contentX, contentY, contentWidth, contentHeight, radius);
    unsigned char outY = background ? background[y * dstWidth + x] : backgroundY;
    if (inside) {
        const float localX = fminf(static_cast<float>(contentWidth - 1), fmaxf(0.0f, layoutXf - contentX));
        const float localY = fminf(static_cast<float>(contentHeight - 1), fmaxf(0.0f, layoutYf - contentY));
        const int sx = min(srcWidth - 1, static_cast<int>((localX * srcWidth) / contentWidth));
        const int sy = min(srcHeight - 1, static_cast<int>((localY * srcHeight) / contentHeight));
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
    dst[y * dstPitch + x] = outY;

    if ((x % 2) == 0 && (y % 2) == 0) {
        unsigned char* dstUv = dst + dstChromaOffset + (y / 2) * dstPitch + x;
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
            const int suvX = min(srcWidth - 2, (static_cast<int>((localX * srcWidth) / contentWidth)) & ~1);
            const int suvY = min((srcHeight / 2) - 1, static_cast<int>(localY * srcHeight / contentHeight) / 2);
            const unsigned char* srcUv = src + srcPitch * srcSurfaceHeight + suvY * srcPitch + suvX;
            dstUv[0] = srcUv[0];
            dstUv[1] = srcUv[1];
        } else {
            if (background) {
                const unsigned char* bgUv = background + dstWidth * dstHeight + (y / 2) * dstWidth + x;
                dstUv[0] = bgUv[0];
                dstUv[1] = bgUv[1];
            } else {
                dstUv[0] = backgroundU;
                dstUv[1] = backgroundV;
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
            dstUv[0] = webcamUv[0];
            dstUv[1] = webcamUv[1];
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
            dstUv[0] = blendByte(dstUv[0], 128, cursorUvShadowAlpha);
            dstUv[1] = blendByte(dstUv[1], 128, cursorUvShadowAlpha);
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
            dstUv[0] = blendByte(dstUv[0], cursorUvU, cursorUvAlpha);
            dstUv[1] = blendByte(dstUv[1], cursorUvV, cursorUvAlpha);
        } else {
            const int cursorUvMask =
                cursorVisible && !cursorAtlasRgba
                    ? cursorMaskAt(x + 1, y + 1, cursorX, cursorY, cursorWidth, cursorHeight)
                    : 0;
            if (cursorUvMask > 0) {
                dstUv[0] = 128;
                dstUv[1] = 128;
            }
        }
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

class NvencSink {
public:
    NvencSink(
        CUcontext context,
        int width,
        int height,
        int fps,
        uint32_t bitrate,
        const std::string& outputPath,
        bool streamSync,
        Options layoutOptions,
        const WebcamFrameCache* webcamCache,
        const CursorTrack* cursorTrack,
        const ZoomTrack* zoomTrack)
        : encoder_(context, width, height, NV_ENC_BUFFER_FORMAT_NV12),
          width_(width),
          height_(height),
          fps_(fps),
          streamSync_(streamSync),
          layoutOptions_(layoutOptions),
          webcamCache_(webcamCache),
          cursorTrack_(cursorTrack),
          zoomTrack_(zoomTrack) {
        loadBackgroundFrame();
        loadWebcamFrame();
        loadCursorAtlas();
        if (streamSync_) {
            checkCuda(cudaStreamCreateWithFlags(&copyStream_, cudaStreamNonBlocking), "cudaStreamCreateWithFlags");
        }

        NV_ENC_INITIALIZE_PARAMS initializeParams = {NV_ENC_INITIALIZE_PARAMS_VER};
        NV_ENC_CONFIG encodeConfig = {NV_ENC_CONFIG_VER};
        initializeParams.encodeConfig = &encodeConfig;
        encoder_.CreateDefaultEncoderParams(&initializeParams, NV_ENC_CODEC_H264_GUID, NV_ENC_PRESET_HP_GUID);

        initializeParams.frameRateNum = static_cast<uint32_t>(fps);
        initializeParams.frameRateDen = 1;
        initializeParams.enableEncodeAsync = 1;
        encodeConfig.profileGUID = NV_ENC_H264_PROFILE_HIGH_GUID;
        encodeConfig.gopLength = static_cast<uint32_t>(fps * 2);
        encodeConfig.frameIntervalP = 1;
        encodeConfig.rcParams.rateControlMode = NV_ENC_PARAMS_RC_VBR;
        encodeConfig.rcParams.averageBitRate = bitrate;
        encodeConfig.rcParams.maxBitRate = static_cast<uint32_t>(
            std::min<uint64_t>(0xffffffffu, static_cast<uint64_t>(bitrate) * 3 / 2));
        encodeConfig.rcParams.vbvBufferSize = bitrate;
        encodeConfig.rcParams.vbvInitialDelay = bitrate;
        encodeConfig.encodeCodecConfig.h264Config.idrPeriod = encodeConfig.gopLength;
        encoder_.CreateEncoder(&initializeParams);

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
        const bool zoomChangesLayout =
            zoomTrack_ &&
            (std::abs(zoomSample.scale - 1.0) > 0.001 ||
             std::abs(zoomSample.x) > 0.5 ||
             std::abs(zoomSample.y) > 0.5);
        const bool useFastRoiComposite =
            canUseFastRoiComposite(zoomChangesLayout);
        const bool useLayeredStaticRoiComposite =
            !useFastRoiComposite && canUseLayeredStaticRoiComposite(zoomChangesLayout);
        const auto compositeStart = std::chrono::steady_clock::now();
        if (useFastRoiComposite) {
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
                static_cast<float>(srcWidth) / static_cast<float>(std::max(1, layoutOptions_.contentWidth));
            const float srcScaleY =
                static_cast<float>(srcHeight) / static_cast<float>(std::max(1, layoutOptions_.contentHeight));
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
                        layoutOptions_.contentHeight);
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
                layoutOptions_.contentX,
                layoutOptions_.contentY,
                layoutOptions_.contentWidth,
                layoutOptions_.contentHeight,
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
                static_cast<float>(zoomSample.y));
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
        if (streamSync_) {
            checkCuda(cudaStreamSynchronize(copyStream_), "cudaStreamSynchronize copy");
        } else {
            checkCuda(cudaDeviceSynchronize(), "cudaDeviceSynchronize");
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

private:
    bool canUseFastRoiComposite(bool zoomChangesLayout) const {
        return hasStaticLayout(layoutOptions_) &&
            layoutOptions_.contentX == 0 &&
            layoutOptions_.contentY == 0 &&
            layoutOptions_.contentWidth == width_ &&
            layoutOptions_.contentHeight == height_ &&
            layoutOptions_.radius == 0 &&
            layoutOptions_.shadowIntensityPct == 0 &&
            backgroundDevice_ == nullptr &&
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
    bool streamSync_ = false;
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
    cudaStream_t copyStream_ = nullptr;
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
        counters.nvencMs = sink->nvencMs();
        counters.packetWriteMs = sink->packetWriteMs();
        counters.roiCompositeFrames = sink->roiCompositeFrames();
        counters.monolithicCompositeFrames = sink->monolithicCompositeFrames();
        counters.copyCompositeFrames = sink->copyCompositeFrames();
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
        *state->sink = std::make_unique<NvencSink>(
            state->context,
            width,
            height,
            state->options->fps,
            state->bitrate,
            state->options->outputPath,
            state->options->streamSync,
            *state->options,
            state->webcamCache,
            state->cursorTrack,
            state->zoomTrack);
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
    std::cerr << std::fixed << std::setprecision(2)
              << "PROGRESS {\"currentFrame\":" << encodedFrames
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
              << ",\"intervalNvencMs\":" << intervalNvencMs
              << ",\"intervalPacketWriteMs\":" << intervalPacketWriteMs
              << ",\"intervalWebcamDecodeMs\":" << intervalWebcamDecodeMs
              << ",\"intervalWebcamCopyMs\":" << intervalWebcamCopyMs
              << ",\"intervalRoiCompositeFrames\":" << intervalRoiCompositeFrames
              << ",\"intervalMonolithicCompositeFrames\":" << intervalMonolithicCompositeFrames
              << ",\"intervalCopyCompositeFrames\":" << intervalCopyCompositeFrames
              << "}" << std::endl;
    state.lastReportAt = now;
    state.lastReportedFrame = encodedFrames;
    state.lastCounters = counters;
}

} // namespace

int main(int argc, char** argv) {
    try {
        Options options = parseOptions(argc, argv);
        options.timelineSegments = loadTimelineMap(options.timelineMapPath);
        if (!options.timelineSegments.empty() && !options.callbackEncode) {
            fail("Timeline-map CUDA export requires --callback-encode");
        }
        const uint32_t bitrate = static_cast<uint32_t>(options.bitrateMbps) * 1000U * 1000U;

        checkCuda(cudaSetDevice(0), "cudaSetDevice");
        checkCu(cuInit(0), "cuInit");
        CUdevice device = 0;
        checkCu(cuDeviceGet(&device, 0), "cuDeviceGet");
        CUcontext context = nullptr;
        checkCu(cuCtxCreate(&context, 0, device), "cuCtxCreate");
        checkCu(cuCtxSetCurrent(context), "cuCtxSetCurrent");
        prewarmCuda(options.prewarmMs);

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
                    sink = std::make_unique<NvencSink>(
                        context,
                        decoder->GetWidth(),
                        decoder->GetHeight(),
                        options.fps,
                        bitrate,
                        options.outputPath,
                        options.streamSync,
                        options,
                        webcamCachePtr,
                        cursorTrackPtr,
                        zoomTrackPtr);
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
                    sink = std::make_unique<NvencSink>(
                        context,
                        decoder->GetWidth(),
                        decoder->GetHeight(),
                        options.fps,
                        bitrate,
                        options.outputPath,
                        options.streamSync,
                        options,
                        webcamCachePtr,
                        cursorTrackPtr,
                        zoomTrackPtr);
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
                  << "\"selectionStage\":\""
                  << (options.callbackEncode
                          ? (useDecoderFramePolicy ? "decoder-policy-mapped-callback" : "mapped-callback")
                          : (useDecoderFramePolicy ? "decoder" : "post"))
                  << "\","
                  << "\"sourceTimestampMode\":\"" << (useSourcePts ? "pts" : "ordinal") << "\","
                  << "\"timelineMap\":" << (!options.timelineSegments.empty() ? "true" : "false") << ","
                  << "\"timelineSegments\":" << options.timelineSegments.size() << ","
                  << "\"syncMode\":\"" << (options.streamSync ? "stream" : "device") << "\","
                  << "\"prewarmMs\":" << options.prewarmMs << ","
                  << "\"chunkMb\":" << options.chunkMb << ","
                  << "\"width\":" << decoder->GetWidth() << ","
                  << "\"height\":" << decoder->GetHeight() << ","
                  << "\"fps\":" << options.fps << ","
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
        checkCu(cuCtxDestroy(context), "cuCtxDestroy");
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "{\"success\":false,\"error\":\"" << error.what() << "\"}" << std::endl;
        return 1;
    }
}
