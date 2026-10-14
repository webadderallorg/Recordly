#pragma once

#include <cstdint>
#include <mfapi.h>
#include <mfidl.h>
#include <vector>

#if defined(_M_X64) || defined(_M_IX86) || defined(__x86_64__) || defined(__i386__)
#include <emmintrin.h>
#include <immintrin.h>
#define BT709_VIDEO_HAS_SSE2 1
#endif

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

// Reference implementation. The vectorised path below must stay byte-identical to it.
// Pixels [startX, endX) of every row (luma) and every 2x2 block (chroma) are converted,
// so the vectorised path can hand it the unaligned remainder of each row.
inline void convertBgraToBt709LimitedNv12Scalar(
    const uint8_t* bgra,
    int bgraPitch,
    int width,
    int height,
    std::vector<uint8_t>& nv12Buffer,
    int startX = 0,
    int startY = 0,
    int endY = -1) {
    if (endY < 0) endY = height;

    for (int y = startY; y < endY; ++y) {
        for (int x = startX; x < width; ++x) {
            const uint8_t* pixel = bgra + y * bgraPitch + x * 4;
            const int blue = pixel[0];
            const int green = pixel[1];
            const int red = pixel[2];
            const int luma = ((47 * red + 157 * green + 16 * blue + 128) >> 8) + 16;
            nv12Buffer[y * width + x] = static_cast<uint8_t>(clampVideoSample(luma, 16, 235));
        }
    }

    uint8_t* uvPlane = nv12Buffer.data() + width * height;
    for (int y = startY & ~1; y < endY; y += 2) {
        for (int x = startX & ~1; x < width; x += 2) {
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

#ifdef BT709_VIDEO_HAS_SSE2

// Luma of four BGRA pixels, one 32-bit lane each.
inline __m128i bt709Luma4(__m128i pixels, __m128i zero, __m128i coefficients) {
    // madd gives {16*B + 157*G, 47*R} per pixel; adding the two halves finishes the dot product.
    __m128i lo = _mm_madd_epi16(_mm_unpacklo_epi8(pixels, zero), coefficients);
    __m128i hi = _mm_madd_epi16(_mm_unpackhi_epi8(pixels, zero), coefficients);
    lo = _mm_add_epi32(lo, _mm_srli_epi64(lo, 32));
    hi = _mm_add_epi32(hi, _mm_srli_epi64(hi, 32));
    return _mm_castps_si128(
        _mm_shuffle_ps(_mm_castsi128_ps(lo), _mm_castsi128_ps(hi), _MM_SHUFFLE(2, 0, 2, 0)));
}

// Sums each 2x2 block of BGRA pixels for two blocks (pixels 0-1 and 2-3 of both rows),
// returned as 16-bit {B,G,R,A} for block 0 followed by block 1.
inline __m128i bt709BlockSums2(__m128i row0, __m128i row1, __m128i zero) {
    __m128i lo0 = _mm_unpacklo_epi8(row0, zero);
    __m128i lo1 = _mm_unpacklo_epi8(row1, zero);
    __m128i hi0 = _mm_unpackhi_epi8(row0, zero);
    __m128i hi1 = _mm_unpackhi_epi8(row1, zero);
    lo0 = _mm_add_epi16(lo0, _mm_srli_si128(lo0, 8));
    lo1 = _mm_add_epi16(lo1, _mm_srli_si128(lo1, 8));
    hi0 = _mm_add_epi16(hi0, _mm_srli_si128(hi0, 8));
    hi1 = _mm_add_epi16(hi1, _mm_srli_si128(hi1, 8));
    return _mm_unpacklo_epi64(_mm_add_epi16(lo0, lo1), _mm_add_epi16(hi0, hi1));
}

// {U0,V0,U1,V1} (unclamped, 32-bit lanes) for the two blocks in `sums`.
inline __m128i bt709Chroma2(__m128i sums, __m128i two, __m128i coeffU, __m128i coeffV, __m128i c128) {
    const __m128i average = _mm_srli_epi16(_mm_add_epi16(sums, two), 2);
    __m128i u = _mm_madd_epi16(average, coeffU);
    __m128i v = _mm_madd_epi16(average, coeffV);
    u = _mm_add_epi32(u, _mm_srli_epi64(u, 32));
    v = _mm_add_epi32(v, _mm_srli_epi64(v, 32));
    const __m128i uvLanes = _mm_castps_si128(
        _mm_shuffle_ps(_mm_castsi128_ps(u), _mm_castsi128_ps(v), _MM_SHUFFLE(2, 0, 2, 0)));
    const __m128i ordered = _mm_shuffle_epi32(uvLanes, _MM_SHUFFLE(3, 1, 2, 0));
    return _mm_add_epi32(_mm_srai_epi32(_mm_add_epi32(ordered, c128), 8), c128);
}

// Converts columns [xBegin, width) of every row; xBegin must be a multiple of 16.
inline void convertBgraToBt709LimitedNv12Sse2From(
    const uint8_t* bgra,
    int bgraPitch,
    int width,
    int height,
    std::vector<uint8_t>& nv12Buffer,
    int xBegin) {
    constexpr int kPixelsPerStep = 16;
    const int vectorWidth = width & ~(kPixelsPerStep - 1);

    const __m128i zero = _mm_setzero_si128();
    const __m128i lumaCoefficients = _mm_set_epi16(0, 47, 157, 16, 0, 47, 157, 16);
    const __m128i c128 = _mm_set1_epi32(128);
    const __m128i c16 = _mm_set1_epi32(16);

    uint8_t* const yPlane = nv12Buffer.data();
    uint8_t* const uvPlane = nv12Buffer.data() + static_cast<size_t>(width) * height;
    const __m128i two = _mm_set1_epi16(2);
    const __m128i coeffU = _mm_set_epi16(0, -26, -87, 113, 0, -26, -87, 113);
    const __m128i coeffV = _mm_set_epi16(0, 112, -102, -10, 0, 112, -102, -10);
    const __m128i min16 = _mm_set1_epi16(16);
    const __m128i max240 = _mm_set1_epi16(240);

    // One pass over each pair of rows: both rows' luma and their shared chroma, so every
    // source pixel is read from memory once.
    for (int y = 0; y + 1 < height; y += 2) {
        const uint8_t* row0 = bgra + static_cast<size_t>(y) * bgraPitch;
        const uint8_t* row1 = row0 + bgraPitch;
        uint8_t* dstY0 = yPlane + static_cast<size_t>(y) * width;
        uint8_t* dstY1 = dstY0 + width;
        uint8_t* dstUv = uvPlane + static_cast<size_t>(y / 2) * width;
        for (int x = xBegin; x < vectorWidth; x += kPixelsPerStep) {
            const __m128i* src0 = reinterpret_cast<const __m128i*>(row0 + x * 4);
            const __m128i* src1 = reinterpret_cast<const __m128i*>(row1 + x * 4);
            __m128i p0[4];
            __m128i p1[4];
            for (int i = 0; i < 4; ++i) {
                p0[i] = _mm_loadu_si128(src0 + i);
                p1[i] = _mm_loadu_si128(src1 + i);
            }

            __m128i l0[4];
            __m128i l1[4];
            for (int i = 0; i < 4; ++i) {
                const __m128i s0 = bt709Luma4(p0[i], zero, lumaCoefficients);
                const __m128i s1 = bt709Luma4(p1[i], zero, lumaCoefficients);
                l0[i] = _mm_add_epi32(_mm_srli_epi32(_mm_add_epi32(s0, c128), 8), c16);
                l1[i] = _mm_add_epi32(_mm_srli_epi32(_mm_add_epi32(s1, c128), 8), c16);
            }
            // Luma stays within 16..235 by construction, so no clamp is needed.
            _mm_storeu_si128(
                reinterpret_cast<__m128i*>(dstY0 + x),
                _mm_packus_epi16(_mm_packs_epi32(l0[0], l0[1]), _mm_packs_epi32(l0[2], l0[3])));
            _mm_storeu_si128(
                reinterpret_cast<__m128i*>(dstY1 + x),
                _mm_packus_epi16(_mm_packs_epi32(l1[0], l1[1]), _mm_packs_epi32(l1[2], l1[3])));

            __m128i g[4];
            for (int i = 0; i < 4; ++i) {
                g[i] = bt709Chroma2(bt709BlockSums2(p0[i], p1[i], zero), two, coeffU, coeffV, c128);
            }
            __m128i lo = _mm_packs_epi32(g[0], g[1]);
            __m128i hi = _mm_packs_epi32(g[2], g[3]);
            lo = _mm_max_epi16(_mm_min_epi16(lo, max240), min16);
            hi = _mm_max_epi16(_mm_min_epi16(hi, max240), min16);
            _mm_storeu_si128(reinterpret_cast<__m128i*>(dstUv + x), _mm_packus_epi16(lo, hi));
        }
    }

    if (vectorWidth < width) {
        // Remainder columns (width not a multiple of 16) go through the reference path.
        convertBgraToBt709LimitedNv12Scalar(bgra, bgraPitch, width, height, nv12Buffer, vectorWidth);
    }
}

inline void convertBgraToBt709LimitedNv12Sse2(
    const uint8_t* bgra,
    int bgraPitch,
    int width,
    int height,
    std::vector<uint8_t>& nv12Buffer) {
    convertBgraToBt709LimitedNv12Sse2From(bgra, bgraPitch, width, height, nv12Buffer, 0);
}

// ---- AVX2: the same arithmetic on 32 pixels per step --------------------------------
// 256-bit unpack/pack work per 128-bit lane, so results land in a lane-interleaved order;
// `restoreOrder` puts the dwords back in pixel order.

inline __m256i bt709Luma8(__m256i pixels, __m256i zero, __m256i coefficients) {
    __m256i lo = _mm256_madd_epi16(_mm256_unpacklo_epi8(pixels, zero), coefficients);
    __m256i hi = _mm256_madd_epi16(_mm256_unpackhi_epi8(pixels, zero), coefficients);
    lo = _mm256_add_epi32(lo, _mm256_srli_epi64(lo, 32));
    hi = _mm256_add_epi32(hi, _mm256_srli_epi64(hi, 32));
    return _mm256_castps_si256(_mm256_shuffle_ps(
        _mm256_castsi256_ps(lo), _mm256_castsi256_ps(hi), _MM_SHUFFLE(2, 0, 2, 0)));
}

// Four 2x2 block sums (16-bit {B,G,R,A} each), in pixel order across both lanes.
inline __m256i bt709BlockSums4(__m256i row0, __m256i row1, __m256i zero) {
    __m256i lo0 = _mm256_unpacklo_epi8(row0, zero);
    __m256i lo1 = _mm256_unpacklo_epi8(row1, zero);
    __m256i hi0 = _mm256_unpackhi_epi8(row0, zero);
    __m256i hi1 = _mm256_unpackhi_epi8(row1, zero);
    lo0 = _mm256_add_epi16(lo0, _mm256_srli_si256(lo0, 8));
    lo1 = _mm256_add_epi16(lo1, _mm256_srli_si256(lo1, 8));
    hi0 = _mm256_add_epi16(hi0, _mm256_srli_si256(hi0, 8));
    hi1 = _mm256_add_epi16(hi1, _mm256_srli_si256(hi1, 8));
    return _mm256_unpacklo_epi64(_mm256_add_epi16(lo0, lo1), _mm256_add_epi16(hi0, hi1));
}

inline __m256i bt709Chroma4(
    __m256i sums, __m256i two, __m256i coeffU, __m256i coeffV, __m256i c128) {
    const __m256i average = _mm256_srli_epi16(_mm256_add_epi16(sums, two), 2);
    __m256i u = _mm256_madd_epi16(average, coeffU);
    __m256i v = _mm256_madd_epi16(average, coeffV);
    u = _mm256_add_epi32(u, _mm256_srli_epi64(u, 32));
    v = _mm256_add_epi32(v, _mm256_srli_epi64(v, 32));
    const __m256i uvLanes = _mm256_castps_si256(_mm256_shuffle_ps(
        _mm256_castsi256_ps(u), _mm256_castsi256_ps(v), _MM_SHUFFLE(2, 0, 2, 0)));
    const __m256i ordered = _mm256_shuffle_epi32(uvLanes, _MM_SHUFFLE(3, 1, 2, 0));
    return _mm256_add_epi32(_mm256_srai_epi32(_mm256_add_epi32(ordered, c128), 8), c128);
}

inline void convertBgraToBt709LimitedNv12Avx2(
    const uint8_t* bgra,
    int bgraPitch,
    int width,
    int height,
    std::vector<uint8_t>& nv12Buffer) {
    constexpr int kPixelsPerStep = 32;
    const int vectorWidth = width & ~(kPixelsPerStep - 1);

    const __m256i zero = _mm256_setzero_si256();
    const __m256i lumaCoefficients =
        _mm256_set_epi16(0, 47, 157, 16, 0, 47, 157, 16, 0, 47, 157, 16, 0, 47, 157, 16);
    const __m256i c128 = _mm256_set1_epi32(128);
    const __m256i c16 = _mm256_set1_epi32(16);
    const __m256i restoreOrder = _mm256_setr_epi32(0, 4, 1, 5, 2, 6, 3, 7);

    uint8_t* const yPlane = nv12Buffer.data();
    uint8_t* const uvPlane = nv12Buffer.data() + static_cast<size_t>(width) * height;
    const __m256i two = _mm256_set1_epi16(2);
    const __m256i coeffU =
        _mm256_set_epi16(0, -26, -87, 113, 0, -26, -87, 113, 0, -26, -87, 113, 0, -26, -87, 113);
    const __m256i coeffV =
        _mm256_set_epi16(0, 112, -102, -10, 0, 112, -102, -10, 0, 112, -102, -10, 0, 112, -102, -10);
    const __m256i min16 = _mm256_set1_epi16(16);
    const __m256i max240 = _mm256_set1_epi16(240);

    // One pass over each pair of rows: both rows' luma and their shared chroma, so every
    // source pixel is read from memory once.
    for (int y = 0; y + 1 < height; y += 2) {
        const uint8_t* row0 = bgra + static_cast<size_t>(y) * bgraPitch;
        const uint8_t* row1 = row0 + bgraPitch;
        uint8_t* dstY0 = yPlane + static_cast<size_t>(y) * width;
        uint8_t* dstY1 = dstY0 + width;
        uint8_t* dstUv = uvPlane + static_cast<size_t>(y / 2) * width;
        for (int x = 0; x < vectorWidth; x += kPixelsPerStep) {
            const __m256i* src0 = reinterpret_cast<const __m256i*>(row0 + x * 4);
            const __m256i* src1 = reinterpret_cast<const __m256i*>(row1 + x * 4);
            __m256i p0[4];
            __m256i p1[4];
            for (int i = 0; i < 4; ++i) {
                p0[i] = _mm256_loadu_si256(src0 + i);
                p1[i] = _mm256_loadu_si256(src1 + i);
            }

            __m256i l0[4];
            __m256i l1[4];
            for (int i = 0; i < 4; ++i) {
                const __m256i s0 = bt709Luma8(p0[i], zero, lumaCoefficients);
                const __m256i s1 = bt709Luma8(p1[i], zero, lumaCoefficients);
                l0[i] = _mm256_add_epi32(_mm256_srli_epi32(_mm256_add_epi32(s0, c128), 8), c16);
                l1[i] = _mm256_add_epi32(_mm256_srli_epi32(_mm256_add_epi32(s1, c128), 8), c16);
            }
            _mm256_storeu_si256(
                reinterpret_cast<__m256i*>(dstY0 + x),
                _mm256_permutevar8x32_epi32(
                    _mm256_packus_epi16(
                        _mm256_packs_epi32(l0[0], l0[1]), _mm256_packs_epi32(l0[2], l0[3])),
                    restoreOrder));
            _mm256_storeu_si256(
                reinterpret_cast<__m256i*>(dstY1 + x),
                _mm256_permutevar8x32_epi32(
                    _mm256_packus_epi16(
                        _mm256_packs_epi32(l1[0], l1[1]), _mm256_packs_epi32(l1[2], l1[3])),
                    restoreOrder));

            __m256i g[4];
            for (int i = 0; i < 4; ++i) {
                g[i] = bt709Chroma4(bt709BlockSums4(p0[i], p1[i], zero), two, coeffU, coeffV, c128);
            }
            __m256i lo = _mm256_packs_epi32(g[0], g[1]);
            __m256i hi = _mm256_packs_epi32(g[2], g[3]);
            lo = _mm256_max_epi16(_mm256_min_epi16(lo, max240), min16);
            hi = _mm256_max_epi16(_mm256_min_epi16(hi, max240), min16);
            _mm256_storeu_si256(
                reinterpret_cast<__m256i*>(dstUv + x),
                _mm256_permutevar8x32_epi32(_mm256_packus_epi16(lo, hi), restoreOrder));
        }
    }

    if (vectorWidth < width) {
        // Whatever is left (up to 31 columns) goes through the SSE2 / scalar paths.
        convertBgraToBt709LimitedNv12Sse2From(bgra, bgraPitch, width, height, nv12Buffer, vectorWidth);
    }
}

inline bool bt709Avx2Available() {
    static const bool available = IsProcessorFeaturePresent(PF_AVX2_INSTRUCTIONS_AVAILABLE) != 0;
    return available;
}

#endif  // BT709_VIDEO_HAS_SSE2

inline void convertBgraToBt709LimitedNv12(
    const uint8_t* bgra,
    int bgraPitch,
    int width,
    int height,
    std::vector<uint8_t>& nv12Buffer) {
#ifdef BT709_VIDEO_HAS_SSE2
    // SSE2 is part of the x86-64 baseline; AVX2 is picked at runtime when the CPU has it.
    if (bt709Avx2Available()) {
        convertBgraToBt709LimitedNv12Avx2(bgra, bgraPitch, width, height, nv12Buffer);
    } else {
        convertBgraToBt709LimitedNv12Sse2(bgra, bgraPitch, width, height, nv12Buffer);
    }
#else
    convertBgraToBt709LimitedNv12Scalar(bgra, bgraPitch, width, height, nv12Buffer);
#endif
}
