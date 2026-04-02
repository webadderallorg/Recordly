#include "mf_encoder.h"
#include <mfapi.h>
#include <mferror.h>
#include <codecapi.h>
#include <strmif.h>
#include <iostream>
#include <cstring>

#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfreadwrite.lib")
#pragma comment(lib, "mf.lib")
#pragma comment(lib, "mfuuid.lib")

static int clampByte(int v) {
    return v < 0 ? 0 : (v > 255 ? 255 : v);
}

MFEncoder::MFEncoder() {}

MFEncoder::~MFEncoder() {
    finalize();
}

bool MFEncoder::initialize(const std::wstring& outputPath, int width, int height, int fps,
                           ID3D11Device* device, ID3D11DeviceContext* context) {
    std::lock_guard<std::mutex> lock(mutex_);

    if (initialized_) return false;

    if (width % 2 != 0 || height % 2 != 0) {
        std::cerr << "ERROR: Encoder dimensions must be even, got " << width << "x" << height << std::endl;
        return false;
    }

    width_ = width;
    height_ = height;
    fps_ = fps;
    device_ = device;
    context_ = context;

    HRESULT hr = MFStartup(MF_VERSION);
    if (FAILED(hr)) {
        std::cerr << "ERROR: MFStartup failed: 0x" << std::hex << hr << std::endl;
        return false;
    }

    // Output media type (H.264)
    ComPtr<IMFMediaType> outputType;
    hr = MFCreateMediaType(&outputType);
    if (FAILED(hr)) return false;

    outputType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    outputType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
    outputType->SetUINT32(MF_MT_AVG_BITRATE, 20000000);
    MFSetAttributeSize(outputType.Get(), MF_MT_FRAME_SIZE, width_, height_);
    MFSetAttributeRatio(outputType.Get(), MF_MT_FRAME_RATE, fps_, 1);
    MFSetAttributeRatio(outputType.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    outputType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);

    // Input media type (NV12)
    ComPtr<IMFMediaType> inputType;
    hr = MFCreateMediaType(&inputType);
    if (FAILED(hr)) return false;

    inputType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    inputType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12);
    MFSetAttributeSize(inputType.Get(), MF_MT_FRAME_SIZE, width_, height_);
    MFSetAttributeRatio(inputType.Get(), MF_MT_FRAME_RATE, fps_, 1);
    MFSetAttributeRatio(inputType.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    inputType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);

    // Create SinkWriter with MPEG4 container
    ComPtr<IMFAttributes> writerAttrs;
    hr = MFCreateAttributes(&writerAttrs, 3);
    if (FAILED(hr)) return false;

    writerAttrs->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE);
    writerAttrs->SetUINT32(MF_LOW_LATENCY, TRUE);
    writerAttrs->SetUINT32(MF_SINK_WRITER_DISABLE_THROTTLING, TRUE);

    hr = MFCreateSinkWriterFromURL(outputPath.c_str(), nullptr, writerAttrs.Get(), &sinkWriter_);
    if (FAILED(hr)) {
        std::cerr << "ERROR: MFCreateSinkWriterFromURL failed: 0x" << std::hex << hr << std::endl;
        return false;
    }

    hr = sinkWriter_->AddStream(outputType.Get(), &streamIndex_);
    if (FAILED(hr)) {
        std::cerr << "ERROR: AddStream failed: 0x" << std::hex << hr << std::endl;
        return false;
    }

    // Attempt to set encoder properties for real-time performance
    ComPtr<ICodecAPI> codecApi;
    if (sinkWriter_ && SUCCEEDED(sinkWriter_->GetServiceForStream(streamIndex_, GUID_NULL, IID_PPV_ARGS(&codecApi)))) {
        VARIANT var;
        VariantInit(&var);
        var.vt = VT_BOOL;
        var.boolVal = VARIANT_TRUE;
        codecApi->SetValue(&CODECAPI_AVLowLatencyMode, &var);
        
        var.vt = VT_UI4;
        var.ulVal = 1; // RealTime
        codecApi->SetValue(&CODECAPI_AVEncCommonRealTime, &var);
    }

    hr = sinkWriter_->SetInputMediaType(streamIndex_, inputType.Get(), nullptr);
    if (FAILED(hr)) {
        std::cerr << "ERROR: SetInputMediaType failed: 0x" << std::hex << hr << std::endl;
        return false;
    }

    hr = sinkWriter_->BeginWriting();
    if (FAILED(hr)) {
        std::cerr << "ERROR: BeginWriting failed: 0x" << std::hex << hr << std::endl;
        return false;
    }

    // Pre-allocate staging texture
    D3D11_TEXTURE2D_DESC stagingDesc = {};
    stagingDesc.Width = width_;
    stagingDesc.Height = height_;
    stagingDesc.MipLevels = 1;
    stagingDesc.ArraySize = 1;
    stagingDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    stagingDesc.SampleDesc.Count = 1;
    stagingDesc.Usage = D3D11_USAGE_STAGING;
    stagingDesc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;

    hr = device_->CreateTexture2D(&stagingDesc, nullptr, &stagingTexture_);
    if (FAILED(hr)) {
        std::cerr << "ERROR: Failed to create staging texture: 0x" << std::hex << hr << std::endl;
        return false;
    }

    // Pre-allocate NV12 buffer
    const int ySize = width_ * height_;
    const int uvSize = (width_ / 2) * (height_ / 2) * 2;
    nv12Buffer_.resize(ySize + uvSize);

    initialized_ = true;
    return true;
}

bool MFEncoder::writeFrame(ID3D11Texture2D* texture, int64_t timestampHns) {
    std::lock_guard<std::mutex> lock(mutex_);

    if (!initialized_ || !sinkWriter_) return false;

    if (texture) {
        context_->CopyResource(stagingTexture_.Get(), texture);

        D3D11_MAPPED_SUBRESOURCE mapped;
        HRESULT hr = context_->Map(stagingTexture_.Get(), 0, D3D11_MAP_READ, 0, &mapped);
        if (FAILED(hr)) return false;

    // Convert BGRA → NV12
    const uint8_t* bgra = static_cast<const uint8_t*>(mapped.pData);
    const int bgraPitch = static_cast<int>(mapped.RowPitch);

    // Y plane
    for (int y = 0; y < height_; y++) {
        for (int x = 0; x < width_; x++) {
            const uint8_t* pixel = bgra + y * bgraPitch + x * 4;
            uint8_t b = pixel[0], g = pixel[1], r = pixel[2];
            int yVal = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
            nv12Buffer_[y * width_ + x] = static_cast<uint8_t>(clampByte(yVal));
        }
    }

    // UV plane (interleaved, subsampled 2x2)
    const int ySize = width_ * height_;
    uint8_t* uvPlane = nv12Buffer_.data() + ySize;
    for (int y = 0; y < height_; y += 2) {
        for (int x = 0; x < width_; x += 2) {
            const uint8_t* pixel = bgra + y * bgraPitch + x * 4;
            uint8_t b = pixel[0], g = pixel[1], r = pixel[2];
            int u = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
            int v = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
            int uvIdx = (y / 2) * width_ + (x / 2) * 2;
            uvPlane[uvIdx] = static_cast<uint8_t>(clampByte(u));
            uvPlane[uvIdx + 1] = static_cast<uint8_t>(clampByte(v));
        }
    }

    context_->Unmap(stagingTexture_.Get(), 0);
    hasValidFrame_ = true;
    }

    if (!hasValidFrame_) return true;

    int64_t frameDurationHns = 10000000LL / fps_;

    // First frame initialization
    if (lastWrittenPtsHns_ == -1) {
        lastWrittenPtsHns_ = timestampHns;
        return writeInternalSample(lastWrittenPtsHns_);
    }

    // Do not step backwards in time
    if (timestampHns <= lastWrittenPtsHns_) return true;

    bool success = true;
    int64_t nextExpectedPts = lastWrittenPtsHns_ + frameDurationHns;

    // Fill the temporal gap with duplicate frames
    while (nextExpectedPts <= timestampHns) {
        success &= writeInternalSample(nextExpectedPts);
        lastWrittenPtsHns_ = nextExpectedPts;
        nextExpectedPts += frameDurationHns;
    }

    return success;
}

bool MFEncoder::writeInternalSample(int64_t pts) {
    DWORD bufferSize = static_cast<DWORD>(nv12Buffer_.size());
    ComPtr<IMFMediaBuffer> buffer;
    HRESULT hr = MFCreateMemoryBuffer(bufferSize, &buffer);
    if (FAILED(hr)) return false;

    BYTE* bufferData = nullptr;
    hr = buffer->Lock(&bufferData, nullptr, nullptr);
    if (FAILED(hr)) return false;

    std::memcpy(bufferData, nv12Buffer_.data(), bufferSize);
    buffer->Unlock();
    buffer->SetCurrentLength(bufferSize);

    ComPtr<IMFSample> sample;
    hr = MFCreateSample(&sample);
    if (FAILED(hr)) return false;

    sample->AddBuffer(buffer.Get());
    sample->SetSampleTime(pts);
    sample->SetSampleDuration(10000000LL / fps_);

    hr = sinkWriter_->WriteSample(streamIndex_, sample.Get());
    if (FAILED(hr)) {
        std::cerr << "ERROR: WriteSample failed: 0x" << std::hex << hr << std::endl;
    }
    return SUCCEEDED(hr);
}

bool MFEncoder::markEndOfStream() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!initialized_ || !sinkWriter_) return false;
    
    // Notify the sink writer that the stream has ended
    sinkWriter_->SendStreamTick(streamIndex_, 0); 
    sinkWriter_->PlaceMarker(streamIndex_, nullptr);
    return true;
}

bool MFEncoder::finalize() {
    std::lock_guard<std::mutex> lock(mutex_);

    if (!initialized_) return false;
    if (!sinkWriter_) return false;

    HRESULT hr = sinkWriter_->Finalize();
    if (FAILED(hr)) {
        std::cerr << "ERROR: SinkWriter Finalize failed: 0x" << std::hex << hr << std::endl;
    }

    initialized_ = false;
    sinkWriter_.Reset();
    stagingTexture_.Reset();
    nv12Buffer_.clear();
    nv12Buffer_.shrink_to_fit();
    MFShutdown();
    return SUCCEEDED(hr);
}
