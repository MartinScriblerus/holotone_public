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
if (!root) {
  throw new Error("missing #hydra-root");
}

const surface = createHydraSurface(root);
const target = parseTargetFromPath();
const params = new URLSearchParams(window.location.search);
const demo = params.get("demo") === "1";

function setStatus(text: string): void {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function onSnapshot(snap: LiveProjectionSnapshotLite): void {
  setStatus(`live · seq ${snap.seq}`);
  // Full graph apply lands when StrangeLoop runtime is ported; CV can modulate boot osc later.
  const energy = snap.performance?.energy;
  if (typeof energy === "number" && Number.isFinite(energy)) {
    const g = globalThis as {
      osc?: (...args: unknown[]) => {
        color?: (...c: unknown[]) => { out?: () => void };
        out?: () => void;
      };
    };
    try {
      const freq = 1.5 + energy * 6;
      g.osc?.(freq, 0.05, 0.15)?.color?.(0.2, 0.45 + energy * 0.3, 0.8)?.out?.();
    } catch {
      /* ignore */
    }
  }
}

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
  payload: { mode: "embed", target },
});

setStatus(demo ? "demo embed" : "ready · waiting for parent");

window.addEventListener("beforeunload", () => surface.dispose());
