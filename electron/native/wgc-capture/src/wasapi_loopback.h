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
    uint64_t capturedDurationMs() const;
    uint64_t totalDataBytes() const { return totalDataBytes_.load(); }
    uint32_t sampleRate() const;
    uint16_t channelCount() const;
    uint32_t dataDiscontinuityCount() const { return dataDiscontinuityCount_.load(); }
    uint32_t timestampErrorCount() const { return timestampErrorCount_.load(); }
    uint32_t gapFillCount() const { return gapFillCount_.load(); }
    uint64_t insertedSilenceFrames() const { return insertedSilenceFrames_.load(); }

private:
    bool initializeCommon();
    void captureThread();
    bool writeWavHeader(HANDLE file, DWORD dataSize);
    void writePcmFrames(const int16_t* samples, UINT32 frameCount, WORD channels);
    void writeSilenceFrames(uint64_t frameCount, WORD channels);
    uint32_t boundaryFadeInFrameCount() const;
    IMMDevice* findCaptureDeviceByName(const std::wstring& name);

    std::string outputPath_;
    std::thread thread_;
    std::atomic<bool> capturing_{false};
    std::atomic<bool> paused_{false};
    HANDLE outputFile_ = INVALID_HANDLE_VALUE;
    std::atomic<uint64_t> totalDataBytes_{0};
    std::atomic<uint64_t> framesWritten_{0};

    IMMDeviceEnumerator* enumerator_ = nullptr;
    IMMDevice* device_ = nullptr;
    IAudioClient* audioClient_ = nullptr;
    IAudioCaptureClient* captureClient_ = nullptr;
    WAVEFORMATEX* mixFormat_ = nullptr;
    DWORD streamFlags_ = 0;

    UINT32 bufferFrameCount_ = 0;
    std::atomic<int64_t> firstPacketQpcHns_{-1};
    std::atomic<int64_t> pauseStartQpcHns_{0};
    std::atomic<int64_t> accumulatedPausedQpcHns_{0};
    std::atomic<uint32_t> dataDiscontinuityCount_{0};
    std::atomic<uint32_t> timestampErrorCount_{0};
    std::atomic<uint32_t> gapFillCount_{0};
    std::atomic<uint64_t> insertedSilenceFrames_{0};
    std::atomic<uint32_t> fadeInFramesRemaining_{0};
};
