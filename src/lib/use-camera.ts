"use client";

// The live back camera for Scan and Snap (docs/SPEC.md section 7). Browser only.
// getUserMedia with facingMode "environment". The stream runs only while `active` is true and the tab is
// visible: it stops when the screen changes, the student leaves the page (or Next hides it), or the tab goes
// to the background, so the camera light never stays on behind their back.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type CameraStatus = "starting" | "on" | "denied" | "unavailable" | "insecure" | "busy";

/** Why the camera isn't on, in one plain sentence. */
export const CAMERA_PROBLEMS: Record<Exclude<CameraStatus, "starting" | "on">, string> = {
  denied: "Camera access is off for this site.",
  unavailable: "We couldn't find a camera on this device.",
  insecure: "The camera only works on a secure (https) page.",
  busy: "The camera is being used by another app.",
};

export type Camera = {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  /** One sentence for the student when the camera can't be used, else null. */
  problem: string | null;
  /** Still starting after a few seconds: usually the browser's permission question is waiting. */
  slow: boolean;
  torch: { supported: boolean; on: boolean; toggle: () => void };
  /** Ask for the camera again (after "denied" or "busy"). */
  retry: () => void;
};

type State = { status: CameraStatus; torchSupported: boolean; torchOn: boolean; slow: boolean };
const STARTING: State = { status: "starting", torchSupported: false, torchOn: false, slow: false };
const SLOW_AFTER_MS = 6_000;

// Torch isn't in TypeScript's DOM types for capabilities and constraint sets yet.
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };
type TorchConstraintSet = MediaTrackConstraintSet & { torch: boolean };

function failureStatus(err: unknown): CameraStatus {
  const name = err instanceof Error || err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") return "busy";
  return "unavailable";
}

/** The camera is ready to draw from. */
export function videoHasFrame(video: HTMLVideoElement | null): video is HTMLVideoElement {
  return !!video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
}

export function useCamera(active: boolean): Camera {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [state, setState] = useState<State>(STARTING);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let stream: MediaStream | null = null;

    const stop = () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      trackRef.current = null;
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };

    const start = async () => {
      if (!window.isSecureContext) return setState({ ...STARTING, status: "insecure" });
      if (!navigator.mediaDevices?.getUserMedia) return setState({ ...STARTING, status: "unavailable" });
      try {
        const next = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled || document.visibilityState === "hidden") {
          next.getTracks().forEach((t) => t.stop());
          return;
        }
        stop();
        stream = next;
        const video = videoRef.current;
        if (!video) return stop();
        video.muted = true; // inline autoplay on iPhone needs muted + playsInline
        video.playsInline = true;
        video.srcObject = next;
        await video.play().catch(() => undefined);
        if (cancelled) return;
        const track = next.getVideoTracks()[0] ?? null;
        trackRef.current = track;
        const caps = track?.getCapabilities?.() as TorchCapabilities | undefined;
        setState({ status: "on", torchSupported: caps?.torch === true, torchOn: false, slow: false });
      } catch (err) {
        if (!cancelled) setState({ ...STARTING, status: failureStatus(err) });
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        setState(STARTING);
      } else if (!stream) {
        void start();
      }
    };

    void start();
    const slowTimer = setTimeout(
      () => setState((s) => (s.status === "starting" ? { ...s, slow: true } : s)),
      SLOW_AFTER_MS,
    );
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stop);
    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stop);
      stop();
      // The next time the camera turns on, it starts from "starting" again.
      setState(STARTING);
    };
  }, [active, attempt]);

  const toggleTorch = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const next = !state.torchOn;
    const torch: TorchConstraintSet = { torch: next };
    track
      .applyConstraints({ advanced: [torch] })
      .then(() => setState((s) => ({ ...s, torchOn: next })))
      .catch(() => setState((s) => ({ ...s, torchSupported: false, torchOn: false })));
  }, [state.torchOn]);

  const retry = useCallback(() => {
    setState(STARTING);
    setAttempt((n) => n + 1);
  }, []);

  const status = active ? state.status : "starting";
  const problem = status === "starting" || status === "on" ? null : CAMERA_PROBLEMS[status];
  return {
    videoRef,
    status,
    problem,
    slow: status === "starting" && state.slow,
    torch: { supported: status === "on" && state.torchSupported, on: state.torchOn, toggle: toggleTorch },
    retry,
  };
}
