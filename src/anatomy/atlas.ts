import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { BodyMesh } from "./model";
import { bakeGeometry } from "./geometry";
import type { RegionId } from "../types";

export function regionAt(point: T.Vector3, structure = ""): RegionId {
  const side = point.x > 0 ? "left" : "right",
    x = Math.abs(point.x),
    y = point.y;
  if (
    /deltoid|supraspinatus|infraspinatus|subscapularis|teres (minor|major)/i.test(
      structure,
    )
  )
    return `${side}_shoulder`;
  if (/sternocleidomastoid|splenius capitis|levator scapulae/i.test(structure))
    return "neck";
  if (y > 2.48) return "neck";
  if (y > 1.65 && x > 0.45) return `${side}_shoulder`;
  if (y > 2.17) return "neck";
  if (y > 0.9 && x > 0.7) return `${side}_elbow`;
  if (y > 0.25 && x > 0.85) return `${side}_wrist`;
  if (y > 1.4) return point.z < 0 ? "upper_back" : "chest";
  if (y > 0.8) return point.z < 0 ? "lower_back" : "abdomen";
  if (y > 0.25) return `${side}_hip`;
  if (y > -0.67) return `${side}_thigh`;
  if (y > -1.07) return `${side}_knee`;
  if (y > -1.94) return `${side}_calf`;
  if (y > -2.22) return `${side}_ankle`;
  return `${side}_foot`;
}

export async function loadAtlas() {
  const draco = new DRACOLoader()
    .setDecoderPath("/draco/")
    .setDecoderConfig({ type: "wasm" })
    .setWorkerLimit(2);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  try {
    const files = await Promise.all([
      loader.loadAsync("/models/muscular.glb"),
      loader.loadAsync("/models/skeleton.glb"),
    ]);
    const meshes: {
      geometry: T.BufferGeometry;
      name: string;
      layer: "muscle" | "bone";
    }[] = [];
    const bounds = new T.Box3();
    files.forEach((file, index) => {
      file.scene.updateMatrixWorld(true);
      file.scene.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        const association = file.parser.associations.get(object);
        const original =
          association?.nodes !== undefined
            ? file.parser.json.nodes[association.nodes]?.name
            : object.name;
        const name = original ?? object.name;
        if (/\.g\.|\.j\.|fascia|bursa|sheath|retinaculum/i.test(name)) {
          object.geometry.dispose();
          return;
        }
        const geometry = bakeGeometry(object.geometry, object.matrixWorld);
        geometry.computeBoundingBox();
        bounds.union(geometry.boundingBox!);
        meshes.push({ geometry, name, layer: index === 0 ? "muscle" : "bone" });
        object.geometry.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        materials.forEach((m) => m.dispose());
      });
    });
    const scale = 5.85 / (bounds.max.y - bounds.min.y),
      center = bounds.getCenter(new T.Vector3());
    const group = new T.Group(),
      muscles: BodyMesh[] = [],
      bones: BodyMesh[] = [];
    for (const item of meshes) {
      item.geometry
        .translate(-center.x, -bounds.min.y, -center.z)
        .scale(scale, scale, scale)
        .translate(0, -2.5, 0);
      if (!item.geometry.getAttribute("normal"))
        item.geometry.computeVertexNormals();
      item.geometry.computeBoundingBox();
      const p = item.geometry.boundingBox!.getCenter(new T.Vector3());
      const mesh = new BodyMesh(
        item.geometry,
        new T.MeshStandardMaterial({
          color: "white",
          vertexColors: true,
          roughness: 0.62,
          metalness: 0.08,
        }),
      );
      const base = new T.Color(item.layer === "bone" ? "#bcc4ad" : "#94a38e");
      const color = new Float32Array(
        item.geometry.attributes.position.count * 3,
      );
      for (let i = 0; i < color.length; i += 3) base.toArray(color, i);
      item.geometry.setAttribute("color", new T.BufferAttribute(color, 3));
      mesh.name = item.name;
      mesh.userData = {
        region: regionAt(p, item.name),
        base,
        layer: item.layer,
      };
      group.add(mesh);
      (item.layer === "muscle" ? muscles : bones).push(mesh);
    }
    return { group, muscles, bones };
  } finally {
    draco.dispose();
  }
}
