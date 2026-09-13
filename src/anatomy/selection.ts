import type { Intersection, Object3D } from "three";

// Keep nearby surfaces along the ray; exclude duplicate triangles and the far side.
export function nearbySurfaces<T extends Object3D>(hits: Intersection<T>[]) {
  const first = hits[0];
  if (!first) return [];
  const seen = new Set<Object3D>();
  return hits
    .filter((hit) => {
      if (seen.has(hit.object) || hit.point.distanceTo(first.point) > 0.5)
        return false;
      seen.add(hit.object);
      return true;
    })
    .slice(0, 6);
}
