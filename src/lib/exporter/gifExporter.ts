import GIF from 'gif.js';
import type { ExportProgress, ExportResult, GifFrameRate, GifSizePreset, GIF_SIZE_PRESETS } from './types';
import { StreamingVideoDecoder } from './streamingDecoder';
import { FrameRenderer } from './frameRenderer';
import { SyncedVideoProvider } from './syncedVideoProvider';
import type { ZoomRegion, CropRegion, TrimRegion, AnnotationRegion, SpeedRegion, CursorTelemetryPoint } from '@/components/video-editor/types';
import type { FacecamSettings } from '@/lib/recordingSession';

const GIF_WORKER_URL = new URL('gif.js/dist/gif.worker.js', import.meta.url).toString();

interface GifExporterConfig {
  videoUrl: string;
  facecamVideoUrl?: string;
  facecamOffsetMs?: number;
  width: number;
  height: number;
  frameRate: GifFrameRate;
  loop: boolean;
  sizePreset: GifSizePreset;
  wallpaper: string;
  zoomRegions: ZoomRegion[];
  trimRegions?: TrimRegion[];
  speedRegions?: SpeedRegion[];
  showShadow: boolean;
  shadowIntensity: number;
  backgroundBlur: number;
  zoomMotionBlur?: number;
  connectZooms?: boolean;
  borderRadius?: number;
  padding?: number;
  videoPadding?: number;
  cropRegion: CropRegion;
  facecamSettings?: FacecamSettings;
  annotationRegions?: AnnotationRegion[];
  cursorTelemetry?: CursorTelemetryPoint[];
  showCursor?: boolean;
  cursorSize?: number;
  cursorSmoothing?: number;
  cursorMotionBlur?: number;
  cursorClickBounce?: number;
  previewWidth?: number;
  previewHeight?: number;
  onProgress?: (progress: ExportProgress) => void;
}

/**
 * Calculate output dimensions based on size preset and source dimensions while preserving aspect ratio.
 * @param sourceWidth - Original video width
 * @param sourceHeight - Original video height
 * @param sizePreset - The size preset to use
 * @param sizePresets - The size presets configuration
 * @returns The calculated output dimensions
 */
export function calculateOutputDimensions(
  sourceWidth: number,
  sourceHeight: number,
  sizePreset: GifSizePreset,
  sizePresets: typeof GIF_SIZE_PRESETS
): { width: number; height: number } {
  const preset = sizePresets[sizePreset];
  const maxHeight = preset.maxHeight;

  // If original is smaller than max height or preset is 'original', use source dimensions
  if (sourceHeight <= maxHeight || sizePreset === 'original') {
    return { width: sourceWidth, height: sourceHeight };
  }

  // Calculate scaled dimensions preserving aspect ratio
  const aspectRatio = sourceWidth / sourceHeight;
  const newHeight = maxHeight;
  const newWidth = Math.round(newHeight * aspectRatio);

  // Ensure dimensions are even (required for some encoders)
  return {
    width: newWidth % 2 === 0 ? newWidth : newWidth + 1,
    height: newHeight % 2 === 0 ? newHeight : newHeight + 1,
  };
}

export class GifExporter {
  private config: GifExporterConfig;
  private streamingDecoder: StreamingVideoDecoder | null = null;
  private renderer: FrameRenderer | null = null;
  private facecamProvider: SyncedVideoProvider | null = null;
  private gif: GIF | null = null;
  private cancelled = false;

  constructor(config: GifExporterConfig) {
    this.config = config;
  }

  async export(): Promise<ExportResult> {
    try {
      this.cleanup();
      this.cancelled = false;

      // Initialize streaming decoder and load video metadata
      this.streamingDecoder = new StreamingVideoDecoder();
      const videoInfo = await this.streamingDecoder.loadMetadata(this.config.videoUrl);

      // Initialize frame renderer
      this.renderer = new FrameRenderer({
        width: this.config.width,
        height: this.config.height,
        wallpaper: this.config.wallpaper,
        zoomRegions: this.config.zoomRegions,
        showShadow: this.config.showShadow,
        shadowIntensity: this.config.shadowIntensity,
        backgroundBlur: this.config.backgroundBlur,
        zoomMotionBlur: this.config.zoomMotionBlur,
        connectZooms: this.config.connectZooms,
        borderRadius: this.config.borderRadius,
        padding: this.config.padding,
        cropRegion: this.config.cropRegion,
        facecamSettings: this.config.facecamSettings,
        videoWidth: videoInfo.width,
        videoHeight: videoInfo.height,
        annotationRegions: this.config.annotationRegions,
        speedRegions: this.config.speedRegions,
        previewWidth: this.config.previewWidth,
        previewHeight: this.config.previewHeight,
        cursorTelemetry: this.config.cursorTelemetry,
        showCursor: this.config.showCursor,
        cursorSize: this.config.cursorSize,
        cursorSmoothing: this.config.cursorSmoothing,
        cursorMotionBlur: this.config.cursorMotionBlur,
        cursorClickBounce: this.config.cursorClickBounce,
      });
      await this.renderer.initialize();

      if (this.config.facecamVideoUrl && this.config.facecamSettings?.enabled) {
        this.facecamProvider = new SyncedVideoProvider();
        await this.facecamProvider.initialize(this.config.facecamVideoUrl, this.config.frameRate);
      }

      // Initialize GIF encoder
      // Loop: 0 = infinite loop, 1 = play once (no loop)
      const repeat = this.config.loop ? 0 : 1;
      const cores = navigator.hardwareConcurrency || 4;
      const WORKER_COUNT = Math.max(1, Math.min(8, cores - 1));

      this.gif = new GIF({
        workers: WORKER_COUNT,
        quality: 10,
        width: this.config.width,
        height: this.config.height,
        workerScript: GIF_WORKER_URL,
        repeat,
        background: '#000000',
        transparent: null,
        dither: 'FloydSteinberg',
      });

      // Calculate effective duration and frame count (excluding trim regions)
      const effectiveDuration = this.streamingDecoder.getEffectiveDuration(this.config.trimRegions, this.config.speedRegions);
      const totalFrames = Math.ceil(effectiveDuration * this.config.frameRate);

      // Calculate frame delay in milliseconds (gif.js uses ms)
      const frameDelay = Math.round(1000 / this.config.frameRate);

      console.log('[GifExporter] Original duration:', videoInfo.duration, 's');
      console.log('[GifExporter] Effective duration:', effectiveDuration, 's');
      console.log('[GifExporter] Total frames to export:', totalFrames);
      console.log('[GifExporter] Frame rate:', this.config.frameRate, 'FPS');
      console.log('[GifExporter] Frame delay:', frameDelay, 'ms');
      console.log('[GifExporter] Loop:', this.config.loop ? 'infinite' : 'once');
      console.log('[GifExporter] Using streaming decode (web-demuxer + VideoDecoder)');

      let frameIndex = 0;

      // Stream decode and process frames — no seeking!
      await this.streamingDecoder.decodeAll(
        this.config.frameRate,
        this.config.trimRegions,
        this.config.speedRegions,
        async (videoFrame, _exportTimestampUs, sourceTimestampMs) => {
          if (this.cancelled) {
            videoFrame.close();
            return;
          }

          const sourceTimestampUs = sourceTimestampMs * 1000;
          const facecamFrame = this.facecamProvider
            ? await this.facecamProvider.getFrameAt(sourceTimestampMs - (this.config.facecamOffsetMs ?? 0))
            : null;
          await this.renderer!.renderFrame(videoFrame, sourceTimestampUs, facecamFrame);
          videoFrame.close();
          facecamFrame?.close();

          this.addRenderedGifFrame(frameDelay);
          frameIndex++;
          this.reportProgress(frameIndex, totalFrames);
        }
      );

      if (this.cancelled) {
        return { success: false, error: 'Export cancelled' };
      }

      // Update progress to show we're now in the finalizing phase
      if (this.config.onProgress) {
        this.config.onProgress({
          currentFrame: totalFrames,
          totalFrames,
          percentage: 100,
          estimatedTimeRemaining: 0,
          phase: 'finalizing',
        });
      }

      // Render the GIF
      const blob = await new Promise<Blob>((resolve, _reject) => {
        this.gif!.on('finished', (blob: Blob) => {
          resolve(blob);
        });

        // Track rendering progress
        this.gif!.on('progress', (progress: number) => {
          if (this.config.onProgress) {
            this.config.onProgress({
              currentFrame: totalFrames,
              totalFrames,
              percentage: 100,
              estimatedTimeRemaining: 0,
              phase: 'finalizing',
              renderProgress: Math.round(progress * 100),
            });
          }
        });

        // gif.js doesn't have a typed 'error' event, but we can catch errors in the try/catch
        this.gif!.render();
      });

      return { success: true, blob };
    } catch (error) {
      console.error('GIF Export error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.cleanup();
    }
  }

  private addRenderedGifFrame(frameDelay: number) {
    const canvas = this.renderer!.getCanvas();
    this.gif!.addFrame(canvas, { delay: frameDelay, copy: true });
  }

  private reportProgress(currentFrame: number, totalFrames: number) {
    if (this.config.onProgress) {
      this.config.onProgress({
        currentFrame,
        totalFrames,
        percentage: totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 100,
        estimatedTimeRemaining: 0,
      });
    }
  }

  cancel(): void {
    this.cancelled = true;
    if (this.streamingDecoder) {
      this.streamingDecoder.cancel();
    }
    if (this.gif) {
      this.gif.abort();
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.streamingDecoder) {
      try {
        this.streamingDecoder.destroy();
      } catch (e) {
        console.warn('Error destroying streaming decoder:', e);
      }
      this.streamingDecoder = null;
    }

    if (this.renderer) {
      try {
        this.renderer.destroy();
      } catch (e) {
        console.warn('Error destroying renderer:', e);
      }
      this.renderer = null;
    }

    if (this.facecamProvider) {
      try {
        this.facecamProvider.destroy();
      } catch (e) {
        console.warn('Error destroying facecam provider:', e);
      }
      this.facecamProvider = null;
    }

    this.gif = null;
  }
}
