import { createHydraSurface } from "./hydraSurface";
import {
  HOLOTONE_PROTOCOL,
  isHolotoneMessage,
  parseTargetFromPath,
  postToParent,
  type LiveProjectionSnapshotLite,
} from "./protocol";

const root = document.getElementById("hydra-root");
const statusEl = document.getElementById("status");
const fullscreenBtn = document.getElementById("fullscreen-btn");
if (!root) {
  throw new Error("missing #hydra-root");
}

const surface = createHydraSurface(root);
const target = parseTargetFromPath() ?? "demo";

function setStatus(text: string): void {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function onSnapshot(snap: LiveProjectionSnapshotLite): void {
  setStatus(`${target} · seq ${snap.seq}`);
  const motion = snap.performance?.motion ?? snap.performance?.pulse ?? 0;
  const g = globalThis as {
    osc?: (...args: unknown[]) => {
      kaleid?: (n: number) => { colorama?: (n: number) => { out?: () => void } };
      out?: () => void;
    };
  };
  try {
    const chain = g.osc?.(3 + motion * 4, 0.03, 0.25);
    chain?.kaleid?.(2 + Math.floor(motion * 4))?.colorama?.(motion * 0.2)?.out?.() ?? chain?.out?.();
  } catch {
    /* ignore */
  }
}

fullscreenBtn?.addEventListener("click", () => {
  void document.documentElement.requestFullscreen?.();
});

window.addEventListener("message", (event) => {
  if (!isHolotoneMessage(event.data)) {
    return;
  }
  const msg = event.data;
  if (msg.type === "ping") {
    postToParent({ protocol: HOLOTONE_PROTOCOL, type: "pong" });
    return;
  }
  if (msg.type === "snapshot" && msg.payload) {
    onSnapshot(msg.payload);
  }
});

postToParent({
  protocol: HOLOTONE_PROTOCOL,
  type: "ready",
  payload: { mode: "projection", target },
});

setStatus(`${target} · waiting`);
window.addEventListener("beforeunload", () => surface.dispose());
