#include "dxgi_session.h"
#include "mf_encoder.h"
#include "monitor_utils.h"
#include "wasapi_loopback.h"

#include <functiondiscoverykeys_devpkey.h>
#include <propidl.h>
#include <iostream>
#include <string>
#include <thread>
#include <atomic>
#include <mutex>
#include <condition_variable>
#include <chrono>

static std::atomic<bool> g_stopRequested{false};
static std::atomic<bool> g_pauseRequested{false};
static std::atomic<bool> g_resumePending{false};
static std::atomic<int64_t> g_lastFrameTimestampHns{0};
static std::atomic<int64_t> g_pauseStartTimestampHns{0};
static std::atomic<int64_t> g_accumulatedPausedHns{0};
static std::mutex g_stopMutex;
static std::condition_variable g_stopCv;

static std::string wideToUtf8(const std::wstring& value) {
    if (value.empty()) return "";
    const int size = WideCharToMultiByte(
        CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    if (size <= 0) return "";
    std::string result(size, '\0');
    WideCharToMultiByte(
        CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()),
        result.data(), size, nullptr, nullptr);
    return result;
}

static int listAudioOutputs() {
    HRESULT initHr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    const bool shouldUninitialize = SUCCEEDED(initHr);
    IMMDeviceEnumerator* enumerator = nullptr;
    HRESULT hr = CoCreateInstance(
        __uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
        __uuidof(IMMDeviceEnumerator), reinterpret_cast<void**>(&enumerator));
    if (FAILED(hr) || !enumerator) {
        if (shouldUninitialize) CoUninitialize();
        return 1;
    }

    IMMDeviceCollection* collection = nullptr;
    hr = enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &collection);
    if (SUCCEEDED(hr) && collection) {
        UINT count = 0;
        collection->GetCount(&count);
        for (UINT i = 0; i < count; i++) {
            IMMDevice* device = nullptr;
            if (FAILED(collection->Item(i, &device)) || !device) continue;

            LPWSTR id = nullptr;
            IPropertyStore* store = nullptr;
            PROPVARIANT value;
            PropVariantInit(&value);
            const bool gotId = SUCCEEDED(device->GetId(&id));
            const bool gotStore = SUCCEEDED(device->OpenPropertyStore(STGM_READ, &store)) && store;
            const bool gotName = gotStore &&
                SUCCEEDED(store->GetValue(PKEY_Device_FriendlyName, &value)) &&
                value.vt == VT_LPWSTR && value.pwszVal;
            if (gotId && gotName) {
                std::cout << "AUDIO_OUTPUT\t" << wideToUtf8(id) << "\t"
                          << wideToUtf8(value.pwszVal) << std::endl;
            }
            PropVariantClear(&value);
            if (store) store->Release();
            if (id) CoTaskMemFree(id);
            device->Release();
        }
        collection->Release();
    }
    enumerator->Release();
    if (shouldUninitialize) CoUninitialize();
    return SUCCEEDED(hr) ? 0 : 1;
}

struct CaptureConfig {
    int64_t displayId = 0;
    int64_t windowHandle = 0;
    std::string outputPath;
    std::string audioOutputPath;
    std::string systemAudioDeviceId;
    std::string systemAudioDeviceName;
    std::string micOutputPath;
    std::string micDeviceName;
    int fps = 60;
    int width = 0;
    int height = 0;
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
    config.systemAudioDeviceId = findString("systemAudioDeviceId");
    config.systemAudioDeviceName = findString("systemAudioDeviceName");
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

    if (std::string(argv[1]) == "--list-audio-outputs") {
        return listAudioOutputs();
    }

    CaptureConfig config;
    if (!parseSimpleJson(argv[1], config)) {
        std::cerr << "ERROR: Failed to parse config JSON" << std::endl;
        return 1;
    }

    DxgiSession session;

    if (config.windowHandle > 0) {
        HWND hwnd = reinterpret_cast<HWND>(static_cast<intptr_t>(config.windowHandle));
        if (!IsWindow(hwnd)) {
            std::cerr << "ERROR: Invalid window handle " << config.windowHandle << std::endl;
            return 1;
        }
        if (!session.initialize(hwnd, config.fps)) {
            std::cerr << "ERROR: Failed to initialize DXGI window capture session" << std::endl;
            return 1;
        }
    } else {
        HMONITOR monitor = findMonitorByDisplayId(config.displayId);
        if (!monitor) {
            std::cerr << "ERROR: Could not find monitor for displayId " << config.displayId << std::endl;
            return 1;
        }
        if (!session.initialize(monitor, config.fps)) {
            std::cerr << "ERROR: Failed to initialize DXGI capture session" << std::endl;
            return 1;
        }
    }

    int captureWidth = config.width > 0 ? config.width : session.captureWidth();
    int captureHeight = config.height > 0 ? config.height : session.captureHeight();

    // Ensure even dimensions for H.264
    captureWidth = (captureWidth / 2) * 2;
    captureHeight = (captureHeight / 2) * 2;

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
    session.setFrameCallback([&](ID3D11Texture2D* texture, int64_t timestampHns) {
        g_lastFrameTimestampHns = timestampHns;
        if (g_stopRequested) return;

        if (g_pauseRequested) return;

        int64_t adjustedTimestampHns = timestampHns;
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

        if (encoder.writeFrame(texture, adjustedTimestampHns)) {
            frameCount++;
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
        audioInitialized = loopback.initializeLoopback(
            config.audioOutputPath,
            config.systemAudioDeviceId,
            config.systemAudioDeviceName);
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
        std::cerr << "ERROR: Failed to start DXGI capture" << std::endl;
        return 1;
    }

    if (audioInitialized) {
        audioActive = loopback.start();
    }
    if (micInitialized) {
        micActive = micCapture.start();
    }

    std::cout << "Recording started" << std::endl;
    std::cout.flush();

    // Wait for stop signal
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
    encoder.finalize();

    std::cout << "Recording stopped. Output path: " << config.outputPath << std::endl;
    if (audioActive) {
        std::cout << "Audio path: " << config.audioOutputPath << std::endl;
    }
    if (micActive) {
        std::cout << "Mic path: " << config.micOutputPath << std::endl;
    }
    std::cout.flush();

    // Allow pipe buffers to drain before forceful exit
    Sleep(100);

    // Fast exit to avoid WinRT/COM teardown crashes during apartment cleanup
    ExitProcess(0);
}
