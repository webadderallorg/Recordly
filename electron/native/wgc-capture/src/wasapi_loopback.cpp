#include "wasapi_loopback.h"
#include <functiondiscoverykeys_devpkey.h>
#include <iostream>
#include <cstring>
#include <algorithm>

#pragma comment(lib, "ole32.lib")

namespace {
constexpr int64_t kHundredNanosecondsPerSecond = 10000000;
constexpr uint64_t kSilenceWriteChunkFrames = 4096;

int64_t queryPerformanceCounterHns() {
    LARGE_INTEGER counter;
    LARGE_INTEGER frequency;
    if (!QueryPerformanceCounter(&counter) || !QueryPerformanceFrequency(&frequency) || frequency.QuadPart <= 0) {
        return 0;
    }

    return static_cast<int64_t>(
        (static_cast<long double>(counter.QuadPart) * 10000000.0L) /
        static_cast<long double>(frequency.QuadPart));
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

int16_t pcm24ToInt16(const BYTE* sample) {
    int32_t value = static_cast<int32_t>(sample[0]) |
        (static_cast<int32_t>(sample[1]) << 8) |
        (static_cast<int32_t>(sample[2]) << 16);
    if ((value & 0x800000) != 0) {
        value |= ~0xFFFFFF;
    }
    return static_cast<int16_t>(value >> 8);
}
}

static const CLSID CLSID_MMDeviceEnumerator_ = __uuidof(MMDeviceEnumerator);
static const IID IID_IMMDeviceEnumerator_ = __uuidof(IMMDeviceEnumerator);
static const IID IID_IAudioClient_ = __uuidof(IAudioClient);
static const IID IID_IAudioCaptureClient_ = __uuidof(IAudioCaptureClient);

WasapiCapture::WasapiCapture() {}

WasapiCapture::~WasapiCapture() {
    stop();
    if (mixFormat_) CoTaskMemFree(mixFormat_);
    if (captureClient_) captureClient_->Release();
    if (audioClient_) audioClient_->Release();
    if (device_) device_->Release();
    if (enumerator_) enumerator_->Release();
}

static std::wstring utf8ToWide(const std::string& str) {
    if (str.empty()) return L"";
    int len = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), static_cast<int>(str.size()), nullptr, 0);
    std::wstring wstr(len, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), static_cast<int>(str.size()), &wstr[0], len);
    return wstr;
}

IMMDevice* WasapiCapture::findCaptureDeviceByName(const std::wstring& targetName) {
    IMMDeviceCollection* collection = nullptr;
    HRESULT hr = enumerator_->EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE, &collection);
    if (FAILED(hr)) return nullptr;

    UINT count = 0;
    collection->GetCount(&count);

    for (UINT i = 0; i < count; i++) {
        IMMDevice* dev = nullptr;
        collection->Item(i, &dev);

        IPropertyStore* store = nullptr;
        dev->OpenPropertyStore(STGM_READ, &store);
        PROPVARIANT pv;
        PropVariantInit(&pv);
        store->GetValue(PKEY_Device_FriendlyName, &pv);
        std::wstring name = pv.pwszVal ? pv.pwszVal : L"";
        PropVariantClear(&pv);
        store->Release();

        if (name.find(targetName) != std::wstring::npos || targetName.find(name) != std::wstring::npos) {
            collection->Release();
            return dev;
        }
        dev->Release();
    }

    collection->Release();
    return nullptr;
}

bool WasapiCapture::initializeLoopback(const std::string& outputPath) {
    outputPath_ = outputPath;
    streamFlags_ = AUDCLNT_STREAMFLAGS_LOOPBACK;

    HRESULT hr = CoCreateInstance(
        CLSID_MMDeviceEnumerator_, nullptr, CLSCTX_ALL,
        IID_IMMDeviceEnumerator_, reinterpret_cast<void**>(&enumerator_));
    if (FAILED(hr)) return false;

    hr = enumerator_->GetDefaultAudioEndpoint(eRender, eConsole, &device_);
    if (FAILED(hr)) return false;

    return initializeCommon();
}

bool WasapiCapture::initializeMic(const std::string& outputPath, const std::string& deviceName) {
    outputPath_ = outputPath;
    streamFlags_ = 0;

    HRESULT hr = CoCreateInstance(
        CLSID_MMDeviceEnumerator_, nullptr, CLSCTX_ALL,
        IID_IMMDeviceEnumerator_, reinterpret_cast<void**>(&enumerator_));
    if (FAILED(hr)) return false;

    if (!deviceName.empty()) {
        device_ = findCaptureDeviceByName(utf8ToWide(deviceName));
    }
    if (!device_) {
        hr = enumerator_->GetDefaultAudioEndpoint(eCapture, eCommunications, &device_);
        if (FAILED(hr)) {
            hr = enumerator_->GetDefaultAudioEndpoint(eCapture, eConsole, &device_);
            if (FAILED(hr)) return false;
        }
    }

    return initializeCommon();
}

bool WasapiCapture::initializeCommon() {
    HRESULT hr = device_->Activate(IID_IAudioClient_, CLSCTX_ALL, nullptr,
                                    reinterpret_cast<void**>(&audioClient_));
    if (FAILED(hr)) return false;

    hr = audioClient_->GetMixFormat(&mixFormat_);
    if (FAILED(hr)) return false;

    REFERENCE_TIME bufferDuration = 200000; // 20ms
    hr = audioClient_->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        streamFlags_,
        bufferDuration, 0, mixFormat_, nullptr);
    if (FAILED(hr)) return false;

    hr = audioClient_->GetBufferSize(&bufferFrameCount_);
    if (FAILED(hr)) return false;

    hr = audioClient_->GetService(IID_IAudioCaptureClient_,
                                   reinterpret_cast<void**>(&captureClient_));
    if (FAILED(hr)) return false;

    return true;
}

bool WasapiCapture::start() {
    if (capturing_) return true;

    outputFile_ = CreateFileA(
        outputPath_.c_str(), GENERIC_WRITE, 0, nullptr,
        CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);

    if (outputFile_ == INVALID_HANDLE_VALUE) {
        std::cerr << "ERROR: Cannot create audio output file" << std::endl;
        return false;
    }

    totalDataBytes_ = 0;
    framesWritten_ = 0;
    firstPacketQpcHns_ = -1;
    pauseStartQpcHns_ = 0;
    accumulatedPausedQpcHns_ = 0;
    dataDiscontinuityCount_ = 0;
    timestampErrorCount_ = 0;
    writeWavHeader(outputFile_, 0);

    HRESULT hr = audioClient_->Start();
    if (FAILED(hr)) {
        CloseHandle(outputFile_);
        outputFile_ = INVALID_HANDLE_VALUE;
        return false;
    }

    capturing_ = true;
    paused_ = false;
    thread_ = std::thread(&WasapiCapture::captureThread, this);
    return true;
}

bool WasapiCapture::pause() {
    if (!capturing_ || paused_) return true;
    pauseStartQpcHns_ = queryPerformanceCounterHns();
    paused_ = true;
    return audioClient_ ? SUCCEEDED(audioClient_->Stop()) : false;
}

bool WasapiCapture::resume() {
    if (!capturing_ || !paused_) return true;
    const int64_t resumedQpcHns = queryPerformanceCounterHns();
    const int64_t pauseStartQpcHns = pauseStartQpcHns_.load();
    HRESULT hr = audioClient_ ? audioClient_->Start() : E_FAIL;
    if (FAILED(hr)) return false;
    if (pauseStartQpcHns > 0 && resumedQpcHns > pauseStartQpcHns) {
        accumulatedPausedQpcHns_.fetch_add(resumedQpcHns - pauseStartQpcHns);
    }
    pauseStartQpcHns_ = 0;
    paused_ = false;
    return true;
}

void WasapiCapture::stop() {
    if (!capturing_) return;
    capturing_ = false;
    if (thread_.joinable()) thread_.join();
    if (audioClient_) audioClient_->Stop();

    if (outputFile_ != INVALID_HANDLE_VALUE) {
        SetFilePointer(outputFile_, 0, nullptr, FILE_BEGIN);
        const uint64_t dataBytes = totalDataBytes_.load();
        const DWORD wavDataBytes =
            static_cast<DWORD>(std::min<uint64_t>(dataBytes, 0xFFFFFFFFu));
        writeWavHeader(outputFile_, wavDataBytes);
        CloseHandle(outputFile_);
        outputFile_ = INVALID_HANDLE_VALUE;
    }

    paused_ = false;
    pauseStartQpcHns_ = 0;
    accumulatedPausedQpcHns_ = 0;
}

static int16_t floatToInt16(float v) {
    v = v < -1.0f ? -1.0f : (v > 1.0f ? 1.0f : v);
    return static_cast<int16_t>(v * 32767.0f);
}

bool WasapiCapture::writeWavHeader(HANDLE file, DWORD dataSize) {
    WORD channels = static_cast<WORD>(mixFormat_->nChannels);
    DWORD sampleRate = mixFormat_->nSamplesPerSec;
    WORD bitsPerSample = 16;
    WORD blockAlign = channels * (bitsPerSample / 8);
    DWORD byteRate = sampleRate * blockAlign;

    DWORD written;
    WriteFile(file, "RIFF", 4, &written, nullptr);
    DWORD chunkSize = 36 + dataSize;
    WriteFile(file, &chunkSize, 4, &written, nullptr);
    WriteFile(file, "WAVE", 4, &written, nullptr);
    WriteFile(file, "fmt ", 4, &written, nullptr);
    DWORD fmtSize = 16;
    WriteFile(file, &fmtSize, 4, &written, nullptr);
    WORD audioFormat = 1;
    WriteFile(file, &audioFormat, 2, &written, nullptr);
    WriteFile(file, &channels, 2, &written, nullptr);
    WriteFile(file, &sampleRate, 4, &written, nullptr);
    WriteFile(file, &byteRate, 4, &written, nullptr);
    WriteFile(file, &blockAlign, 2, &written, nullptr);
    WriteFile(file, &bitsPerSample, 2, &written, nullptr);
    WriteFile(file, "data", 4, &written, nullptr);
    WriteFile(file, &dataSize, 4, &written, nullptr);
    return true;
}

void WasapiCapture::writePcmFrames(const int16_t* samples, UINT32 frameCount, WORD channels) {
    if (!samples || frameCount == 0 || channels == 0 || outputFile_ == INVALID_HANDLE_VALUE) {
        return;
    }

    const DWORD bytesToWrite = frameCount * channels * sizeof(int16_t);
    DWORD written = 0;
    WriteFile(outputFile_, samples, bytesToWrite, &written, nullptr);
    totalDataBytes_.fetch_add(written);
    framesWritten_.fetch_add(written / (channels * sizeof(int16_t)));
}

void WasapiCapture::writeSilenceFrames(uint64_t frameCount, WORD channels) {
    if (frameCount == 0 || channels == 0 || outputFile_ == INVALID_HANDLE_VALUE) {
        return;
    }

    std::vector<int16_t> silence(static_cast<size_t>(kSilenceWriteChunkFrames * channels), 0);
    while (frameCount > 0) {
        const uint64_t chunkFrames = std::min<uint64_t>(frameCount, kSilenceWriteChunkFrames);
        writePcmFrames(silence.data(), static_cast<UINT32>(chunkFrames), channels);
        frameCount -= chunkFrames;
    }
}

uint64_t WasapiCapture::capturedDurationMs() const {
    if (!mixFormat_ || mixFormat_->nSamplesPerSec == 0) {
        return 0;
    }

    return (framesWritten_.load() * 1000) / mixFormat_->nSamplesPerSec;
}

void WasapiCapture::captureThread() {
    // COM must be initialized on every thread that uses COM objects.
    // The main thread calls winrt::init_apartment(MTA) but that only covers
    // the main thread.  Windows 11 enforces per-thread COM init more strictly
    // than Windows 10, causing silent audio capture failures without this.
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);

    WORD channels = static_cast<WORD>(mixFormat_->nChannels);
    const bool isFloat = isFloatFormat(mixFormat_);
    const bool isPcm = isPcmFormat(mixFormat_);
    const WORD bitsPerSample = mixFormat_->wBitsPerSample;
    const WORD sourceBlockAlign = mixFormat_->nBlockAlign;
    const WORD sourceBytesPerSample =
        channels > 0 ? static_cast<WORD>(sourceBlockAlign / channels) : 0;

    std::vector<int16_t> pcmBuffer;

    DWORD sleepMs = static_cast<DWORD>((static_cast<double>(bufferFrameCount_) / mixFormat_->nSamplesPerSec) * 500.0);
    if (sleepMs < 5) sleepMs = 5;

    while (capturing_) {
        if (paused_) {
            Sleep(10);
            continue;
        }

        Sleep(sleepMs);

        UINT32 packetLength = 0;
        HRESULT hr = captureClient_->GetNextPacketSize(&packetLength);
        if (FAILED(hr)) {
            std::cerr << "WASAPI: GetNextPacketSize failed hr=0x" << std::hex << hr << std::dec << std::endl;
            break;
        }

        while (packetLength > 0) {
            BYTE* data = nullptr;
            UINT32 numFrames = 0;
            DWORD flags = 0;
            UINT64 devicePosition = 0;
            UINT64 qpcPosition = 0;

            hr = captureClient_->GetBuffer(
                &data,
                &numFrames,
                &flags,
                &devicePosition,
                &qpcPosition);
            if (FAILED(hr)) {
                std::cerr << "WASAPI: GetBuffer failed hr=0x" << std::hex << hr << std::dec << std::endl;
                break;
            }

            if ((flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY) != 0) {
                dataDiscontinuityCount_.fetch_add(1);
            }
            if ((flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR) != 0) {
                timestampErrorCount_.fetch_add(1);
            }
            const bool hasReliableTimestamp =
                numFrames > 0 &&
                qpcPosition > 0 &&
                (flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR) == 0;
            if (hasReliableTimestamp) {
                int64_t expected = -1;
                firstPacketQpcHns_.compare_exchange_strong(
                    expected,
                    static_cast<int64_t>(qpcPosition));

                const int64_t firstPacketQpcHns = firstPacketQpcHns_.load();
                if (
                    firstPacketQpcHns >= 0 &&
                    static_cast<int64_t>(qpcPosition) > firstPacketQpcHns
                ) {
                    const int64_t elapsedHns =
                        static_cast<int64_t>(qpcPosition) - firstPacketQpcHns;
                    const int64_t adjustedElapsedHns = std::max<int64_t>(
                        0,
                        elapsedHns - accumulatedPausedQpcHns_.load());
                    const uint64_t expectedStartFrame =
                        (static_cast<uint64_t>(adjustedElapsedHns) * mixFormat_->nSamplesPerSec +
                         kHundredNanosecondsPerSecond / 2) /
                        kHundredNanosecondsPerSecond;
                    const uint64_t writtenFrames = framesWritten_.load();
                    const uint64_t gapThresholdFrames = mixFormat_->nSamplesPerSec / 100;

                    if (expectedStartFrame > writtenFrames + gapThresholdFrames) {
                        writeSilenceFrames(expectedStartFrame - writtenFrames, channels);
                    }
                }
            }

            UINT32 totalSamples = numFrames * channels;

            if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
                pcmBuffer.assign(totalSamples, 0);
            } else if (isFloat && bitsPerSample == 32 && sourceBytesPerSample >= 4) {
                pcmBuffer.resize(totalSamples);
                const float* src = reinterpret_cast<const float*>(data);
                for (UINT32 i = 0; i < totalSamples; i++) {
                    pcmBuffer[i] = floatToInt16(src[i]);
                }
            } else if (isPcm && bitsPerSample == 16 && sourceBytesPerSample >= 2) {
                pcmBuffer.resize(totalSamples);
                if (sourceBytesPerSample == sizeof(int16_t)) {
                    std::memcpy(pcmBuffer.data(), data, totalSamples * sizeof(int16_t));
                } else {
                    for (UINT32 frame = 0; frame < numFrames; frame++) {
                        const BYTE* frameData = data + frame * sourceBlockAlign;
                        for (WORD channel = 0; channel < channels; channel++) {
                            const BYTE* sample = frameData + channel * sourceBytesPerSample;
                            pcmBuffer[frame * channels + channel] =
                                *reinterpret_cast<const int16_t*>(sample);
                        }
                    }
                }
            } else if (isPcm && bitsPerSample == 24 && sourceBytesPerSample >= 3) {
                pcmBuffer.resize(totalSamples);
                for (UINT32 frame = 0; frame < numFrames; frame++) {
                    const BYTE* frameData = data + frame * sourceBlockAlign;
                    for (WORD channel = 0; channel < channels; channel++) {
                        const BYTE* sample = frameData + channel * sourceBytesPerSample;
                        pcmBuffer[frame * channels + channel] = pcm24ToInt16(sample);
                    }
                }
            } else if (isPcm && bitsPerSample == 32 && sourceBytesPerSample >= 4) {
                pcmBuffer.resize(totalSamples);
                for (UINT32 frame = 0; frame < numFrames; frame++) {
                    const BYTE* frameData = data + frame * sourceBlockAlign;
                    for (WORD channel = 0; channel < channels; channel++) {
                        const BYTE* sample = frameData + channel * sourceBytesPerSample;
                        const int32_t value = *reinterpret_cast<const int32_t*>(sample);
                        pcmBuffer[frame * channels + channel] = static_cast<int16_t>(value >> 16);
                    }
                }
            } else if (isPcm && bitsPerSample == 8 && sourceBytesPerSample >= 1) {
                pcmBuffer.resize(totalSamples);
                for (UINT32 frame = 0; frame < numFrames; frame++) {
                    const BYTE* frameData = data + frame * sourceBlockAlign;
                    for (WORD channel = 0; channel < channels; channel++) {
                        const BYTE value = *(frameData + channel * sourceBytesPerSample);
                        pcmBuffer[frame * channels + channel] =
                            static_cast<int16_t>((static_cast<int>(value) - 128) << 8);
                    }
                }
            } else {
                pcmBuffer.assign(totalSamples, 0);
            }

            captureClient_->ReleaseBuffer(numFrames);

            writePcmFrames(pcmBuffer.data(), numFrames, channels);

            hr = captureClient_->GetNextPacketSize(&packetLength);
            if (FAILED(hr)) {
                std::cerr << "WASAPI: GetNextPacketSize failed hr=0x" << std::hex << hr << std::dec << std::endl;
                break;
            }
        }
    }

    CoUninitialize();
}
