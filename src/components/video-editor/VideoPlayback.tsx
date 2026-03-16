import type React from "react";
import { useEffect, useRef, useImperativeHandle, forwardRef, useState, useMemo, useCallback } from "react";
import { getAssetPath, getRenderableAssetUrl } from "@/lib/assetPath";
import { getFacecamLayout, type FacecamSettings } from "@/lib/recordingSession";
import { DEFAULT_WALLPAPER_PATH, DEFAULT_WALLPAPER_RELATIVE_PATH } from "@/lib/wallpapers";
import { Application, Container, Sprite, Graphics, BlurFilter, Texture, VideoSource } from 'pixi.js';
import { MotionBlurFilter } from 'pixi-filters/motion-blur';
import { ZOOM_DEPTH_SCALES, type ZoomRegion, type ZoomFocus, type ZoomDepth, type TrimRegion, type SpeedRegion, type AnnotationRegion, type CursorTelemetryPoint } from "./types";
import { DEFAULT_FOCUS, ZOOM_SCALE_DEADZONE, ZOOM_TRANSLATION_DEADZONE_PX } from "./videoPlayback/constants";
import { DEFAULT_CURSOR_CONFIG, PixiCursorOverlay, preloadCursorAssets } from "./videoPlayback/cursorRenderer";
import { clamp01 } from "./videoPlayback/mathUtils";
import { findDominantRegion } from "./videoPlayback/zoomRegionUtils";
import { clampFocusToStage as clampFocusToStageUtil } from "./videoPlayback/focusUtils";
import { updateOverlayIndicator } from "./videoPlayback/overlayUtils";
import { layoutVideoContent as layoutVideoContentUtil } from "./videoPlayback/layoutUtils";
import { applyZoomTransform, computeFocusFromTransform, computeZoomTransform, createMotionBlurState, type MotionBlurState } from "./videoPlayback/zoomTransform";
import { createVideoEventHandlers } from "./videoPlayback/videoEventHandlers";
import { type AspectRatio, formatAspectRatioForCSS } from "@/utils/aspectRatioUtils";
import { AnnotationOverlay } from "./AnnotationOverlay";
import {
  DEFAULT_CURSOR_CLICK_BOUNCE,
  DEFAULT_CURSOR_MOTION_BLUR,
  DEFAULT_CURSOR_SIZE,
  DEFAULT_CURSOR_SMOOTHING,
} from "./types";

type PlaybackAnimationState = {
  scale: number;
  appliedScale: number;
  focusX: number;
  focusY: number;
  progress: number;
  x: number;
  y: number;
};

function createPlaybackAnimationState(): PlaybackAnimationState {
  return {
    scale: 1,
    appliedScale: 1,
    focusX: DEFAULT_FOCUS.cx,
    focusY: DEFAULT_FOCUS.cy,
    progress: 0,
    x: 0,
    y: 0,
  };
}

interface VideoPlaybackProps {
  videoPath: string;
  facecamVideoPath?: string;
  facecamOffsetMs?: number;
  facecamSettings?: FacecamSettings;
  onDurationChange: (duration: number) => void;
  onTimeUpdate: (time: number) => void;
  currentTime: number;
  onPlayStateChange: (playing: boolean) => void;
  onError: (error: string) => void;
  wallpaper?: string;
  zoomRegions: ZoomRegion[];
  selectedZoomId: string | null;
  onSelectZoom: (id: string | null) => void;
  onZoomFocusChange: (id: string, focus: ZoomFocus) => void;
  isPlaying: boolean;
  showShadow?: boolean;
  shadowIntensity?: number;
  backgroundBlur?: number;
  zoomMotionBlur?: number;
  connectZooms?: boolean;
  borderRadius?: number;
  padding?: number;
  cropRegion?: import('./types').CropRegion;
  trimRegions?: TrimRegion[];
  speedRegions?: SpeedRegion[];
  aspectRatio: AspectRatio;
  annotationRegions?: AnnotationRegion[];
  selectedAnnotationId?: string | null;
  onSelectAnnotation?: (id: string | null) => void;
  onAnnotationPositionChange?: (id: string, position: { x: number; y: number }) => void;
  onAnnotationSizeChange?: (id: string, size: { width: number; height: number }) => void;
  cursorTelemetry?: CursorTelemetryPoint[];
  showCursor?: boolean;
  cursorSize?: number;
  cursorSmoothing?: number;
  cursorMotionBlur?: number;
  cursorClickBounce?: number;
}

export interface VideoPlaybackRef {
  video: HTMLVideoElement | null;
  app: Application | null;
  videoSprite: Sprite | null;
  videoContainer: Container | null;
  containerRef: React.RefObject<HTMLDivElement>;
  play: () => Promise<void>;
  pause: () => void;
  refreshFrame: () => Promise<void>;
}

const VideoPlayback = forwardRef<VideoPlaybackRef, VideoPlaybackProps>(({
  videoPath,
  facecamVideoPath,
  facecamOffsetMs = 0,
  facecamSettings,
  onDurationChange,
  onTimeUpdate,
  currentTime,
  onPlayStateChange,
  onError,
  wallpaper,
  zoomRegions,
  selectedZoomId,
  onSelectZoom,
  onZoomFocusChange,
  isPlaying,
  showShadow,
  shadowIntensity = 0,
  backgroundBlur = 0,
  zoomMotionBlur = 0,
  connectZooms = true,
  borderRadius = 0,
  padding = 50,
  cropRegion,
  trimRegions = [],
  speedRegions = [],
  aspectRatio,
  annotationRegions = [],
  selectedAnnotationId,
  onSelectAnnotation,
  onAnnotationPositionChange,
  onAnnotationSizeChange,
  cursorTelemetry = [],
  showCursor = false,
  cursorSize = DEFAULT_CURSOR_SIZE,
  cursorSmoothing = DEFAULT_CURSOR_SMOOTHING,
  cursorMotionBlur = DEFAULT_CURSOR_MOTION_BLUR,
  cursorClickBounce = DEFAULT_CURSOR_CLICK_BOUNCE,
}, ref) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const facecamVideoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const videoSpriteRef = useRef<Sprite | null>(null);
  const videoContainerRef = useRef<Container | null>(null);
  const cursorContainerRef = useRef<Container | null>(null);
  const cameraContainerRef = useRef<Container | null>(null);
  const facecamContainerRef = useRef<Container | null>(null);
  const facecamSpriteRef = useRef<Sprite | null>(null);
  const facecamMaskRef = useRef<Graphics | null>(null);
  const facecamBorderRef = useRef<Graphics | null>(null);
  const timeUpdateAnimationRef = useRef<number | null>(null);
  const [pixiReady, setPixiReady] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [facecamReady, setFacecamReady] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const focusIndicatorRef = useRef<HTMLDivElement | null>(null);
  const currentTimeRef = useRef(0);
  const zoomRegionsRef = useRef<ZoomRegion[]>([]);
  const selectedZoomIdRef = useRef<string | null>(null);
  const animationStateRef = useRef<PlaybackAnimationState>(createPlaybackAnimationState());
  const blurFilterRef = useRef<BlurFilter | null>(null);
  const motionBlurFilterRef = useRef<MotionBlurFilter | null>(null);
  const isDraggingFocusRef = useRef(false);
  const stageSizeRef = useRef({ width: 0, height: 0 });
  const videoSizeRef = useRef({ width: 0, height: 0 });
  const baseScaleRef = useRef(1);
  const baseOffsetRef = useRef({ x: 0, y: 0 });
  const baseMaskRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const cropBoundsRef = useRef({ startX: 0, endX: 0, startY: 0, endY: 0 });
  const maskGraphicsRef = useRef<Graphics | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const isSeekingRef = useRef(false);
  const allowPlaybackRef = useRef(false);
  const lockedVideoDimensionsRef = useRef<{ width: number; height: number } | null>(null);
  const layoutVideoContentRef = useRef<(() => void) | null>(null);
  const layoutFacecamOverlayRef = useRef<(() => void) | null>(null);
  const trimRegionsRef = useRef<TrimRegion[]>([]);
  const speedRegionsRef = useRef<SpeedRegion[]>([]);
  const zoomMotionBlurRef = useRef(zoomMotionBlur);
  const connectZoomsRef = useRef(connectZooms);
  const videoReadyRafRef = useRef<number | null>(null);
  const cursorOverlayRef = useRef<PixiCursorOverlay | null>(null);
  const cursorTelemetryRef = useRef<CursorTelemetryPoint[]>([]);
  const showCursorRef = useRef(showCursor);
  const cursorSizeRef = useRef(cursorSize);
  const cursorSmoothingRef = useRef(cursorSmoothing);
  const cursorMotionBlurRef = useRef(cursorMotionBlur);
  const cursorClickBounceRef = useRef(cursorClickBounce);
  const motionBlurStateRef = useRef<MotionBlurState>(createMotionBlurState());
  const facecamOffsetMsRef = useRef(facecamOffsetMs);
  const facecamSettingsRef = useRef(facecamSettings);

  const clampFocusToStage = useCallback((focus: ZoomFocus, depth: ZoomDepth) => {
    return clampFocusToStageUtil(focus, depth, stageSizeRef.current);
  }, []);

  const updateOverlayForRegion = useCallback((region: ZoomRegion | null, focusOverride?: ZoomFocus) => {
    const overlayEl = overlayRef.current;
    const indicatorEl = focusIndicatorRef.current;
    
    if (!overlayEl || !indicatorEl) {
      return;
    }

    // Update stage size from overlay dimensions
    const stageWidth = overlayEl.clientWidth;
    const stageHeight = overlayEl.clientHeight;
    if (stageWidth && stageHeight) {
      stageSizeRef.current = { width: stageWidth, height: stageHeight };
    }

    updateOverlayIndicator({
      overlayEl,
      indicatorEl,
      region,
      focusOverride,
      baseMask: baseMaskRef.current,
      isPlaying: isPlayingRef.current,
    });
  }, []);

  const layoutFacecamOverlay = useCallback(() => {
    const facecamContainer = facecamContainerRef.current;
    const facecamSprite = facecamSpriteRef.current;
    const facecamMask = facecamMaskRef.current;
    const facecamBorder = facecamBorderRef.current;
    const facecamVideo = facecamVideoRef.current;
    const settings = facecamSettingsRef.current;

    if (!facecamContainer || !facecamSprite || !facecamMask || !facecamBorder || !facecamVideo || !settings) {
      return;
    }

    const stageWidth = stageSizeRef.current.width || containerRef.current?.clientWidth || 0;
    const stageHeight = stageSizeRef.current.height || containerRef.current?.clientHeight || 0;

    if (!stageWidth || !stageHeight || !settings.enabled || !facecamVideoPath) {
      facecamContainer.visible = false;
      return;
    }

    const { x, y, size, borderRadius } = getFacecamLayout(stageWidth, stageHeight, settings);
    const scale = Math.max(
      size / Math.max(1, facecamVideo.videoWidth),
      size / Math.max(1, facecamVideo.videoHeight),
    );
    const drawWidth = facecamVideo.videoWidth * scale;
    const drawHeight = facecamVideo.videoHeight * scale;
    const centerX = x + size / 2;
    const centerY = y + size / 2;

    facecamSprite.scale.set(scale);
    facecamSprite.position.set(
      x + (size - drawWidth) / 2,
      y + (size - drawHeight) / 2,
    );

    facecamMask.clear();
    facecamBorder.clear();

    if (settings.shape === 'circle') {
      facecamMask.circle(centerX, centerY, size / 2);
      facecamMask.fill({ color: 0xffffff });
      if (settings.borderWidth > 0) {
        facecamBorder.circle(centerX, centerY, Math.max(0, size / 2 - settings.borderWidth / 2));
        facecamBorder.stroke({
          color: Number.parseInt(settings.borderColor.replace('#', ''), 16),
          width: settings.borderWidth,
        });
      }
    } else {
      facecamMask.roundRect(x, y, size, size, borderRadius);
      facecamMask.fill({ color: 0xffffff });
      if (settings.borderWidth > 0) {
        facecamBorder.roundRect(
          x + settings.borderWidth / 2,
          y + settings.borderWidth / 2,
          Math.max(0, size - settings.borderWidth),
          Math.max(0, size - settings.borderWidth),
          Math.max(0, borderRadius - settings.borderWidth / 2),
        );
        facecamBorder.stroke({
          color: Number.parseInt(settings.borderColor.replace('#', ''), 16),
          width: settings.borderWidth,
        });
      }
    }

    facecamContainer.visible = true;
  }, [facecamVideoPath]);

  const layoutVideoContent = useCallback(() => {
    const container = containerRef.current;
    const app = appRef.current;
    const videoSprite = videoSpriteRef.current;
    const maskGraphics = maskGraphicsRef.current;
    const videoElement = videoRef.current;
    const cameraContainer = cameraContainerRef.current;

    if (!container || !app || !videoSprite || !maskGraphics || !videoElement || !cameraContainer) {
      return;
    }

    // Lock video dimensions on first layout to prevent resize issues
    if (!lockedVideoDimensionsRef.current && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
      lockedVideoDimensionsRef.current = {
        width: videoElement.videoWidth,
        height: videoElement.videoHeight,
      };
    }

    const result = layoutVideoContentUtil({
      container,
      app,
      videoSprite,
      maskGraphics,
      videoElement,
      cropRegion,
      lockedVideoDimensions: lockedVideoDimensionsRef.current,
      borderRadius,
      padding,
    });

    if (result) {
      stageSizeRef.current = result.stageSize;
      videoSizeRef.current = result.videoSize;
      baseScaleRef.current = result.baseScale;
      baseOffsetRef.current = result.baseOffset;
      baseMaskRef.current = result.maskRect;
      cropBoundsRef.current = result.cropBounds;

      // Reset camera container to identity
      cameraContainer.scale.set(1);
      cameraContainer.position.set(0, 0);

      const selectedId = selectedZoomIdRef.current;
      const activeRegion = selectedId
        ? zoomRegionsRef.current.find((region) => region.id === selectedId) ?? null
        : null;

      updateOverlayForRegion(activeRegion);
      layoutFacecamOverlayRef.current?.();
    }
  }, [updateOverlayForRegion, cropRegion, borderRadius, padding]);

  useEffect(() => {
    layoutVideoContentRef.current = layoutVideoContent;
  }, [layoutVideoContent]);

  useEffect(() => {
    layoutFacecamOverlayRef.current = layoutFacecamOverlay;
  }, [layoutFacecamOverlay]);

  const selectedZoom = useMemo(() => {
    if (!selectedZoomId) return null;
    return zoomRegions.find((region) => region.id === selectedZoomId) ?? null;
  }, [zoomRegions, selectedZoomId]);

  useImperativeHandle(ref, () => ({
    video: videoRef.current,
    app: appRef.current,
    videoSprite: videoSpriteRef.current,
    videoContainer: videoContainerRef.current,
    containerRef,
    play: async () => {
      const vid = videoRef.current;
      if (!vid) return;
      try {
        allowPlaybackRef.current = true;
        await vid.play();
      } catch (error) {
        allowPlaybackRef.current = false;
        throw error;
      }
    },
    pause: () => {
      const video = videoRef.current;
      allowPlaybackRef.current = false;
      if (!video) {
        return;
      }
      video.pause();
    },
    refreshFrame: async () => {
      const video = videoRef.current;
      if (!video || Number.isNaN(video.currentTime)) {
        return;
      }

      const restoreTime = video.currentTime;
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const epsilon = duration > 0 ? Math.min(1 / 120, duration / 1000 || 1 / 120) : 1 / 120;
      const nudgeTarget = restoreTime > epsilon
        ? restoreTime - epsilon
        : Math.min(duration || restoreTime + epsilon, restoreTime + epsilon);

      if (Math.abs(nudgeTarget - restoreTime) < 0.000001) {
        return;
      }

      await new Promise<void>((resolve) => {
        const handleFirstSeeked = () => {
          video.removeEventListener('seeked', handleFirstSeeked);
          const handleSecondSeeked = () => {
            video.removeEventListener('seeked', handleSecondSeeked);
            video.pause();
            resolve();
          };

          video.addEventListener('seeked', handleSecondSeeked, { once: true });
          video.currentTime = restoreTime;
        };

        video.addEventListener('seeked', handleFirstSeeked, { once: true });
        video.currentTime = nudgeTarget;
      });
    },
  }));

  const updateFocusFromClientPoint = (clientX: number, clientY: number) => {
    const overlayEl = overlayRef.current;
    if (!overlayEl) return;

    const regionId = selectedZoomIdRef.current;
    if (!regionId) return;

    const region = zoomRegionsRef.current.find((r) => r.id === regionId);
    if (!region) return;

    const rect = overlayEl.getBoundingClientRect();
    const stageWidth = rect.width;
    const stageHeight = rect.height;

    if (!stageWidth || !stageHeight) {
      return;
    }

    stageSizeRef.current = { width: stageWidth, height: stageHeight };

    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const baseMask = baseMaskRef.current;

    const unclampedFocus: ZoomFocus = {
      cx: clamp01((localX - baseMask.x) / Math.max(1, baseMask.width)),
      cy: clamp01((localY - baseMask.y) / Math.max(1, baseMask.height)),
    };
    const clampedFocus = clampFocusToStage(unclampedFocus, region.depth);

    onZoomFocusChange(region.id, clampedFocus);
    updateOverlayForRegion({ ...region, focus: clampedFocus }, clampedFocus);
  };

  const handleOverlayPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isPlayingRef.current) return;
    const regionId = selectedZoomIdRef.current;
    if (!regionId) return;
    const region = zoomRegionsRef.current.find((r) => r.id === regionId);
    if (!region) return;
    onSelectZoom(region.id);
    event.preventDefault();
    isDraggingFocusRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFocusFromClientPoint(event.clientX, event.clientY);
  };

  const handleOverlayPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingFocusRef.current) return;
    event.preventDefault();
    updateFocusFromClientPoint(event.clientX, event.clientY);
  };

  const endFocusDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingFocusRef.current) return;
    isDraggingFocusRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      
    }
  };

  const handleOverlayPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    endFocusDrag(event);
  };

  const handleOverlayPointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    endFocusDrag(event);
  };

  useEffect(() => {
    zoomRegionsRef.current = zoomRegions;
  }, [zoomRegions]);

  useEffect(() => {
    selectedZoomIdRef.current = selectedZoomId;
  }, [selectedZoomId]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    trimRegionsRef.current = trimRegions;
  }, [trimRegions]);

  useEffect(() => {
    speedRegionsRef.current = speedRegions;
  }, [speedRegions]);

  useEffect(() => {
    zoomMotionBlurRef.current = zoomMotionBlur;
  }, [zoomMotionBlur]);

  useEffect(() => {
    connectZoomsRef.current = connectZooms;
  }, [connectZooms]);

  useEffect(() => {
    cursorTelemetryRef.current = cursorTelemetry;
  }, [cursorTelemetry]);

  useEffect(() => {
    showCursorRef.current = showCursor;
  }, [showCursor]);

  useEffect(() => {
    cursorSizeRef.current = cursorSize;
  }, [cursorSize]);

  useEffect(() => {
    cursorSmoothingRef.current = cursorSmoothing;
  }, [cursorSmoothing]);

  useEffect(() => {
    cursorMotionBlurRef.current = cursorMotionBlur;
  }, [cursorMotionBlur]);

  useEffect(() => {
    cursorClickBounceRef.current = cursorClickBounce;
  }, [cursorClickBounce]);

  useEffect(() => {
    facecamOffsetMsRef.current = facecamOffsetMs;
  }, [facecamOffsetMs]);

  useEffect(() => {
    facecamSettingsRef.current = facecamSettings;
  }, [facecamSettings]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;

    const app = appRef.current;
    const cameraContainer = cameraContainerRef.current;
    const video = videoRef.current;

    if (!app || !cameraContainer || !video) return;

    const tickerWasStarted = app.ticker?.started || false;
    if (tickerWasStarted && app.ticker) {
      app.ticker.stop();
    }

    const wasPlaying = !video.paused;
    if (wasPlaying) {
      video.pause();
    }

    animationStateRef.current = createPlaybackAnimationState();

    // Reset cursor overlay smoothing on layout change
    cursorOverlayRef.current?.reset();

    // Reset motion blur state for clean transitions
    motionBlurStateRef.current = createMotionBlurState();

    if (blurFilterRef.current) {
      blurFilterRef.current.blur = 0;
    }

    requestAnimationFrame(() => {
      const container = cameraContainerRef.current;
      const videoStage = videoContainerRef.current;
      const sprite = videoSpriteRef.current;
      const currentApp = appRef.current;
      if (!container || !videoStage || !sprite || !currentApp) {
        return;
      }

      container.scale.set(1);
      container.position.set(0, 0);
      videoStage.scale.set(1);
      videoStage.position.set(0, 0);
      sprite.scale.set(1);
      sprite.position.set(0, 0);

      layoutVideoContent();

      applyZoomTransform({
        cameraContainer: container,
        blurFilter: blurFilterRef.current,
        stageSize: stageSizeRef.current,
        baseMask: baseMaskRef.current,
        zoomScale: 1,
        focusX: DEFAULT_FOCUS.cx,
        focusY: DEFAULT_FOCUS.cy,
        motionIntensity: 0,
        isPlaying: false,
        motionBlurAmount: zoomMotionBlurRef.current,
      });

      requestAnimationFrame(() => {
        const finalApp = appRef.current;
        if (wasPlaying && video) {
          video.play().catch(() => {
          });
        }
        if (tickerWasStarted && finalApp?.ticker) {
          finalApp.ticker.start();
        }
      });
    });
  }, [pixiReady, videoReady, layoutVideoContent, cropRegion]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;
    const container = containerRef.current;
    if (!container) return;

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      layoutVideoContent();
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [pixiReady, videoReady, layoutVideoContent]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;
    updateOverlayForRegion(selectedZoom);
  }, [selectedZoom, pixiReady, videoReady, updateOverlayForRegion]);

  useEffect(() => {
    if (!pixiReady) {
      return;
    }

    layoutFacecamOverlay();
  }, [pixiReady, facecamReady, facecamSettings, facecamVideoPath, layoutFacecamOverlay]);

  useEffect(() => {
    const overlayEl = overlayRef.current;
    if (!overlayEl) return;
    if (!selectedZoom) {
      overlayEl.style.cursor = 'default';
      overlayEl.style.pointerEvents = 'none';
      return;
    }
    overlayEl.style.cursor = isPlaying ? 'not-allowed' : 'grab';
    overlayEl.style.pointerEvents = isPlaying ? 'none' : 'auto';
  }, [selectedZoom, isPlaying]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let mounted = true;
    let app: Application | null = null;

    (async () => {
      let cursorOverlayEnabled = true;
      try {
        await preloadCursorAssets();
      } catch (error) {
        cursorOverlayEnabled = false;
        console.warn('Native cursor assets are unavailable in preview; continuing without cursor overlay.', error);
      }

      app = new Application();
      
      await app.init({
        width: container.clientWidth,
        height: container.clientHeight,
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      app.ticker.maxFPS = 60;

      if (!mounted) {
        app.destroy(true, { children: true, texture: false, textureSource: false });
        return;
      }

      appRef.current = app;
      container.appendChild(app.canvas);

      // Camera container - this will be scaled/positioned for zoom
      const cameraContainer = new Container();
      cameraContainerRef.current = cameraContainer;
      app.stage.addChild(cameraContainer);

      const facecamContainer = new Container();
      facecamContainer.visible = false;
      facecamContainerRef.current = facecamContainer;
      app.stage.addChild(facecamContainer);

      // Video container - holds the masked video sprite
      const videoContainer = new Container();
      videoContainerRef.current = videoContainer;
      cameraContainer.addChild(videoContainer);

      const cursorContainer = new Container();
      cursorContainerRef.current = cursorContainer;
      cameraContainer.addChild(cursorContainer);

      // Cursor overlay - rendered above the masked video so it can sit in front
      // of the content without getting clipped.
      if (cursorOverlayEnabled) {
        const cursorOverlay = new PixiCursorOverlay({
          dotRadius: DEFAULT_CURSOR_CONFIG.dotRadius * cursorSizeRef.current,
          smoothingFactor: cursorSmoothingRef.current,
          motionBlur: cursorMotionBlurRef.current,
          clickBounce: cursorClickBounceRef.current,
        });
        cursorOverlayRef.current = cursorOverlay;
        cursorContainer.addChild(cursorOverlay.container);
      } else {
        cursorOverlayRef.current = null;
      }
      
      setPixiReady(true);
    })().catch((error) => {
      console.error('Failed to initialize preview renderer:', error);
      onError(error instanceof Error ? error.message : 'Failed to initialize preview renderer');
    });

    return () => {
      mounted = false;
      setPixiReady(false);
      if (cursorOverlayRef.current) {
        cursorOverlayRef.current.destroy();
        cursorOverlayRef.current = null;
      }
      if (app && app.renderer) {
        app.destroy(true, { children: true, texture: false, textureSource: false });
      }
      appRef.current = null;
      cameraContainerRef.current = null;
      facecamContainerRef.current = null;
      facecamSpriteRef.current = null;
      facecamMaskRef.current = null;
      facecamBorderRef.current = null;
      videoContainerRef.current = null;
      cursorContainerRef.current = null;
      videoSpriteRef.current = null;
    };
  }, [onError]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
    allowPlaybackRef.current = false;
    lockedVideoDimensionsRef.current = null;
    setVideoReady(false);
    if (videoReadyRafRef.current) {
      cancelAnimationFrame(videoReadyRafRef.current);
      videoReadyRafRef.current = null;
    }
  }, [videoPath]);

  useEffect(() => {
    const video = facecamVideoRef.current;
    if (!video) {
      return;
    }

    video.pause();
    video.currentTime = 0;
    setFacecamReady(false);
  }, [facecamVideoPath]);



  useEffect(() => {
    if (!pixiReady || !videoReady) return;

    const video = videoRef.current;
    const app = appRef.current;
    const videoContainer = videoContainerRef.current;
    const cursorContainer = cursorContainerRef.current;
    
    if (!video || !app || !videoContainer || !cursorContainer) return;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;
    
    const source = VideoSource.from(video);
    if ('autoPlay' in source) {
      (source as { autoPlay?: boolean }).autoPlay = false;
    }
    if ('autoUpdate' in source) {
      (source as { autoUpdate?: boolean }).autoUpdate = true;
    }
    const videoTexture = Texture.from(source);
    
    const videoSprite = new Sprite(videoTexture);
    videoSpriteRef.current = videoSprite;
    
    const maskGraphics = new Graphics();
    videoContainer.addChild(videoSprite);
    videoContainer.addChild(maskGraphics);
    videoContainer.mask = maskGraphics;
    maskGraphicsRef.current = maskGraphics;
    if (cursorOverlayRef.current) {
      cursorContainer.addChild(cursorOverlayRef.current.container);
    }

    animationStateRef.current = createPlaybackAnimationState();

    const blurFilter = new BlurFilter();
    blurFilter.quality = 3;
    blurFilter.resolution = app.renderer.resolution;
    blurFilter.blur = 0;
    const motionBlurFilter = new MotionBlurFilter([0, 0], 5, 0);
    videoContainer.filters = [blurFilter, motionBlurFilter];
    blurFilterRef.current = blurFilter;
    motionBlurFilterRef.current = motionBlurFilter;
    
    layoutVideoContent();
    video.pause();

    const { handlePlay, handlePause, handleSeeked, handleSeeking } = createVideoEventHandlers({
      video,
      isSeekingRef,
      isPlayingRef,
      allowPlaybackRef,
      currentTimeRef,
      timeUpdateAnimationRef,
      onPlayStateChange,
      onTimeUpdate,
      trimRegionsRef,
      speedRegionsRef,
    });
    
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handlePause);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('seeking', handleSeeking);
    
    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handlePause);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('seeking', handleSeeking);
      
      if (timeUpdateAnimationRef.current) {
        cancelAnimationFrame(timeUpdateAnimationRef.current);
      }
      
      if (videoSprite) {
        videoContainer.removeChild(videoSprite);
        videoSprite.destroy();
      }
      if (maskGraphics) {
        videoContainer.removeChild(maskGraphics);
        maskGraphics.destroy();
      }
      videoContainer.mask = null;
      maskGraphicsRef.current = null;
      if (blurFilterRef.current) {
        videoContainer.filters = [];
        blurFilterRef.current.destroy();
        blurFilterRef.current = null;
      }
      if (motionBlurFilterRef.current) {
        motionBlurFilterRef.current.destroy();
        motionBlurFilterRef.current = null;
      }
      videoTexture.destroy(false);
      
      videoSpriteRef.current = null;
    };
  }, [pixiReady, videoReady, onTimeUpdate, updateOverlayForRegion]);

  useEffect(() => {
    if (!pixiReady || !facecamReady || !facecamVideoPath) {
      const facecamContainer = facecamContainerRef.current;
      if (facecamContainer) {
        facecamContainer.visible = false;
      }
      return;
    }

    const facecamVideo = facecamVideoRef.current;
    const app = appRef.current;
    const facecamContainer = facecamContainerRef.current;

    if (!facecamVideo || !app || !facecamContainer) {
      return;
    }

    const source = VideoSource.from(facecamVideo);
    if ('autoPlay' in source) {
      (source as { autoPlay?: boolean }).autoPlay = false;
    }
    if ('autoUpdate' in source) {
      (source as { autoUpdate?: boolean }).autoUpdate = true;
    }
    const facecamTexture = Texture.from(source);
    const facecamSprite = new Sprite(facecamTexture);
    const facecamMask = new Graphics();
    const facecamBorder = new Graphics();

    facecamSpriteRef.current = facecamSprite;
    facecamMaskRef.current = facecamMask;
    facecamBorderRef.current = facecamBorder;

    facecamContainer.addChild(facecamSprite);
    facecamContainer.addChild(facecamMask);
    facecamContainer.addChild(facecamBorder);
    facecamContainer.mask = facecamMask;

    layoutFacecamOverlay();

    return () => {
      facecamContainer.visible = false;
      facecamContainer.mask = null;
      facecamContainer.removeChildren();

      facecamBorder.destroy();
      facecamMask.destroy();
      facecamSprite.destroy();
      facecamTexture.destroy(false);

      facecamSpriteRef.current = null;
      facecamMaskRef.current = null;
      facecamBorderRef.current = null;
    };
  }, [pixiReady, facecamReady, facecamVideoPath, layoutFacecamOverlay]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;

      const app = appRef.current;
      const videoSprite = videoSpriteRef.current;
      const videoContainer = videoContainerRef.current;
      const primaryVideo = videoRef.current;
      if (!app || !videoSprite || !videoContainer || !primaryVideo) return;

    const applyTransform = (
      transform: { scale: number; x: number; y: number },
      focus: ZoomFocus,
      motionIntensity: number,
      motionVector: { x: number; y: number },
    ) => {
      const cameraContainer = cameraContainerRef.current;
      if (!cameraContainer) return;

      const state = animationStateRef.current;

      const appliedTransform = applyZoomTransform({
        cameraContainer,
        blurFilter: blurFilterRef.current,
        stageSize: stageSizeRef.current,
        baseMask: baseMaskRef.current,
        zoomScale: state.scale,
        zoomProgress: state.progress,
        focusX: focus.cx,
        focusY: focus.cy,
        motionIntensity,
        motionVector,
        isPlaying: isPlayingRef.current,
        motionBlurAmount: zoomMotionBlurRef.current,
        motionBlurFilter: motionBlurFilterRef.current,
        transformOverride: transform,
        motionBlurState: motionBlurStateRef.current,
        frameTimeMs: performance.now(),
      });

      state.x = appliedTransform.x;
      state.y = appliedTransform.y;
      state.appliedScale = appliedTransform.scale;
    };

    const ticker = () => {
      const { region, strength, blendedScale, transition } = findDominantRegion(
        zoomRegionsRef.current,
        currentTimeRef.current,
        {
          connectZooms: connectZoomsRef.current,
        },
      );
      
      const defaultFocus = DEFAULT_FOCUS;
      let targetScaleFactor = 1;
      let targetFocus = defaultFocus;
      let targetProgress = 0;

      // If a zoom is selected but video is not playing, show default unzoomed view
      // (the overlay will show where the zoom will be)
      const selectedId = selectedZoomIdRef.current;
      const hasSelectedZoom = selectedId !== null;
      const shouldShowUnzoomedView = hasSelectedZoom && !isPlayingRef.current;

      if (region && strength > 0 && !shouldShowUnzoomedView) {
        const zoomScale = blendedScale ?? ZOOM_DEPTH_SCALES[region.depth];
        const regionFocus = region.focus;

        targetScaleFactor = zoomScale;
        targetFocus = regionFocus;
        targetProgress = strength;

        if (transition) {
          const startTransform = computeZoomTransform({
            stageSize: stageSizeRef.current,
            baseMask: baseMaskRef.current,
            zoomScale: transition.startScale,
            zoomProgress: 1,
            focusX: transition.startFocus.cx,
            focusY: transition.startFocus.cy,
          });
          const endTransform = computeZoomTransform({
            stageSize: stageSizeRef.current,
            baseMask: baseMaskRef.current,
            zoomScale: transition.endScale,
            zoomProgress: 1,
            focusX: transition.endFocus.cx,
            focusY: transition.endFocus.cy,
          });

          const interpolatedTransform = {
            scale: startTransform.scale + (endTransform.scale - startTransform.scale) * transition.progress,
            x: startTransform.x + (endTransform.x - startTransform.x) * transition.progress,
            y: startTransform.y + (endTransform.y - startTransform.y) * transition.progress,
          };

          targetScaleFactor = interpolatedTransform.scale;
          targetFocus = computeFocusFromTransform({
            stageSize: stageSizeRef.current,
            baseMask: baseMaskRef.current,
            zoomScale: interpolatedTransform.scale,
            x: interpolatedTransform.x,
            y: interpolatedTransform.y,
          });
          targetProgress = 1;
        }
      }

      const state = animationStateRef.current;
      const prevScale = state.appliedScale;
      const prevX = state.x;
      const prevY = state.y;

      state.scale = targetScaleFactor;
      state.focusX = targetFocus.cx;
      state.focusY = targetFocus.cy;
      state.progress = targetProgress;

      const projectedTransform = computeZoomTransform({
        stageSize: stageSizeRef.current,
        baseMask: baseMaskRef.current,
        zoomScale: state.scale,
        zoomProgress: state.progress,
        focusX: state.focusX,
        focusY: state.focusY,
      });

      const appliedScale = Math.abs(projectedTransform.scale - prevScale) < ZOOM_SCALE_DEADZONE
        ? projectedTransform.scale
        : projectedTransform.scale;
      const appliedX = Math.abs(projectedTransform.x - prevX) < ZOOM_TRANSLATION_DEADZONE_PX
        ? projectedTransform.x
        : projectedTransform.x;
      const appliedY = Math.abs(projectedTransform.y - prevY) < ZOOM_TRANSLATION_DEADZONE_PX
        ? projectedTransform.y
        : projectedTransform.y;

      const motionIntensity = Math.max(
        Math.abs(appliedScale - prevScale),
        Math.abs(appliedX - prevX) / Math.max(1, stageSizeRef.current.width),
        Math.abs(appliedY - prevY) / Math.max(1, stageSizeRef.current.height),
      );

      const motionVector = {
        x: appliedX - prevX,
        y: appliedY - prevY,
      };

      applyTransform({ scale: appliedScale, x: appliedX, y: appliedY }, targetFocus, motionIntensity, motionVector);

      const facecamVideo = facecamVideoRef.current;
      const activeFacecamSettings = facecamSettingsRef.current;
      if (
        facecamVideo
        && facecamVideo.readyState >= HTMLMediaElement.HAVE_METADATA
        && facecamVideoPath
        && activeFacecamSettings?.enabled
      ) {
        const targetTime = Math.max(0, currentTimeRef.current / 1000 - facecamOffsetMsRef.current / 1000);
        const withinDuration = !Number.isFinite(facecamVideo.duration) || targetTime <= facecamVideo.duration;

        facecamVideo.playbackRate = primaryVideo.playbackRate;

        if (!isPlayingRef.current || !withinDuration) {
          if (!facecamVideo.paused) {
            facecamVideo.pause();
          }
          if (withinDuration && Math.abs(facecamVideo.currentTime - targetTime) > 0.06) {
            facecamVideo.currentTime = targetTime;
          }
        } else {
          if (Math.abs(facecamVideo.currentTime - targetTime) > 0.12) {
            facecamVideo.currentTime = targetTime;
          }
          if (facecamVideo.paused) {
            facecamVideo.play().catch(() => {});
          }
        }
      }

      // Update cursor overlay
      const cursorOverlay = cursorOverlayRef.current;
      if (cursorOverlay) {
        const timeMs = currentTimeRef.current;
        cursorOverlay.update(
          cursorTelemetryRef.current,
          timeMs,
          baseMaskRef.current,
          showCursorRef.current,
          !isPlayingRef.current || isSeekingRef.current,
        );
      }
    };

    app.ticker.add(ticker);
    return () => {
      if (app && app.ticker) {
        app.ticker.remove(ticker);
      }
    };
  }, [pixiReady, videoReady, clampFocusToStage]);

  useEffect(() => {
    const overlay = cursorOverlayRef.current;
    if (!overlay) {
      return;
    }

    overlay.setDotRadius(DEFAULT_CURSOR_CONFIG.dotRadius * cursorSize);
    overlay.setSmoothingFactor(cursorSmoothing);
    overlay.setMotionBlur(cursorMotionBlur);
    overlay.setClickBounce(cursorClickBounce);
    overlay.reset();
  }, [cursorSize, cursorSmoothing, cursorMotionBlur, cursorClickBounce]);

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const video = e.currentTarget;
    onDurationChange(video.duration);
    video.currentTime = 0;
    video.pause();
    allowPlaybackRef.current = false;
    currentTimeRef.current = 0;

    if (videoReadyRafRef.current) {
      cancelAnimationFrame(videoReadyRafRef.current);
      videoReadyRafRef.current = null;
    }

    const waitForRenderableFrame = () => {
      const hasDimensions = video.videoWidth > 0 && video.videoHeight > 0;
      const hasData = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
      if (hasDimensions && hasData) {
        videoReadyRafRef.current = null;
        setVideoReady(true);
        return;
      }
      videoReadyRafRef.current = requestAnimationFrame(waitForRenderableFrame);
    };

    videoReadyRafRef.current = requestAnimationFrame(waitForRenderableFrame);
  };

  const handleFacecamLoadedMetadata = () => {
    const video = facecamVideoRef.current;
    if (!video) {
      return;
    }

    video.currentTime = 0;
    video.pause();
    setFacecamReady(true);
  };

  const [resolvedWallpaper, setResolvedWallpaper] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        if (!wallpaper) {
          const def = await getAssetPath(DEFAULT_WALLPAPER_RELATIVE_PATH)
          if (mounted) setResolvedWallpaper(def)
          return
        }

        if (wallpaper.startsWith('#') || wallpaper.startsWith('linear-gradient') || wallpaper.startsWith('radial-gradient')) {
          if (mounted) setResolvedWallpaper(wallpaper)
          return
        }

        // If it's a data URL (custom uploaded image), use as-is
        if (wallpaper.startsWith('data:')) {
          if (mounted) setResolvedWallpaper(wallpaper)
          return
        }

        if (wallpaper.startsWith('http') || wallpaper.startsWith('file://') || wallpaper.startsWith('/')) {
          const renderable = await getRenderableAssetUrl(wallpaper)
          if (mounted) setResolvedWallpaper(renderable)
          return
        }
        const p = await getRenderableAssetUrl(await getAssetPath(wallpaper.replace(/^\//, '')))
        if (mounted) setResolvedWallpaper(p)
      } catch (err) {
        if (mounted) setResolvedWallpaper(wallpaper || DEFAULT_WALLPAPER_PATH)
      }
    })()
    return () => { mounted = false }
  }, [wallpaper])

  useEffect(() => {
    return () => {
      if (videoReadyRafRef.current) {
        cancelAnimationFrame(videoReadyRafRef.current);
        videoReadyRafRef.current = null;
      }
    };
  }, [])

  const isImageUrl = Boolean(resolvedWallpaper && (resolvedWallpaper.startsWith('file://') || resolvedWallpaper.startsWith('http') || resolvedWallpaper.startsWith('/') || resolvedWallpaper.startsWith('data:')))
  const backgroundStyle = isImageUrl
    ? { backgroundImage: `url(${resolvedWallpaper || ''})` }
    : { background: resolvedWallpaper || '' };

  const nativeAspectRatio = (() => {
    const locked = lockedVideoDimensionsRef.current;
    if (locked && locked.height > 0) {
      return locked.width / locked.height;
    }
    const video = videoRef.current;
    if (video && video.videoHeight > 0) {
      return video.videoWidth / video.videoHeight;
    }
    return 16 / 9;
  })();

  return (
    <div className="relative rounded-sm overflow-hidden" style={{ width: '100%', aspectRatio: formatAspectRatioForCSS(aspectRatio, nativeAspectRatio) }}>
      {/* Background layer */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          ...backgroundStyle,
          filter: backgroundBlur > 0 ? `blur(${backgroundBlur}px)` : 'none',
        }}
      />
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{
          filter: (showShadow && shadowIntensity > 0)
            ? `drop-shadow(0 ${shadowIntensity * 12}px ${shadowIntensity * 48}px rgba(0,0,0,${shadowIntensity * 0.7})) drop-shadow(0 ${shadowIntensity * 4}px ${shadowIntensity * 16}px rgba(0,0,0,${shadowIntensity * 0.5})) drop-shadow(0 ${shadowIntensity * 2}px ${shadowIntensity * 8}px rgba(0,0,0,${shadowIntensity * 0.3}))`
            : 'none',
        }}
      />
      {/* Only render overlay after PIXI and video are fully initialized */}
      {pixiReady && videoReady && (
        <div
          ref={overlayRef}
          className="absolute inset-0 select-none"
          style={{ pointerEvents: 'none' }}
          onPointerDown={handleOverlayPointerDown}
          onPointerMove={handleOverlayPointerMove}
          onPointerUp={handleOverlayPointerUp}
          onPointerLeave={handleOverlayPointerLeave}
        >
          <div
            ref={focusIndicatorRef}
            className="absolute rounded-md border border-[#2563EB]/80 bg-[#2563EB]/20 shadow-[0_0_0_1px_rgba(37,99,235,0.35)]"
            style={{ display: 'none', pointerEvents: 'none' }}
          />
          {(() => {
            const filtered = (annotationRegions || []).filter((annotation) => {
              if (typeof annotation.startMs !== 'number' || typeof annotation.endMs !== 'number') return false;
              
              if (annotation.id === selectedAnnotationId) return true;
              
              const timeMs = Math.round(currentTime * 1000);
              return timeMs >= annotation.startMs && timeMs <= annotation.endMs;
            });
            
            // Sort by z-index (lowest to highest) so higher z-index renders on top
            const sorted = [...filtered].sort((a, b) => a.zIndex - b.zIndex);
            
            // Handle click-through cycling: when clicking same annotation, cycle to next
            const handleAnnotationClick = (clickedId: string) => {
              if (!onSelectAnnotation) return;
              
              // If clicking on already selected annotation and there are multiple overlapping
              if (clickedId === selectedAnnotationId && sorted.length > 1) {
                // Find current index and cycle to next
                const currentIndex = sorted.findIndex(a => a.id === clickedId);
                const nextIndex = (currentIndex + 1) % sorted.length;
                onSelectAnnotation(sorted[nextIndex].id);
              } else {
                // First click or clicking different annotation
                onSelectAnnotation(clickedId);
              }
            };
            
            return sorted.map((annotation) => (
              <AnnotationOverlay
                key={annotation.id}
                annotation={annotation}
                isSelected={annotation.id === selectedAnnotationId}
                containerWidth={overlayRef.current?.clientWidth || 800}
                containerHeight={overlayRef.current?.clientHeight || 600}
                onPositionChange={(id, position) => onAnnotationPositionChange?.(id, position)}
                onSizeChange={(id, size) => onAnnotationSizeChange?.(id, size)}
                onClick={handleAnnotationClick}
                zIndex={annotation.zIndex}
                isSelectedBoost={annotation.id === selectedAnnotationId}
              />
            ));
          })()}
        </div>
      )}
      <video
        ref={videoRef}
        src={videoPath}
        className="hidden"
        preload="metadata"
        playsInline
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={e => {
          onDurationChange(e.currentTarget.duration);
        }}
        onError={() => onError('Failed to load video')}
      />
      {facecamVideoPath && (
        <video
          ref={facecamVideoRef}
          src={facecamVideoPath}
          className="hidden"
          preload="metadata"
          muted
          playsInline
          onLoadedMetadata={handleFacecamLoadedMetadata}
          onError={() => setFacecamReady(false)}
        />
      )}
    </div>
  );
});

VideoPlayback.displayName = 'VideoPlayback';

export default VideoPlayback;
