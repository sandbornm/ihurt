import test from "node:test";
import assert from "node:assert/strict";
import { InstancedMesh, Matrix4, Vector3 } from "three";
import { PinMarkers } from "../src/anatomy/pins.ts";
import { exampleEntry } from "../src/example.ts";

test("hundreds of pins share one mesh and retain positions after growth and removal", () => {
  const pins = new PinMarkers();
  const points = Array.from({ length: 600 }, (_, i) => ({
    ...exampleEntry().points![0],
    id: String(i),
    position: [i / 100, 1, 0] as [number, number, number],
  }));
  pins.setPoints(points.slice(0, 1));
  pins.setPoints(points);
  assert.equal(pins.children.length, 1);
  const mesh = pins.children[0] as InstancedMesh;
  assert.equal(mesh.count, 600);
  const matrix = new Matrix4();
  mesh.getMatrixAt(599, matrix);
  assert.ok(
    new Vector3()
      .setFromMatrixPosition(matrix)
      .distanceTo(new Vector3(...points[599].position)) < 0.00001,
  );
  pins.setPoints(points.slice(0, 2));
  assert.equal(pins.children[0], mesh);
  assert.equal(mesh.count, 2);
  pins.setPoints([]);
  assert.equal(mesh.count, 0);
  pins.setPoints(points.slice(0, 1));
  assert.equal(mesh.count, 1);
  assert.ok(mesh.boundingSphere!.radius > 0);
  pins.dispose();
});
