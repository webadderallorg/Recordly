#include "wasapi_loopback.h"
#include <functiondiscoverykeys_devpkey.h>
#include <iostream>
#include <cstring>

#pragma comment(lib, "ole32.lib")

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
    paused_ = true;
    return audioClient_ ? SUCCEEDED(audioClient_->Stop()) : false;
}

bool WasapiCapture::resume() {
    if (!capturing_ || !paused_) return true;
    HRESULT hr = audioClient_ ? audioClient_->Start() : E_FAIL;
    if (FAILED(hr)) return false;
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
        writeWavHeader(outputFile_, totalDataBytes_);
        CloseHandle(outputFile_);
        outputFile_ = INVALID_HANDLE_VALUE;
    }

    paused_ = false;
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

void WasapiCapture::captureThread() {
    WORD channels = static_cast<WORD>(mixFormat_->nChannels);
    bool isFloat = (mixFormat_->wFormatTag == WAVE_FORMAT_IEEE_FLOAT) ||
        (mixFormat_->wFormatTag == WAVE_FORMAT_EXTENSIBLE &&
         reinterpret_cast<WAVEFORMATEXTENSIBLE*>(mixFormat_)->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);

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
        if (FAILED(hr)) break;

        while (packetLength > 0) {
            BYTE* data = nullptr;
            UINT32 numFrames = 0;
            DWORD flags = 0;

            hr = captureClient_->GetBuffer(&data, &numFrames, &flags, nullptr, nullptr);
            if (FAILED(hr)) break;

            UINT32 totalSamples = numFrames * channels;

            if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
                pcmBuffer.assign(totalSamples, 0);
            } else if (isFloat) {
                pcmBuffer.resize(totalSamples);
                const float* src = reinterpret_cast<const float*>(data);
                for (UINT32 i = 0; i < totalSamples; i++) {
                    pcmBuffer[i] = floatToInt16(src[i]);
                }
            } else {
                pcmBuffer.resize(totalSamples);
                std::memcpy(pcmBuffer.data(), data, totalSamples * sizeof(int16_t));
            }

            captureClient_->ReleaseBuffer(numFrames);

            DWORD bytesToWrite = totalSamples * sizeof(int16_t);
            DWORD written;
            WriteFile(outputFile_, pcmBuffer.data(), bytesToWrite, &written, nullptr);
            totalDataBytes_ += written;

            hr = captureClient_->GetNextPacketSize(&packetLength);
            if (FAILED(hr)) break;
        }
    }
}
