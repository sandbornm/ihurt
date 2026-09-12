import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { bakeGeometry } from "../src/anatomy/geometry.ts";

for (const indexed of [true, false]) {
  test(`mirrored ${indexed ? "indexed" : "unindexed"} anatomy keeps outward faces`, () => {
    const source = new T.BufferGeometry();
    source.setAttribute(
      "position",
      new T.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    source.setAttribute(
      "normal",
      new T.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
    );
    if (indexed) source.setIndex([0, 1, 2]);
    const transform = new T.Matrix4()
      .makeRotationY(0.7)
      .scale(new T.Vector3(-1, 1, 1));
    const baked = bakeGeometry(source, transform);
    const vertices = [0, 1, 2].map((i) =>
      new T.Vector3().fromBufferAttribute(
        baked.attributes.position,
        baked.index!.getX(i),
      ),
    );
    const faceNormal = vertices[1]
      .clone()
      .sub(vertices[0])
      .cross(vertices[2].clone().sub(vertices[0]))
      .normalize();
    const normal = new T.Vector3().fromBufferAttribute(
      baked.attributes.normal,
      0,
    );
    assert.ok(faceNormal.dot(normal) > 0.999);
    assert.equal(source.attributes.position.getX(1), 1);
    assert.deepEqual(
      source.index ? Array.from(source.index.array) : null,
      indexed ? [0, 1, 2] : null,
    );
  });
}
