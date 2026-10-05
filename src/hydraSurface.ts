import Hydra from "hydra-synth";

export type HydraSurfaceOptions = {
  /** Cap internal render size (embed preview). Display still CSS-scales. */
  maxWidth?: number;
  maxHeight?: number;
};

export type HydraSurface = {
  canvas: HTMLCanvasElement;
  hydra: InstanceType<typeof Hydra>;
  dispose: () => void;
  resize: () => void;
};

/** Minimal AGPL host — boot sketch until parent sends a graph snapshot. */
export function createHydraSurface(
  container: HTMLElement,
  options: HydraSurfaceOptions = {},
): HydraSurface {
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  // Preview must never steal pointer events from the parent instrument UI.
  canvas.style.pointerEvents = "none";
  container.appendChild(canvas);

  const hydra = new Hydra({
    canvas,
    detectAudio: false,
    makeGlobal: true,
  }) as InstanceType<typeof Hydra> & {
    setResolution?: (w: number, h: number) => void;
  };

  // Preview: 30 fps is plenty and frees the GPU/CPU for the audio engine.
  (hydra as unknown as { synth: { fps?: number } }).synth.fps = options.maxWidth ? 30 : undefined;

  const resize = () => {
    let w = container.clientWidth || window.innerWidth;
    let h = container.clientHeight || window.innerHeight;
    if (w <= 0 || h <= 0) {
      return;
    }
    const maxW = options.maxWidth;
    const maxH = options.maxHeight;
    if (maxW && w > maxW) {
      h = Math.round((h * maxW) / w);
      w = maxW;
    }
    if (maxH && h > maxH) {
      w = Math.round((w * maxH) / h);
      h = maxH;
    }
    // Prefer even dims for WebGL.
    w = Math.max(2, w - (w % 2));
    h = Math.max(2, h - (h % 2));
    if (typeof hydra.setResolution === "function") {
      hydra.setResolution(w, h);
    } else {
      canvas.width = w;
      canvas.height = h;
    }
  };

  const g = globalThis as {
    osc?: (...args: unknown[]) => {
      color?: (...c: unknown[]) => { out?: () => void };
      out?: () => void;
    };
  };

  try {
    const chain = g.osc?.(2, 0.04, 0.2);
    chain?.color?.(0.12, 0.4, 0.85)?.out?.() ?? chain?.out?.();
  } catch (err) {
    console.warn("[holotone] boot sketch failed", err);
  }

  resize();
  window.addEventListener("resize", resize);
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  ro?.observe(container);

  return {
    canvas,
    hydra,
    resize,
    dispose: () => {
      window.removeEventListener("resize", resize);
      ro?.disconnect();
      try {
        (hydra as { sandbox?: { destroy?: () => void } }).sandbox?.destroy?.();
      } catch {
        /* ignore */
      }
      canvas.remove();
    },
  };
}
