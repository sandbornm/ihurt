import type { Vector3 } from "three";

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
