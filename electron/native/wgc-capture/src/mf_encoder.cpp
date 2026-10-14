#include "mf_encoder.h"
#include <d3d11_4.h>
#include <mfapi.h>
#include <mferror.h>
#include <codecapi.h>
#include <algorithm>
#include <cstdint>
#include <iostream>
#include <chrono>
#include <cstring>
#include "../../common/bt709_video.h"

#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfreadwrite.lib")
#pragma comment(lib, "mf.lib")
#pragma comment(lib, "mfuuid.lib")

static UINT32 calculateScreenRecordingBitrate(int width, int height, int fps) {
    constexpr uint64_t kFourKPixels = 3840ULL * 2160ULL;
    constexpr uint64_t kQhdPixels = 2560ULL * 1440ULL;
    constexpr UINT32 kBitrate4K = 45000000;
    constexpr UINT32 kBitrateQhd = 28000000;
    constexpr UINT32 kBitrateBase = 18000000;
    constexpr double kHighFrameRateBoost = 1.35;

    const uint64_t pixels =
        static_cast<uint64_t>((std::max)(width, 1)) *
        static_cast<uint64_t>((std::max)(height, 1));
    const UINT32 baseBitrate =
        pixels >= kFourKPixels ? kBitrate4K :
        pixels >= kQhdPixels ? kBitrateQhd :
        kBitrateBase;
    const double boost = fps >= 60 ? kHighFrameRateBoost : 1.0;
    return static_cast<UINT32>(static_cast<double>(baseBitrate) * boost + 0.5);
}

MFEncoder::MFEncoder() {}

MFEncoder::~MFEncoder() {
    finalize();
}

bool MFEncoder::initialize(const std::wstring& outputPath, int width, int height, int fps,
                           ID3D11Device* device, ID3D11DeviceContext* context) {
    std::lock_guard<std::mutex> lock(mutex_);

    if (initialized_) return false;

    if (fps <= 0) {
        std::cerr << "ERROR: Encoder fps must be positive, got " << fps << std::endl;
        return false;
    }

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
    const UINT32 videoBitrate = calculateScreenRecordingBitrate(width_, height_, fps_);
    outputType->SetUINT32(MF_MT_AVG_BITRATE, videoBitrate);
    MFSetAttributeSize(outputType.Get(), MF_MT_FRAME_SIZE, width_, height_);
    MFSetAttributeRatio(outputType.Get(), MF_MT_FRAME_RATE, fps_, 1);
    MFSetAttributeRatio(outputType.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    outputType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    hr = setBt709LimitedVideoAttributes(outputType.Get());
    if (FAILED(hr)) return false;
    std::cerr << "Encoder bitrate: " << videoBitrate << " bps for "
              << width_ << "x" << height_ << "@" << fps_ << "fps" << std::endl;

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
    hr = setBt709LimitedVideoAttributes(inputType.Get());
    if (FAILED(hr)) return false;

    // Create SinkWriter with MPEG4 container
    ComPtr<IMFAttributes> writerAttrs;
    hr = MFCreateAttributes(&writerAttrs, 1);
    if (FAILED(hr)) return false;

    writerAttrs->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE);

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

    // Staging ring: each frame is copied into the next free slot on the GPU, then read back
    // by the worker thread. Slots are CPU-readable BGRA textures of the output size.
    D3D11_TEXTURE2D_DESC stagingDesc = {};
    stagingDesc.Width = width_;
    stagingDesc.Height = height_;
    stagingDesc.MipLevels = 1;
    stagingDesc.ArraySize = 1;
    stagingDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    stagingDesc.SampleDesc.Count = 1;
    stagingDesc.Usage = D3D11_USAGE_STAGING;
    stagingDesc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;

    constexpr size_t kStagingSlotCount = 4;
    slots_.clear();
    slots_.resize(kStagingSlotCount);
    for (auto& slot : slots_) {
        hr = device_->CreateTexture2D(&stagingDesc, nullptr, &slot.texture);
        if (FAILED(hr)) {
            std::cerr << "ERROR: Failed to create staging texture: 0x" << std::hex << hr << std::endl;
            return false;
        }
    }

    // The capture thread issues copies while the worker maps staging textures, so the shared
    // immediate context has to serialise those calls.
    ComPtr<ID3D11Multithread> multithread;
    hr = context_->QueryInterface(IID_PPV_ARGS(&multithread));
    if (FAILED(hr) || !multithread) {
        std::cerr << "ERROR: Failed to query ID3D11Multithread: 0x" << std::hex << hr << std::endl;
        return false;
    }
    multithread->SetMultithreadProtected(TRUE);

    // WGC window captures can change frame size while recording. Keep the muxer
    // output dimensions stable by compositing resized frames into this fixed
    // BGRA surface before CPU readback.
    D3D11_TEXTURE2D_DESC compositeDesc = {};
    compositeDesc.Width = width_;
    compositeDesc.Height = height_;
    compositeDesc.MipLevels = 1;
    compositeDesc.ArraySize = 1;
    compositeDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    compositeDesc.SampleDesc.Count = 1;
    compositeDesc.Usage = D3D11_USAGE_DEFAULT;
    compositeDesc.BindFlags = D3D11_BIND_RENDER_TARGET;

    hr = device_->CreateTexture2D(&compositeDesc, nullptr, &resizeCompositeTexture_);
    if (FAILED(hr)) {
        std::cerr << "ERROR: Failed to create resize composite texture: 0x" << std::hex << hr << std::endl;
        return false;
    }

    hr = device_->CreateRenderTargetView(resizeCompositeTexture_.Get(), nullptr, &resizeCompositeView_);
    if (FAILED(hr)) {
        std::cerr << "ERROR: Failed to create resize composite view: 0x" << std::hex << hr << std::endl;
        return false;
    }

    // Pre-allocate NV12 buffer
    const int ySize = width_ * height_;
    const int uvSize = (width_ / 2) * (height_ / 2) * 2;
    nv12Buffer_.resize(ySize + uvSize);
    lastFrameBuffer_.clear();
    firstSampleTimeHns_ = -1;
    lastSampleTimeHns_ = -1;
    droppedFrames_ = 0;

    stopWorker_ = false;
    workerBusy_ = false;
    pending_.clear();
    initialized_ = true;
    worker_ = std::thread([this] { workerLoop(); });
    return true;
}

bool MFEncoder::writeFrame(ID3D11Texture2D* texture, int64_t timestampHns) {
    std::lock_guard<std::mutex> captureLock(captureMutex_);

    size_t slotIndex = slots_.size();
    {
        std::lock_guard<std::mutex> lock(queueMutex_);
        if (!initialized_ || stopWorker_ || !sinkWriter_) return false;
        for (size_t i = 0; i < slots_.size(); ++i) {
            if (slots_[i].state == SlotState::Free) {
                slotIndex = i;
                break;
            }
        }
        if (slotIndex == slots_.size()) {
            // The worker is behind. Dropping is better than stalling the capture frame pool;
            // the gap is filled by repeating the previous frame.
            droppedFrames_.fetch_add(1);
            return false;
        }
        slots_[slotIndex].state = SlotState::Reserved;
    }

    D3D11_TEXTURE2D_DESC sourceDesc = {};
    texture->GetDesc(&sourceDesc);

    bool copied = true;
    if (sourceDesc.Width == static_cast<UINT>(width_) &&
        sourceDesc.Height == static_cast<UINT>(height_)) {
        context_->CopyResource(slots_[slotIndex].texture.Get(), texture);
    } else if (!resizeCompositeTexture_ || !resizeCompositeView_) {
        copied = false;
    } else {
        const FLOAT clearColor[4] = {0.0f, 0.0f, 0.0f, 1.0f};
        context_->ClearRenderTargetView(resizeCompositeView_.Get(), clearColor);

        D3D11_BOX sourceBox = {};
        sourceBox.left = 0;
        sourceBox.top = 0;
        sourceBox.front = 0;
        sourceBox.right = (std::min)(sourceDesc.Width, static_cast<UINT>(width_));
        sourceBox.bottom = (std::min)(sourceDesc.Height, static_cast<UINT>(height_));
        sourceBox.back = 1;

        if (sourceBox.right == 0 || sourceBox.bottom == 0) {
            copied = false;
        } else {
            context_->CopySubresourceRegion(
                resizeCompositeTexture_.Get(),
                0,
                0,
                0,
                0,
                texture,
                0,
                &sourceBox);
            context_->CopyResource(slots_[slotIndex].texture.Get(), resizeCompositeTexture_.Get());
        }
    }

    if (!copied) {
        std::lock_guard<std::mutex> lock(queueMutex_);
        slots_[slotIndex].state = SlotState::Free;
        return false;
    }

    // Submit the copy now. Without this the work can sit in the context's command buffer and
    // the worker's non-blocking Map would keep reporting "still drawing".
    context_->Flush();

    {
        std::lock_guard<std::mutex> lock(queueMutex_);
        slots_[slotIndex].timestampHns = timestampHns;
        slots_[slotIndex].state = SlotState::Pending;
        pending_.push_back(slotIndex);
    }
    queueCv_.notify_one();
    return true;
}

namespace {

// Sleeps ~0.5 ms using a high-resolution waitable timer (default Sleep granularity is ~15 ms).
class ShortSleeper {
public:
    ShortSleeper() {
        timer_ = CreateWaitableTimerExW(
            nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
    }
    ~ShortSleeper() {
        if (timer_) CloseHandle(timer_);
    }
    void sleep() {
        if (timer_) {
            LARGE_INTEGER dueTime;
            dueTime.QuadPart = -5000;  // 0.5 ms, relative
            if (SetWaitableTimer(timer_, &dueTime, 0, nullptr, nullptr, FALSE)) {
                WaitForSingleObject(timer_, 20);
                return;
            }
        }
        Sleep(1);
    }

private:
    HANDLE timer_ = nullptr;
};

}  // namespace

void MFEncoder::workerLoop() {
    for (;;) {
        size_t index = 0;
        {
            std::unique_lock<std::mutex> lock(queueMutex_);
            queueCv_.wait(lock, [this] { return !pending_.empty() || stopWorker_; });
            if (pending_.empty()) return;  // asked to stop and nothing left to write
            index = pending_.front();
            pending_.pop_front();
            workerBusy_ = true;
        }

        processSlot(index);

        {
            std::lock_guard<std::mutex> lock(queueMutex_);
            slots_[index].state = SlotState::Free;
            workerBusy_ = false;
            if (pending_.empty()) idleCv_.notify_all();
        }
    }
}

void MFEncoder::processSlot(size_t index) {
    ID3D11Texture2D* staging = slots_[index].texture.Get();
    const int64_t timestampHns = slots_[index].timestampHns;

    // Poll instead of blocking: a blocking Map would hold the (multithread-protected) context
    // lock and stall the capture thread for as long as the GPU takes to finish the copy.
    static thread_local ShortSleeper sleeper;
    D3D11_MAPPED_SUBRESOURCE mapped = {};
    HRESULT hr = S_OK;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
    for (;;) {
        hr = context_->Map(staging, 0, D3D11_MAP_READ, D3D11_MAP_FLAG_DO_NOT_WAIT, &mapped);
        if (hr != DXGI_ERROR_WAS_STILL_DRAWING) break;
        if (std::chrono::steady_clock::now() > deadline) break;
        sleeper.sleep();
    }
    if (FAILED(hr)) {
        droppedFrames_.fetch_add(1);
        return;
    }

    // Convert full-range desktop BGRA to explicitly tagged BT.709 video-range NV12.
    convertBgraToBt709LimitedNv12(
        static_cast<const uint8_t*>(mapped.pData),
        static_cast<int>(mapped.RowPitch),
        width_,
        height_,
        nv12Buffer_);
    context_->Unmap(staging, 0);

    std::lock_guard<std::mutex> lock(mutex_);
    if (!initialized_ || !sinkWriter_) return;

    // WGC may stop delivering frames while the scene is static; keep the MP4
    // timeline continuous by repeating the previous frame before writing a new one.
    int64_t normalizedTimestampHns = 0;
    normalizeWriteTimestampHnsLocked(timestampHns, normalizedTimestampHns);

    if (!lastFrameBuffer_.empty() && !extendLastFrameToLocked(normalizedTimestampHns)) {
        return;
    }

    if (writeNv12SampleLocked(nv12Buffer_, normalizedTimestampHns)) {
        // Swap rather than copy: nv12Buffer_ is fully rewritten by the next conversion.
        // The first swap hands back an empty buffer, so restore its size.
        lastFrameBuffer_.swap(nv12Buffer_);
        nv12Buffer_.resize(lastFrameBuffer_.size());
        lastSampleTimeHns_ = normalizedTimestampHns;
    }
}

void MFEncoder::drainQueue() {
    std::unique_lock<std::mutex> lock(queueMutex_);
    idleCv_.wait(lock, [this] { return pending_.empty() && !workerBusy_; });
}

void MFEncoder::stopWorker() {
    {
        std::lock_guard<std::mutex> lock(queueMutex_);
        stopWorker_ = true;
    }
    queueCv_.notify_all();
    if (worker_.joinable()) worker_.join();
}

bool MFEncoder::extendLastFrameTo(int64_t timestampHns) {
    // Frames still queued for the worker must land before the timeline is extended.
    drainQueue();

    std::lock_guard<std::mutex> lock(mutex_);

    int64_t normalizedTimestampHns = 0;
    if (!normalizeTimelineTimestampHnsLocked(timestampHns, normalizedTimestampHns)) {
        return false;
    }

    return extendLastFrameToLocked(normalizedTimestampHns);
}

void MFEncoder::normalizeWriteTimestampHnsLocked(int64_t timestampHns, int64_t& normalizedTimestampHns) {
    if (firstSampleTimeHns_ < 0) {
        firstSampleTimeHns_ = timestampHns < 0 ? 0 : timestampHns;
    }

    normalizedTimestampHns = timestampHns - firstSampleTimeHns_;
    if (normalizedTimestampHns < 0) {
        normalizedTimestampHns = 0;
    }
}

bool MFEncoder::normalizeTimelineTimestampHnsLocked(
    int64_t timestampHns,
    int64_t& normalizedTimestampHns
) const {
    if (firstSampleTimeHns_ < 0) return false;

    normalizedTimestampHns = timestampHns - firstSampleTimeHns_;
    if (normalizedTimestampHns < 0) {
        normalizedTimestampHns = 0;
    }
    return true;
}

bool MFEncoder::extendLastFrameToLocked(int64_t timestampHns) {
    if (!initialized_ || !sinkWriter_) return false;
    if (lastFrameBuffer_.empty()) return false;
    if (lastSampleTimeHns_ < 0) return false;

    if (fps_ <= 0) return false;
    const int64_t frameDurationHns = 10000000LL / fps_;
    if (frameDurationHns <= 0) return false;
    if (timestampHns <= lastSampleTimeHns_ + frameDurationHns) {
        return true;
    }

    int64_t nextSampleTimeHns = lastSampleTimeHns_ + frameDurationHns;
    while (nextSampleTimeHns + frameDurationHns <= timestampHns) {
        if (!writeNv12SampleLocked(lastFrameBuffer_, nextSampleTimeHns)) {
            return false;
        }
        lastSampleTimeHns_ = nextSampleTimeHns;
        nextSampleTimeHns += frameDurationHns;
    }

    return true;
}

bool MFEncoder::writeNv12SampleLocked(const std::vector<uint8_t>& frameBuffer, int64_t timestampHns) {
    if (frameBuffer.empty()) return false;
    if (fps_ <= 0) return false;

    const int64_t frameDurationHns = 10000000LL / fps_;
    if (frameDurationHns <= 0) return false;

    // Create MF sample
    DWORD bufferSize = static_cast<DWORD>(frameBuffer.size());
    ComPtr<IMFMediaBuffer> buffer;
    HRESULT hr = MFCreateMemoryBuffer(bufferSize, &buffer);
    if (FAILED(hr)) return false;

    BYTE* bufferData = nullptr;
    hr = buffer->Lock(&bufferData, nullptr, nullptr);
    if (FAILED(hr)) return false;

    std::memcpy(bufferData, frameBuffer.data(), bufferSize);
    buffer->Unlock();
    buffer->SetCurrentLength(bufferSize);

    ComPtr<IMFSample> sample;
    hr = MFCreateSample(&sample);
    if (FAILED(hr)) return false;

    sample->AddBuffer(buffer.Get());
    sample->SetSampleTime(timestampHns);
    sample->SetSampleDuration(frameDurationHns);

    hr = sinkWriter_->WriteSample(streamIndex_, sample.Get());
    if (FAILED(hr)) {
        std::cerr << "ERROR: WriteSample failed: 0x" << std::hex << hr << std::endl;
    }
    return SUCCEEDED(hr);
}

bool MFEncoder::finalize() {
    // Hold off any in-flight writeFrame() until teardown is done; it reads slots_ and initialized_.
    std::lock_guard<std::mutex> captureLock(captureMutex_);

    if (initialized_) {
        drainQueue();
        stopWorker();
        if (droppedFrames_.load() > 0) {
            std::cerr << "WARNING: Encoder dropped " << droppedFrames_.load()
                      << " frame(s) because encoding fell behind capture" << std::endl;
        }
    }

    std::lock_guard<std::mutex> lock(mutex_);

    if (!initialized_) return false;
    if (!sinkWriter_) return false;

    HRESULT hr = sinkWriter_->Finalize();
    if (FAILED(hr)) {
        std::cerr << "ERROR: SinkWriter Finalize failed: 0x" << std::hex << hr << std::endl;
    }

    initialized_ = false;
    sinkWriter_.Reset();
    slots_.clear();
    pending_.clear();
    resizeCompositeView_.Reset();
    resizeCompositeTexture_.Reset();
    nv12Buffer_.clear();
    lastFrameBuffer_.clear();
    nv12Buffer_.shrink_to_fit();
    lastFrameBuffer_.shrink_to_fit();
    firstSampleTimeHns_ = -1;
    lastSampleTimeHns_ = -1;
    MFShutdown();
    return SUCCEEDED(hr);
}
