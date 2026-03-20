import type { CropRegion } from "../types";

const CURSOR_VIEWPORT_EPSILON = 0.000001;

export interface CursorViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceCrop?: CropRegion;
}

export interface ProjectedCursorPosition {
  cx: number;
  cy: number;
  visible: boolean;
}

export function projectCursorPositionToViewport(
  position: { cx: number; cy: number },
  sourceCrop?: CropRegion,
): ProjectedCursorPosition {
  if (!sourceCrop) {
    return {
      cx: position.cx,
      cy: position.cy,
      visible: true,
    };
  }

  const cropWidth = sourceCrop.width;
  const cropHeight = sourceCrop.height;

  if (cropWidth <= 0 || cropHeight <= 0) {
    return {
      cx: position.cx,
      cy: position.cy,
      visible: false,
    };
  }

  const projectedX = (position.cx - sourceCrop.x) / cropWidth;
  const projectedY = (position.cy - sourceCrop.y) / cropHeight;
  const visible =
    projectedX >= -CURSOR_VIEWPORT_EPSILON &&
    projectedX <= 1 + CURSOR_VIEWPORT_EPSILON &&
    projectedY >= -CURSOR_VIEWPORT_EPSILON &&
    projectedY <= 1 + CURSOR_VIEWPORT_EPSILON;

  return {
    cx: projectedX,
    cy: projectedY,
    visible,
  };
}