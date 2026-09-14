import { Spherical, Vector3 } from "three";
import type { HandDelta } from "./hands.ts";

export function nudgeCamera(
  position: Vector3,
  look: Vector3,
  direction: string,
  pan: boolean,
) {
  const offset = position.clone().sub(look);
  if (pan) {
    const right = new Vector3(0, 1, 0).cross(offset).normalize();
    const up = offset.clone().cross(right).normalize();
    const delta = (
      direction === "left" || direction === "right" ? right : up
    ).multiplyScalar(
      offset.length() *
        0.12 *
        (direction === "left" || direction === "down" ? -1 : 1),
    );
    return {
      position: position.clone().add(delta),
      look: look.clone().add(delta),
    };
  }
  const sphere = new Spherical().setFromVector3(offset);
  if (direction === "left") sphere.theta -= Math.PI / 12;
  if (direction === "right") sphere.theta += Math.PI / 12;
  if (direction === "up") sphere.phi -= Math.PI / 18;
  if (direction === "down") sphere.phi += Math.PI / 18;
  sphere.phi = Math.max(0.04, Math.min(Math.PI - 0.04, sphere.phi));
  return {
    position: look.clone().add(offset.setFromSpherical(sphere)),
    look: look.clone(),
  };
}

export function advanceCamera(
  position: Vector3,
  look: Vector3,
  targetPosition: Vector3,
  targetLook: Vector3,
  elapsedSeconds: number,
  reducedMotion: boolean,
) {
  // Match the original easing at 60 Hz; cap gaps after a stalled frame.
  const blend = reducedMotion
    ? 1
    : 1 - Math.pow(0.9, Math.max(0, Math.min(elapsedSeconds, 0.05)) * 60);
  position.lerp(targetPosition, blend);
  look.lerp(targetLook, blend);
  if (
    position.distanceTo(targetPosition) < 0.003 &&
    look.distanceTo(targetLook) < 0.003
  ) {
    position.copy(targetPosition);
    look.copy(targetLook);
    return false;
  }
  return true;
}

export function applyHandDelta(
  position: Vector3,
  look: Vector3,
  delta: HandDelta,
  bounds: {
    minDistance: number;
    maxDistance: number;
    maxTargetRadius: number;
    cursor: Vector3;
  } = {
    minDistance: 0.35,
    maxDistance: 13,
    maxTargetRadius: 4,
    cursor: new Vector3(0, 0.4, 0),
  },
) {
  const nextLook = look.clone();
  const offset = position.clone().sub(look);
  if (delta.panX || delta.panY) {
    const right = new Vector3(0, 1, 0).cross(offset).normalize();
    const up = offset.clone().cross(right).normalize();
    const shift = right
      .multiplyScalar(delta.panX * offset.length())
      .addScaledVector(up, -delta.panY * offset.length());
    nextLook.add(shift);
    offset.copy(position).sub(look);
  }
  const sphere = new Spherical().setFromVector3(offset);
  sphere.theta += delta.rotateX;
  sphere.phi = Math.max(
    0.04,
    Math.min(Math.PI - 0.04, sphere.phi + delta.rotateY),
  );
  const zoom = delta.zoom || 1;
  sphere.radius = Math.max(
    bounds.minDistance,
    Math.min(bounds.maxDistance, sphere.radius / zoom),
  );
  const correction = nextLook.clone().sub(bounds.cursor);
  if (correction.length() > bounds.maxTargetRadius) {
    nextLook.copy(
      correction.clampLength(0, bounds.maxTargetRadius).add(bounds.cursor),
    );
  }
  return {
    position: nextLook.clone().add(new Vector3().setFromSpherical(sphere)),
    look: nextLook,
  };
}
