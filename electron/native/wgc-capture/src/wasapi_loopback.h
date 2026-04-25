#pragma once

#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <string>
#include <thread>
#include <atomic>
#include <vector>

class WasapiCapture {
public:
    WasapiCapture();
    ~WasapiCapture();

    bool initializeLoopback(const std::string& outputPath);
    bool initializeMic(const std::string& outputPath, const std::string& deviceName = "");
    bool start();
    bool pause();
    bool resume();
    void stop();
    int64_t firstPacketQpcHns() const { return firstPacketQpcHns_.load(); }
    uint32_t dataDiscontinuityCount() const { return dataDiscontinuityCount_.load(); }
    uint32_t timestampErrorCount() const { return timestampErrorCount_.load(); }

private:
    bool initializeCommon();
    void captureThread();
    bool writeWavHeader(HANDLE file, DWORD dataSize);
    IMMDevice* findCaptureDeviceByName(const std::wstring& name);

    std::string outputPath_;
    std::thread thread_;
    std::atomic<bool> capturing_{false};
    std::atomic<bool> paused_{false};
    HANDLE outputFile_ = INVALID_HANDLE_VALUE;
    DWORD totalDataBytes_ = 0;

    IMMDeviceEnumerator* enumerator_ = nullptr;
    IMMDevice* device_ = nullptr;
    IAudioClient* audioClient_ = nullptr;
    IAudioCaptureClient* captureClient_ = nullptr;
    WAVEFORMATEX* mixFormat_ = nullptr;
    DWORD streamFlags_ = 0;

    UINT32 bufferFrameCount_ = 0;
    std::atomic<int64_t> firstPacketQpcHns_{-1};
    std::atomic<uint32_t> dataDiscontinuityCount_{0};
    std::atomic<uint32_t> timestampErrorCount_{0};
};
