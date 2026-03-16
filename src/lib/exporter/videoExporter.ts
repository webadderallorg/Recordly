import type { ExportConfig, ExportProgress, ExportResult } from './types';
import { AudioProcessor } from './audioEncoder';
import { StreamingVideoDecoder } from './streamingDecoder';
import { FrameRenderer } from './frameRenderer';
import { VideoMuxer } from './muxer';
import { SyncedVideoProvider } from './syncedVideoProvider';
import type { ZoomRegion, CropRegion, TrimRegion, AnnotationRegion, SpeedRegion, CursorTelemetryPoint } from '@/components/video-editor/types';
import type { FacecamSettings } from '@/lib/recordingSession';

interface VideoExporterConfig extends ExportConfig {
  videoUrl: string;
  facecamVideoUrl?: string;
  facecamOffsetMs?: number;
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

export class VideoExporter {
  private config: VideoExporterConfig;
  private streamingDecoder: StreamingVideoDecoder | null = null;
  private renderer: FrameRenderer | null = null;
  private facecamProvider: SyncedVideoProvider | null = null;
  private encoder: VideoEncoder | null = null;
  private muxer: VideoMuxer | null = null;
  private audioProcessor: AudioProcessor | null = null;
  private cancelled = false;
  private encodeQueue = 0;
  // Increased queue size for better throughput with hardware encoding
  private readonly MAX_ENCODE_QUEUE = 120;
  private videoDescription: Uint8Array | undefined;
  private videoColorSpace: VideoColorSpaceInit | undefined;
  private pendingMuxing: Promise<void> = Promise.resolve();
  private chunkCount = 0;
  private readonly WINDOWS_FINALIZATION_TIMEOUT_MS = 60_000;

  constructor(config: VideoExporterConfig) {
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

      // Initialize video encoder
      await this.initializeEncoder();

      const hasAudio = videoInfo.hasAudio;

      // Initialize muxer
      this.muxer = new VideoMuxer(this.config, hasAudio);
      await this.muxer.initialize();

      // Calculate effective duration and frame count (excluding trim regions)
      const effectiveDuration = this.streamingDecoder.getEffectiveDuration(this.config.trimRegions, this.config.speedRegions);
      const totalFrames = Math.ceil(effectiveDuration * this.config.frameRate);

      console.log('[VideoExporter] Original duration:', videoInfo.duration, 's');
      console.log('[VideoExporter] Effective duration:', effectiveDuration, 's');
      console.log('[VideoExporter] Total frames to export:', totalFrames);
      console.log('[VideoExporter] Using streaming decode (web-demuxer + VideoDecoder)');

      const frameDuration = 1_000_000 / this.config.frameRate; // in microseconds
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

          const timestamp = frameIndex * frameDuration;
          const sourceTimestampUs = sourceTimestampMs * 1000;
          const facecamFrame = this.facecamProvider
            ? await this.facecamProvider.getFrameAt(sourceTimestampMs - (this.config.facecamOffsetMs ?? 0))
            : null;
          await this.renderer!.renderFrame(videoFrame, sourceTimestampUs, facecamFrame);
          videoFrame.close();
          facecamFrame?.close();

          await this.encodeRenderedFrame(timestamp, frameDuration, frameIndex);
          frameIndex++;
          this.reportProgress(frameIndex, totalFrames);
        }
      );

      if (this.cancelled) {
        return { success: false, error: 'Export cancelled' };
      }

      // Finalize encoding
      if (this.encoder && this.encoder.state === 'configured') {
        await this.awaitWithWindowsTimeout(this.encoder.flush(), 'encoder flush');
      }

      // Wait for queued muxing operations to complete
      await this.awaitWithWindowsTimeout(this.pendingMuxing, 'muxing queued video chunks');

      if (hasAudio && !this.cancelled) {
        const demuxer = this.streamingDecoder.getDemuxer();
        if (demuxer) {
          this.audioProcessor = new AudioProcessor();
          await this.awaitWithWindowsTimeout(
            this.audioProcessor.process(
              demuxer,
              this.muxer!,
              this.config.videoUrl,
              this.config.trimRegions,
              this.config.speedRegions,
            ),
            'audio processing',
          );
        }
      }

      // Finalize muxer and get output blob
      const blob = await this.awaitWithWindowsTimeout(this.muxer!.finalize(), 'muxer finalization');

      return { success: true, blob };
    } catch (error) {
      console.error('Export error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.cleanup();
    }
  }

  private isWindowsPlatform(): boolean {
    if (typeof navigator === 'undefined') {
      return false;
    }
    return /Win/i.test(navigator.platform);
  }

  private async awaitWithWindowsTimeout<T>(promise: Promise<T>, stage: string): Promise<T> {
    if (!this.isWindowsPlatform()) {
      return promise;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Export timed out during ${stage} on Windows`));
          }, this.WINDOWS_FINALIZATION_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async encodeRenderedFrame(timestamp: number, frameDuration: number, frameIndex: number) {
    const canvas = this.renderer!.getCanvas();

    // @ts-ignore - colorSpace not in TypeScript definitions but works at runtime
    const exportFrame = new VideoFrame(canvas, {
      timestamp,
      duration: frameDuration,
      colorSpace: {
        primaries: 'bt709',
        transfer: 'iec61966-2-1',
        matrix: 'rgb',
        fullRange: true,
      },
    });

    while (this.encoder && this.encoder.encodeQueueSize >= this.MAX_ENCODE_QUEUE && !this.cancelled) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    if (this.encoder && this.encoder.state === 'configured') {
      this.encodeQueue++;
      this.encoder.encode(exportFrame, { keyFrame: frameIndex % 150 === 0 });
    } else {
      console.warn(`[Frame ${frameIndex}] Encoder not ready! State: ${this.encoder?.state}`);
    }

    exportFrame.close();
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

  private async initializeEncoder(): Promise<void> {
    this.encodeQueue = 0;
    this.pendingMuxing = Promise.resolve();
    this.chunkCount = 0;
    let videoDescription: Uint8Array | undefined;

    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        // Capture decoder config metadata from encoder output
        if (meta?.decoderConfig?.description && !videoDescription) {
          const desc = meta.decoderConfig.description;
          videoDescription = new Uint8Array(desc instanceof ArrayBuffer ? desc : (desc as any));
          this.videoDescription = videoDescription;
        }
        // Capture colorSpace from encoder metadata if provided
        if (meta?.decoderConfig?.colorSpace && !this.videoColorSpace) {
          this.videoColorSpace = meta.decoderConfig.colorSpace;
        }

        // Stream chunks to muxer in order without retaining an ever-growing promise array
        const isFirstChunk = this.chunkCount === 0;
        this.chunkCount++;

        this.pendingMuxing = this.pendingMuxing.then(async () => {
          try {
            if (isFirstChunk && this.videoDescription) {
              // Add decoder config for the first chunk
              const colorSpace = this.videoColorSpace || {
                primaries: 'bt709',
                transfer: 'iec61966-2-1',
                matrix: 'rgb',
                fullRange: true,
              };

              const metadata: EncodedVideoChunkMetadata = {
                decoderConfig: {
                  codec: this.config.codec || 'avc1.640033',
                  codedWidth: this.config.width,
                  codedHeight: this.config.height,
                  description: this.videoDescription,
                  colorSpace,
                },
              };

              await this.muxer!.addVideoChunk(chunk, metadata);
            } else {
              await this.muxer!.addVideoChunk(chunk, meta);
            }
          } catch (error) {
            console.error('Muxing error:', error);
          }
        });
        this.encodeQueue--;
      },
      error: (error) => {
        console.error('[VideoExporter] Encoder error:', error);
        // Stop export encoding failed
        this.cancelled = true;
      },
    });

    const codec = this.config.codec || 'avc1.640033';

    const encoderConfig: VideoEncoderConfig = {
      codec,
      width: this.config.width,
      height: this.config.height,
      bitrate: this.config.bitrate,
      framerate: this.config.frameRate,
      latencyMode: 'quality', // Changed from 'realtime' to 'quality' for better throughput
      bitrateMode: 'variable',
      hardwareAcceleration: 'prefer-hardware',
    };

    // Check hardware support first
    const hardwareSupport = await VideoEncoder.isConfigSupported(encoderConfig);

    if (hardwareSupport.supported) {
      // Use hardware encoding
      console.log('[VideoExporter] Using hardware acceleration');
      this.encoder.configure(encoderConfig);
    } else {
      // Fall back to software encoding
      console.log('[VideoExporter] Hardware not supported, using software encoding');
      encoderConfig.hardwareAcceleration = 'prefer-software';

      const softwareSupport = await VideoEncoder.isConfigSupported(encoderConfig);
      if (!softwareSupport.supported) {
        throw new Error('Video encoding not supported on this system');
      }

      this.encoder.configure(encoderConfig);
    }
  }

  cancel(): void {
    this.cancelled = true;
    if (this.streamingDecoder) {
      this.streamingDecoder.cancel();
    }
    if (this.audioProcessor) {
      this.audioProcessor.cancel();
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.encoder) {
      try {
        if (this.encoder.state === 'configured') {
          this.encoder.close();
        }
      } catch (e) {
        console.warn('Error closing encoder:', e);
      }
      this.encoder = null;
    }

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

    this.muxer = null;
    this.audioProcessor = null;
    this.encodeQueue = 0;
    this.pendingMuxing = Promise.resolve();
    this.chunkCount = 0;
    this.videoDescription = undefined;
    this.videoColorSpace = undefined;
  }
}
