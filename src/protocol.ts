/**
 * Cross-origin protocol between StrangeLoop (parent) and holotone_public (iframe / popup).
 */

export const HOLOTONE_PROTOCOL = "holotone-hydra/v1" as const;

export type HolotoneEnvelope<T extends string, P = unknown> = {
  protocol: typeof HOLOTONE_PROTOCOL;
  type: T;
  payload?: P;
};

/** Full projection snapshot fields needed to run the Hydra graph remotely. */
export type LiveProjectionSnapshotLite = {
  v: 2;
  seq: number;
  sessionGuid: string;
  ts: number;
  performance?: {
    bpm: number;
    beat: number;
    count?: number;
    onsets?: number;
    energy: number;
    impact?: number;
    motion: number;
    pulse: number;
  };
  meyda?: {
    rms: number;
    flatness: number;
    zcr: number;
    flux: number;
    centroid: number;
    low: number;
    mid: number;
    high: number;
  };
  cvMix?: {
    master: number;
    onsets: number;
    beat: number;
    impact: number;
    pulse: number;
    energy: number;
  };
  overlay?: { r: number; g: number; b: number };
  media?: {
    videoUrl: string | null;
    videoLabel: string | null;
    cameraRequested: boolean;
    /** Tab/window/screen via getDisplayMedia on this origin. */
    screenRequested?: boolean;
    /** Center-zoom into capture (trim browser / YouTube chrome). 1–2.5 */
    frameZoom?: number;
    /** Parent: wall Window open — embed must not Enable / getDisplayMedia. */
    wallPreferred?: boolean;
  };
  graph?: {
    revision: number;
    chains: unknown[];
  };
};

export type ParentToChild =
  | HolotoneEnvelope<"snapshot", LiveProjectionSnapshotLite>
  | HolotoneEnvelope<"ping">;

export type ChildToParent =
  | HolotoneEnvelope<"ready", { mode: "embed" | "projection"; target: string | null }>
  | HolotoneEnvelope<"pong">
  | HolotoneEnvelope<"error", { message: string }>
  | HolotoneEnvelope<"captureGate", { pending: boolean; kind: "camera" | "screen" | null }>
  | HolotoneEnvelope<"captureEnded", { kind: "camera" | "screen" }>;

export function isHolotoneMessage(data: unknown): data is ParentToChild | ChildToParent {
  if (!data || typeof data !== "object") {
    return false;
  }
  const d = data as { protocol?: unknown; type?: unknown };
  return d.protocol === HOLOTONE_PROTOCOL && typeof d.type === "string";
}

export function postToParent(msg: ChildToParent, targetOrigin = "*"): void {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(msg, targetOrigin);
  }
  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage(msg, targetOrigin);
    } catch {
      /* cross-origin opener may throw */
    }
  }
}

export function parseTargetFromPath(): string | null {
  const m = window.location.pathname.match(
    /\/(?:projection|hydra|embed)\/([a-z0-9][a-z0-9-]{0,63})/i,
  );
  return m?.[1] ?? null;
}
