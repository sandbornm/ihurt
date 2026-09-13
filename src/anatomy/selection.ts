import {
  Mesh,
  Camera,
  Raycaster,
  Vector2,
  Vector3,
  type Intersection,
  type Object3D,
} from "three";

// A bounding-box center can miss a curved muscle. Aim through a real triangle.
export function surfaceNearViewCenter(mesh: Mesh, camera: Camera) {
  mesh.updateWorldMatrix(true, false);
  camera.updateMatrixWorld();
  const positions = mesh.geometry.getAttribute("position");
  const indices = mesh.geometry.getIndex();
  const count = indices?.count ?? positions.count;
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3();
  const center = new Vector3(),
    projected = new Vector3();
  const aim = new Vector2();
  let closest = Infinity;
  for (let i = 0; i + 2 < count; i += 3) {
    a.fromBufferAttribute(positions, indices ? indices.getX(i) : i);
    b.fromBufferAttribute(positions, indices ? indices.getX(i + 1) : i + 1);
    c.fromBufferAttribute(positions, indices ? indices.getX(i + 2) : i + 2);
    center
      .copy(a)
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3)
      .applyMatrix4(mesh.matrixWorld);
    projected.copy(center).project(camera);
    if (
      projected.z < -1 ||
      projected.z > 1 ||
      Math.abs(projected.x) > 1 ||
      Math.abs(projected.y) > 1
    )
      continue;
    const distance = projected.x ** 2 + projected.y ** 2;
    if (distance < closest) {
      closest = distance;
      aim.set(projected.x, projected.y);
    }
  }
  if (!Number.isFinite(closest)) return undefined;
  const ray = new Raycaster();
  ray.setFromCamera(aim, camera);
  return ray.intersectObject(mesh, false)[0];
}

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
