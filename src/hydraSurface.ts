import Hydra from "hydra-synth";

export type HydraSurface = {
  canvas: HTMLCanvasElement;
  hydra: InstanceType<typeof Hydra>;
  dispose: () => void;
  resize: () => void;
};

/** Minimal AGPL host — boot sketch until StrangeLoop graph runtime is ported. */
export function createHydraSurface(container: HTMLElement): HydraSurface {
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  container.appendChild(canvas);

  const hydra = new Hydra({
    canvas,
    detectAudio: false,
    makeGlobal: true,
  }) as InstanceType<typeof Hydra> & {
    setResolution?: (w: number, h: number) => void;
  };

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    if (w <= 0 || h <= 0) {
      return;
    }
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
