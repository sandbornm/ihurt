import test from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { LayerSpread } from "../src/anatomy/spread.ts";

test("spreading layers leaves source coordinates, materials and geometry intact", () => {
  const geometry = new BoxGeometry();
  const material = new MeshStandardMaterial();
  const first = new Mesh(geometry, material),
    second = new Mesh(geometry, material);
  first.position.set(1, 2, 3);
  second.position.set(-1, 1, 2);
  const positions = [first.position.clone(), second.position.clone()];
  let geometryDisposed = false,
    materialDisposed = false;
  geometry.addEventListener("dispose", () => (geometryDisposed = true));
  material.addEventListener("dispose", () => (materialDisposed = true));
  const spread = new LayerSpread();
  spread.set([first, second], new Vector3(1, 0, 0), new Vector3(0, 1, 0));
  spread.setAmount(1);
  spread.tick(1, true);
  assert.equal(spread.active, true);
  assert.notDeepEqual(spread.group.children[0].position, first.position);
  assert.deepEqual([first.position, second.position], positions);
  spread.highlight(first);
  assert.equal(material.emissive.getHex(), 0);
  spread.setAmount(0);
  spread.tick(1, true);
  assert.deepEqual(spread.group.children[0].position, first.position);
  spread.clear();
  assert.equal(spread.group.children.length, 0);
  assert.equal(geometryDisposed, false);
  assert.equal(materialDisposed, false);
  geometry.dispose();
  material.dispose();
});
