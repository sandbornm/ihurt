import {
  Raycaster,
  Vector2,
  Vector3,
  type Mesh,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from "three";
import type { PainPoint } from "../types";

export interface ViewportCapture {
  image: string;
  width: number;
  height: number;
  visiblePins: number[];
  caption: string;
}

export function captureViewport(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  points: PainPoint[],
  surfaces: Mesh[],
  caption: string,
): ViewportCapture {
  // Read immediately after rendering; keeping the WebGL buffer alive would slow normal use.
  renderer.render(scene, camera);
  const source = renderer.domElement;
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1600 / Math.max(source.width, source.height));
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#14211b";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const ray = new Raycaster(),
    projected = new Vector3();
  const visiblePins: number[] = [],
    labels: { x: number; y: number }[] = [];
  const radius = Math.max(11, canvas.width / 75);
  points.forEach((point, index) => {
    const world = new Vector3(...point.position);
    projected.copy(world).project(camera);
    if (
      Math.abs(projected.x) > 0.97 ||
      Math.abs(projected.y) > 0.97 ||
      Math.abs(projected.z) > 1
    )
      return;
    ray.setFromCamera(new Vector2(projected.x, projected.y), camera);
    const obstruction = ray.intersectObjects(surfaces, false)[0];
    if (
      obstruction &&
      obstruction.distance < world.distanceTo(camera.position) - 0.07
    )
      return;
    const x = ((projected.x + 1) * canvas.width) / 2,
      y = ((1 - projected.y) * canvas.height) / 2;
    let lx = x,
      ly = y;
    for (const [dx, dy] of [
      [0, 0],
      [2.6, 0],
      [-2.6, 0],
      [0, -2.6],
      [0, 2.6],
      [2.6, -2.6],
      [-2.6, 2.6],
    ]) {
      lx = Math.max(
        radius + 4,
        Math.min(canvas.width - radius - 4, x + dx * radius),
      );
      ly = Math.max(
        radius + 4,
        Math.min(canvas.height - radius - 4, y + dy * radius),
      );
      if (labels.every((p) => Math.hypot(p.x - lx, p.y - ly) > radius * 2.2))
        break;
    }
    labels.push({ x: lx, y: ly });
    visiblePins.push(index + 1);
    ctx.strokeStyle = "#e5f5d5";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(lx, ly);
    ctx.stroke();
    ctx.fillStyle = "#c4ed76";
    ctx.beginPath();
    ctx.arc(lx, ly, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#14211b";
    ctx.font = `700 ${radius * 1.15}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), lx, ly + 0.5);
  });
  return {
    image: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
    visiblePins,
    caption,
  };
}
