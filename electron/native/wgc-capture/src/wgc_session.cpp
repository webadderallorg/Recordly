#include "wgc_session.h"

#include <windows.graphics.capture.interop.h>
#include <Windows.Graphics.Capture.h>
#include <dwmapi.h>
#include <inspectable.h>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.System.h>

#include <iostream>
#include <chrono>
#include <algorithm>
#include <cmath>

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
        std::cerr << "ERROR: D3D11CreateDevice failed: 0x" << std::hex << hr << std::endl;
        return false;
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
    framePoolWidth_ = size.Width;
    framePoolHeight_ = size.Height;

    framePool_ = winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool::CreateFreeThreaded(
        winrtDevice_,
        winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized,
        2,
        size);

    session_ = framePool_.CreateCaptureSession(captureItem_);

    session_.IsCursorCaptureEnabled(false);

    // IsBorderRequired is only available on Windows 11+ (build 22000). propagating an hresult_error results in Native Windows capture failure
    try {
        session_.IsBorderRequired(false);
    } catch (winrt::hresult_error const&) {
    }

    return true;
}

bool WgcSession::recreateFramePoolIfNeeded(
    winrt::Windows::Graphics::SizeInt32 const& contentSize) {
    if (!framePool_) return false;

    const int normalizedWidth = normalizeFramePoolExtent(contentSize.Width);
    const int normalizedHeight = normalizeFramePoolExtent(contentSize.Height);
    if (normalizedWidth == framePoolWidth_ && normalizedHeight == framePoolHeight_) {
        return false;
    }

    winrt::Windows::Graphics::SizeInt32 normalizedSize{
        normalizedWidth,
        normalizedHeight,
    };

    try {
        framePool_.Recreate(
            winrtDevice_,
            winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
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

    return true;
}

bool WgcSession::initialize(HMONITOR monitor, int fps) {
    fps_ = fps;
    frameIntervalHns_ = 10000000LL / fps_;

    if (!createD3DDevice()) return false;

    winrtDevice_ = createWinRTDevice();
    if (!winrtDevice_) {
        std::cerr << "ERROR: Failed to create WinRT D3D device" << std::endl;
        return false;
    }

    captureItem_ = createCaptureItemForMonitor(monitor);
    return initializeWithItem(fps);
}

bool WgcSession::initialize(HWND hwnd, int fps) {
    fps_ = fps;
    frameIntervalHns_ = 10000000LL / fps_;

    if (!createD3DDevice()) return false;

    winrtDevice_ = createWinRTDevice();
    if (!winrtDevice_) {
        std::cerr << "ERROR: Failed to create WinRT D3D device" << std::endl;
        return false;
    }

    HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    if (!monitor) return false;

    captureItem_ = createCaptureItemForMonitor(monitor);
    return initializeWithItem(fps) && initializeWindowCrop(hwnd);
}

bool WgcSession::initializeWindowCrop(HWND hwnd) {
    windowHandle_ = hwnd;
    MONITORINFO monitorInfo{};
    monitorInfo.cbSize = sizeof(monitorInfo);
    if (!GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &monitorInfo)) return false;
    monitorBounds_ = monitorInfo.rcMonitor;

    return updateWindowCropRect(true);
}

bool WgcSession::updateWindowCropRect(bool initializeSize) {
    RECT windowBounds{};
    if (FAILED(DwmGetWindowAttribute(windowHandle_, DWMWA_EXTENDED_FRAME_BOUNDS, &windowBounds, sizeof(windowBounds))) &&
        !GetWindowRect(windowHandle_, &windowBounds)) return false;
    RECT clipped{};
    if (!IntersectRect(&clipped, &windowBounds, &monitorBounds_)) return false;

    const LONG monitorWidth = monitorBounds_.right - monitorBounds_.left;
    const LONG monitorHeight = monitorBounds_.bottom - monitorBounds_.top;
    if (monitorWidth <= 0 || monitorHeight <= 0 || framePoolWidth_ < 2 || framePoolHeight_ < 2) return false;

    // WGC textures are in capture-surface pixels, while Win32 monitor/window
    // rectangles can be DPI-virtualized. Map both edges into texture space
    // instead of assuming those coordinate systems are identical.
    const auto mapX = [this, monitorWidth](LONG desktopX) {
        const double normalized = static_cast<double>(desktopX - monitorBounds_.left) /
            static_cast<double>(monitorWidth);
        return std::clamp(
            static_cast<LONG>(std::llround(normalized * framePoolWidth_)),
            0L,
            static_cast<LONG>(framePoolWidth_));
    };
    const auto mapY = [this, monitorHeight](LONG desktopY) {
        const double normalized = static_cast<double>(desktopY - monitorBounds_.top) /
            static_cast<double>(monitorHeight);
        return std::clamp(
            static_cast<LONG>(std::llround(normalized * framePoolHeight_)),
            0L,
            static_cast<LONG>(framePoolHeight_));
    };

    LONG left = mapX(clipped.left);
    LONG top = mapY(clipped.top);
    LONG right = mapX(clipped.right);
    LONG bottom = mapY(clipped.bottom);
    const LONG mappedWidth = (right - left) & ~1L;
    const LONG mappedHeight = (bottom - top) & ~1L;
    if (mappedWidth < 2 || mappedHeight < 2) return false;

    if (initializeSize) {
        captureWidth_ = static_cast<int>(mappedWidth);
        captureHeight_ = static_cast<int>(mappedHeight);

        D3D11_TEXTURE2D_DESC desc{};
        desc.Width = static_cast<UINT>(captureWidth_);
        desc.Height = static_cast<UINT>(captureHeight_);
        desc.MipLevels = 1;
        desc.ArraySize = 1;
        desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
        desc.SampleDesc.Count = 1;
        desc.Usage = D3D11_USAGE_DEFAULT;
        desc.BindFlags = D3D11_BIND_RENDER_TARGET;

        ComPtr<ID3D11Texture2D> resizedTexture;
        if (FAILED(d3dDevice_->CreateTexture2D(&desc, nullptr, &resizedTexture))) return false;
        ComPtr<ID3D11RenderTargetView> renderTargetView;
        if (FAILED(d3dDevice_->CreateRenderTargetView(resizedTexture.Get(), nullptr, &renderTargetView))) return false;
        cropTexture_ = resizedTexture;
        cropRenderTargetView_ = renderTargetView;
    }

    if (!cropTexture_ || !cropRenderTargetView_) return false;

    // The encoder's dimensions are fixed for the lifetime of the MP4. Keep the
    // crop texture fixed too: reallocating it after a resize made the encoder
    // pad the changed frame with black bars. If the selected window shrinks,
    // copy only its current area so the crop never exposes nearby desktop pixels.
    const LONG copyWidth = (std::min)(mappedWidth, static_cast<LONG>(captureWidth_));
    const LONG copyHeight = (std::min)(mappedHeight, static_cast<LONG>(captureHeight_));
    left = std::clamp(left, 0L, static_cast<LONG>(framePoolWidth_) - copyWidth);
    top = std::clamp(top, 0L, static_cast<LONG>(framePoolHeight_) - copyHeight);
    cropRect_ = {left, top, left + copyWidth, top + copyHeight};
    return true;
}

void WgcSession::setFrameCallback(FrameCallback callback) {
    frameCallback_ = std::move(callback);
}

bool WgcSession::startCapture() {
    if (!session_ || !framePool_) return false;

    capturing_ = true;
    fatalError_ = false;
    lastFrameTimeHns_ = 0;

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

    frameArrivedRevoker_.revoke();

    if (session_) {
        session_.Close();
        session_ = nullptr;
    }
    if (framePool_) {
        framePool_.Close();
        framePool_ = nullptr;
    }
    cropTexture_.Reset();
    cropRenderTargetView_.Reset();
}

void WgcSession::onFrameArrived(
    winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool const& sender,
    winrt::Windows::Foundation::IInspectable const&) {

    if (!capturing_ || fatalError_) return;

    auto frame = sender.TryGetNextFrame();
    if (!frame) return;
    auto contentSize = frame.ContentSize();
    if (recreateFramePoolIfNeeded(contentSize)) {
        frame.Close();
        return;
    }

    auto timestamp = frame.SystemRelativeTime();
    int64_t frameTimeHns = std::chrono::duration_cast<std::chrono::duration<int64_t, std::ratio<1, 10000000>>>(timestamp).count();

    // Frame rate limiting: skip frames that arrive too soon
    if (lastFrameTimeHns_ > 0 && (frameTimeHns - lastFrameTimeHns_) < (frameIntervalHns_ * 7 / 10)) {
        frame.Close();
        return;
    }
    lastFrameTimeHns_ = frameTimeHns;

    auto surface = frame.Surface();

    // Get the underlying D3D texture from the WinRT surface via COM interop
    winrt::com_ptr<IDirect3DDxgiInterfaceAccess> access;
    try {
        access = surface.as<IDirect3DDxgiInterfaceAccess>();
    } catch (...) {
        frame.Close();
        return;
    }
    ComPtr<ID3D11Texture2D> texture;
    HRESULT hr = access->GetInterface(IID_PPV_ARGS(&texture));

    if (SUCCEEDED(hr) && texture && frameCallback_) {
        if (windowHandle_ && cropTexture_ && updateWindowCropRect()) {
            constexpr float clearColor[4] = {0.0f, 0.0f, 0.0f, 1.0f};
            d3dContext_->ClearRenderTargetView(cropRenderTargetView_.Get(), clearColor);
            D3D11_BOX sourceBox{
                static_cast<UINT>(cropRect_.left), static_cast<UINT>(cropRect_.top), 0,
                static_cast<UINT>(cropRect_.right), static_cast<UINT>(cropRect_.bottom), 1,
            };
            d3dContext_->CopySubresourceRegion(cropTexture_.Get(), 0, 0, 0, 0, texture.Get(), 0, &sourceBox);
            frameCallback_(cropTexture_.Get(), frameTimeHns);
        } else if (!windowHandle_) {
            frameCallback_(texture.Get(), frameTimeHns);
        }
    }

    frame.Close();
}
