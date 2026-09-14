import { useEffect, useRef, useState } from "react";
import {
  describeGrabbers,
  HandNavigator,
  type Grabber,
  type HandDelta,
  type Landmark,
} from "./hands";

const CONNECTIONS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [0, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [0, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [5, 9],
  [9, 13],
  [13, 17],
];

function palmOf(hand: Landmark[]) {
  return {
    x: (hand[0].x + hand[5].x + hand[17].x) / 3,
    y: (hand[0].y + hand[5].y + hand[17].y) / 3,
  };
}

function drawHands(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  hands: Landmark[][],
) {
  const width = canvas.width,
    height = canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  if (video.readyState >= 2) ctx.drawImage(video, 0, 0, width, height);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#baf38b";
  ctx.fillStyle = "#f4bc71";
  for (const hand of hands) {
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      if (!hand[a] || !hand[b]) continue;
      ctx.moveTo(hand[a].x * width, hand[a].y * height);
      ctx.lineTo(hand[b].x * width, hand[b].y * height);
    }
    ctx.stroke();
    for (const point of hand) {
      ctx.beginPath();
      ctx.arc(point.x * width, point.y * height, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (hand.length >= 21) {
      const palm = palmOf(hand);
      ctx.beginPath();
      ctx.strokeStyle = "#e8f6c8";
      ctx.lineWidth = 2;
      ctx.arc(palm.x * width, palm.y * height, 11, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

const MODE_LABEL = { turn: "Turn", zoom: "Zoom", slide: "Slide" };

function paintGrabbers(
  overlay: HTMLElement,
  grabbers: Grabber[],
  shown: { x: number; y: number }[],
) {
  const nodes = overlay.querySelectorAll<HTMLElement>(".hand-grabber");
  const line = overlay.querySelector("line");
  grabbers.forEach((grabber, index) => {
    const point = shown[index] ?? { x: grabber.x, y: grabber.y };
    point.x += (grabber.x - point.x) * 0.4;
    point.y += (grabber.y - point.y) * 0.4;
    shown[index] = point;
    const node = nodes[index];
    if (!node) return;
    node.classList.add("is-on");
    node.dataset.mode = grabber.mode;
    node.style.left = `${point.x * 100}%`;
    node.style.top = `${point.y * 100}%`;
    node.style.setProperty("--pinch", String(1 - grabber.pinch * 0.45));
    const label = node.querySelector("span");
    if (label) label.textContent = MODE_LABEL[grabber.mode];
  });
  for (let index = grabbers.length; index < nodes.length; index++)
    nodes[index].classList.remove("is-on");
  if (line) {
    if (grabbers.length === 2 && shown[0] && shown[1]) {
      line.setAttribute("x1", `${shown[0].x * 100}%`);
      line.setAttribute("y1", `${shown[0].y * 100}%`);
      line.setAttribute("x2", `${shown[1].x * 100}%`);
      line.setAttribute("y2", `${shown[1].y * 100}%`);
      line.style.display = "";
    } else line.style.display = "none";
  }
}

export default function HandCamera({
  active,
  onMotion,
}: {
  active: boolean;
  onMotion: (delta: HandDelta) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const motion = useRef(onMotion);
  motion.current = onMotion;
  const [status, setStatus] = useState("Opening camera…");
  useEffect(() => {
    if (!active) return;
    const video = videoRef.current,
      canvas = canvasRef.current,
      overlay = overlayRef.current;
    if (!video || !canvas || !overlay) return;
    const tracker = new HandNavigator();
    const shown: { x: number; y: number }[] = [];
    let stream: MediaStream | null = null;
    let landmarker: {
      detectForVideo: (
        video: HTMLVideoElement,
        timestamp: number,
      ) => { landmarks?: Landmark[][] };
      close: () => void;
    } | null = null;
    let cancelled = false;
    let frameHandle = 0;
    let usingVideoFrame = false;
    let lastStatus = "";
    const report = (text: string) => {
      if (text === lastStatus) return;
      lastStatus = text;
      setStatus(text);
    };
    const host = overlay.closest<HTMLElement>(".anatomy-canvas");
    const feed = (hands: Landmark[][]) => {
      const grabbers = describeGrabbers(hands);
      paintGrabbers(overlay, grabbers, shown);
      if (host) {
        host.dataset.handsGrabbers = String(grabbers.length);
        host.dataset.handsMode = grabbers[0]?.mode ?? "";
      }
      const delta = tracker.apply(hands);
      if (delta) {
        motion.current(delta);
        if (host) host.dataset.handsMoved = grabbers[0]?.mode ?? "move";
      }
      report(
        grabbers.length > 1
          ? "Slide both grabbers to pan"
          : grabbers[0]?.mode === "zoom"
            ? "Pinch the grabber to zoom"
            : grabbers[0]
              ? "Move the grabber to turn"
              : "Raise a hand — a grabber appears on the body",
      );
    };
    const onSpoof = (event: Event) => {
      const landmarks = (event as CustomEvent).detail?.landmarks;
      if (!Array.isArray(landmarks) || cancelled) return;
      feed(landmarks);
    };
    window.addEventListener("ihurt:hands", onSpoof);
    overlay.dataset.handsReady = "true";
    const stopLoop = () => {
      if (usingVideoFrame && "cancelVideoFrameCallback" in video)
        video.cancelVideoFrameCallback(frameHandle);
      else cancelAnimationFrame(frameHandle);
    };
    const tick = () => {
      if (cancelled) return;
      if (document.hidden || video.readyState < 2) {
        schedule();
        return;
      }
      try {
        const result = landmarker?.detectForVideo(video, performance.now());
        const hands = (result?.landmarks ?? []) as Landmark[][];
        drawHands(canvas, video, hands);
        feed(hands);
      } catch {
        report("Hand tracking paused");
      }
      schedule();
    };
    const schedule = () => {
      if (cancelled) return;
      if ("requestVideoFrameCallback" in video) {
        usingVideoFrame = true;
        frameHandle = video.requestVideoFrameCallback(() => tick());
      } else {
        usingVideoFrame = false;
        frameHandle = requestAnimationFrame(() => tick());
      }
    };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
            width: { ideal: 320 },
            height: { ideal: 240 },
            frameRate: { ideal: 24, max: 24 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        const vision = await import("@mediapipe/tasks-vision");
        if (cancelled) return;
        const wasm =
          await vision.FilesetResolver.forVisionTasks("/mediapipe/wasm");
        const options = {
          baseOptions: {
            modelAssetPath: "/mediapipe/hand_landmarker.task",
            delegate: "GPU" as const,
          },
          runningMode: "VIDEO" as const,
          numHands: 2,
        };
        try {
          landmarker = await vision.HandLandmarker.createFromOptions(
            wasm,
            options,
          );
        } catch {
          landmarker = await vision.HandLandmarker.createFromOptions(wasm, {
            ...options,
            baseOptions: { ...options.baseOptions, delegate: "CPU" },
          });
        }
        if (cancelled) {
          landmarker.close();
          return;
        }
        canvas.width = 160;
        canvas.height = 120;
        report("Raise a hand — a grabber appears on the body");
        schedule();
      } catch {
        if (!cancelled) report("This browser could not open a camera.");
      }
    })();
    return () => {
      cancelled = true;
      stopLoop();
      tracker.reset();
      window.removeEventListener("ihurt:hands", onSpoof);
      delete overlay.dataset.handsReady;
      if (host) {
        delete host.dataset.handsGrabbers;
        delete host.dataset.handsMode;
        delete host.dataset.handsMoved;
      }
      landmarker?.close();
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, [active]);
  if (!active) return null;
  return (
    <>
      <div className="hand-grabbers" ref={overlayRef} aria-hidden="true">
        <svg>
          <line />
        </svg>
        <div className="hand-grabber">
          <b />
          <span>Turn</span>
        </div>
        <div className="hand-grabber">
          <b />
          <span>Turn</span>
        </div>
      </div>
      <div className="hand-camera" data-hands="live">
        <video ref={videoRef} playsInline muted hidden />
        <canvas ref={canvasRef} aria-hidden="true" />
        <p>{status}</p>
        <small>The camera stays on this device. Nothing is uploaded.</small>
      </div>
    </>
  );
}
