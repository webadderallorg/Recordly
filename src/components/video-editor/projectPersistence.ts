import { ASPECT_RATIOS, type AspectRatio, isCustomAspectRatio } from "@/utils/aspectRatioUtils";
import type { ExportFormat, ExportQuality, GifFrameRate, GifSizePreset } from "@/lib/exporter";
import { normalizeFacecamSettings, type FacecamSettings } from "@/lib/recordingSession";
import { WALLPAPER_PATHS } from "@/lib/wallpapers";
import {
  DEFAULT_CURSOR_CLICK_BOUNCE,
  DEFAULT_CURSOR_MOTION_BLUR,
  DEFAULT_CURSOR_SIZE,
  DEFAULT_CURSOR_SMOOTHING,
  DEFAULT_ANNOTATION_POSITION,
  DEFAULT_ANNOTATION_SIZE,
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_CROP_REGION,
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_FIGURE_DATA,
  DEFAULT_ZOOM_DEPTH,
  DEFAULT_ZOOM_MOTION_BLUR,
  type AnnotationRegion,
  type CropRegion,
  type SpeedRegion,
  type TrimRegion,
  type ZoomRegion,
} from "./types";

export const PROJECT_VERSION = 2;

export interface ProjectEditorState {
  wallpaper: string;
  shadowIntensity: number;
  backgroundBlur: number;
  zoomMotionBlur: number;
  connectZooms: boolean;
  showCursor: boolean;
  loopCursor: boolean;
  cursorSize: number;
  cursorSmoothing: number;
  cursorMotionBlur: number;
  cursorClickBounce: number;
  borderRadius: number;
  padding: number;
  cropRegion: CropRegion;
  zoomRegions: ZoomRegion[];
  trimRegions: TrimRegion[];
  speedRegions: SpeedRegion[];
  annotationRegions: AnnotationRegion[];
  facecamSettings: FacecamSettings;
  aspectRatio: AspectRatio;
  exportQuality: ExportQuality;
  exportFormat: ExportFormat;
  gifFrameRate: GifFrameRate;
  gifLoop: boolean;
  gifSizePreset: GifSizePreset;
}

export interface EditorProjectData {
  version: number;
  videoPath: string;
  facecamVideoPath?: string;
  facecamOffsetMs?: number;
  editor: ProjectEditorState;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isFileUrl(value: string): boolean {
  return /^file:\/\//i.test(value);
}

function encodePathSegments(pathname: string, keepWindowsDrive = false): string {
  return pathname
    .split("/")
    .map((segment, index) => {
      if (!segment) return "";
      if (keepWindowsDrive && index === 1 && /^[a-zA-Z]:$/.test(segment)) {
        return segment;
      }
      return encodeURIComponent(segment);
    })
    .join("/");
}

export function toFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");

  // Windows drive path: C:/Users/...
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file://${encodePathSegments(`/${normalized}`, true)}`;
  }

  // UNC path: //server/share/...
  if (normalized.startsWith("//")) {
    const [host, ...pathParts] = normalized.replace(/^\/+/, "").split("/");
    const encodedPath = pathParts.map((part) => encodeURIComponent(part)).join("/");
    return encodedPath ? `file://${host}/${encodedPath}` : `file://${host}/`;
  }

  const absolutePath = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${encodePathSegments(absolutePath)}`;
}

export function fromFileUrl(fileUrl: string): string {
  const value = fileUrl.trim();
  if (!isFileUrl(value)) {
    return fileUrl;
  }

  try {
    const url = new URL(value);
    const pathname = decodeURIComponent(url.pathname);

    if (url.host && url.host !== "localhost") {
      const uncPath = `//${url.host}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
      return uncPath.replace(/\//g, "\\");
    }

    if (/^\/[A-Za-z]:/.test(pathname)) {
      return pathname.slice(1);
    }

    return pathname;
  } catch {
    const rawFallbackPath = value.replace(/^file:\/\//i, "");
    let fallbackPath = rawFallbackPath;
    try {
      fallbackPath = decodeURIComponent(rawFallbackPath);
    } catch {
      // Keep raw best-effort path if percent decoding fails.
    }
    return fallbackPath.replace(/^\/([a-zA-Z]:)/, "$1");
  }
}

export function deriveNextId(prefix: string, ids: string[]): number {
  const max = ids.reduce((acc, id) => {
    const match = id.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (!match) return acc;
    const value = Number(match[1]);
    return Number.isFinite(value) ? Math.max(acc, value) : acc;
  }, 0);
  return max + 1;
}

export function validateProjectData(candidate: unknown): candidate is EditorProjectData {
  if (!candidate || typeof candidate !== "object") return false;
  const project = candidate as Partial<EditorProjectData>;
  if (typeof project.version !== "number") return false;
  if (typeof project.videoPath !== "string" || !project.videoPath) return false;
  if (!project.editor || typeof project.editor !== "object") return false;
  return true;
}

export function normalizeProjectEditor(editor: Partial<ProjectEditorState>): ProjectEditorState {
  const validAspectRatios = new Set<AspectRatio>(ASPECT_RATIOS);
  const legacyMotionBlurEnabled = (editor as Partial<{ motionBlurEnabled: boolean }>).motionBlurEnabled;
  const legacyShowBlur = (editor as Partial<{ showBlur: boolean }>).showBlur;
  const normalizedZoomMotionBlur = isFiniteNumber((editor as Partial<ProjectEditorState>).zoomMotionBlur)
    ? clamp((editor as Partial<ProjectEditorState>).zoomMotionBlur as number, 0, 2)
    : legacyMotionBlurEnabled
      ? 0.35
      : DEFAULT_ZOOM_MOTION_BLUR;
  const normalizedBackgroundBlur = isFiniteNumber((editor as Partial<ProjectEditorState>).backgroundBlur)
    ? clamp((editor as Partial<ProjectEditorState>).backgroundBlur as number, 0, 8)
    : legacyShowBlur
      ? 2
      : 0;

  const normalizedZoomRegions: ZoomRegion[] = Array.isArray(editor.zoomRegions)
    ? editor.zoomRegions
        .filter((region): region is ZoomRegion => Boolean(region && typeof region.id === "string"))
        .map((region) => {
          const rawStart = isFiniteNumber(region.startMs) ? Math.round(region.startMs) : 0;
          const rawEnd = isFiniteNumber(region.endMs) ? Math.round(region.endMs) : rawStart + 1000;
          const startMs = Math.max(0, Math.min(rawStart, rawEnd));
          const endMs = Math.max(startMs + 1, rawEnd);

          return {
            id: region.id,
            startMs,
            endMs,
            depth: [1, 2, 3, 4, 5, 6].includes(region.depth) ? region.depth : DEFAULT_ZOOM_DEPTH,
            focus: {
              cx: clamp(isFiniteNumber(region.focus?.cx) ? region.focus.cx : 0.5, 0, 1),
              cy: clamp(isFiniteNumber(region.focus?.cy) ? region.focus.cy : 0.5, 0, 1),
            },
          };
        })
    : [];

  const normalizedTrimRegions: TrimRegion[] = Array.isArray(editor.trimRegions)
    ? editor.trimRegions
        .filter((region): region is TrimRegion => Boolean(region && typeof region.id === "string"))
        .map((region) => {
          const rawStart = isFiniteNumber(region.startMs) ? Math.round(region.startMs) : 0;
          const rawEnd = isFiniteNumber(region.endMs) ? Math.round(region.endMs) : rawStart + 1000;
          const startMs = Math.max(0, Math.min(rawStart, rawEnd));
          const endMs = Math.max(startMs + 1, rawEnd);
          return {
            id: region.id,
            startMs,
            endMs,
          };
        })
    : [];

  const normalizedSpeedRegions: SpeedRegion[] = Array.isArray(editor.speedRegions)
    ? editor.speedRegions
        .filter((region): region is SpeedRegion => Boolean(region && typeof region.id === "string"))
        .map((region) => {
          const rawStart = isFiniteNumber(region.startMs) ? Math.round(region.startMs) : 0;
          const rawEnd = isFiniteNumber(region.endMs) ? Math.round(region.endMs) : rawStart + 1000;
          const startMs = Math.max(0, Math.min(rawStart, rawEnd));
          const endMs = Math.max(startMs + 1, rawEnd);

          const speed =
            region.speed === 0.25 ||
            region.speed === 0.5 ||
            region.speed === 0.75 ||
            region.speed === 1.25 ||
            region.speed === 1.5 ||
            region.speed === 1.75 ||
            region.speed === 2
              ? region.speed
              : DEFAULT_PLAYBACK_SPEED;

          return {
            id: region.id,
            startMs,
            endMs,
            speed,
          };
        })
    : [];

  const normalizedAnnotationRegions: AnnotationRegion[] = Array.isArray(editor.annotationRegions)
    ? editor.annotationRegions
        .filter((region): region is AnnotationRegion => Boolean(region && typeof region.id === "string"))
        .map((region, index) => {
          const rawStart = isFiniteNumber(region.startMs) ? Math.round(region.startMs) : 0;
          const rawEnd = isFiniteNumber(region.endMs) ? Math.round(region.endMs) : rawStart + 1000;
          const startMs = Math.max(0, Math.min(rawStart, rawEnd));
          const endMs = Math.max(startMs + 1, rawEnd);

          return {
            id: region.id,
            startMs,
            endMs,
            type: region.type === "image" || region.type === "figure" ? region.type : "text",
            content: typeof region.content === "string" ? region.content : "",
            textContent: typeof region.textContent === "string" ? region.textContent : undefined,
            imageContent: typeof region.imageContent === "string" ? region.imageContent : undefined,
            position: {
              x: clamp(
                isFiniteNumber(region.position?.x) ? region.position.x : DEFAULT_ANNOTATION_POSITION.x,
                0,
                100,
              ),
              y: clamp(
                isFiniteNumber(region.position?.y) ? region.position.y : DEFAULT_ANNOTATION_POSITION.y,
                0,
                100,
              ),
            },
            size: {
              width: clamp(
                isFiniteNumber(region.size?.width) ? region.size.width : DEFAULT_ANNOTATION_SIZE.width,
                1,
                200,
              ),
              height: clamp(
                isFiniteNumber(region.size?.height) ? region.size.height : DEFAULT_ANNOTATION_SIZE.height,
                1,
                200,
              ),
            },
            style: {
              ...DEFAULT_ANNOTATION_STYLE,
              ...(region.style && typeof region.style === "object" ? region.style : {}),
            },
            zIndex: isFiniteNumber(region.zIndex) ? region.zIndex : index + 1,
            figureData: region.figureData
              ? {
                  ...DEFAULT_FIGURE_DATA,
                  ...region.figureData,
                }
              : undefined,
          };
        })
    : [];

  const normalizedFacecamSettings = normalizeFacecamSettings(
    (editor as Partial<ProjectEditorState>).facecamSettings,
  );

  const rawCropX = isFiniteNumber(editor.cropRegion?.x) ? editor.cropRegion.x : DEFAULT_CROP_REGION.x;
  const rawCropY = isFiniteNumber(editor.cropRegion?.y) ? editor.cropRegion.y : DEFAULT_CROP_REGION.y;
  const rawCropWidth = isFiniteNumber(editor.cropRegion?.width) ? editor.cropRegion.width : DEFAULT_CROP_REGION.width;
  const rawCropHeight = isFiniteNumber(editor.cropRegion?.height)
    ? editor.cropRegion.height
    : DEFAULT_CROP_REGION.height;

  const cropX = clamp(rawCropX, 0, 1);
  const cropY = clamp(rawCropY, 0, 1);
  const cropWidth = clamp(rawCropWidth, 0.01, 1 - cropX);
  const cropHeight = clamp(rawCropHeight, 0.01, 1 - cropY);

  return {
    wallpaper: typeof editor.wallpaper === "string" ? editor.wallpaper : WALLPAPER_PATHS[0],
    shadowIntensity: typeof editor.shadowIntensity === "number" ? editor.shadowIntensity : 0.67,
    backgroundBlur: normalizedBackgroundBlur,
    zoomMotionBlur: normalizedZoomMotionBlur,
    connectZooms: typeof editor.connectZooms === "boolean" ? editor.connectZooms : true,
    showCursor: typeof editor.showCursor === "boolean" ? editor.showCursor : true,
    loopCursor: typeof editor.loopCursor === "boolean" ? editor.loopCursor : false,
    cursorSize: isFiniteNumber(editor.cursorSize) ? clamp(editor.cursorSize, 0.5, 10) : DEFAULT_CURSOR_SIZE,
    cursorSmoothing: isFiniteNumber(editor.cursorSmoothing)
      ? clamp(editor.cursorSmoothing, 0, 2)
      : DEFAULT_CURSOR_SMOOTHING,
    cursorMotionBlur: isFiniteNumber((editor as Partial<ProjectEditorState>).cursorMotionBlur)
      ? clamp((editor as Partial<ProjectEditorState>).cursorMotionBlur as number, 0, 2)
      : DEFAULT_CURSOR_MOTION_BLUR,
    cursorClickBounce: isFiniteNumber((editor as Partial<ProjectEditorState>).cursorClickBounce)
      ? clamp((editor as Partial<ProjectEditorState>).cursorClickBounce as number, 0, 5)
      : DEFAULT_CURSOR_CLICK_BOUNCE,
    borderRadius: typeof editor.borderRadius === "number" ? editor.borderRadius : 12.5,
    padding: isFiniteNumber(editor.padding) ? clamp(editor.padding, 0, 100) : 50,
    cropRegion: {
      x: cropX,
      y: cropY,
      width: cropWidth,
      height: cropHeight,
    },
    zoomRegions: normalizedZoomRegions,
    trimRegions: normalizedTrimRegions,
    speedRegions: normalizedSpeedRegions,
    annotationRegions: normalizedAnnotationRegions,
    facecamSettings: normalizedFacecamSettings,
    aspectRatio:
      typeof editor.aspectRatio === "string" &&
      (validAspectRatios.has(editor.aspectRatio as AspectRatio) || isCustomAspectRatio(editor.aspectRatio))
        ? (editor.aspectRatio as AspectRatio)
        : "16:9",
    exportQuality: editor.exportQuality === "medium" || editor.exportQuality === "source" ? editor.exportQuality : "good",
    exportFormat: editor.exportFormat === "gif" ? "gif" : "mp4",
    gifFrameRate:
      editor.gifFrameRate === 15 ||
      editor.gifFrameRate === 20 ||
      editor.gifFrameRate === 25 ||
      editor.gifFrameRate === 30
        ? editor.gifFrameRate
        : 15,
    gifLoop: typeof editor.gifLoop === "boolean" ? editor.gifLoop : true,
    gifSizePreset:
      editor.gifSizePreset === "medium" || editor.gifSizePreset === "large" || editor.gifSizePreset === "original"
        ? editor.gifSizePreset
        : "medium",
  };
}

export function createProjectData(
  videoPath: string,
  editor: ProjectEditorState,
  options?: {
    facecamVideoPath?: string | null;
    facecamOffsetMs?: number;
  },
): EditorProjectData {
  const facecamVideoPath =
    typeof options?.facecamVideoPath === "string" && options.facecamVideoPath.trim()
      ? options.facecamVideoPath
      : undefined;
  const facecamOffsetMs =
    typeof options?.facecamOffsetMs === "number" && Number.isFinite(options.facecamOffsetMs)
      ? options.facecamOffsetMs
      : undefined;

  return {
    version: PROJECT_VERSION,
    videoPath,
    ...(facecamVideoPath ? { facecamVideoPath } : {}),
    ...(facecamOffsetMs !== undefined ? { facecamOffsetMs } : {}),
    editor,
  };
}
