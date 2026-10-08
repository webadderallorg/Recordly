#pragma once

#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <d3d11.h>
#include <wrl/client.h>
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using Microsoft::WRL::ComPtr;

// Encodes captured frames to H.264/MP4 through Media Foundation.
//
// writeFrame() runs on the capture callback thread and must stay cheap: it only queues a
// GPU copy of the frame into a staging texture. A worker thread then reads the pixels back,
// converts them to NV12 and hands them to the sink writer, so a slow conversion or a busy GPU
// can no longer hold up the capture frame pool.
class MFEncoder {
public:
    MFEncoder();
    ~MFEncoder();

    bool initialize(const std::wstring& outputPath, int width, int height, int fps,
                    ID3D11Device* device, ID3D11DeviceContext* context);
    // Returns true when the frame was accepted for encoding. Returns false when it was
    // dropped (every staging slot busy) or could not be copied.
    bool writeFrame(ID3D11Texture2D* texture, int64_t timestampHns);
    bool extendLastFrameTo(int64_t timestampHns);
    bool finalize();

    int64_t droppedFrames() const { return droppedFrames_.load(); }

private:
    enum class SlotState { Free, Reserved, Pending };
    struct Slot {
        ComPtr<ID3D11Texture2D> texture;
        int64_t timestampHns = 0;
        SlotState state = SlotState::Free;
    };

    void workerLoop();
    void processSlot(size_t index);
    // Blocks until every accepted frame has been written to the sink writer.
    void drainQueue();
    void stopWorker();

    void normalizeWriteTimestampHnsLocked(int64_t timestampHns, int64_t& normalizedTimestampHns);
    bool normalizeTimelineTimestampHnsLocked(int64_t timestampHns, int64_t& normalizedTimestampHns) const;
    bool extendLastFrameToLocked(int64_t timestampHns);
    bool writeNv12SampleLocked(const std::vector<uint8_t>& frameBuffer, int64_t timestampHns);

    ComPtr<IMFSinkWriter> sinkWriter_;
    ID3D11Device* device_ = nullptr;
    ID3D11DeviceContext* context_ = nullptr;
    ComPtr<ID3D11Texture2D> resizeCompositeTexture_;
    ComPtr<ID3D11RenderTargetView> resizeCompositeView_;

    // Staging ring shared between the capture thread (copy in) and the worker (read back).
    std::vector<Slot> slots_;
    std::deque<size_t> pending_;
    std::mutex queueMutex_;
    std::condition_variable queueCv_;  // worker waits for work
    std::condition_variable idleCv_;   // drainQueue() waits for the worker to go idle
    std::mutex captureMutex_;          // serialises writeFrame() callers
    std::thread worker_;
    bool stopWorker_ = false;
    bool workerBusy_ = false;
    std::atomic<int64_t> droppedFrames_{0};

    // Written only by the worker (and by extendLastFrameTo/finalize after draining).
    std::vector<uint8_t> nv12Buffer_;
    std::vector<uint8_t> lastFrameBuffer_;
    DWORD streamIndex_ = 0;
    int width_ = 0;
    int height_ = 0;
    int fps_ = 60;
    int64_t firstSampleTimeHns_ = -1;
    int64_t lastSampleTimeHns_ = -1;
    bool initialized_ = false;
    std::mutex mutex_;  // guards sink writer state: timestamps, last frame, WriteSample
};
