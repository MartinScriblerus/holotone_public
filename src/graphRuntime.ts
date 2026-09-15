/**
 * AGPL Holotone — Hydra graph sketch runner (ported from StrangeLoop hydraGraphRuntime).
 * Resolves params from snapshot chains + live music bag (updated every postMessage).
 */

export type MusicVariableSource =
  | "none"
  | "count"
  | "bpm"
  | "beat"
  | "onsets"
  | "rms"
  | "impact"
  | "pulse"
  | "motion"
  | "meydaRms"
  | "meydaFlatness"
  | "meydaZcr"
  | "meydaFlux"
  | "meydaCentroid"
  | "meydaLow"
  | "meydaMid"
  | "meydaHigh";

export type MusicOperator = "none" | "multiply" | "divide" | "add" | "subtract" | "power" | "sqrt" | "log";

export type HydraControlParam = {
  value: number;
  min: number;
  max: number;
  step?: number;
  musicSource: MusicVariableSource;
  musicOperator: MusicOperator;
  musicOperand: number;
};

export type HydraOperationChain = {
  id: string;
  type: "source" | "transform" | "compositor";
  operation: string;
  enabled: boolean;
  params: Record<string, HydraControlParam>;
  parentId?: string;
  order: number;
  innerSourceId?: string;
};

export type PerformanceMusicData = {
  bpm: number;
  beat: number;
  count: number;
  onsets: number;
  energy: number;
  impact: number;
  pulse: number;
  motion: number;
  meydaRms: number;
  meydaFlatness: number;
  meydaZcr: number;
  meydaFlux: number;
  meydaCentroid: number;
  meydaLow: number;
  meydaMid: number;
  meydaHigh: number;
};

export type VisualOverlayRgb = { r: number; g: number; b: number };
export type VisualCvMix = {
  master: number;
  onsets: number;
  beat: number;
  impact: number;
  pulse: number;
  energy: number;
};

type HydraNode = Record<string, (...args: unknown[]) => unknown> & {
  out?: () => void;
  add?: (other: unknown) => unknown;
  blend?: (other: unknown, amount?: unknown) => unknown;
  layer?: (other: unknown, amount?: unknown) => unknown;
  color?: (r: number, g: number, b: number) => unknown;
};

let liveChains: HydraOperationChain[] = [];
let liveMusic: PerformanceMusicData = {
  bpm: 120,
  beat: 0,
  count: 0,
  onsets: 0,
  energy: 0,
  impact: 0,
  pulse: 0,
  motion: 0,
  meydaRms: 0,
  meydaFlatness: 0,
  meydaZcr: 0,
  meydaFlux: 0,
  meydaCentroid: 0,
  meydaLow: 0,
  meydaMid: 0,
  meydaHigh: 0,
};
let liveOverlay: VisualOverlayRgb = { r: 1, g: 1, b: 1 };

export function setGraphChains(chains: HydraOperationChain[]): void {
  liveChains = chains;
}

export function setLiveMusicData(data: PerformanceMusicData): void {
  liveMusic = data;
}

export function setLiveOverlay(overlay: VisualOverlayRgb): void {
  liveOverlay = overlay;
}

export function buildMusicFromSnapshot(args: {
  performance?: Partial<PerformanceMusicData> | null;
  meyda?: Partial<{
    rms: number;
    flatness: number;
    zcr: number;
    flux: number;
    centroid: number;
    low: number;
    mid: number;
    high: number;
  }> | null;
  cvMix?: Partial<VisualCvMix> | null;
}): PerformanceMusicData {
  const p = args.performance ?? {};
  const mix = args.cvMix ?? {};
  const energyScale = typeof mix.energy === "number" ? mix.energy : 1;
  const beatScale = typeof mix.beat === "number" ? mix.beat : 1;
  const onsetsScale = typeof mix.onsets === "number" ? mix.onsets : 1;
  const impactScale = typeof mix.impact === "number" ? mix.impact : 1;
  const pulseScale = typeof mix.pulse === "number" ? mix.pulse : 1;
  const m = args.meyda ?? {};
  return {
    bpm: p.bpm ?? 120,
    count: p.count ?? 0,
    beat: (p.beat ?? 0) * beatScale,
    onsets: (p.onsets ?? 0) * onsetsScale,
    energy: (p.energy ?? 0) * energyScale,
    impact: (p.impact ?? 0) * impactScale,
    pulse: (p.pulse ?? 0) * pulseScale,
    motion: p.motion ?? 0,
    meydaRms: m.rms ?? 0,
    meydaFlatness: m.flatness ?? 0,
    meydaZcr: m.zcr ?? 0,
    meydaFlux: m.flux ?? 0,
    meydaCentroid: m.centroid ?? 0,
    meydaLow: m.low ?? 0,
    meydaMid: m.mid ?? 0,
    meydaHigh: m.high ?? 0,
  };
}

function g(): HydraNode {
  return globalThis as unknown as HydraNode;
}

function readMusicValue(source: MusicVariableSource, music: PerformanceMusicData): number {
  switch (source) {
    case "count":
      return music.count;
    case "bpm":
      return music.bpm;
    case "beat":
      return music.beat;
    case "onsets":
      return music.onsets;
    case "rms":
      return music.energy;
    case "impact":
      return music.impact;
    case "pulse":
      return music.pulse;
    case "motion":
      return music.motion;
    case "meydaRms":
      return music.meydaRms;
    case "meydaFlatness":
      return music.meydaFlatness;
    case "meydaZcr":
      return music.meydaZcr;
    case "meydaFlux":
      return music.meydaFlux;
    case "meydaCentroid":
      return music.meydaCentroid;
    case "meydaLow":
      return music.meydaLow;
    case "meydaMid":
      return music.meydaMid;
    case "meydaHigh":
      return music.meydaHigh;
    default:
      return 0;
  }
}

function normalizeMusicValue(source: MusicVariableSource, raw: number): number {
  switch (source) {
    case "bpm":
      return Math.max(0, Math.min(1, (raw - 40) / 160));
    case "count":
      return Math.max(0, Math.min(1, (raw % 128) / 128));
    default:
      return Math.max(0, Math.min(1, raw));
  }
}

function applyMusicOperator(
  baseValue: number,
  norm: number,
  op: MusicOperator,
  operand: number,
  span: number,
): number {
  const k = Number.isFinite(operand) ? Math.max(0, operand) : 1;
  const n = Math.max(0, Math.min(1, norm));
  switch (op) {
    case "multiply":
      // Depth k × signal × param span. Works when base is 0 (old base*(1+n*k) was a no-op).
      return baseValue + n * span * k;
    case "divide":
      return k > 0 ? baseValue + n * span / (1 + k) : baseValue;
    case "add":
      return baseValue + n * k;
    case "subtract":
      return baseValue - n * k;
    case "power":
      return baseValue + Math.pow(n, Math.max(0.01, k)) * span * 0.5;
    case "sqrt":
      return baseValue + Math.sqrt(n) * span * Math.max(0.01, k);
    case "log":
      return baseValue + Math.log(n + 0.001) * span * k * 0.15;
    case "none":
    default:
      return baseValue + n * span;
  }
}

function resolveParamValue(paramConfig: HydraControlParam, musicData: PerformanceMusicData): number {
  const span = Math.max(0.000001, paramConfig.max - paramConfig.min);
  let value = paramConfig.value;
  if (paramConfig.musicSource !== "none") {
    const raw = readMusicValue(paramConfig.musicSource, musicData);
    const norm = normalizeMusicValue(paramConfig.musicSource, raw);
    value = applyMusicOperator(
      value,
      norm,
      paramConfig.musicOperator,
      paramConfig.musicOperand,
      span,
    );
  }
  return Math.max(paramConfig.min, Math.min(paramConfig.max, value));
}

function getParamValue(chainId: string, param: string): number {
  const chain = liveChains.find((c) => c.id === chainId);
  const cfg = chain?.params?.[param];
  if (!cfg) {
    return 0;
  }
  return resolveParamValue(cfg, liveMusic);
}

function defaultInnerPlaceholder(): unknown {
  return g().solid?.(0.02, 0.02, 0.03) ?? null;
}

function mergeSiblingSource(base: unknown, next: unknown): unknown {
  if (!base || typeof base !== "object" || !next) {
    return next ?? base;
  }
  const node = base as HydraNode;
  if (typeof node.blend === "function") {
    return node.blend(next, 0.5) ?? base;
  }
  if (typeof node.add === "function") {
    return node.add(next) ?? base;
  }
  if (typeof node.layer === "function") {
    return node.layer(next) ?? base;
  }
  return next;
}

export type GraphSketchOptions = { videoReady: boolean };

function isS0MediaBound(): boolean {
  const s0 = g().s0 as { src?: unknown } | undefined;
  return Boolean(s0?.src);
}

function buildS0Source(videoReady: boolean): unknown {
  if (!videoReady || !isS0MediaBound()) {
    return g().solid?.(0.05, 0.05, 0.08);
  }
  const chain = g().src?.(g().s0);
  if (chain && typeof (chain as HydraNode).color === "function") {
    return (chain as HydraNode).color!(1, 1, 1);
  }
  return chain ?? g().solid?.(0.05, 0.05, 0.08);
}

function buildSourceChain(chain: HydraOperationChain, opts: GraphSketchOptions): unknown {
  const gg = g();
  const id = chain.id;
  switch (chain.operation) {
    case "osc":
      return gg.osc?.(
        () => getParamValue(id, "freq"),
        () => getParamValue(id, "sync"),
        () => getParamValue(id, "offset"),
      );
    case "noise":
      return gg.noise?.(() => getParamValue(id, "scale"));
    case "shape":
      return gg.shape?.(
        () => getParamValue(id, "sides"),
        () => getParamValue(id, "radius"),
      );
    case "gradient":
      return gg.gradient?.(() => getParamValue(id, "speed") ?? 1);
    case "voronoi":
      return gg.voronoi?.(
        () => getParamValue(id, "scale"),
        () => getParamValue(id, "speed"),
      );
    case "src":
      return buildS0Source(opts.videoReady);
    default:
      return null;
  }
}

function applyTransformOp(base: unknown, chain: HydraOperationChain): unknown {
  if (!base || typeof base !== "object") {
    return base;
  }
  const node = base as HydraNode;
  const id = chain.id;
  switch (chain.operation) {
    case "repeat":
      return node.repeat?.(
        () => getParamValue(id, "x"),
        () => getParamValue(id, "y"),
      ) ?? base;
    case "kaleid":
      return node.kaleid?.(() => getParamValue(id, "sides")) ?? base;
    case "pixelate": {
      const px = () => getParamValue(id, "amount");
      return node.pixelate?.(px, px) ?? base;
    }
    case "rotate":
      return node.rotate?.(
        () => getParamValue(id, "angle"),
        () => getParamValue(id, "speed"),
      ) ?? base;
    case "scale":
      return node.scale?.(() => getParamValue(id, "amount")) ?? base;
    case "scrollX":
      return node.scrollX?.(
        () => getParamValue(id, "amount"),
        () => getParamValue(id, "speed"),
      ) ?? base;
    case "scrollY":
      return node.scrollY?.(
        () => getParamValue(id, "amount"),
        () => getParamValue(id, "speed"),
      ) ?? base;
    case "colorama":
      return node.colorama?.(() => getParamValue(id, "amount")) ?? base;
    case "saturate":
      return node.saturate?.(() => getParamValue(id, "amount")) ?? base;
    case "contrast":
      return node.contrast?.(() => getParamValue(id, "amount")) ?? base;
    case "brightness":
      return node.brightness?.(() => getParamValue(id, "amount")) ?? base;
    case "hue":
      return node.hue?.(() => getParamValue(id, "amount")) ?? base;
    case "posterize":
      return node.posterize?.(() => getParamValue(id, "levels")) ?? base;
    case "invert":
      return node.invert?.(() => getParamValue(id, "amount")) ?? base;
    case "luma":
      return node.luma?.(() => getParamValue(id, "threshold")) ?? base;
    default:
      return base;
  }
}

function buildInnerSource(
  chains: readonly HydraOperationChain[],
  innerSourceId: string | undefined,
  opts: GraphSketchOptions,
  visited: Set<string>,
): unknown {
  if (!innerSourceId) {
    return defaultInnerPlaceholder();
  }
  const innerChain = chains.find((c) => c.id === innerSourceId && c.enabled);
  if (!innerChain) {
    return defaultInnerPlaceholder();
  }
  return buildChainFromNested(chains, innerChain.id, null, opts, new Set(visited));
}

function applyCompositorOp(
  base: unknown,
  chain: HydraOperationChain,
  chains: readonly HydraOperationChain[],
  opts: GraphSketchOptions,
  visited: Set<string>,
): unknown {
  if (!base || typeof base !== "object") {
    return base;
  }
  const node = base as HydraNode;
  const inner = buildInnerSource(chains, chain.innerSourceId, opts, visited) ?? defaultInnerPlaceholder();
  const id = chain.id;
  const amt = () => getParamValue(id, "amount");

  switch (chain.operation) {
    case "modulate":
      return node.modulate?.(inner, amt) ?? base;
    case "modulateHue":
      return node.modulateHue?.(inner, amt) ?? base;
    case "modulateScale":
      return node.modulateScale?.(inner, amt) ?? base;
    case "modulateRotate":
      return node.modulateRotate?.(inner, amt) ?? base;
    case "blend":
      return node.blend?.(inner, amt) ?? base;
    case "add":
      return node.add?.(inner) ?? base;
    case "mult":
      return node.mult?.(inner) ?? base;
    case "diff":
      return node.diff?.(inner) ?? base;
    case "layer":
      return node.layer?.(inner, amt) ?? base;
    case "mask":
      return node.mask?.(inner) ?? base;
    default:
      return base;
  }
}

function buildChainFromNested(
  chains: readonly HydraOperationChain[],
  parentId: string | undefined,
  baseChain: unknown,
  opts: GraphSketchOptions,
  visited: Set<string> = new Set(),
): unknown {
  const childChains = chains
    .filter((c) => c.enabled && c.parentId === parentId)
    .sort((a, b) => a.order - b.order);

  let result = baseChain;

  for (const chain of childChains) {
    if (visited.has(chain.id)) {
      continue;
    }
    visited.add(chain.id);

    if (chain.type === "source") {
      if (result && chain.operation !== "src") {
        const nested = buildChainFromNested(chains, chain.id, null, opts, new Set(visited));
        if (nested) {
          result = mergeSiblingSource(result, nested);
          visited.delete(chain.id);
          continue;
        }
        const fallback = buildSourceChain(chain, opts);
        if (fallback) {
          const built = buildChainFromNested(chains, chain.id, fallback, opts, new Set(visited));
          result = mergeSiblingSource(result, built ?? fallback);
          visited.delete(chain.id);
          continue;
        }
      } else if (!result) {
        const sourceChain = buildSourceChain(chain, opts);
        if (sourceChain) {
          result = buildChainFromNested(chains, chain.id, sourceChain, opts, new Set(visited)) ?? sourceChain;
        }
      }
    } else if (chain.type === "transform") {
      if (!result) {
        visited.delete(chain.id);
        continue;
      }
      result = applyTransformOp(result, chain);
      result = buildChainFromNested(chains, chain.id, result, opts, new Set(visited));
    } else if (chain.type === "compositor") {
      if (!result) {
        visited.delete(chain.id);
        continue;
      }
      result = applyCompositorOp(result, chain, chains, opts, visited);
      result = buildChainFromNested(chains, chain.id, result, opts, new Set(visited));
    }

    visited.delete(chain.id);
  }

  return result;
}

function applyRootChainOperation(
  baseChain: unknown,
  chain: HydraOperationChain,
  allChains: readonly HydraOperationChain[],
  opts: GraphSketchOptions,
): unknown {
  if (!baseChain || !chain.enabled) {
    return baseChain;
  }
  if (chain.type === "transform") {
    return applyTransformOp(baseChain, chain);
  }
  if (chain.type === "compositor") {
    return applyCompositorOp(baseChain, chain, allChains, opts, new Set());
  }
  return baseChain;
}

function applyOutputTint(base: unknown, overlay: VisualOverlayRgb): unknown {
  if (!base || typeof base !== "object") {
    return base;
  }
  const nearWhite =
    Math.abs(overlay.r - 1) < 0.001
    && Math.abs(overlay.g - 1) < 0.001
    && Math.abs(overlay.b - 1) < 0.001;
  if (nearWhite) {
    return base;
  }
  const node = base as HydraNode;
  if (typeof node.color !== "function") {
    return base;
  }
  return node.color(overlay.r, overlay.g, overlay.b);
}

function fallbackOut(): void {
  const chain = g().osc?.(1, 0.05, 0);
  if (chain && typeof (chain as HydraNode).out === "function") {
    (chain as HydraNode).out!();
    return;
  }
  const solid = g().solid?.(0.08, 0.08, 0.12);
  if (solid && typeof (solid as HydraNode).out === "function") {
    (solid as HydraNode).out!();
  }
}

function runGraphSketchInner(chains: readonly HydraOperationChain[], opts: GraphSketchOptions): void {
  const allChains = chains.filter((c) => c.enabled);
  const rootChains = allChains.filter((c) => !c.parentId).sort((a, b) => a.order - b.order);

  if (rootChains.length === 0) {
    if (opts.videoReady && isS0MediaBound()) {
      const src = buildS0Source(true);
      if (src && typeof (src as HydraNode).out === "function") {
        applyOutputTint(src, liveOverlay);
        (src as HydraNode).out!();
        return;
      }
    }
    fallbackOut();
    return;
  }

  const rootSources = rootChains.filter((c) => c.type === "source").sort((a, b) => a.order - b.order);
  const rootTransforms = rootChains.filter((c) => c.type === "transform").sort((a, b) => a.order - b.order);
  const rootCompositors = rootChains.filter((c) => c.type === "compositor").sort((a, b) => a.order - b.order);

  const videoNode = rootSources.find((s) => s.operation === "src");
  let finalChain: unknown = null;

  if (videoNode) {
    finalChain = buildS0Source(opts.videoReady);
    finalChain = buildChainFromNested(allChains, videoNode.id, finalChain, opts);
    if (finalChain) {
      for (const source of rootSources) {
        if (source.id === videoNode.id || !source.enabled) {
          continue;
        }
        const sc = buildChainFromNested(allChains, source.id, null, opts);
        if (sc) {
          finalChain = mergeSiblingSource(finalChain, sc);
        }
      }
    }
  } else if (rootSources.length > 0) {
    const first = rootSources[0];
    finalChain = buildChainFromNested(allChains, first.id, null, opts);
    if (finalChain) {
      for (const source of rootSources.slice(1)) {
        if (source.operation !== "src" && source.enabled) {
          const sc = buildChainFromNested(allChains, source.id, null, opts);
          if (sc) {
            finalChain = mergeSiblingSource(finalChain, sc);
          }
        }
      }
    }
  } else if (g().s0 && opts.videoReady) {
    finalChain = buildS0Source(opts.videoReady);
  } else {
    finalChain = g().solid?.(0.1, 0.1, 0.1);
  }

  for (const transform of rootTransforms) {
    finalChain = applyRootChainOperation(finalChain, transform, allChains, opts);
    finalChain = buildChainFromNested(allChains, transform.id, finalChain, opts);
  }

  for (const compositor of rootCompositors) {
    finalChain = applyRootChainOperation(finalChain, compositor, allChains, opts);
    finalChain = buildChainFromNested(allChains, compositor.id, finalChain, opts);
  }

  if (finalChain && typeof (finalChain as HydraNode).out === "function") {
    finalChain = applyOutputTint(finalChain, liveOverlay);
    (finalChain as HydraNode).out!();
    return;
  }

  fallbackOut();
}

/** Compile graph once; param arrows read liveMusic every Hydra frame. */
export function runGraphSketch(chains: readonly HydraOperationChain[], opts: GraphSketchOptions): void {
  setGraphChains([...chains]);
  try {
    runGraphSketchInner(chains, opts);
  } catch (err) {
    console.warn("[holotone] sketch failed", err);
    fallbackOut();
  }
}

export function isHydraGraphPayload(value: unknown): value is { revision: number; chains: HydraOperationChain[] } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as { revision?: unknown; chains?: unknown };
  return typeof v.revision === "number" && Array.isArray(v.chains);
}
