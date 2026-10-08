import { createLiveSession } from "./liveSession";
import {
  HOLOTONE_PROTOCOL,
  isHolotoneMessage,
  parseTargetFromPath,
  postToParent,
} from "./protocol";

const root = document.getElementById("hydra-root");
const statusEl = document.getElementById("status");
const fullscreenBtn = document.getElementById("fullscreen-btn");
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
  mode: "projection",
  target: parseTargetFromPath() ?? "demo",
  statusEl,
  fullscreenBtn,
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
    return;
  }
  if (msg.type === "recordStart" && msg.payload?.sessionId) {
    session.startRecording(msg.payload.sessionId);
    return;
  }
  if (msg.type === "recordStop") {
    session.stopRecording(msg.payload?.sessionId);
  }
});

window.addEventListener("beforeunload", () => {
  session.dispose();
});
