/**
 * Center-zoom crop for camera / tab share.
 * Goal: trim browser chrome / YouTube UI bars — not force a rigid wall aspect.
 * Destination keeps the source's aspect (loose framing on the wall).
 */

export function clampFrameZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return 1;
  }
  return Math.max(1, Math.min(2.5, zoom));
}

export function videoSize(
  src: CanvasImageSource & { videoWidth?: number; videoHeight?: number; width?: number; height?: number },
): { w: number; h: number } {
  const w =
    typeof src.videoWidth === "number" && src.videoWidth > 0
      ? src.videoWidth
      : typeof src.width === "number"
        ? src.width
        : 0;
  const h =
    typeof src.videoHeight === "number" && src.videoHeight > 0
      ? src.videoHeight
      : typeof src.height === "number"
        ? src.height
        : 0;
  return { w, h };
}

/**
 * Draw the center of `src` scaled by `zoom` into the full dest canvas.
 * zoom 1 = full frame; 1.2–1.5 typically clears tab chrome / player bars.
 */
export function drawZoomCrop(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource & { videoWidth?: number; videoHeight?: number; width?: number; height?: number },
  destW: number,
  destH: number,
  zoom = 1,
): void {
  const { w: vw, h: vh } = videoSize(src);
  if (vw < 2 || vh < 2 || destW < 2 || destH < 2) {
    return;
  }
  const z = clampFrameZoom(zoom);
  const cropW = vw / z;
  const cropH = vh / z;
  const sx = (vw - cropW) * 0.5;
  const sy = (vh - cropH) * 0.5;
  ctx.drawImage(src, sx, sy, cropW, cropH, 0, 0, destW, destH);
}
