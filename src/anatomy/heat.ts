import { Color, Matrix4, Vector3, type BufferAttribute } from "three";
import { intensityColor } from "./intensity.ts";

export type HeatFunction = (...values: number[]) => number;
export type HeatSample = {
  position: readonly [number, number, number];
  radius: number;
};

const vertex = new Vector3();
const painted = new Color();
const heatTint = new Color();
const selectedTint = new Color("#ceefb3");
const base = new Color();
const probe = new Vector3();

export const fallbackHeat: HeatFunction = (x, y, z, cx, cy, cz, r, i) =>
  Math.exp(
    -2 *
      (((x - cx) / r) ** 2 +
        ((y - cy) / (r * 1.25)) ** 2 +
        ((z - cz) / r) ** 2),
  ) * i;

export function samplesNear(
  samples: HeatSample[],
  bounds: { distanceToPoint: (point: Vector3) => number },
  reach = 0.6,
) {
  return samples.filter((sample) => {
    probe.set(...sample.position);
    return bounds.distanceToPoint(probe) < reach;
  });
}

export function paintHeat(
  positions: BufferAttribute,
  colors: BufferAttribute,
  matrix: Matrix4,
  baseColor: Color,
  selectedUnmapped: boolean,
  samples: HeatSample[],
  region: HeatSample | null,
  intensity: number | null,
  heat: HeatFunction,
) {
  base.copy(baseColor);
  if (selectedUnmapped) base.lerp(selectedTint, 0.48);
  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i).applyMatrix4(matrix);
    let amount = 0;
    for (const sample of samples)
      amount = Math.max(
        amount,
        heat(
          vertex.x,
          vertex.y,
          vertex.z,
          ...sample.position,
          sample.radius,
          1,
        ),
      );
    if (region)
      amount = Math.max(
        amount,
        heat(
          vertex.x,
          vertex.y,
          vertex.z,
          ...region.position,
          region.radius,
          1,
        ),
      );
    painted.copy(base);
    if (amount > 0.02) {
      heatTint.set(intensityColor(intensity));
      painted.lerp(heatTint, Math.min(1, amount * 1.6 + 0.15));
    }
    colors.setXYZ(i, painted.r, painted.g, painted.b);
  }
  colors.needsUpdate = true;
}
