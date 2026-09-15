/**
 * In-app preview — same snapshot feed as the wall (URL / camera / screen / CV / graph).
 * pointer-events none except while a capture gate needs a click (camera / tab share).
 */
import { createLiveSession } from "./liveSession";
import {
  HOLOTONE_PROTOCOL,
  isHolotoneMessage,
  parseTargetFromPath,
  postToParent,
} from "./protocol";

const root = document.getElementById("hydra-root");
const statusEl = document.getElementById("status");
const captureGate = document.getElementById("capture-gate");
const captureTitle = document.getElementById("capture-gate-title");
const captureHint = document.getElementById("capture-gate-hint");
const captureError = document.getElementById("capture-gate-error");
const captureBtn = document.getElementById("capture-enable-btn");
if (!root) {
  throw new Error("missing #hydra-root");
}

const session = createLiveSession({
  root,
  mode: "embed",
  target: parseTargetFromPath() ?? "preview",
  maxWidth: 640,
  maxHeight: 360,
  statusEl,
  captureGate,
  captureTitle,
  captureHint,
  captureError,
  captureBtn,
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
    void session.applySnapshot(msg.payload);
  }
});

window.addEventListener("beforeunload", () => {
  session.dispose();
});
