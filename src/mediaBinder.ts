/**
 * Bind https video / HLS / camera / tab-capture to Hydra s0.
 *
 * Wall owns getDisplayMedia / getUserMedia. After wall Enable:
 * - Screen: embed mirrors JPEG frames via parent relay onto a canvas bound to s0.
 * - Camera: embed prefers same-origin follow; else JPEG mirror.
 *
 * Never use canvas.captureStream() into s0 — resize blacks the stream in Chrome.
 * Crop-into-src for YouTube chrome is deferred (CSS crop does not help kaleid).
 */

import Hls from "hls.js";
import {
  createMediaMirrorBus,
  type MediaMirrorBus,
  type MirrorCaptureKind,
  type MirrorRole,
} from "./mediaMirrorBus";
import { HOLOTONE_PROTOCOL, postToParent } from "./protocol";

type S0Like = {
  init?: (opts: { src: HTMLVideoElement | HTMLCanvasElement }) => void;
  src?: HTMLVideoElement | HTMLCanvasElement | null;
};

export type LiveCaptureKind = "camera" | "screen";

function resolveS0(): S0Like | undefined {
  const g = globalThis as { s0?: S0Like };
  return g.s0;
}

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|#|$)/i.test(url);
}

function attachHiddenVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.loop = true;
  video.crossOrigin = "anonymous";
  video.setAttribute("playsinline", "true");
  video.style.cssText =
    "position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:0;top:0;";
  document.body.appendChild(video);
  return video;
}

async function waitForFrames(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Video timed out")), timeoutMs);
    const finish = () => {
      clearTimeout(timeout);
      video.removeEventListener("loadeddata", finish);
      video.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      clearTimeout(timeout);
      video.removeEventListener("loadeddata", finish);
      video.removeEventListener("error", onError);
      reject(new Error("Video failed to load (CORS or bad URL)"));
    };
    if (video.readyState >= 2 && video.videoWidth > 0) {
      clearTimeout(timeout);
      resolve();
      return;
    }
    video.addEventListener("loadeddata", finish);
    video.addEventListener("error", onError);
  });
  await video.play().catch(() => {});
}

async function acquireCameraStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera not available in this browser");
  }
  const attempts: MediaStreamConstraints[] = [
    { video: true, audio: false },
    { video: { facingMode: "user" }, audio: false },
  ];
  let lastErr: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastErr = err;
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        throw err;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Camera unavailable");
}

async function acquireScreenStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Tab/screen capture not available in this browser");
  }
  return navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  });
}

function bindMediaToS0(s0: S0Like, src: HTMLVideoElement | HTMLCanvasElement): void {
  if (typeof s0.init !== "function") {
    throw new Error("s0.init missing");
  }
  s0.init({ src });
}

export type MediaBinder = {
  applyVideoUrl: (url: string | null) => Promise<boolean>;
  setLiveCaptureRequested: (kind: LiveCaptureKind | null) => void;
  /** Kept for protocol compat — crop-into-src deferred (does not help kaleid via CSS). */
  setFrameZoom: (zoom: number) => void;
  /** Parent says wall Window is open — embed never Enables / getDisplayMedia. */
  setWallPreferred: (preferred: boolean) => void;
  enableLiveCapture: () => Promise<boolean>;
  isPendingGesture: () => boolean;
  getPendingKind: () => LiveCaptureKind | null;
  getError: () => string | null;
  isReady: () => boolean;
  isMirroring: () => boolean;
  dispose: () => void;
};

export type MediaBinderOptions = {
  role: MirrorRole;
  onCaptureReady?: () => void;
  onCaptureStateChange?: () => void;
};

export function createMediaBinder(
  onStatus: (msg: string) => void,
  binderOpts: MediaBinderOptions,
): MediaBinder {
  const role = binderOpts.role;
  const bus: MediaMirrorBus = createMediaMirrorBus(role);

  let lastUrl: string | null = null;
  let videoEl: HTMLVideoElement | null = null;
  let hls: Hls | null = null;
  let ready = false;
  let generation = 0;
  let requestedCapture: LiveCaptureKind | null = null;
  let pendingGesture = false;
  let mirroring = false;
  let followingPeer = false;
  let peerProjectionPresent = role === "projection";
  let lastError: string | null = null;
  let ownerPumpTimer: ReturnType<typeof setTimeout> | null = null;
  let ownerClaimTimer: ReturnType<typeof setTimeout> | null = null;
  /** Embed: draw mirrored JPEGs here; bind canvas directly to s0 (no captureStream). */
  let mirrorCanvas: HTMLCanvasElement | null = null;
  let mirrorCtx: CanvasRenderingContext2D | null = null;
  let mirrorBound = false;
  /** Wall: JPEG pump for embed only. */
  let pumpCanvas: HTMLCanvasElement | null = null;
  let pumpCtx: CanvasRenderingContext2D | null = null;
  let followInFlight = false;
  let wallPreferred = false;

  const notifyState = () => binderOpts.onCaptureStateChange?.();

  const destroyHls = () => {
    if (hls) {
      try {
        hls.destroy();
      } catch {
        /* ignore */
      }
      hls = null;
    }
  };

  const stopOwnerPump = () => {
    if (ownerPumpTimer != null) {
      clearTimeout(ownerPumpTimer);
      ownerPumpTimer = null;
    }
  };

  const clearS0Binding = () => {
    const s0 = resolveS0();
    if (!s0) {
      return;
    }
    try {
      s0.src = null;
    } catch {
      /* ignore */
    }
  };

  const disposeMirrorSink = () => {
    mirrorBound = false;
    mirrorCanvas = null;
    mirrorCtx = null;
  };

  const disposeVideo = () => {
    stopOwnerPump();
    destroyHls();
    disposeMirrorSink();
    if (videoEl) {
      try {
        const stream = videoEl.srcObject;
        if (stream instanceof MediaStream) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
        }
        videoEl.pause();
        videoEl.removeAttribute("src");
        videoEl.srcObject = null;
        videoEl.load();
        videoEl.remove();
      } catch {
        /* ignore */
      }
      videoEl = null;
    }
    clearS0Binding();
    ready = false;
  };

  const startOwnerPump = (kind: MirrorCaptureKind) => {
    stopOwnerPump();
    if (!pumpCanvas) {
      pumpCanvas = document.createElement("canvas");
      pumpCtx = pumpCanvas.getContext("2d", { alpha: false });
    }
    const tick = () => {
      const el = videoEl;
      const ctx = pumpCtx;
      const canvas = pumpCanvas;
      if (
        !el ||
        !ctx ||
        !canvas ||
        !requestedCapture ||
        mirroring ||
        followingPeer ||
        role !== "projection"
      ) {
        return;
      }
      try {
        if (el.videoWidth > 2 && el.videoHeight > 2) {
          const maxW = 640;
          const scale = Math.min(1, maxW / el.videoWidth);
          const w = Math.max(2, Math.round(el.videoWidth * scale) - (Math.round(el.videoWidth * scale) % 2));
          const h = Math.max(2, Math.round(el.videoHeight * scale) - (Math.round(el.videoHeight * scale) % 2));
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          ctx.drawImage(el, 0, 0, w, h);
          canvas.toBlob(
            (blob) => {
              if (!blob || requestedCapture !== kind || mirroring || followingPeer) {
                return;
              }
              void blob.arrayBuffer().then((jpeg) => {
                if (requestedCapture !== kind || mirroring || followingPeer) {
                  return;
                }
                bus.publishFrameJpeg(kind, jpeg);
              });
            },
            "image/jpeg",
            0.5,
          );
        }
      } catch {
        /* frame drop ok */
      }
      ownerPumpTimer = setTimeout(tick, 100);
    };
    tick();
  };

  /** Bind a canvas to s0 and draw into it — hydra samples canvas.width each tick. */
  const ensureMirrorSink = (width: number, height: number): boolean => {
    const s0 = resolveS0();
    if (!s0 || typeof s0.init !== "function") {
      return false;
    }
    const w = Math.max(2, Math.round(width) - (Math.round(width) % 2));
    const h = Math.max(2, Math.round(height) - (Math.round(height) % 2));
    if (!mirrorCanvas) {
      mirrorCanvas = document.createElement("canvas");
      mirrorCtx = mirrorCanvas.getContext("2d", { alpha: false });
    }
    if (!mirrorCtx) {
      return false;
    }
    if (mirrorCanvas.width !== w || mirrorCanvas.height !== h) {
      mirrorCanvas.width = w;
      mirrorCanvas.height = h;
    }
    // Re-init when sketch refresh cleared s0.src, or first bind.
    if (!mirrorBound || s0.src !== mirrorCanvas) {
      bindMediaToS0(s0, mirrorCanvas);
      mirrorBound = true;
    }
    return mirrorBound;
  };

  const becomeMirrorSubscriber = (kind: LiveCaptureKind) => {
    mirroring = true;
    followingPeer = false;
    pendingGesture = false;
    lastError = null;
    stopOwnerPump();
    if (videoEl) {
      try {
        const stream = videoEl.srcObject;
        if (stream instanceof MediaStream) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
        }
        videoEl.remove();
      } catch {
        /* ignore */
      }
      videoEl = null;
    }
    onStatus(`${kind} — mirroring wall`);
    notifyState();
    // Ask wall to (re)announce + pump in case we missed the first owner event.
    bus.hello();
  };

  const becomeOwnerCandidate = (kind: LiveCaptureKind) => {
    // Embed must never take screen/camera ownership while the wall is preferred —
    // getDisplayMedia in the iframe shows a "Sharing" banner on the parent tab (5173).
    if (role === "embed" && (wallPreferred || peerProjectionPresent)) {
      mirroring = true;
      followingPeer = false;
      pendingGesture = false;
      ready = false;
      onStatus(kind === "screen" ? "share — enable on wall" : "camera — enable on wall");
      notifyState();
      bus.hello();
      return;
    }
    mirroring = false;
    followingPeer = false;
    pendingGesture = true;
    ready = false;
    disposeMirrorSink();
    onStatus(kind === "screen" ? "share — click Enable" : "camera — click Enable");
    notifyState();
  };

  const clearPeerFollow = () => {
    stopOwnerPump();
    disposeMirrorSink();
    disposeVideo();
    ready = false;
    mirroring = false;
    followingPeer = false;
    pendingGesture = false;
  };

  let enableLiveCaptureImpl: (opts?: { followOnly?: boolean }) => Promise<boolean> = async () =>
    false;

  bus.onHello((helloRole) => {
    if (helloRole === "projection") {
      peerProjectionPresent = true;
      if (role === "embed" && requestedCapture && !ready && !followingPeer) {
        mirroring = true;
        pendingGesture = false;
        notifyState();
      }
    }
    if (helloRole === "embed" && role === "projection") {
      bus.hello();
      if (requestedCapture && ready && !mirroring && !followingPeer) {
        bus.announceOwner(requestedCapture);
        startOwnerPump(requestedCapture);
      }
    }
  });
  bus.onOwner((ownerRole, kind) => {
    if (!requestedCapture || requestedCapture !== kind) {
      return;
    }
    if (role !== "embed" || ownerRole !== "projection") {
      return;
    }
    peerProjectionPresent = true;
    // Already showing wall camera follow or JPEG mirror — ignore re-announces.
    if (ready) {
      return;
    }
    if (followInFlight) {
      return;
    }
    pendingGesture = false;
    if (kind === "camera") {
      followInFlight = true;
      mirroring = false;
      onStatus("camera — following wall…");
      notifyState();
      void (async () => {
        try {
          const ok = await enableLiveCaptureImpl({ followOnly: true });
          if (ok) {
            return;
          }
          becomeMirrorSubscriber(kind);
        } finally {
          followInFlight = false;
        }
      })();
      return;
    }
    becomeMirrorSubscriber(kind);
  });

  bus.onRelease((kind, fromRole) => {
    if (requestedCapture !== kind || fromRole === role) {
      return;
    }
    if (followingPeer || mirroring) {
      peerProjectionPresent = fromRole === "projection" ? false : peerProjectionPresent;
      clearPeerFollow();
      onStatus(`${kind} — peer stopped`);
      notifyState();
      return;
    }
    if (role === "embed" && fromRole === "projection") {
      peerProjectionPresent = false;
    }
  });

  bus.onFrame(async (kind, jpeg) => {
    if (!requestedCapture || requestedCapture !== kind || !mirroring || followingPeer) {
      return;
    }
    try {
      const blob = new Blob([jpeg], { type: "image/jpeg" });
      const bitmap = await createImageBitmap(blob);
      const ok = ensureMirrorSink(bitmap.width, bitmap.height);
      if (!ok || !mirrorCtx) {
        bitmap.close();
        return;
      }
      mirrorCtx.drawImage(bitmap, 0, 0);
      bitmap.close();
      if (!ready) {
        ready = true;
        pendingGesture = false;
        onStatus(`${kind} — mirrored`);
        binderOpts.onCaptureReady?.();
        notifyState();
      }
    } catch {
      /* frame drop ok */
    }
  });

  bus.hello();

  enableLiveCaptureImpl = async (opts?: { followOnly?: boolean }): Promise<boolean> => {
    const kind = requestedCapture;
    const followOnly = opts?.followOnly === true;
    if (!kind) {
      return ready;
    }
    if (mirroring && !followOnly) {
      return ready;
    }
    lastError = null;
    const gen = ++generation;
    disposeVideo();
    disposeMirrorSink();
    lastUrl = null;
    mirroring = false;

    const s0 = resolveS0();
    if (!s0 || typeof s0.init !== "function") {
      lastError = "s0 missing";
      pendingGesture = !followOnly;
      onStatus(lastError);
      notifyState();
      return false;
    }

    onStatus(
      followOnly
        ? "camera — following wall…"
        : kind === "screen"
          ? "opening share picker…"
          : "requesting camera…",
    );
    try {
      const stream = kind === "screen" ? await acquireScreenStream() : await acquireCameraStream();
      if (gen !== generation) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return false;
      }
      const video = attachHiddenVideo();
      video.loop = false;
      video.crossOrigin = null;
      video.srcObject = stream;
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (gen !== generation) {
          return;
        }
        if (!followOnly) {
          bus.release(kind);
        }
        requestedCapture = null;
        pendingGesture = false;
        followingPeer = false;
        mirroring = false;
        disposeVideo();
        ready = false;
        onStatus(kind === "screen" ? "share ended" : "camera ended");
        try {
          postToParent({
            protocol: HOLOTONE_PROTOCOL,
            type: "captureEnded",
            payload: { kind },
          });
        } catch {
          /* ignore */
        }
        notifyState();
      });
      await waitForFrames(video, 12000);
      if (gen !== generation) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        video.remove();
        return false;
      }
      videoEl = video;
      bindMediaToS0(s0, video);
      ready = true;
      pendingGesture = false;
      mirroring = false;
      followingPeer = followOnly;
      lastError = null;
      onStatus(
        followOnly
          ? "camera — following wall"
          : kind === "screen"
            ? "tab/screen live"
            : "camera live",
      );
      if (!followOnly && role === "projection") {
        startOwnerPump(kind);
        bus.announceOwner(kind);
      }
      binderOpts.onCaptureReady?.();
      notifyState();
      return true;
    } catch (err) {
      if (gen !== generation) {
        return false;
      }
      followingPeer = false;
      pendingGesture = !followOnly;
      lastError = err instanceof Error ? err.message : "Capture failed";
      onStatus(lastError);
      console.warn("[holotone] live capture failed", err);
      notifyState();
      return false;
    }
  };

  return {
    isReady: () => ready,
    isPendingGesture: () => pendingGesture && requestedCapture != null && !mirroring,
    getPendingKind: () => (pendingGesture && !mirroring ? requestedCapture : null),
    getError: () => lastError,
    isMirroring: () => mirroring || followingPeer,
    enableLiveCapture: () => enableLiveCaptureImpl(),
    setFrameZoom: (_zoom) => {
      /* deferred — CSS crop does not remove chrome from kaleid/src() */
    },
    setWallPreferred: (preferred) => {
      wallPreferred = preferred;
      if (preferred && role === "embed") {
        peerProjectionPresent = true;
        if (pendingGesture && requestedCapture) {
          pendingGesture = false;
          mirroring = true;
          notifyState();
          bus.hello();
        }
      }
    },

    setLiveCaptureRequested: (kind) => {
      if (ownerClaimTimer != null) {
        clearTimeout(ownerClaimTimer);
        ownerClaimTimer = null;
      }
      if (kind === requestedCapture) {
        if (kind && role === "projection" && ready && !mirroring && !followingPeer) {
          bus.announceOwner(kind);
          startOwnerPump(kind);
        }
        notifyState();
        return;
      }

      if (requestedCapture) {
        bus.release(requestedCapture);
      }
      generation += 1;
      disposeVideo();
      lastUrl = null;
      requestedCapture = kind;
      lastError = null;
      mirroring = false;
      followingPeer = false;
      pendingGesture = false;

      if (!kind) {
        onStatus("capture off");
        notifyState();
        return;
      }

      bus.hello();

      if (role === "projection") {
        becomeOwnerCandidate(kind);
        return;
      }

      onStatus(`${kind} — waiting for wall…`);
      pendingGesture = false;
      mirroring = true;
      notifyState();
      const pokeWall = () => {
        bus.hello();
      };
      pokeWall();
      ownerClaimTimer = setTimeout(() => {
        ownerClaimTimer = null;
        if (requestedCapture !== kind || ready || followingPeer) {
          return;
        }
        if (peerProjectionPresent) {
          onStatus(`${kind} — enable on wall`);
          pendingGesture = false;
          mirroring = true;
          notifyState();
          pokeWall();
          ownerClaimTimer = setTimeout(() => {
            ownerClaimTimer = null;
            if (requestedCapture !== kind || ready || followingPeer) {
              return;
            }
            if (peerProjectionPresent) {
              onStatus(`${kind} — waiting for wall Enable`);
              pendingGesture = false;
              mirroring = true;
              pokeWall();
              notifyState();
              return;
            }
            becomeOwnerCandidate(kind);
          }, 2500);
          return;
        }
        becomeOwnerCandidate(kind);
      }, 700);
    },

    applyVideoUrl: async (url: string | null) => {
      if (url === lastUrl && requestedCapture == null) {
        return ready;
      }
      if (requestedCapture) {
        bus.release(requestedCapture);
      }
      requestedCapture = null;
      pendingGesture = false;
      mirroring = false;
      followingPeer = false;
      lastUrl = url;
      const gen = ++generation;
      disposeVideo();
      lastError = null;
      notifyState();

      if (!url) {
        onStatus("no video url");
        return false;
      }
      if (url.startsWith("blob:")) {
        lastError = "blob video blocked cross-origin — use https URL";
        onStatus(lastError);
        return false;
      }

      const s0 = resolveS0();
      if (!s0 || typeof s0.init !== "function") {
        lastError = "s0 missing";
        onStatus(lastError);
        return false;
      }

      onStatus(isHlsUrl(url) ? "loading HLS…" : "loading video…");
      const video = attachHiddenVideo();

      try {
        if (isHlsUrl(url)) {
          if (Hls.isSupported()) {
            const instance = new Hls({
              enableWorker: true,
              lowLatencyMode: true,
            });
            hls = instance;
            instance.loadSource(url);
            instance.attachMedia(video);
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error("HLS timed out")), 20000);
              instance.on(Hls.Events.MANIFEST_PARSED, () => {
                clearTimeout(timeout);
                resolve();
              });
              instance.on(Hls.Events.ERROR, (_e, data) => {
                if (data.fatal) {
                  clearTimeout(timeout);
                  reject(new Error(data.details || "HLS error"));
                }
              });
            });
          } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = url;
          } else {
            throw new Error("HLS not supported in this browser — try Chrome/Safari");
          }
        } else {
          video.src = url;
        }

        await waitForFrames(video, 20000);
        if (gen !== generation) {
          destroyHls();
          video.remove();
          return false;
        }
        bindMediaToS0(s0, video);
        videoEl = video;
        ready = true;
        onStatus(isHlsUrl(url) ? "HLS live" : "video live");
        return true;
      } catch (err) {
        destroyHls();
        video.remove();
        const msg = err instanceof Error ? err.message : "video load failed";
        lastError = msg;
        onStatus(msg);
        console.warn("[holotone] video bind failed", err);
        return false;
      }
    },

    dispose: () => {
      generation += 1;
      if (ownerClaimTimer != null) {
        clearTimeout(ownerClaimTimer);
        ownerClaimTimer = null;
      }
      if (requestedCapture && !followingPeer && !mirroring) {
        bus.release(requestedCapture);
      }
      requestedCapture = null;
      pendingGesture = false;
      mirroring = false;
      followingPeer = false;
      disposeVideo();
      bus.dispose();
    },
  };
}
