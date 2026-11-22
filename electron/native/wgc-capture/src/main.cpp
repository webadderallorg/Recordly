#include "wgc_session.h"
#include "mf_encoder.h"
#include "monitor_utils.h"
#include "wasapi_loopback.h"

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.System.h>

#include <iostream>
#include <string>
#include <thread>
#include <atomic>
#include <mutex>
#include <condition_variable>
#include <vector>
#include <deque>
#include <chrono>
#include <cstdio>
#include <fstream>
#include <utility>

static std::atomic<bool> g_pauseRequested{false};
static std::atomic<int64_t> g_lastFrameTimestampHns{0};
static std::atomic<int64_t> g_pauseStartTimestampHns{0};
static std::atomic<int64_t> g_accumulatedPausedHns{0};
static std::mutex g_videoMutex;
static std::mutex g_stopMutex;
static std::condition_variable g_stopCv;
static bool g_stopRequested = false;
enum class CaptureCommand { Pause, Resume };
static std::vector<CaptureCommand> g_captureCommands;

static void reportMicrophoneCaptureUnavailable() {
    std::cerr << "WARNING: Failed to initialize WASAPI mic capture" << std::endl;
    // This stable stdout marker is ordered before "Recording started", allowing
    // Electron to select its per-recording browser fallback without a pipe race.
    std::cout << "MICROPHONE_CAPTURE_UNAVAILABLE" << std::endl;
    std::cout.flush();
}

struct CaptureConfig {
    int64_t displayId = 0;
    int64_t windowHandle = 0;
    std::string outputPath;
    std::string audioOutputPath;
    std::string micOutputPath;
    std::string micDeviceId;
    std::string micDeviceName;
    int fps = 60;
    int width = 0;
    int height = 0;
    int displayX = 0;
    int displayY = 0;
    int displayW = 0;
    int displayH = 0;
    bool hasDisplayBounds = false;
    bool captureSystemAudio = false;
    bool captureMic = false;
};

static bool parseSimpleJson(const std::string& json, CaptureConfig& config) {
    auto findInt = [&](const std::string& key) -> int {
        auto pos = json.find("\"" + key + "\"");
        if (pos == std::string::npos) return -1;
        pos = json.find(':', pos);
        if (pos == std::string::npos) return -1;
        pos++;
        while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
        try {
            return std::stoi(json.substr(pos));
        } catch (...) {
            return -1;
        }
    };

    auto findInt64 = [&](const std::string& key) -> int64_t {
        auto pos = json.find("\"" + key + "\"");
        if (pos == std::string::npos) return -1;
        pos = json.find(':', pos);
        if (pos == std::string::npos) return -1;
        pos++;
        while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
        try {
            return std::stoll(json.substr(pos));
        } catch (...) {
            return -1;
        }
    };

    auto findString = [&](const std::string& key) -> std::string {
        auto pos = json.find("\"" + key + "\"");
        if (pos == std::string::npos) return "";
        pos = json.find(':', pos);
        if (pos == std::string::npos) return "";
        pos++;
        while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
        if (pos >= json.size() || json[pos] != '"') return "";
        pos++;
        std::string result;
        while (pos < json.size() && json[pos] != '"') {
            if (json[pos] == '\\' && pos + 1 < json.size()) {
                pos++;
                if (json[pos] == 'n') result += '\n';
                else if (json[pos] == 't') result += '\t';
                else if (json[pos] == '\\') result += '\\';
                else if (json[pos] == '"') result += '"';
                else if (json[pos] == '/') result += '/';
                else result += json[pos];
            } else {
                result += json[pos];
            }
            pos++;
        }
        return result;
    };

    config.outputPath = findString("outputPath");
    if (config.outputPath.empty()) return false;

    int64_t displayId = findInt64("displayId");
    if (displayId >= 0) config.displayId = displayId;

    int64_t windowHandle = findInt64("windowHandle");
    if (windowHandle > 0) config.windowHandle = windowHandle;

    int fps = findInt("fps");
    if (fps > 0) config.fps = fps;

    int width = findInt("width");
    if (width > 0) config.width = width;

    int height = findInt("height");
    if (height > 0) config.height = height;

    config.audioOutputPath = findString("audioOutputPath");
    config.micOutputPath = findString("micOutputPath");
    config.micDeviceId = findString("micDeviceId");
    config.micDeviceName = findString("micDeviceName");

    auto findBool = [&](const std::string& key) -> bool {
        auto pos = json.find("\"" + key + "\"");
        if (pos == std::string::npos) return false;
        auto colonPos = json.find(':', pos);
        if (colonPos == std::string::npos) return false;
        auto valStart = json.find_first_not_of(" \t", colonPos + 1);
        return valStart != std::string::npos && json.substr(valStart, 4) == "true";
    };

    config.captureSystemAudio = findBool("captureSystemAudio");
    config.captureMic = findBool("captureMic");

    int dx = findInt("displayX");
    int dy = findInt("displayY");
    int dw = findInt("displayW");
    int dh = findInt("displayH");
    if (dw > 0 && dh > 0) {
        config.displayX = dx;
        config.displayY = dy;
        config.displayW = dw;
        config.displayH = dh;
        config.hasDisplayBounds = true;
    }

    return true;
}

static std::wstring utf8ToWide(const std::string& str) {
    if (str.empty()) return L"";
    int len = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), static_cast<int>(str.size()), nullptr, 0);
    std::wstring wstr(len, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), static_cast<int>(str.size()), &wstr[0], len);
    return wstr;
}

static std::string wideToUtf8(const wchar_t* text) {
    const int length = WideCharToMultiByte(
        CP_UTF8, WC_ERR_INVALID_CHARS, text, -1, nullptr, 0, nullptr, nullptr);
    if (length <= 1) return {};

    std::string result(static_cast<size_t>(length), '\0');
    if (!WideCharToMultiByte(
            CP_UTF8, WC_ERR_INVALID_CHARS, text, -1, result.data(), length, nullptr, nullptr)) {
        return {};
    }
    result.pop_back();
    return result;
}

static int64_t queryPerformanceCounterHns() {
    LARGE_INTEGER counter;
    LARGE_INTEGER frequency;
    if (!QueryPerformanceCounter(&counter) || !QueryPerformanceFrequency(&frequency) || frequency.QuadPart <= 0) {
        return g_lastFrameTimestampHns.load();
    }

    return static_cast<int64_t>(
        (static_cast<long double>(counter.QuadPart) * 10000000.0L) /
        static_cast<long double>(frequency.QuadPart));
}

static int64_t adjustedVideoTimestampHns(int64_t timestampHns) {
    int64_t accumulatedPausedHns = g_accumulatedPausedHns.load();
    if (g_pauseRequested.load()) {
        const int64_t pauseStart = g_pauseStartTimestampHns.load();
        if (pauseStart > 0 && timestampHns > pauseStart) {
            accumulatedPausedHns += (timestampHns - pauseStart);
        }
    }

    int64_t adjustedTimestampHns = timestampHns - accumulatedPausedHns;
    if (adjustedTimestampHns < 0) {
        adjustedTimestampHns = 0;
    }
    return adjustedTimestampHns;
}

static void openActivePauseAt(int64_t timestampHns) {
    g_pauseStartTimestampHns.store(timestampHns);
    g_pauseRequested.store(true);
}

static void closeActivePauseAt(int64_t timestampHns) {
    const int64_t pauseStart = g_pauseStartTimestampHns.exchange(0);
    if (pauseStart > 0 && timestampHns > pauseStart) {
        g_accumulatedPausedHns.fetch_add(timestampHns - pauseStart);
    }
    g_pauseRequested.store(false);
}

static void writeCompanionAudioTimingMetadata(
    const std::string& audioPath,
    int64_t firstVideoTimestampHns,
    const WasapiCapture& capture
) {
    if (audioPath.empty() || firstVideoTimestampHns < 0) {
        return;
    }

    const int64_t firstPacketQpcHns = capture.firstPacketQpcHns();
    if (firstPacketQpcHns < 0) {
        return;
    }

    int64_t startDelayMs = (firstPacketQpcHns - firstVideoTimestampHns + 5000) / 10000;
    if (startDelayMs < 0) {
        startDelayMs = 0;
    }

    std::ofstream metadataFile(audioPath + ".json", std::ios::trunc);
    if (!metadataFile) {
        std::cerr << "WARNING: Failed to write audio timing metadata for " << audioPath << std::endl;
        return;
    }

    metadataFile << "{\"startDelayMs\":" << startDelayMs;
    metadataFile << ",\"capturedDurationMs\":" << capture.capturedDurationMs();
    metadataFile << ",\"dataBytes\":" << capture.totalDataBytes();
    metadataFile << ",\"sampleRate\":" << capture.sampleRate();
    metadataFile << ",\"channels\":" << capture.channelCount();
    metadataFile << ",\"gapFillCount\":" << capture.gapFillCount();
    metadataFile << ",\"insertedSilenceFrames\":" << capture.insertedSilenceFrames();
    metadataFile << ",\"compactedDiscontinuityCount\":" << capture.compactedDiscontinuityCount();
    metadataFile << ",\"compactedDiscontinuityFrames\":" << capture.compactedDiscontinuityFrames();
    metadataFile << ",\"compactedSilentDiscontinuityCount\":" << capture.compactedSilentDiscontinuityCount();
    metadataFile << ",\"compactedSilentDiscontinuityFrames\":" << capture.compactedSilentDiscontinuityFrames();
    const uint32_t discontinuityCount = capture.dataDiscontinuityCount();
    if (discontinuityCount > 0) {
        metadataFile << ",\"dataDiscontinuityCount\":" << discontinuityCount;
    }
    const uint32_t timestampErrorCount = capture.timestampErrorCount();
    if (timestampErrorCount > 0) {
        metadataFile << ",\"timestampErrorCount\":" << timestampErrorCount;
    }
    metadataFile << "}";
}

static void stdinListenerThread() {
    std::string line;
    while (std::getline(std::cin, line)) {
        // Trim whitespace
        while (!line.empty() && (line.back() == '\r' || line.back() == '\n' || line.back() == ' ')) {
            line.pop_back();
        }

        if (line == "pause" || line == "resume") {
            {
                std::lock_guard<std::mutex> lock(g_stopMutex);
                g_captureCommands.push_back(
                    line == "pause" ? CaptureCommand::Pause : CaptureCommand::Resume);
            }
            g_stopCv.notify_one();
            continue;
        }

        if (line == "stop") {
            break;
        }
    }

    // End the recording on Stop or when the parent closes stdin.
    {
        std::lock_guard<std::mutex> lock(g_stopMutex);
        g_stopRequested = true;
    }
    g_stopCv.notify_one();
}

int wmain(int argc, wchar_t* argv[]) {
    if (argc < 2) {
        std::cerr << "ERROR: Missing JSON config argument" << std::endl;
        return 1;
    }

    // Keep Win32 monitor/window rectangles in physical pixels. Without
    // per-monitor awareness, mixed-DPI desktops can report virtualized bounds
    // that do not line up with the WGC monitor texture.
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    winrt::init_apartment(winrt::apartment_type::multi_threaded);

    CaptureConfig config;
    if (!parseSimpleJson(wideToUtf8(argv[1]), config)) {
        std::cerr << "ERROR: Failed to parse config JSON" << std::endl;
        return 1;
    }

    WgcSession session;

    if (config.windowHandle > 0) {
        HWND hwnd = reinterpret_cast<HWND>(static_cast<intptr_t>(config.windowHandle));
        if (!IsWindow(hwnd)) {
            std::cerr << "ERROR: Invalid window handle " << config.windowHandle << std::endl;
            return 1;
        }
        if (!session.initialize(hwnd, config.fps)) {
            std::cerr << "ERROR: Failed to initialize WGC window capture session" << std::endl;
            return 1;
        }
    } else {
        HMONITOR monitor = findMonitorByDisplayId(config.displayId);
        if (!monitor && config.hasDisplayBounds) {
            std::cerr << "Monitor ID match failed, attempting coordinate-based match: "
                      << config.displayX << "," << config.displayY << " " << config.displayW << "x" << config.displayH << std::endl;
            monitor = findMonitorByBounds(config.displayX, config.displayY, config.displayW, config.displayH);
        }

        if (!monitor) {
            std::cerr << "ERROR: Could not find monitor for displayId " << config.displayId << std::endl;
            return 1;
        }
        if (!session.initialize(monitor, config.fps)) {
            std::cerr << "ERROR: Failed to initialize WGC capture session" << std::endl;
            return 1;
        }
    }

    int captureWidth = config.width > 0 ? config.width : session.captureWidth();
    int captureHeight = config.height > 0 ? config.height : session.captureHeight();

    // Ensure even dimensions for H.264
    captureWidth = (captureWidth / 2) * 2;
    captureHeight = (captureHeight / 2) * 2;

    // Declare before `encoder` so ~MFEncoder() joins the worker before these go out of scope.
    std::atomic<int64_t> frameCount{0};
    std::atomic<int64_t> firstVideoTimestampHns{-1};
    std::atomic<bool> recordingStartedAnnounced{false};
    std::atomic<bool> captureSetupComplete{false};
    const auto announceRecordingStarted = [&] {
        if (captureSetupComplete && frameCount > 0 && !recordingStartedAnnounced.exchange(true)) {
            std::cout << "CAPTURE_SIZE:" << captureWidth << "x" << captureHeight << "\n";
            std::cout << "Recording started" << std::endl;
        }
    };

    // Initialize encoder
    MFEncoder encoder;
    std::wstring outputPathW = utf8ToWide(config.outputPath);
    if (!encoder.initialize(outputPathW, captureWidth, captureHeight, config.fps,
                           session.device(), session.context())) {
        std::cerr << "ERROR: Failed to initialize Media Foundation encoder" << std::endl;
        return 1;
    }
    encoder.setSampleWrittenCallback([&] {
        frameCount.fetch_add(1);
        announceRecordingStarted();
    });

    // Set up frame callback
    struct CachedWindowFrame {
        ComPtr<ID3D11Texture2D> texture;
        int width = 0;
        int height = 0;
        int64_t timestampHns = 0;
    };
    CachedWindowFrame pausedWindowFrame;
    constexpr size_t kMaxPendingResumeFrames = 4;
    std::deque<CachedWindowFrame> pendingResumeFrames;
    bool videoStopped = false;
    bool encoderInterrupted = false;
    const auto writeResumedWindowFrames = [&] {
        while (!pendingResumeFrames.empty()) {
            auto& frame = pendingResumeFrames.front();
            if (!encoder.writeFrameSync(frame.texture.Get(), frame.width, frame.height, frame.timestampHns)) {
                return;
            }
            if (!pausedWindowFrame.texture) pausedWindowFrame.texture = std::move(frame.texture);
            pendingResumeFrames.pop_front();
        }
    };

    session.setFrameCallback([&](ID3D11Texture2D* texture, int contentWidth, int contentHeight,
                                 int64_t timestampHns) {
        std::lock_guard<std::mutex> lock(g_videoMutex);
        g_lastFrameTimestampHns = timestampHns;
        if (videoStopped) return;
        int64_t expectedFirstVideoTimestampHns = -1;
        if (firstVideoTimestampHns.compare_exchange_strong(expectedFirstVideoTimestampHns, timestampHns)) {
            encoder.setTimelineOrigin(adjustedVideoTimestampHns(timestampHns));
        }

        if (g_pauseRequested) {
            if (config.windowHandle <= 0 || contentWidth <= 0 || contentHeight <= 0 ||
                timestampHns < g_pauseStartTimestampHns || timestampHns <= pausedWindowFrame.timestampHns) {
                return;
            }
            // WGC does not emit another frame when a window becomes static before Resume.
            D3D11_TEXTURE2D_DESC sourceDesc{};
            texture->GetDesc(&sourceDesc);
            D3D11_TEXTURE2D_DESC cachedDesc{};
            if (pausedWindowFrame.texture) pausedWindowFrame.texture->GetDesc(&cachedDesc);
            if (cachedDesc.Width != sourceDesc.Width || cachedDesc.Height != sourceDesc.Height ||
                cachedDesc.Format != sourceDesc.Format) {
                sourceDesc.Usage = D3D11_USAGE_DEFAULT;
                sourceDesc.BindFlags = 0;
                sourceDesc.CPUAccessFlags = 0;
                sourceDesc.MiscFlags = 0;
                ComPtr<ID3D11Texture2D> replacement;
                if (FAILED(session.device()->CreateTexture2D(
                        &sourceDesc, nullptr, replacement.GetAddressOf()))) return;
                pausedWindowFrame.texture = std::move(replacement);
            }
            session.context()->CopyResource(pausedWindowFrame.texture.Get(), texture);
            pausedWindowFrame.width = contentWidth;
            pausedWindowFrame.height = contentHeight;
            pausedWindowFrame.timestampHns = timestampHns;
            return;
        }
        writeResumedWindowFrames();
        const int64_t presentationHns = adjustedVideoTimestampHns(timestampHns);
        if (!pendingResumeFrames.empty()) {
            // Confirm the newer live frame actually commits before superseding failed resume frames.
            if (encoder.writeFrameSync(texture, contentWidth, contentHeight, presentationHns)) {
                pendingResumeFrames.clear();
            }
        } else {
            encoder.writeFrame(texture, contentWidth, contentHeight, presentationHns);
        }
    }, [] { return g_pauseRequested.load(); });

    // Start stdin listener
    std::thread stdinThread(stdinListenerThread);
    stdinThread.detach();

    // Initialize WASAPI captures (but don't start yet)
    WasapiCapture loopback;
    WasapiCapture micCapture;
    bool audioActive = false;
    bool audioInitialized = false;
    bool micActive = false;
    bool micInitialized = false;

    if (config.captureSystemAudio && !config.audioOutputPath.empty()) {
        audioInitialized = loopback.initializeLoopback(config.audioOutputPath);
        if (!audioInitialized) {
            std::cerr << "WARNING: Failed to initialize WASAPI loopback" << std::endl;
        }
    }

    if (config.captureMic && !config.micOutputPath.empty()) {
        micInitialized = micCapture.initializeMic(
            config.micOutputPath,
            config.micDeviceId,
            config.micDeviceName);
        if (!micInitialized) {
            reportMicrophoneCaptureUnavailable();
        }
    }

    // Start video capture, then audio immediately after for sync
    if (!session.startCapture()) {
        std::cerr << "ERROR: Failed to start WGC capture" << std::endl;
        return 1;
    }

    if (audioInitialized) {
        audioActive = loopback.start();
    }
    if (config.captureSystemAudio && !audioActive) {
        std::cout << "SYSTEM_AUDIO_CAPTURE_UNAVAILABLE" << std::endl;
    }
    if (micInitialized) {
        micActive = micCapture.start();
        if (!micActive) {
            reportMicrophoneCaptureUnavailable();
        }
    }
    captureSetupComplete = true;
    announceRecordingStarted();

    const auto resumeAudio = [&] {
        if (audioActive) loopback.resume();
        if (micActive) micCapture.resume();
    };

    while (!session.hasFatalError()) {
        std::vector<CaptureCommand> commands;
        bool stopRequested;
        {
            std::unique_lock<std::mutex> lock(g_stopMutex);
            g_stopCv.wait_for(lock, std::chrono::milliseconds(20), [] {
                return g_stopRequested || !g_captureCommands.empty();
            });
            commands.swap(g_captureCommands);
            stopRequested = g_stopRequested;
        }
        for (const auto command : commands) {
            if (command == CaptureCommand::Pause && !g_pauseRequested) {
                {
                    std::lock_guard<std::mutex> lock(g_videoMutex);
                    writeResumedWindowFrames();
                    openActivePauseAt(queryPerformanceCounterHns());
                }
                if (audioActive) loopback.pause();
                if (micActive) micCapture.pause();
            } else if (command == CaptureCommand::Resume && g_pauseRequested) {
                // Frames queued during the drain belong at or after the Resume boundary.
                const int64_t resumeTimestampHns = queryPerformanceCounterHns();
                resumeAudio();
                session.resumeAfterPendingFrames(resumeTimestampHns, [&] {
                    std::lock_guard<std::mutex> lock(g_videoMutex);
                    closeActivePauseAt(resumeTimestampHns);
                    writeResumedWindowFrames();
                    if (!pausedWindowFrame.timestampHns) return;
                    if (pendingResumeFrames.size() == kMaxPendingResumeFrames) {
                        // Recover the take instead of growing GPU memory usage while writes keep failing.
                        encoderInterrupted = true;
                        return;
                    }
                    pausedWindowFrame.timestampHns = adjustedVideoTimestampHns(resumeTimestampHns);
                    pendingResumeFrames.push_back(std::exchange(pausedWindowFrame, CachedWindowFrame{}));
                    writeResumedWindowFrames();
                });
                if (encoderInterrupted) break;
            }
        }
        if (stopRequested || encoderInterrupted) break;

        if (!g_pauseRequested) {
            resumeAudio();
            if (config.windowHandle > 0) {
                std::lock_guard<std::mutex> lock(g_videoMutex);
                writeResumedWindowFrames();
            }
        }
    }

    // Stop capture admission first so no new live frames can race with the final drain.
    int64_t adjustedStopTimestampHns;
    {
        std::lock_guard<std::mutex> lock(g_videoMutex);
        videoStopped = true;
        adjustedStopTimestampHns = adjustedVideoTimestampHns(queryPerformanceCounterHns());
    }
    session.stopCapture();
    if (audioActive) loopback.stop();
    if (micActive) micCapture.stop();

    // Drain queued live frames so a full staging ring cannot reject cached resume frames
    // at Stop, and so frameCount reflects every actually committed sample.
    encoder.drain();
    {
        std::lock_guard<std::mutex> lock(g_videoMutex);
        writeResumedWindowFrames();
        if (!pendingResumeFrames.empty()) {
            encoderInterrupted = true;
        }
    }

    // A device/source failure can happen after minutes of valid capture. Finalize
    // the same tracks as an ordinary stop; never discard that recoverable take.
    const bool interrupted = encoderInterrupted || session.hasFatalError();
    if (interrupted) {
        std::cout << "CAPTURE_INTERRUPTED: "
                  << (encoderInterrupted ? "Could not encode queued window frames"
                                         : "WGC capture session failed during recording")
                  << std::endl;
    }

    if (audioActive) {
        writeCompanionAudioTimingMetadata(
            config.audioOutputPath,
            firstVideoTimestampHns.load(),
            loopback);
    }
    if (micActive) {
        writeCompanionAudioTimingMetadata(
            config.micOutputPath,
            firstVideoTimestampHns.load(),
            micCapture);
    }

    if (frameCount.load() <= 0) {
        std::cerr << "ERROR: No video frames were captured before stop" << std::endl;
        encoder.finalize();
        DeleteFileW(outputPathW.c_str());
        return 1;
    }

    if (!encoder.extendLastFrameTo(adjustedStopTimestampHns)) {
        std::cerr << "WARNING: Failed to extend the last video frame to the stop timestamp" << std::endl;
    }

    if (!encoder.finalize()) {
        std::cerr << "ERROR: Failed to finalize Media Foundation encoder" << std::endl;
        return 1;
    }

    std::cout << (interrupted ? "Recording interrupted. Output path: " : "Recording stopped. Output path: ")
              << config.outputPath << std::endl;
    if (audioActive) {
        if (
            loopback.dataDiscontinuityCount() > 0 ||
            loopback.timestampErrorCount() > 0 ||
            loopback.gapFillCount() > 0 ||
            loopback.compactedDiscontinuityCount() > 0 ||
            loopback.compactedSilentDiscontinuityCount() > 0
        ) {
            std::cerr << "WARNING: System audio timing metadata includes discontinuities="
                      << loopback.dataDiscontinuityCount()
                      << " timestampErrors=" << loopback.timestampErrorCount()
                      << " gapFills=" << loopback.gapFillCount()
                      << " insertedSilenceFrames=" << loopback.insertedSilenceFrames()
                      << " compactedDiscontinuities=" << loopback.compactedDiscontinuityCount()
                      << " compactedDiscontinuityFrames=" << loopback.compactedDiscontinuityFrames()
                      << " compactedSilentDiscontinuities=" << loopback.compactedSilentDiscontinuityCount()
                      << " compactedSilentDiscontinuityFrames=" << loopback.compactedSilentDiscontinuityFrames()
                      << std::endl;
        }
        std::cout << "Audio path: " << config.audioOutputPath << std::endl;
    }
    if (micActive) {
        if (
            micCapture.dataDiscontinuityCount() > 0 ||
            micCapture.timestampErrorCount() > 0 ||
            micCapture.gapFillCount() > 0 ||
            micCapture.compactedDiscontinuityCount() > 0 ||
            micCapture.compactedSilentDiscontinuityCount() > 0
        ) {
            std::cerr << "WARNING: Microphone timing metadata includes discontinuities="
                      << micCapture.dataDiscontinuityCount()
                      << " timestampErrors=" << micCapture.timestampErrorCount()
                      << " gapFills=" << micCapture.gapFillCount()
                      << " insertedSilenceFrames=" << micCapture.insertedSilenceFrames()
                      << " compactedDiscontinuities=" << micCapture.compactedDiscontinuityCount()
                      << " compactedDiscontinuityFrames=" << micCapture.compactedDiscontinuityFrames()
                      << " compactedSilentDiscontinuities=" << micCapture.compactedSilentDiscontinuityCount()
                      << " compactedSilentDiscontinuityFrames=" << micCapture.compactedSilentDiscontinuityFrames()
                      << std::endl;
        }
        std::cout << "Mic path: " << config.micOutputPath << std::endl;
    }
    std::cout.flush();

    // Allow pipe buffers to drain before forceful exit
    Sleep(100);

    // Fast exit to avoid WinRT/COM teardown crashes during apartment cleanup
    ExitProcess(interrupted ? 1 : 0);
}
