/**
 * Capture sync bus between wall popup and embed iframe.
 *
 * BroadcastChannel is partitioned for third-party iframes (StrangeLoop hosts
 * the embed), so this uses window.opener / window.parent postMessage. StrangeLoop
 * relays messages between the two holotone surfaces.
 *
 * Frames use JPEG ArrayBuffer (structured-clone safe). ImageBitmap transfer
 * across cross-origin postMessage was dropping silently.
 */

export const HOLOTONE_MEDIA_MIRROR = "holotone-media-mirror/v1";

export type MirrorRole = "projection" | "embed";
export type MirrorCaptureKind = "camera" | "screen";

export type MirrorBusMessage =
  | {
      protocol: typeof HOLOTONE_MEDIA_MIRROR;
      type: "hello";
      role: MirrorRole;
    }
  | {
      protocol: typeof HOLOTONE_MEDIA_MIRROR;
      type: "owner";
      role: MirrorRole;
      kind: MirrorCaptureKind;
    }
  | {
      protocol: typeof HOLOTONE_MEDIA_MIRROR;
      type: "release";
      role: MirrorRole;
      kind: MirrorCaptureKind;
    }
  | {
      protocol: typeof HOLOTONE_MEDIA_MIRROR;
      type: "frame";
      role: MirrorRole;
      kind: MirrorCaptureKind;
      jpeg: ArrayBuffer;
    };

export type MediaMirrorBus = {
  role: MirrorRole;
  hello: () => void;
  announceOwner: (kind: MirrorCaptureKind) => void;
  release: (kind: MirrorCaptureKind) => void;
  publishFrameJpeg: (kind: MirrorCaptureKind, jpeg: ArrayBuffer) => void;
  onOwner: (cb: (role: MirrorRole, kind: MirrorCaptureKind) => void) => () => void;
  onRelease: (cb: (kind: MirrorCaptureKind, fromRole: MirrorRole) => void) => () => void;
  onFrame: (cb: (kind: MirrorCaptureKind, jpeg: ArrayBuffer) => void) => () => void;
  onHello: (cb: (role: MirrorRole) => void) => () => void;
  dispose: () => void;
};

function relayParent(): Window | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (window.opener && !window.opener.closed) {
    return window.opener as Window;
  }
  if (window.parent && window.parent !== window) {
    return window.parent;
  }
  return null;
}

export function createMediaMirrorBus(role: MirrorRole): MediaMirrorBus {
  const ownerListeners = new Set<(role: MirrorRole, kind: MirrorCaptureKind) => void>();
  const releaseListeners = new Set<(kind: MirrorCaptureKind, fromRole: MirrorRole) => void>();
  const frameListeners = new Set<(kind: MirrorCaptureKind, jpeg: ArrayBuffer) => void>();
  const helloListeners = new Set<(role: MirrorRole) => void>();

  const onWindowMessage = (ev: MessageEvent) => {
    const msg = ev.data as MirrorBusMessage | null;
    if (!msg || msg.protocol !== HOLOTONE_MEDIA_MIRROR) {
      return;
    }
    if ("role" in msg && msg.role === role) {
      return;
    }
    if (msg.type === "hello") {
      for (const cb of helloListeners) {
        cb(msg.role);
      }
      return;
    }
    if (msg.type === "owner") {
      for (const cb of ownerListeners) {
        cb(msg.role, msg.kind);
      }
      return;
    }
    if (msg.type === "release") {
      for (const cb of releaseListeners) {
        cb(msg.kind, msg.role);
      }
      return;
    }
    if (msg.type === "frame") {
      for (const cb of frameListeners) {
        cb(msg.kind, msg.jpeg);
      }
    }
  };

  window.addEventListener("message", onWindowMessage);

  const post = (msg: MirrorBusMessage) => {
    const parent = relayParent();
    if (!parent) {
      return;
    }
    try {
      parent.postMessage(msg, "*");
    } catch (err) {
      console.warn("[holotone] mirror bus post failed", err);
    }
  };

  return {
    role,
    hello: () => post({ protocol: HOLOTONE_MEDIA_MIRROR, type: "hello", role }),
    announceOwner: (kind) =>
      post({ protocol: HOLOTONE_MEDIA_MIRROR, type: "owner", role, kind }),
    release: (kind) => post({ protocol: HOLOTONE_MEDIA_MIRROR, type: "release", role, kind }),
    publishFrameJpeg: (kind, jpeg) =>
      post({ protocol: HOLOTONE_MEDIA_MIRROR, type: "frame", role, kind, jpeg }),
    onOwner: (cb) => {
      ownerListeners.add(cb);
      return () => ownerListeners.delete(cb);
    },
    onRelease: (cb) => {
      releaseListeners.add(cb);
      return () => releaseListeners.delete(cb);
    },
    onFrame: (cb) => {
      frameListeners.add(cb);
      return () => frameListeners.delete(cb);
    },
    onHello: (cb) => {
      helloListeners.add(cb);
      return () => helloListeners.delete(cb);
    },
    dispose: () => {
      window.removeEventListener("message", onWindowMessage);
      ownerListeners.clear();
      releaseListeners.clear();
      frameListeners.clear();
      helloListeners.clear();
    },
  };
}
