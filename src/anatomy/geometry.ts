import * as T from "three";

export function bakeGeometry(source: T.BufferGeometry, transform: T.Matrix4) {
  const geometry = source.clone().applyMatrix4(transform);
  // Mirroring reverses triangle winding. Preserve the outward-facing surface.
  if (transform.determinant() < 0) {
    if (!geometry.index)
      geometry.setIndex(
        Array.from({ length: geometry.attributes.position.count }, (_, i) => i),
      );
    const index = geometry.index!;
    for (let i = 0; i < index.count; i += 3) {
      const second = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, second);
    }
  }
  return geometry;
}
