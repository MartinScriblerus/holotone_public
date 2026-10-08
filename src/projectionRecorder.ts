/**
 * Canvas MediaRecorder for wall / embed — results go to StrangeLoop via postMessage.
 */

import { HOLOTONE_PROTOCOL, postToParent } from "./protocol";

export type ProjectionRecorder = {
  start: (sessionId: string, targetId: string) => void;
  stop: (sessionId?: string) => void;
  dispose: () => void;
};

function buildFilename(targetId: string, sessionId: string): string {
  const safeTarget = targetId.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "") || "target";
  return `${safeTarget}-${sessionId}.webm`;
}

export function createProjectionRecorder(getCanvas: () => HTMLCanvasElement | null): ProjectionRecorder {
  let active: {
    sessionId: string;
    targetId: string;
    startedAtPerformanceMs: number;
    mimeType: string;
    chunks: Blob[];
    recorder: MediaRecorder;
    stream: MediaStream;
  } | null = null;

  function postError(sessionId: string, targetId: string, message: string): void {
    postToParent({
      protocol: HOLOTONE_PROTOCOL,
      type: "recordError",
      payload: { sessionId, targetId, message },
    });
  }

  function stop(sessionId?: string): void {
    const current = active;
    if (!current) {
      return;
    }
    if (sessionId && current.sessionId !== sessionId) {
      return;
    }
    if (current.recorder.state !== "inactive") {
      current.recorder.stop();
      return;
    }
    current.stream.getTracks().forEach((track) => track.stop());
    active = null;
  }

  function start(sessionId: string, targetId: string): void {
    if (active?.sessionId === sessionId) {
      return;
    }
    stop();

    const canvas = getCanvas();
    if (!canvas?.captureStream) {
      postError(sessionId, targetId, "Canvas captureStream() is unavailable in this browser.");
      return;
    }

    const stream = canvas.captureStream(60);
    const preferredMimeTypes = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const mimeType =
      preferredMimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "video/webm";

    let recorder: MediaRecorder;
    try {
      recorder =
        mimeType === "video/webm"
          ? new MediaRecorder(stream)
          : new MediaRecorder(stream, { mimeType });
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      postError(
        sessionId,
        targetId,
        error instanceof Error ? error.message : "Projection recorder failed to start.",
      );
      return;
    }

    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      const stoppedAtPerformanceMs = performance.now();
      const current = active;
      stream.getTracks().forEach((track) => track.stop());
      active = null;
      if (!current) {
        return;
      }
      const blob = new Blob(current.chunks, { type: current.mimeType });
      if (blob.size === 0) {
        postError(current.sessionId, current.targetId, "Projection recorder produced an empty video.");
        return;
      }
      postToParent({
        protocol: HOLOTONE_PROTOCOL,
        type: "recordCompleted",
        payload: {
          sessionId: current.sessionId,
          targetId: current.targetId,
          filename: buildFilename(current.targetId, current.sessionId),
          mimeType: current.mimeType,
          durationMs: Math.max(0, stoppedAtPerformanceMs - current.startedAtPerformanceMs),
          startedAtPerformanceMs: current.startedAtPerformanceMs,
          stoppedAtPerformanceMs,
          blob,
        },
      });
    };

    active = {
      sessionId,
      targetId,
      startedAtPerformanceMs: performance.now(),
      mimeType,
      chunks,
      recorder,
      stream,
    };
    recorder.start(1000);
  }

  return {
    start,
    stop,
    dispose: () => stop(),
  };
}
