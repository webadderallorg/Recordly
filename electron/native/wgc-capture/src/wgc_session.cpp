#include "wgc_session.h"

#include <windows.graphics.capture.interop.h>
#include <Windows.Graphics.Capture.h>
#include <d3d11_4.h>
#include <inspectable.h>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.System.h>

#include <iostream>
#include <chrono>

// IDirect3DDxgiInterfaceAccess is a COM interface for getting the DXGI interface
// from a WinRT IDirect3DSurface
MIDL_INTERFACE("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1")
IDirect3DDxgiInterfaceAccess : public IUnknown {
    virtual HRESULT STDMETHODCALLTYPE GetInterface(REFIID iid, void** p) = 0;
};

// Convert ID3D11Device → IDirect3DDevice (WinRT interop)
extern "C" {
    HRESULT __stdcall CreateDirect3D11DeviceFromDXGIDevice(
        IDXGIDevice* dxgiDevice,
        IInspectable** graphicsDevice);
}

static int normalizeFramePoolExtent(int value) {
    int normalized = value < 2 ? 2 : value;
    if ((normalized % 2) != 0) ++normalized;
    return normalized;
}

// Frames the pool can hold while the consumer is busy; 2 starves easily at high frame rates.
static constexpr int kFramePoolBuffers = 4;

WgcSession::WgcSession() {}

WgcSession::~WgcSession() {
    stopCapture();
}

bool WgcSession::createD3DDevice() {
    D3D_FEATURE_LEVEL featureLevels[] = {
        D3D_FEATURE_LEVEL_11_1,
        D3D_FEATURE_LEVEL_11_0,
    };

    HRESULT hr = D3D11CreateDevice(
        nullptr,
        D3D_DRIVER_TYPE_HARDWARE,
        nullptr,
        D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        featureLevels,
        ARRAYSIZE(featureLevels),
        D3D11_SDK_VERSION,
        &d3dDevice_,
        nullptr,
        &d3dContext_);

    if (FAILED(hr)) {
        std::cerr << "ERROR: D3D11CreateDevice failed: 0x" << std::hex << hr << std::dec << std::endl;
        return false;
    }

    // The capture callback and the encoder's readback worker share this immediate context.
    ComPtr<ID3D11Multithread> multithread;
    hr = d3dContext_.As(&multithread);
    if (FAILED(hr) || !multithread) {
        std::cerr << "ERROR: Failed to query ID3D11Multithread: 0x" << std::hex << hr << std::dec << std::endl;
        return false;
    }
    multithread->SetMultithreadProtected(TRUE);

    // Report which GPU performs the capture; on hybrid laptops this matters for performance.
    ComPtr<IDXGIDevice> dxgiDevice;
    ComPtr<IDXGIAdapter> adapter;
    DXGI_ADAPTER_DESC adapterDesc{};
    if (SUCCEEDED(d3dDevice_.As(&dxgiDevice)) && SUCCEEDED(dxgiDevice->GetAdapter(&adapter)) &&
        SUCCEEDED(adapter->GetDesc(&adapterDesc))) {
        char name[256]{};
        WideCharToMultiByte(CP_UTF8, 0, adapterDesc.Description, -1, name, sizeof(name) - 1, nullptr, nullptr);
        std::cerr << "Capture adapter: " << name << std::endl;
    }

    return true;
}

winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice WgcSession::createWinRTDevice() {
    ComPtr<IDXGIDevice> dxgiDevice;
    HRESULT hr = d3dDevice_.As(&dxgiDevice);
    if (FAILED(hr)) return nullptr;

    winrt::com_ptr<IInspectable> inspectable;
    hr = CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.Get(), inspectable.put());
    if (FAILED(hr)) return nullptr;

    return inspectable.as<winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice>();
}

winrt::Windows::Graphics::Capture::GraphicsCaptureItem WgcSession::createCaptureItemForMonitor(HMONITOR monitor) {
    auto factory = winrt::get_activation_factory<
        winrt::Windows::Graphics::Capture::GraphicsCaptureItem>();

    auto interop = factory.as<IGraphicsCaptureItemInterop>();

    winrt::Windows::Graphics::Capture::GraphicsCaptureItem item{nullptr};
    HRESULT hr = interop->CreateForMonitor(
        monitor,
        winrt::guid_of<ABI::Windows::Graphics::Capture::IGraphicsCaptureItem>(),
        winrt::put_abi(item));

    if (FAILED(hr)) {
        std::cerr << "ERROR: CreateForMonitor failed: 0x" << std::hex << hr << std::endl;
        return nullptr;
    }

    return item;
}

bool WgcSession::initializeWithItem(int fps) {
    if (!captureItem_) return false;

    auto size = captureItem_.Size();
    captureWidth_ = size.Width;
    captureHeight_ = size.Height;
    framePoolWidth_ = normalizeFramePoolExtent(size.Width);
    framePoolHeight_ = normalizeFramePoolExtent(size.Height);

    framePool_ = winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool::CreateFreeThreaded(
        winrtDevice_,
        winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized,
        kFramePoolBuffers,
        {framePoolWidth_, framePoolHeight_});

    session_ = framePool_.CreateCaptureSession(captureItem_);

    session_.IsCursorCaptureEnabled(false);

    // Windows 11 24H2 can composite qualifying popups inside the captured window's bounds.
    // The SDK guard preserves older builds, and QueryInterface handles older Windows runtimes.
#if defined(____x_ABI_CWindows_CGraphics_CCapture_CIGraphicsCaptureSession6_INTERFACE_DEFINED__)
    if (windowHandle_) {
        if (auto secondaryWindows = session_.try_as<
                winrt::Windows::Graphics::Capture::IGraphicsCaptureSession6>()) {
            try {
                secondaryWindows.IncludeSecondaryWindows(true);
            } catch (winrt::hresult_error const& e) {
                std::cerr << "WARNING: Could not include secondary windows: 0x"
                          << std::hex << e.code() << std::dec << std::endl;
            }
        }
    }
#endif

    // IsBorderRequired is only available on Windows 11+ (build 22000). propagating an hresult_error results in Native Windows capture failure
    try {
        session_.IsBorderRequired(false);
    } catch (winrt::hresult_error const&) {
    }

    return true;
}

void WgcSession::recreateFramePoolIfNeeded(
    winrt::Windows::Graphics::SizeInt32 const& contentSize) {
    if (!capturing_ || !framePool_) return;

    const int normalizedWidth = normalizeFramePoolExtent(contentSize.Width);
    const int normalizedHeight = normalizeFramePoolExtent(contentSize.Height);
    if (normalizedWidth == framePoolWidth_ && normalizedHeight == framePoolHeight_) {
        return;
    }

    winrt::Windows::Graphics::SizeInt32 normalizedSize{
        normalizedWidth,
        normalizedHeight,
    };

    try {
        framePool_.Recreate(
            winrtDevice_,
            winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized,
            kFramePoolBuffers,
            normalizedSize);
        framePoolWidth_ = normalizedWidth;
        framePoolHeight_ = normalizedHeight;
        std::cerr << "INFO: Recreated WGC frame pool for resized content "
                  << framePoolWidth_ << "x" << framePoolHeight_ << std::endl;
    } catch (winrt::hresult_error const& e) {
        fatalError_ = true;
        capturing_ = false;
        std::cerr << "ERROR: Failed to recreate WGC frame pool after resize: 0x"
                  << std::hex << e.code() << std::dec << std::endl;
    }

}

bool WgcSession::initialize(HMONITOR monitor, int fps) {
    fps_ = fps > 0 ? fps : 60;
    frameIntervalHns_ = 10000000LL / fps_;

    if (!createD3DDevice()) return false;

    winrtDevice_ = createWinRTDevice();
    if (!winrtDevice_) {
        std::cerr << "ERROR: Failed to create WinRT D3D device" << std::endl;
        return false;
    }

    captureItem_ = createCaptureItemForMonitor(monitor);
    return initializeWithItem(fps_);
}

bool WgcSession::initialize(HWND hwnd, int fps) {
    fps_ = fps > 0 ? fps : 60;
    frameIntervalHns_ = 10000000LL / fps_;

    if (!createD3DDevice()) return false;

    winrtDevice_ = createWinRTDevice();
    if (!winrtDevice_) {
        std::cerr << "ERROR: Failed to create WinRT D3D device" << std::endl;
        return false;
    }

    auto factory = winrt::get_activation_factory<
        winrt::Windows::Graphics::Capture::GraphicsCaptureItem>();
    auto interop = factory.as<IGraphicsCaptureItemInterop>();
    const HRESULT result = interop->CreateForWindow(
        hwnd,
        winrt::guid_of<ABI::Windows::Graphics::Capture::IGraphicsCaptureItem>(),
        winrt::put_abi(captureItem_));
    if (FAILED(result)) {
        std::cerr << "ERROR: CreateForWindow failed: 0x" << std::hex << result << std::dec << std::endl;
        return false;
    }
    windowHandle_ = hwnd;
    return initializeWithItem(fps_);
}

void WgcSession::setFrameCallback(FrameCallback callback, std::function<bool()> isPaused) {
    frameCallback_ = std::move(callback);
    isPaused_ = std::move(isPaused);
}

bool WgcSession::startCapture() {
    if (!session_ || !framePool_) return false;

    capturing_ = true;
    fatalError_ = false;
    nextFrameDueHns_ = 0;
    hasNextFrameDue_ = false;

    if (windowHandle_) {
        itemClosedRevoker_ = captureItem_.Closed(
            winrt::auto_revoke,
            [this](auto const&, auto const&) { fatalError_ = true; });
    }
    frameArrivedRevoker_ = framePool_.FrameArrived(
        winrt::auto_revoke,
        [this](auto const& sender, auto const& args) {
            onFrameArrived(sender, args);
        });

    session_.StartCapture();
    return true;
}

void WgcSession::stopCapture() {
    capturing_ = false;

    itemClosedRevoker_.revoke();
    frameArrivedRevoker_.revoke();

    // Wait for the active reader, then release the lock before WinRT closes the frame pool.
    {
        std::lock_guard<std::mutex> lock(frameDeliveryMutex_);
    }
    if (session_) {
        session_.Close();
        session_ = nullptr;
    }
    if (framePool_) {
        framePool_.Close();
        framePool_ = nullptr;
    }
}

void WgcSession::onFrameArrived(
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool const& sender,
    winrt::Windows::Foundation::IInspectable const&) {
    if (!capturing_) return;
    std::lock_guard<std::mutex> lock(frameDeliveryMutex_);
    const bool cachePausedWindowFrame = windowHandle_ && isPaused_ && isPaused_();
    readFrame(sender, cachePausedWindowFrame);
}

void WgcSession::resumeAfterPendingFrames(int64_t resumeTimestampHns, const std::function<void()>& resume) {
    std::lock_guard<std::mutex> lock(frameDeliveryMutex_);
    if (windowHandle_) {
        // Let any callback already in flight finish and drain the frames already queued
        // by WGC before switching the timestamp and frame writer back to recording.
        for (int count = 0; count < kFramePoolBuffers; ++count) {
            if (!readFrame(framePool_, true)) break;
        }
    }
    nextFrameDueHns_ = 0;
    hasNextFrameDue_ = false;
    resumeTimestampHns_ = resumeTimestampHns;
    resume();
}

bool WgcSession::readFrame(
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool const& pool,
    bool skipFrameRateLimit) {
    if (!capturing_ || fatalError_) return false;

    auto frame = pool.TryGetNextFrame();
    if (!frame) return false;
    const auto contentSize = frame.ContentSize();

    auto timestamp = frame.SystemRelativeTime();
    int64_t frameTimeHns = std::chrono::duration_cast<std::chrono::duration<int64_t, std::ratio<1, 10000000>>>(timestamp).count();

    if (frameTimeHns < resumeTimestampHns_) {
        frame.Close();
        recreateFramePoolIfNeeded(contentSize);
        return true;
    }

    // Paused window frames replace the cached image instead of reaching the encoder.
    if (!skipFrameRateLimit) {
        // Frame rate limiting against a fixed schedule. The display can refresh much faster than
        // the recording rate (e.g. 165 Hz); a plain "minimum gap" test would let through every
        // second refresh (~82 fps) and make the encoder do far more work than requested.
        if (!hasNextFrameDue_) {
            nextFrameDueHns_ = frameTimeHns;
            hasNextFrameDue_ = true;
        }
        if (frameTimeHns + frameIntervalHns_ / 2 < nextFrameDueHns_) {
            frame.Close();
            recreateFramePoolIfNeeded(contentSize);
            return true;
        }
        nextFrameDueHns_ += frameIntervalHns_;
        // After a pause or an idle screen the schedule is stale; restart it from this frame.
        if (nextFrameDueHns_ < frameTimeHns) nextFrameDueHns_ = frameTimeHns + frameIntervalHns_;
    }

    if (auto access = frame.Surface().try_as<IDirect3DDxgiInterfaceAccess>()) {
        ComPtr<ID3D11Texture2D> texture;
        const HRESULT result = access->GetInterface(IID_PPV_ARGS(&texture));
        if (SUCCEEDED(result) && texture && frameCallback_) {
            frameCallback_(texture.Get(), contentSize.Width, contentSize.Height, frameTimeHns);
        }
    }

    frame.Close();
    recreateFramePoolIfNeeded(contentSize);
    return true;
}
