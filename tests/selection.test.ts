import test from "node:test";
import assert from "node:assert/strict";
import {
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  TorusGeometry,
  Vector2,
  Vector3,
  type Intersection,
} from "three";
import {
  nearbySurfaces,
  surfaceNearViewCenter,
} from "../src/anatomy/selection.ts";

test("pinning a curved mesh finds its surface when its center is empty", () => {
  const mesh = new Mesh(
    new TorusGeometry(1, 0.2, 12, 32),
    new MeshBasicMaterial(),
  );
  const camera = new PerspectiveCamera(45, 1, 0.1, 20);
  camera.position.z = 5;
  camera.updateMatrixWorld();
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2(), camera);
  assert.equal(ray.intersectObject(mesh).length, 0);
  const hit = surfaceNearViewCenter(mesh, camera);
  assert.equal(hit?.object, mesh);
  assert.ok(hit!.point.length() > 0.7);
  mesh.position.x = 100;
  assert.equal(surfaceNearViewCenter(mesh, camera), undefined);
  mesh.geometry.dispose();
  mesh.material.dispose();
});
test("layer picking deduplicates triangles and excludes distant surfaces", () => {
  const a = new Object3D(),
    b = new Object3D(),
    c = new Object3D();
  const hit = (object: Object3D, z: number): Intersection => ({
    object,
    point: new Vector3(0, 0, z),
    distance: 10 - z,
  });
  const choices = nearbySurfaces([
    hit(a, 0.2),
    hit(a, 0.19),
    hit(b, 0.1),
    hit(c, -0.9),
  ]);
  assert.deepEqual(
    choices.map((c) => c.object),
    [a, b],
  );
  assert.deepEqual(nearbySurfaces([]), []);
});
