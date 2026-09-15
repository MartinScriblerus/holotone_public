/**
 * Shared Hydra live session for wall + in-app embed preview.
 * Capture: wall owns the device; embed mirrors frames (one Enable, one camera).
 */

import { createHydraSurface, type HydraSurface } from "./hydraSurface";
import { createMediaBinder, type LiveCaptureKind, type MediaBinder } from "./mediaBinder";
import {
  buildMusicFromSnapshot,
  isHydraGraphPayload,
  runGraphSketch,
  setLiveMusicData,
  setLiveOverlay,
  type HydraOperationChain,
} from "./graphRuntime";
import {
  HOLOTONE_PROTOCOL,
  postToParent,
  type LiveProjectionSnapshotLite,
} from "./protocol";

export type LiveSessionMode = "embed" | "projection";

export type LiveSessionOptions = {
  root: HTMLElement;
  mode: LiveSessionMode;
  target: string | null;
  maxWidth?: number;
  maxHeight?: number;
  statusEl?: HTMLElement | null;
  fullscreenBtn?: HTMLElement | null;
  captureGate?: HTMLElement | null;
  captureTitle?: HTMLElement | null;
  captureHint?: HTMLElement | null;
  captureError?: HTMLElement | null;
  captureBtn?: HTMLElement | null;
};

export type LiveSession = {
  applySnapshot: (snap: LiveProjectionSnapshotLite) => Promise<void>;
  dispose: () => void;
};

function desiredCapture(snap: LiveProjectionSnapshotLite): LiveCaptureKind | null {
  if (snap.media?.screenRequested) {
    return "screen";
  }
  if (snap.media?.cameraRequested) {
    return "camera";
  }
  return null;
}

function postCaptureGate(pending: boolean, kind: LiveCaptureKind | null): void {
  postToParent({
    protocol: HOLOTONE_PROTOCOL,
    type: "captureGate",
    payload: { pending, kind },
  });
}

export function createLiveSession(opts: LiveSessionOptions): LiveSession {
  const surface: HydraSurface = createHydraSurface(opts.root, {
    maxWidth: opts.maxWidth,
    maxHeight: opts.maxHeight,
  });
  const target = opts.target ?? "demo";

  let lastGraphRevision = -1;
  let lastChains: HydraOperationChain[] = [];
  let lastVideoReady = false;
  let lastCameraRequested = false;
  let lastScreenRequested = false;
  let lastGatePending: boolean | null = null;
  let statusTick = 0;
  let disposed = false;
  let visible = true;

  function setStatus(text: string): void {
    if (opts.statusEl) {
      opts.statusEl.textContent = text;
    }
  }

  function refreshSketch(): void {
    if (disposed || !visible) {
      return;
    }
    runGraphSketch(lastChains, { videoReady: media.isReady() });
  }

  function syncCaptureGateUi(): void {
    const pending = media.isPendingGesture();
    const kind = media.getPendingKind();
    if (pending !== lastGatePending) {
      lastGatePending = pending;
      postCaptureGate(pending, kind);
    }

    const gate = opts.captureGate;
    const btn = opts.captureBtn;
    if (!gate || !btn) {
      return;
    }
    // Embed mirrors the wall — never show a second Enable when wall owns capture.
    gate.hidden = !pending;
    if (!pending || !kind) {
      return;
    }
    const isScreen = kind === "screen";
    if (opts.captureTitle) {
      opts.captureTitle.textContent = isScreen
        ? "Tab / screen share needs a click here."
        : "Camera needs a click here.";
    }
    if (opts.captureHint) {
      opts.captureHint.textContent =
        opts.mode === "projection"
          ? isScreen
            ? "One click here — the in-app preview mirrors this feed."
            : "One click here — the in-app preview mirrors this camera (no second click)."
          : "Wall is closed — enable capture here for the preview only.";
    }
    btn.textContent = isScreen ? "Share tab / screen" : "Enable camera";
    if (opts.captureError) {
      const err = media.getError();
      opts.captureError.hidden = !err;
      opts.captureError.textContent = err ?? "";
    }
  }

  const media: MediaBinder = createMediaBinder((msg) => setStatus(`${target} · ${msg}`), {
    role: opts.mode === "embed" ? "embed" : "projection",
    onCaptureReady: () => {
      lastVideoReady = true;
      refreshSketch();
      syncCaptureGateUi();
    },
    onCaptureStateChange: () => {
      syncCaptureGateUi();
      // Must refresh on ready→false too — otherwise last camera frame sticks in src().
      const ready = media.isReady();
      if (ready !== lastVideoReady) {
        lastVideoReady = ready;
        refreshSketch();
      }
    },
  });

  async function onSnapshot(snap: LiveProjectionSnapshotLite): Promise<void> {
    if (disposed) {
      return;
    }

    setLiveMusicData(
      buildMusicFromSnapshot({
        performance: snap.performance,
        meyda: snap.meyda,
        cvMix: snap.cvMix,
      }),
    );
    if (snap.overlay) {
      setLiveOverlay(snap.overlay);
    }

    const capture = desiredCapture(snap);
    const cameraRequested = snap.media?.cameraRequested === true;
    const screenRequested = snap.media?.screenRequested === true;

    const captureArmedChanged =
      cameraRequested !== lastCameraRequested || screenRequested !== lastScreenRequested;

    if (capture) {
      if (captureArmedChanged) {
        media.setLiveCaptureRequested(capture);
      }
    } else if (lastCameraRequested || lastScreenRequested) {
      media.setLiveCaptureRequested(null);
    }
    lastCameraRequested = cameraRequested;
    lastScreenRequested = screenRequested;

    const zoom = typeof snap.media?.frameZoom === "number" ? snap.media.frameZoom : 1.2;
    media.setFrameZoom(zoom);
    media.setWallPreferred(snap.media?.wallPreferred === true);

    let ready: boolean;
    if (capture) {
      ready = media.isReady();
    } else {
      ready = await media.applyVideoUrl(snap.media?.videoUrl ?? null);
    }
    if (disposed) {
      return;
    }

    const videoReadyChanged = ready !== lastVideoReady;
    if (videoReadyChanged) {
      lastVideoReady = ready;
    }

    let graphChanged = false;
    if (isHydraGraphPayload(snap.graph)) {
      if (snap.graph.revision !== lastGraphRevision) {
        lastGraphRevision = snap.graph.revision;
        lastChains = snap.graph.chains as HydraOperationChain[];
        graphChanged = true;
      }
    }

    // Always re-eval when capture arming flips off — clears stuck last frame even if
    // ready was already false from a concurrent dispose.
    if (visible && (graphChanged || videoReadyChanged || (captureArmedChanged && !capture))) {
      refreshSketch();
    }

    syncCaptureGateUi();

    statusTick += 1;
    if (statusTick % 5 === 0) {
      const n = lastChains.filter((c) => c.enabled).length;
      const mediaTag = ready
        ? media.isMirroring()
          ? "mirror"
          : (capture ?? "video")
        : media.isPendingGesture()
          ? "arm"
          : media.isMirroring()
            ? "wait"
            : "";
      setStatus(`${target} · seq ${snap.seq} · ${n} ops${mediaTag ? ` · ${mediaTag}` : ""}`);
    }
  }

  opts.fullscreenBtn?.addEventListener("click", () => {
    void document.documentElement.requestFullscreen?.();
  });

  opts.captureBtn?.addEventListener("click", () => {
    void (async () => {
      const ok = await media.enableLiveCapture();
      syncCaptureGateUi();
      if (ok) {
        lastVideoReady = true;
        refreshSketch();
      } else if (lastVideoReady) {
        lastVideoReady = false;
        refreshSketch();
      }
    })();
  });

  const onVisibility = () => {
    visible = document.visibilityState !== "hidden";
    if (visible) {
      refreshSketch();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  const io =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(
          (entries) => {
            if (document.visibilityState === "hidden") {
              return;
            }
            const entry = entries[0];
            if (!entry) {
              return;
            }
            const next = entry.isIntersecting && entry.intersectionRatio > 0.05;
            if (next === visible) {
              return;
            }
            visible = next;
            if (visible) {
              refreshSketch();
            }
          },
          { threshold: [0, 0.05, 0.2] },
        )
      : null;
  io?.observe(opts.root);

  postToParent({
    protocol: HOLOTONE_PROTOCOL,
    type: "ready",
    payload: { mode: opts.mode, target: opts.target },
  });

  setStatus(`${target} · waiting`);
  syncCaptureGateUi();

  return {
    applySnapshot: onSnapshot,
    dispose: () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      io?.disconnect();
      media.dispose();
      surface.dispose();
    },
  };
}
