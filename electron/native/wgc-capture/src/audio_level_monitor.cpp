#include "audio_level_monitor.h"

#include <windows.h>
#include <audioclient.h>
#include <propkeydef.h>
#include <functiondiscoverykeys_devpkey.h>
#include <mmdeviceapi.h>
#include <propidl.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

namespace {

struct LevelAccumulator {
    long double sumSquares = 0.0L;
    float peak = 0.0f;
    uint64_t sampleCount = 0;
};

struct OutputMonitorDevice {
    std::string id;
    IMMDevice* device = nullptr;
    IAudioClient* audioClient = nullptr;
    IAudioCaptureClient* captureClient = nullptr;
    WAVEFORMATEX* mixFormat = nullptr;
    UINT32 bufferFrameCount = 0;
    bool isDefault = false;
};

std::string wideToUtf8(const std::wstring& value) {
    if (value.empty()) return "";
    const int size = WideCharToMultiByte(
        CP_UTF8,
        0,
        value.c_str(),
        static_cast<int>(value.size()),
        nullptr,
        0,
        nullptr,
        nullptr);
    if (size <= 0) return "";

    std::string result(size, '\0');
    WideCharToMultiByte(
        CP_UTF8,
        0,
        value.c_str(),
        static_cast<int>(value.size()),
        result.data(),
        size,
        nullptr,
        nullptr);
    return result;
}

bool isFloatFormat(const WAVEFORMATEX* format) {
    if (!format) return false;
    if (format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT) return true;
    if (format->wFormatTag != WAVE_FORMAT_EXTENSIBLE) return false;
    return reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format)->SubFormat ==
        KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
}

bool isPcmFormat(const WAVEFORMATEX* format) {
    if (!format) return false;
    if (format->wFormatTag == WAVE_FORMAT_PCM) return true;
    if (format->wFormatTag != WAVE_FORMAT_EXTENSIBLE) return false;
    return reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format)->SubFormat ==
        KSDATAFORMAT_SUBTYPE_PCM;
}

float clampSample(float sample) {
    return std::clamp(sample, -1.0f, 1.0f);
}

int16_t readInt16(const BYTE* sample) {
    int16_t value = 0;
    std::memcpy(&value, sample, sizeof(value));
    return value;
}

int32_t readInt32(const BYTE* sample) {
    int32_t value = 0;
    std::memcpy(&value, sample, sizeof(value));
    return value;
}

float readPcmSample(const BYTE* sample, WORD bitsPerSample) {
    switch (bitsPerSample) {
        case 8:
            return (static_cast<float>(*sample) - 128.0f) / 128.0f;
        case 16:
            return static_cast<float>(readInt16(sample)) / 32768.0f;
        case 24: {
            int32_t value = static_cast<int32_t>(sample[0]) |
                (static_cast<int32_t>(sample[1]) << 8) |
                (static_cast<int32_t>(sample[2]) << 16);
            if ((value & 0x800000) != 0) value |= ~0xFFFFFF;
            return static_cast<float>(value) / 8388608.0f;
        }
        case 32:
            return static_cast<float>(readInt32(sample)) / 2147483648.0f;
        default:
            return 0.0f;
    }
}

void accumulatePacket(
    const OutputMonitorDevice& monitor,
    const BYTE* data,
    UINT32 frameCount,
    DWORD flags,
    LevelAccumulator& result) {
    if (!monitor.mixFormat || frameCount == 0) return;
    if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0 || !data) return;

    const WORD channels = monitor.mixFormat->nChannels;
    const WORD bitsPerSample = monitor.mixFormat->wBitsPerSample;
    const WORD sourceBlockAlign = monitor.mixFormat->nBlockAlign;
    const WORD sourceBytesPerSample = channels > 0
        ? static_cast<WORD>(sourceBlockAlign / channels)
        : 0;
    if (channels == 0 || sourceBytesPerSample == 0) return;

    const bool floatSamples = isFloatFormat(monitor.mixFormat) &&
        bitsPerSample == 32 && sourceBytesPerSample >= 4;
    const bool pcmSamples = isPcmFormat(monitor.mixFormat) &&
        (bitsPerSample == 8 || bitsPerSample == 16 || bitsPerSample == 24 || bitsPerSample == 32) &&
        sourceBytesPerSample >= ((bitsPerSample + 7) / 8);
    if (!floatSamples && !pcmSamples) return;

    for (UINT32 frame = 0; frame < frameCount; frame++) {
        const BYTE* frameData = data + static_cast<size_t>(frame) * sourceBlockAlign;
        for (WORD channel = 0; channel < channels; channel++) {
            const BYTE* sampleData = frameData + static_cast<size_t>(channel) * sourceBytesPerSample;
            float sample = 0.0f;
            if (floatSamples) {
                std::memcpy(&sample, sampleData, sizeof(sample));
            } else {
                sample = readPcmSample(sampleData, bitsPerSample);
            }
            sample = clampSample(sample);
            const float magnitude = std::fabs(sample);
            result.sumSquares += static_cast<long double>(sample) * sample;
            result.peak = (std::max)(result.peak, magnitude);
            result.sampleCount++;
        }
    }
}

void releaseMonitorDevice(OutputMonitorDevice& monitor) {
    if (monitor.captureClient) {
        monitor.captureClient->Release();
        monitor.captureClient = nullptr;
    }
    if (monitor.audioClient) {
        monitor.audioClient->Stop();
        monitor.audioClient->Release();
        monitor.audioClient = nullptr;
    }
    if (monitor.mixFormat) {
        CoTaskMemFree(monitor.mixFormat);
        monitor.mixFormat = nullptr;
    }
    if (monitor.device) {
        monitor.device->Release();
        monitor.device = nullptr;
    }
}

bool initializeMonitorDevice(OutputMonitorDevice& monitor) {
    if (!monitor.device) return false;

    HRESULT hr = monitor.device->Activate(
        __uuidof(IAudioClient),
        CLSCTX_ALL,
        nullptr,
        reinterpret_cast<void**>(&monitor.audioClient));
    if (FAILED(hr)) return false;

    hr = monitor.audioClient->GetMixFormat(&monitor.mixFormat);
    if (FAILED(hr) || !monitor.mixFormat) return false;

    hr = monitor.audioClient->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK,
        200000,
        0,
        monitor.mixFormat,
        nullptr);
    if (FAILED(hr)) return false;

    hr = monitor.audioClient->GetBufferSize(&monitor.bufferFrameCount);
    if (FAILED(hr) || monitor.bufferFrameCount == 0) return false;

    hr = monitor.audioClient->GetService(
        __uuidof(IAudioCaptureClient),
        reinterpret_cast<void**>(&monitor.captureClient));
    if (FAILED(hr) || !monitor.captureClient) return false;

    hr = monitor.audioClient->Start();
    return SUCCEEDED(hr);
}

void drainMonitorDevice(OutputMonitorDevice& monitor, LevelAccumulator& result) {
    if (!monitor.captureClient) return;

    UINT32 packetLength = 0;
    HRESULT hr = monitor.captureClient->GetNextPacketSize(&packetLength);
    if (FAILED(hr)) return;

    while (packetLength > 0) {
        BYTE* data = nullptr;
        UINT32 frameCount = 0;
        DWORD flags = 0;
        UINT64 devicePosition = 0;
        UINT64 qpcPosition = 0;
        hr = monitor.captureClient->GetBuffer(
            &data,
            &frameCount,
            &flags,
            &devicePosition,
            &qpcPosition);
        if (FAILED(hr)) return;

        accumulatePacket(monitor, data, frameCount, flags, result);
        monitor.captureClient->ReleaseBuffer(frameCount);

        hr = monitor.captureClient->GetNextPacketSize(&packetLength);
        if (FAILED(hr)) return;
    }
}

void writeLevel(const std::string& deviceId, const LevelAccumulator& result) {
    const float rms = result.sampleCount > 0
        ? static_cast<float>(std::sqrt(result.sumSquares / result.sampleCount))
        : 0.0f;
    const float peak = std::clamp(result.peak, 0.0f, 1.0f);
    std::cout << "AUDIO_LEVEL\t" << deviceId << "\t"
              << std::fixed << std::setprecision(6)
              << std::clamp(rms, 0.0f, 1.0f) << "\t" << peak << "\n";
}

std::string getDeviceId(IMMDevice* device) {
    if (!device) return "";
    LPWSTR rawId = nullptr;
    if (FAILED(device->GetId(&rawId)) || !rawId) return "";
    const std::string id = wideToUtf8(rawId);
    CoTaskMemFree(rawId);
    return id;
}

} // namespace

int runAudioOutputLevelMonitor() {
    HRESULT initHr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    const bool shouldUninitialize = SUCCEEDED(initHr);

    IMMDeviceEnumerator* enumerator = nullptr;
    HRESULT hr = CoCreateInstance(
        __uuidof(MMDeviceEnumerator),
        nullptr,
        CLSCTX_ALL,
        __uuidof(IMMDeviceEnumerator),
        reinterpret_cast<void**>(&enumerator));
    if (FAILED(hr) || !enumerator) {
        if (shouldUninitialize) CoUninitialize();
        return 1;
    }

    std::string defaultDeviceId;
    IMMDevice* defaultDevice = nullptr;
    if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &defaultDevice))) {
        defaultDeviceId = getDeviceId(defaultDevice);
        defaultDevice->Release();
    }

    std::vector<OutputMonitorDevice> monitors;
    IMMDeviceCollection* collection = nullptr;
    hr = enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &collection);
    if (SUCCEEDED(hr) && collection) {
        UINT count = 0;
        collection->GetCount(&count);
        for (UINT index = 0; index < count; index++) {
            IMMDevice* device = nullptr;
            if (FAILED(collection->Item(index, &device)) || !device) continue;

            OutputMonitorDevice monitor;
            monitor.device = device;
            monitor.id = getDeviceId(device);
            monitor.isDefault = !defaultDeviceId.empty() && monitor.id == defaultDeviceId;
            if (monitor.id.empty() || !initializeMonitorDevice(monitor)) {
                releaseMonitorDevice(monitor);
                continue;
            }
            monitors.push_back(monitor);
        }
        collection->Release();
    }
    enumerator->Release();

    if (monitors.empty()) {
        std::cerr << "ERROR: No audio output monitor could be initialized" << std::endl;
        if (shouldUninitialize) CoUninitialize();
        return 1;
    }

    DWORD pollIntervalMs = 50;
    for (const OutputMonitorDevice& monitor : monitors) {
        if (!monitor.mixFormat || monitor.mixFormat->nSamplesPerSec == 0) continue;
        const double bufferDurationMs =
            static_cast<double>(monitor.bufferFrameCount) * 1000.0 /
            static_cast<double>(monitor.mixFormat->nSamplesPerSec);
        const DWORD monitorIntervalMs = static_cast<DWORD>((std::max)(1.0, bufferDurationMs / 2.0));
        pollIntervalMs = (std::min)(pollIntervalMs, monitorIntervalMs);
    }

    std::atomic<bool> stopRequested{false};
    std::thread stdinThread([&stopRequested]() {
        std::string line;
        while (std::getline(std::cin, line)) {
            while (!line.empty() && (line.back() == '\r' || line.back() == '\n' || line.back() == ' ' || line.back() == '\t')) {
                line.pop_back();
            }
            if (line == "stop") {
                stopRequested.store(true);
                return;
            }
        }
        stopRequested.store(true);
    });

    while (!stopRequested.load()) {
        for (OutputMonitorDevice& monitor : monitors) {
            LevelAccumulator result;
            drainMonitorDevice(monitor, result);
            writeLevel(monitor.id, result);
            if (monitor.isDefault) writeLevel("default", result);
        }
        std::cout.flush();
        std::this_thread::sleep_for(std::chrono::milliseconds(pollIntervalMs));
    }

    if (stdinThread.joinable()) stdinThread.join();
    for (OutputMonitorDevice& monitor : monitors) releaseMonitorDevice(monitor);
    if (shouldUninitialize) CoUninitialize();
    return 0;
}
