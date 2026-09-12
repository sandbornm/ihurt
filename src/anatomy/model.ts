import * as T from "three";
import type { RegionId } from "../types";

type Point = [number, number, number];
export class BodyMesh extends T.Mesh<T.BufferGeometry, T.MeshStandardMaterial> {
  declare userData: {
    region?: RegionId;
    base: T.Color;
    layer: "muscle" | "bone";
  };
}

export function createBody() {
  const group = new T.Group();
  const muscles: BodyMesh[] = [];
  const bones: BodyMesh[] = [];
  const fiberPoints: number[] = [];
  const baseColor = new T.Color("#8b9992");
  const boneColor = new T.Color("#cfceb8");

  function muscle(
    pos: Point,
    scale: Point,
    region?: RegionId,
    rotation = 0,
    fibers = 9,
    color = baseColor,
  ) {
    const geo = new T.SphereGeometry(1, 28, 24);
    const material = new T.MeshStandardMaterial({
      color: "white",
      roughness: 0.67,
      metalness: 0.16,
      vertexColors: true,
    });
    const mesh = new BodyMesh(geo, material);
    mesh.position.set(...pos);
    mesh.scale.set(...scale);
    mesh.rotation.z = rotation;
    mesh.userData = { region, base: color.clone(), layer: "muscle" };
    const colors = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    geo.setAttribute("color", new T.BufferAttribute(colors, 3));
    group.add(mesh);
    muscles.push(mesh);
    mesh.updateMatrix();
    // Fine longitudinal fibers give each selectable muscle volume a readable direction.
    for (let f = 0; f < fibers; f++) {
      const a = ((f + 0.5) / fibers) * Math.PI * 2;
      for (let j = 2; j < 20; j++) {
        for (const step of [j, j + 1]) {
          const t = (step / 22) * Math.PI;
          const point = new T.Vector3(
            Math.sin(t) * Math.cos(a) * 1.007,
            Math.cos(t),
            Math.sin(t) * Math.sin(a) * 1.007,
          ).applyMatrix4(mesh.matrix);
          fiberPoints.push(point.x, point.y, point.z);
        }
      }
    }
    return mesh;
  }
  function bone(a: Point, b: Point, radius: number, region?: RegionId) {
    const start = new T.Vector3(...a),
      end = new T.Vector3(...b);
    const geo = new T.CapsuleGeometry(
      radius,
      Math.max(0.01, start.distanceTo(end) - radius * 2),
      5,
      10,
    );
    const mesh = new BodyMesh(
      geo,
      new T.MeshStandardMaterial({ color: boneColor, roughness: 0.8 }),
    );
    mesh.position.copy(start).lerp(end, 0.5);
    mesh.quaternion.setFromUnitVectors(
      new T.Vector3(0, 1, 0),
      end.sub(start).normalize(),
    );
    mesh.userData = { region, base: boneColor.clone(), layer: "bone" };
    group.add(mesh);
    bones.push(mesh);
    return mesh;
  }
  function boneCurve(points: Point[], radius: number, region?: RegionId) {
    const geo = new T.TubeGeometry(
      new T.CatmullRomCurve3(points.map((p) => new T.Vector3(...p))),
      28,
      radius,
      6,
      false,
    );
    const mesh = new BodyMesh(
      geo,
      new T.MeshStandardMaterial({ color: boneColor, roughness: 0.8 }),
    );
    mesh.userData = { region, base: boneColor.clone(), layer: "bone" };
    group.add(mesh);
    bones.push(mesh);
  }

  // Original schematic anatomy, built locally from parametric surfaces.
  const profile = new T.SplineCurve(
    [
      [0.08, 0.45],
      [0.35, 0.51],
      [0.43, 0.67],
      [0.38, 0.87],
      [0.32, 1.1],
      [0.34, 1.35],
      [0.43, 1.65],
      [0.54, 1.94],
      [0.52, 2.16],
      [0.22, 2.31],
      [0.12, 2.42],
    ].map(([r, y]) => new T.Vector2(r, y)),
  );
  const torsoGeometry = new T.LatheGeometry(profile.getPoints(55), 40);
  torsoGeometry.scale(1, 1, 0.46);
  const torso = new BodyMesh(
    torsoGeometry,
    new T.MeshStandardMaterial({
      color: "white",
      roughness: 0.72,
      vertexColors: true,
    }),
  );
  torso.userData = { base: new T.Color("#7c8b80"), layer: "muscle" };
  const torsoColors = new Float32Array(
    torsoGeometry.attributes.position.count * 3,
  );
  for (let i = 0; i < torsoColors.length; i += 3)
    torso.userData.base.toArray(torsoColors, i);
  torsoGeometry.setAttribute("color", new T.BufferAttribute(torsoColors, 3));
  group.add(torso);
  muscles.push(torso);
  muscle(
    [0, 2.97, -0.015],
    [0.255, 0.37, 0.25],
    undefined,
    0,
    0,
    new T.Color("#9daa9f"),
  );
  muscle([0, 2.76, 0.035], [0.17, 0.15, 0.19], undefined, 0, 0);
  muscle([0, 3.01, 0.222], [0.027, 0.065, 0.049], undefined, 0, 0);
  for (const side of [-1, 1]) {
    const prefix = side === 1 ? "left" : "right";
    const id = (part: string) => `${prefix}_${part}` as RegionId;
    muscle(
      [side * 0.12, 2.46, 0.065],
      [0.088, 0.25, 0.1],
      "neck",
      side * -0.25,
      6,
    );
    muscle(
      [side * 0.3, 2.28, -0.085],
      [0.31, 0.17, 0.17],
      "upper_back",
      side * 0.32,
      12,
    );
    muscle(
      [side * 0.28, 2.025, 0.207],
      [0.31, 0.225, 0.102],
      "chest",
      side * -0.15,
      18,
    );
    muscle(
      [side * 0.46, 1.77, -0.15],
      [0.24, 0.47, 0.14],
      "upper_back",
      side * -0.18,
      14,
    );
    muscle(
      [side * 0.18, 1.74, -0.25],
      [0.17, 0.49, 0.09],
      "upper_back",
      side * -0.08,
      9,
    );
    muscle(
      [side * 0.14, 1.1, -0.225],
      [0.105, 0.38, 0.1],
      "lower_back",
      side * 0.1,
      8,
    );
    muscle(
      [side * 0.36, 1.25, 0.055],
      [0.17, 0.39, 0.21],
      "abdomen",
      side * -0.15,
      12,
    );
    for (let j = 0; j < 4; j++)
      muscle(
        [side * 0.128, 1.65 - j * 0.205, 0.235 - j * 0.012],
        [0.124 - j * 0.008, 0.112, 0.09],
        "abdomen",
        side * 0.05,
        6,
      );
    for (let j = 0; j < 3; j++)
      muscle(
        [side * (0.435 - j * 0.017), 1.68 - j * 0.13, 0.147],
        [0.16, 0.055, 0.07],
        "chest",
        side * -0.5,
        4,
      );
    muscle(
      [side * 0.32, 0.67, -0.14],
      [0.31, 0.32, 0.23],
      id("hip"),
      side * -0.16,
      15,
    );
    muscle(
      [side * 0.26, 0.62, 0.06],
      [0.23, 0.22, 0.17],
      id("hip"),
      side * -0.2,
      12,
    );
    muscle(
      [side * 0.7, 2.06, 0],
      [0.265, 0.285, 0.265],
      id("shoulder"),
      side * 0.25,
      18,
    );
    muscle(
      [side * 0.85, 1.68, 0.105],
      [0.175, 0.395, 0.17],
      id("shoulder"),
      side * -0.31,
      14,
    );
    muscle(
      [side * 0.85, 1.62, -0.12],
      [0.185, 0.41, 0.16],
      id("shoulder"),
      side * -0.29,
      14,
    );
    muscle(
      [side * 1.02, 1.205, 0],
      [0.13, 0.155, 0.13],
      id("elbow"),
      side * -0.15,
      5,
    );
    muscle(
      [side * 1.1, 0.95, 0.03],
      [0.142, 0.34, 0.135],
      id("elbow"),
      side * -0.22,
      16,
    );
    muscle(
      [side * 1.18, 0.7, 0.015],
      [0.095, 0.255, 0.09],
      id("wrist"),
      side * -0.23,
      10,
    );
    muscle(
      [side * 1.25, 0.4, 0.035],
      [0.11, 0.18, 0.065],
      id("wrist"),
      side * -0.12,
      8,
    );
    for (let j = 0; j < 4; j++) {
      const x = side * (1.175 + j * 0.049);
      bone(
        [x, 0.27, 0.055],
        [x + side * 0.025, 0.08 + Math.abs(j - 1) * 0.025, 0.085],
        0.021,
        id("wrist"),
      );
    }
    bone(
      [side * 1.16, 0.47, 0.07],
      [side * 1.1, 0.29, 0.12],
      0.026,
      id("wrist"),
    );
    muscle(
      [side * 0.32, -0.16, 0.15],
      [0.205, 0.61, 0.16],
      id("thigh"),
      side * -0.035,
      20,
    );
    muscle(
      [side * 0.495, -0.12, 0.05],
      [0.13, 0.6, 0.19],
      id("thigh"),
      side * -0.08,
      15,
    );
    muscle(
      [side * 0.185, -0.3, 0.09],
      [0.135, 0.42, 0.145],
      id("thigh"),
      side * -0.12,
      14,
    );
    muscle(
      [side * 0.34, -0.15, -0.17],
      [0.22, 0.59, 0.16],
      id("thigh"),
      side * 0.015,
      18,
    );
    muscle(
      [side * 0.335, -0.89, 0.065],
      [0.158, 0.16, 0.155],
      id("knee"),
      0,
      0,
      new T.Color("#a7b2a6"),
    );
    muscle(
      [side * 0.34, -1.4, -0.075],
      [0.185, 0.43, 0.17],
      id("calf"),
      side * -0.07,
      17,
    );
    muscle(
      [side * 0.31, -1.48, 0.1],
      [0.092, 0.49, 0.08],
      id("calf"),
      side * 0.06,
      10,
    );
    muscle(
      [side * 0.33, -1.92, -0.055],
      [0.075, 0.28, 0.085],
      id("ankle"),
      0,
      7,
    );
    muscle(
      [side * 0.325, -2.18, 0.005],
      [0.095, 0.145, 0.1],
      id("ankle"),
      0,
      5,
    );
    muscle([side * 0.33, -2.35, 0.15], [0.145, 0.13, 0.275], id("foot"), 0, 10);
    for (let j = 0; j < 5; j++)
      muscle(
        [side * (0.215 + j * 0.055), -2.39, 0.38 - j * 0.018],
        [0.035, 0.055, 0.09 - j * 0.008],
        id("foot"),
        0,
        0,
      );
    bone(
      [side * 0.12, 2.27, 0.05],
      [side * 0.7, 2.14, 0.05],
      0.037,
      id("shoulder"),
    );
    bone([side * 0.72, 2.07, 0], [side * 1.02, 1.22, 0], 0.064, id("shoulder"));
    bone([side * 1.03, 1.22, 0], [side * 1.245, 0.52, 0], 0.045, id("elbow"));
    bone(
      [side * 1.08, 1.2, 0.03],
      [side * 1.29, 0.53, 0.03],
      0.028,
      id("wrist"),
    );
    bone([side * 0.36, 0.52, 0], [side * 0.335, -0.88, 0], 0.079, id("thigh"));
    bone([side * 0.335, -0.94, 0], [side * 0.325, -2.17, 0], 0.055, id("calf"));
    bone(
      [side * 0.405, -0.99, -0.03],
      [side * 0.405, -2.14, -0.04],
      0.027,
      id("calf"),
    );
    boneCurve(
      [
        [side * 0.12, 0.7, -0.03],
        [side * 0.46, 0.87, -0.03],
        [side * 0.53, 0.61, 0],
        [side * 0.28, 0.4, 0.12],
        [side * 0.06, 0.5, 0.15],
      ],
      0.07,
      id("hip"),
    );
    for (let j = 0; j < 9; j++) {
      const y = 2.12 - j * 0.1,
        width = 0.37 + Math.sin((j / 9) * Math.PI) * 0.15;
      boneCurve(
        [
          [side * 0.065, y, -0.16],
          [side * width * 0.8, y + 0.05, -0.18],
          [side * width, y, 0],
          [side * width * 0.8, y - 0.13, 0.2],
          [side * 0.055, y - 0.18, 0.21],
        ],
        0.017,
        "chest",
      );
    }
  }
  bone([0, 2.2, 0.21], [0, 1.43, 0.22], 0.04, "chest");
  for (let j = 0; j < 23; j++) {
    const y = 2.56 - j * 0.086;
    const z = -0.13 - Math.sin((j / 23) * Math.PI) * 0.07;
    bone(
      [0, y, z],
      [0, y - 0.045, z],
      j < 5 ? 0.06 : 0.083,
      y > 1.45 ? "upper_back" : "lower_back",
    );
  }
  const fibers = new T.LineSegments(
    new T.BufferGeometry().setAttribute(
      "position",
      new T.Float32BufferAttribute(fiberPoints, 3),
    ),
    new T.LineBasicMaterial({
      color: "#283c33",
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    }),
  );
  group.add(fibers);
  return { group, muscles, bones, fibers };
}
