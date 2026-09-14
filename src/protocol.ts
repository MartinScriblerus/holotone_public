/**
 * Cross-origin protocol between StrangeLoop (parent) and holotone_public (iframe / popup).
 * BroadcastChannel cannot cross Vercel origins — use window.postMessage instead.
 */

export const HOLOTONE_PROTOCOL = "holotone-hydra/v1" as const;

export type HolotoneEnvelope<T extends string, P = unknown> = {
  protocol: typeof HOLOTONE_PROTOCOL;
  type: T;
  payload?: P;
};

/** Subset aligned with StrangeLoop LiveProjectionSnapshot — extend as the port lands. */
export type LiveProjectionSnapshotLite = {
  v: 2;
  seq: number;
  sessionGuid: string;
  ts: number;
  performance?: {
    bpm: number;
    beat: number;
    energy: number;
    motion: number;
    pulse: number;
  };
  media?: {
    videoUrl: string | null;
    videoLabel: string | null;
    cameraRequested: boolean;
  };
  /** Opaque graph JSON until full HydraOperationChain types are ported. */
  graph?: unknown;
};

export type ParentToChild =
  | HolotoneEnvelope<"snapshot", LiveProjectionSnapshotLite>
  | HolotoneEnvelope<"ping">;

export type ChildToParent =
  | HolotoneEnvelope<"ready", { mode: "embed" | "projection"; target: string | null }>
  | HolotoneEnvelope<"pong">
  | HolotoneEnvelope<"error", { message: string }>;

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
