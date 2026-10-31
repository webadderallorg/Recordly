#pragma once

#include <cstdint>
#include <mfapi.h>
#include <mfidl.h>
#include <vector>

inline int clampVideoSample(int value, int minimum, int maximum) {
    return value < minimum ? minimum : (value > maximum ? maximum : value);
}

inline HRESULT setBt709LimitedVideoAttributes(IMFMediaType* mediaType) {
    HRESULT result = mediaType->SetUINT32(MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709);
    if (FAILED(result)) return result;
    result = mediaType->SetUINT32(MF_MT_TRANSFER_FUNCTION, MFVideoTransFunc_709);
    if (FAILED(result)) return result;
    result = mediaType->SetUINT32(MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709);
    if (FAILED(result)) return result;
    return mediaType->SetUINT32(MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235);
}

inline void convertBgraToBt709LimitedNv12(
    const uint8_t* bgra,
    int bgraPitch,
    int width,
    int height,
    std::vector<uint8_t>& nv12Buffer) {
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            const uint8_t* pixel = bgra + y * bgraPitch + x * 4;
            const int blue = pixel[0];
            const int green = pixel[1];
            const int red = pixel[2];
            const int luma = ((47 * red + 157 * green + 16 * blue + 128) >> 8) + 16;
            nv12Buffer[y * width + x] = static_cast<uint8_t>(clampVideoSample(luma, 16, 235));
        }
    }

    uint8_t* uvPlane = nv12Buffer.data() + width * height;
    for (int y = 0; y < height; y += 2) {
        for (int x = 0; x < width; x += 2) {
            int red = 0;
            int green = 0;
            int blue = 0;
            for (int offsetY = 0; offsetY < 2; ++offsetY) {
                for (int offsetX = 0; offsetX < 2; ++offsetX) {
                    const uint8_t* pixel =
                        bgra + (y + offsetY) * bgraPitch + (x + offsetX) * 4;
                    blue += pixel[0];
                    green += pixel[1];
                    red += pixel[2];
                }
            }
            red = (red + 2) / 4;
            green = (green + 2) / 4;
            blue = (blue + 2) / 4;

            // Coefficients sum to zero so neutral greys remain neutral after quantization.
            const int chromaBlue = ((-26 * red - 87 * green + 113 * blue + 128) >> 8) + 128;
            const int chromaRed = ((112 * red - 102 * green - 10 * blue + 128) >> 8) + 128;
            const int uvIndex = (y / 2) * width + x;
            uvPlane[uvIndex] = static_cast<uint8_t>(clampVideoSample(chromaBlue, 16, 240));
            uvPlane[uvIndex + 1] = static_cast<uint8_t>(clampVideoSample(chromaRed, 16, 240));
        }
    }
}
