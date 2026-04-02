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
#include <chrono>
#include <cstdio>

static std::atomic<bool> g_stopRequested{false};
static std::atomic<bool> g_pauseRequested{false};
static std::atomic<bool> g_resumePending{false};
static std::atomic<int64_t> g_lastFrameTimestampHns{0};
static std::atomic<int64_t> g_firstFrameTimestampHns{-1};
static std::atomic<int64_t> g_pauseStartTimestampHns{0};
static std::atomic<int64_t> g_accumulatedPausedHns{0};
static std::chrono::steady_clock::time_point g_captureStartTime;
static std::mutex g_stopMutex;
static std::condition_variable g_stopCv;

struct CaptureConfig {
    int64_t displayId = 0;
    int64_t windowHandle = 0;
    std::string outputPath;
    std::string audioOutputPath;
    std::string micOutputPath;
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
    int cropX = -1;
    int cropY = -1;
    int cropW = -1;
    int cropH = -1;
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

    config.cropX = findInt("cropX");
    config.cropY = findInt("cropY");
    config.cropW = findInt("cropW");
    config.cropH = findInt("cropH");

    return true;
}

static std::wstring utf8ToWide(const std::string& str) {
    if (str.empty()) return L"";
    int len = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), static_cast<int>(str.size()), nullptr, 0);
    std::wstring wstr(len, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), static_cast<int>(str.size()), &wstr[0], len);
    return wstr;
}

static void stdinListenerThread() {
    std::string line;
    while (std::getline(std::cin, line)) {
        // Trim whitespace
        while (!line.empty() && (line.back() == '\r' || line.back() == '\n' || line.back() == ' ')) {
            line.pop_back();
        }

        if (line == "pause") {
            g_pauseRequested = true;
            g_pauseStartTimestampHns = g_lastFrameTimestampHns.load();
            continue;
        }

        if (line == "resume") {
            g_pauseRequested = false;
            g_resumePending = true;
            continue;
        }

        if (line == "stop") {
            g_stopRequested = true;
            g_stopCv.notify_all();
            return;
        }
    }

    // stdin closed (parent process died)
    g_stopRequested = true;
    g_stopCv.notify_all();
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "ERROR: Missing JSON config argument" << std::endl;
        return 1;
    }

    winrt::init_apartment(winrt::apartment_type::multi_threaded);

    // Set DPI awareness to match Electron's logical units as closely as possible for coordinate matching.
    // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 is supported on Win10 1703 and later.
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

    CaptureConfig config;
    if (!parseSimpleJson(argv[1], config)) {
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
        if (monitor) {
            std::cerr << "Found monitor by displayId: " << config.displayId << " handle: " << monitor << std::endl;
        } else if (config.hasDisplayBounds) {
            std::cerr << "Monitor ID match failed for " << config.displayId << ", attempting coordinate-based match: "
                      << config.displayX << "," << config.displayY << " " << config.displayW << "x" << config.displayH << std::endl;
            monitor = findMonitorByBounds(config.displayX, config.displayY, config.displayW, config.displayH);
        }

        if (!monitor) {
            std::cerr << "ERROR: Could not find monitor for displayId " << config.displayId << std::endl;
            // List available monitors for diagnostics
            enumerateMonitors(); // The callback will print them if updated, but for now we error out.
            return 1;
        }
        if (!session.initialize(monitor, config.fps)) {
            std::cerr << "ERROR: Failed to initialize WGC capture session" << std::endl;
            return 1;
        }
    }

    const int monitorWidth = session.captureWidth();
    const int monitorHeight = session.captureHeight();
    int captureWidth = config.width > 0 ? config.width : monitorWidth;
    int captureHeight = config.height > 0 ? config.height : monitorHeight;

    // Scale crop to even dimensions for H.264 if needed
    if (config.cropW > 0 && config.cropH > 0) {
        captureWidth = (config.cropW / 2) * 2;
        captureHeight = (config.cropH / 2) * 2;
    } else {
        captureWidth = (monitorWidth / 2) * 2;
        captureHeight = (monitorHeight / 2) * 2;
    }

    // Set up crop texture IF we are cropping OR if the monitor itself has odd dimensions
    const bool needsCropping = (config.cropW > 0 && config.cropH > 0) || 
                               (monitorWidth != captureWidth || monitorHeight != captureHeight);

    // Initialize encoder
    MFEncoder encoder;
    std::wstring outputPathW = utf8ToWide(config.outputPath);
    if (!encoder.initialize(outputPathW, captureWidth, captureHeight, config.fps,
                           session.device(), session.context())) {
        std::cerr << "ERROR: Failed to initialize Media Foundation encoder" << std::endl;
        return 1;
    }

    // Set up frame callback
    std::atomic<int64_t> frameCount{0};
    std::atomic<bool> recordingStartedAnnounced{false};

    ComPtr<ID3D11Texture2D> cropTexture;
    if (needsCropping) {
        D3D11_TEXTURE2D_DESC desc = {};
        desc.Width = captureWidth;
        desc.Height = captureHeight;
        desc.MipLevels = 1;
        desc.ArraySize = 1;
        desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
        desc.SampleDesc.Count = 1;
        desc.Usage = D3D11_USAGE_DEFAULT;
        desc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
        
        HRESULT hr = session.device()->CreateTexture2D(&desc, nullptr, cropTexture.GetAddressOf());
        if (FAILED(hr)) {
            std::cerr << "ERROR: Failed to create crop texture (HRESULT 0x" << std::hex << hr << ")" << std::endl;
            return 1;
        }
    }

    // Set up frame callback
    session.setFrameCallback([&](ID3D11Texture2D* texture, int64_t timestampHns) {
        g_lastFrameTimestampHns = timestampHns;
        if (g_stopRequested) return;

        if (g_pauseRequested) return;

        if (g_firstFrameTimestampHns.load() == -1) {
            g_firstFrameTimestampHns.store(timestampHns);
            g_captureStartTime = std::chrono::steady_clock::now();
        }

        int64_t adjustedTimestampHns = timestampHns - g_firstFrameTimestampHns.load();
        if (g_resumePending.exchange(false)) {
            const int64_t pauseStart = g_pauseStartTimestampHns.load();
            if (pauseStart > 0 && timestampHns > pauseStart) {
                g_accumulatedPausedHns += (timestampHns - pauseStart);
            }
        }

        adjustedTimestampHns -= g_accumulatedPausedHns.load();
        if (adjustedTimestampHns < 0) {
            adjustedTimestampHns = 0;
        }

        ID3D11Texture2D* inputTexture = texture;
        if (cropTexture) {
            D3D11_BOX box = {};
            int left = config.cropX >= 0 ? config.cropX : 0;
            int top = config.cropY >= 0 ? config.cropY : 0;
            
            // Boundary clamping
            if (left + captureWidth > monitorWidth) left = monitorWidth - captureWidth;
            if (top + captureHeight > monitorHeight) top = monitorHeight - captureHeight;
            if (left < 0) left = 0;
            if (top < 0) top = 0;

            box.left = left;
            box.top = top;
            box.front = 0;
            box.right = left + captureWidth;
            box.bottom = top + captureHeight;
            box.back = 1;

            session.context()->CopySubresourceRegion(cropTexture.Get(), 0, 0, 0, 0, texture, 0, &box);
            inputTexture = cropTexture.Get();
        }

        if (encoder.writeFrame(inputTexture, adjustedTimestampHns)) {
            const int64_t writtenFrames = frameCount.fetch_add(1) + 1;
            if (writtenFrames == 1 && !recordingStartedAnnounced.exchange(true)) {
                std::cout << "Recording started" << std::endl;
                std::cout.flush();
            }
        } else {
            static int errorCount = 0;
            if (errorCount++ < 5) {
                std::cerr << "ERROR: Failed to write frame to encoder" << std::endl;
            }
        }
    });

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
        micInitialized = micCapture.initializeMic(config.micOutputPath, config.micDeviceName);
        if (!micInitialized) {
            std::cerr << "WARNING: Failed to initialize WASAPI mic capture" << std::endl;
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
    if (micInitialized) {
        micActive = micCapture.start();
    }

    // Wait for stop signal while pausing/resuming audio tracks in lockstep.
    while (!g_stopRequested) {
        if (g_pauseRequested) {
            if (audioActive) loopback.pause();
            if (micActive) micCapture.pause();
        } else {
            if (audioActive) loopback.resume();
            if (micActive) micCapture.resume();
        }

        std::unique_lock<std::mutex> lock(g_stopMutex);
        g_stopCv.wait_for(lock, std::chrono::milliseconds(20), [] { return g_stopRequested.load(); });
    }

    // Stop capture and finalize
    session.stopCapture();
    if (audioActive) loopback.stop();
    if (micActive) micCapture.stop();

    if (frameCount.load() <= 0) {
        std::cerr << "ERROR: No video frames were captured before stop" << std::endl;
        DeleteFileW(outputPathW.c_str());
        return 1;
    }

    if (g_firstFrameTimestampHns.load() != -1) {
        auto stopTime = std::chrono::steady_clock::now();
        int64_t finalElapsedHns = std::chrono::duration_cast<std::chrono::duration<int64_t, std::ratio<1, 10000000>>>(stopTime - g_captureStartTime).count();
        finalElapsedHns -= g_accumulatedPausedHns.load();
        
        if (finalElapsedHns > g_lastFrameTimestampHns.load() - g_firstFrameTimestampHns.load()) {
            encoder.writeFrame(nullptr, finalElapsedHns);
        }
    }

    encoder.markEndOfStream();

    if (!encoder.finalize()) {
        std::cerr << "ERROR: Failed to finalize Media Foundation encoder" << std::endl;
        return 1;
    }

    std::cout << "Recording stopped. Output path: " << config.outputPath << std::endl;
    if (audioActive) {
        std::cout << "Audio path: " << config.audioOutputPath << std::endl;
    }
    if (micActive) {
        std::cout << "Mic path: " << config.micOutputPath << std::endl;
    }
    std::cout.flush();

    // Allow pipe buffers to drain before forceful exit.
    // 250ms is more robust for flushing MP4 headers on high-res monitors.
    Sleep(250);

    // Fast exit to avoid WinRT/COM teardown crashes during apartment cleanup
    ExitProcess(0);
}
