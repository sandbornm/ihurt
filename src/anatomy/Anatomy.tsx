import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createBody } from "./model";
import { regions, type RegionId, type PainPoint } from "../types";
import { loadAtlas, regionAt } from "./atlas";
import { PinGesture } from "./gesture";
import { advanceCamera } from "./motion";

interface Props {
  selected: RegionId | null;
  mapped: RegionId[];
  intensity: number | null;
  layer: "muscle" | "bone";
  view: "front" | "back";
  command: { type: string; id: number };
  onSelect: (region: RegionId) => void;
  points?: PainPoint[];
  onPoint?: (point: PainPoint) => void;
}
type HeatFunction = (...values: number[]) => number;
const fallbackHeat: HeatFunction = (x, y, z, cx, cy, cz, r, i) =>
  Math.exp(
    -2 *
      (((x - cx) / r) ** 2 +
        ((y - cy) / (r * 1.25)) ** 2 +
        ((z - cz) / r) ** 2),
  ) * i;

export default function Anatomy(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const engine = useRef<{
    update: () => void;
    command: (type: string) => void;
  } | null>(null);
  const [failure, setFailure] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const root = host.current;
    let renderer: T.WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "low-power",
      });
    } catch {
      setFailure(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x111a18, 0);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive anatomy. Click to pin a spot. Drag to rotate; use landmarks or the region picker for keyboard access.",
    );
    renderer.domElement.setAttribute("role", "img");
    root.appendChild(renderer.domElement);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(36, 1, 0.005, 100);
    camera.position.set(0.25, 0.65, 10);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.4, 0);
    const motionPreference = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    controls.enableDamping = !motionPreference.matches;
    controls.dampingFactor = 0.1;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    controls.minDistance = 0.35;
    controls.maxDistance = 13;
    controls.zoomSpeed = 0.65;
    controls.panSpeed = 0.7;
    controls.rotateSpeed = 0.65;
    controls.maxTargetRadius = 4;
    controls.cursor.set(0, 0.4, 0);
    controls.maxPolarAngle = Math.PI - 0.04;
    controls.minPolarAngle = 0.04;
    controls.enableZoom = true;
    scene.add(new T.HemisphereLight(0xe2eddc, 0x293b35, 1.5));
    const key = new T.DirectionalLight(0xe6edd6, 2.4);
    key.position.set(-3, 5, 5);
    scene.add(key);
    const rim = new T.DirectionalLight(0x9ad7b5, 1.6);
    rim.position.set(3, 2, -3);
    scene.add(rim);
    const fill = new T.DirectionalLight(0x899caf, 0.8);
    fill.position.set(1, 1, 4);
    scene.add(fill);
    let body = createBody();
    body.group.visible = false;
    scene.add(body.group);
    const pinGroup = new T.Group();
    scene.add(pinGroup);
    const colorCache = new WeakMap<T.Object3D, string>();
    const meshBounds = new WeakMap<T.Object3D, T.Box3>();
    const disposeGroup = (group: T.Group) =>
      group.traverse((object) => {
        if (object instanceof T.Mesh || object instanceof T.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((m) => m.dispose());
        }
      });
    const ring = new T.Mesh(
      new T.RingGeometry(0.72, 0.728, 80),
      new T.MeshBasicMaterial({
        color: "#577464",
        transparent: true,
        opacity: 0.5,
        side: T.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -2.53;
    scene.add(ring);
    const outerRing = new T.Mesh(
      new T.RingGeometry(0.89, 0.893, 80),
      new T.MeshBasicMaterial({
        color: "#577464",
        transparent: true,
        opacity: 0.22,
        side: T.DoubleSide,
      }),
    );
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.position.y = -2.53;
    scene.add(outerRing);
    const heatColor = new T.Color();
    const cool = new T.Color("#c4ed76"),
      warm = new T.Color("#ffb265"),
      hot = new T.Color("#ed6e42");
    let heat: HeatFunction = fallbackHeat;
    let disposed = false,
      dirty = 2;
    const targetPosition = camera.position.clone(),
      targetLook = controls.target.clone();
    let easing = false;
    let inspected = "";
    let inspectedSide = 0;
    const matchesInspection = (mesh: T.Mesh) =>
      !inspected ||
      (mesh.name.toLowerCase().includes(inspected) &&
        (!inspectedSide ||
          mesh.geometry.boundingBox!.getCenter(new T.Vector3()).x *
            inspectedSide >
            0));
    const stepCamera = (elapsedSeconds: number) =>
      advanceCamera(
        camera.position,
        controls.target,
        targetPosition,
        targetLook,
        elapsedSeconds,
        motionPreference.matches,
      );
    const startTransition = () => {
      easing = stepCamera(0);
      dirty = 2;
    };
    const motionChanged = () => {
      controls.enableDamping = !motionPreference.matches;
      if (easing) easing = stepCamera(0);
      dirty = 2;
    };
    motionPreference.addEventListener("change", motionChanged);
    const update = () => {
      const p = latest.current;
      root.dataset.inspected = inspected || "none";
      for (const mesh of body.muscles) {
        mesh.visible = p.layer === "muscle" && matchesInspection(mesh);
        const matches = matchesInspection(mesh);
        mesh.material.transparent = !!inspected && !matches;
        mesh.material.opacity = matches ? 1 : 0.055;
        mesh.material.depthWrite = matches;
        mesh.material.emissive.set(
          matches && inspected ? "#426020" : "#000000",
        );
        mesh.material.emissiveIntensity = 0.2;
        const region = mesh.userData.region;
        const isSelected = region === p.selected;
        let bounds = meshBounds.get(mesh);
        if (!bounds) {
          mesh.geometry.computeBoundingBox();
          bounds = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrix);
          meshBounds.set(mesh, bounds);
        }
        const points =
          p.points?.filter(
            (point) =>
              bounds.distanceToPoint(new T.Vector3(...point.position)) < 0.6,
          ) ?? [];
        const cacheKey = JSON.stringify([
          isSelected,
          p.mapped,
          p.intensity,
          p.points?.map((point) => [point.id, point.region, point.position]),
        ]);
        if (colorCache.get(mesh) === cacheKey) continue;
        colorCache.set(mesh, cacheKey);
        const base = mesh.userData.base.clone();
        if (isSelected && !p.mapped.includes(region!))
          base.lerp(new T.Color("#ceefb3"), 0.48);
        const pos = mesh.geometry.attributes.position;
        const colors = mesh.geometry.attributes.color;
        const vertex = new T.Vector3(),
          color = new T.Color();
        for (let i = 0; i < pos.count; i++) {
          vertex.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix);
          let amount = 0;
          for (const point of points)
            amount = Math.max(
              amount,
              heat(vertex.x, vertex.y, vertex.z, ...point.position, 0.27, 1),
            );
          for (const regionId of p.mapped.filter(
            (id) => !p.points?.some((point) => point.region === id),
          )) {
            const r = regions.find((r) => r.id === regionId);
            if (r && region === regionId)
              amount = Math.max(
                amount,
                heat(vertex.x, vertex.y, vertex.z, ...r.center, 0.65, 1),
              );
          }
          color.copy(base);
          if (amount > 0.02) {
            const severity = (p.intensity ?? 3) / 10;
            if (p.intensity === null) heatColor.copy(cool);
            else
              heatColor
                .copy(severity < 0.5 ? cool : warm)
                .lerp(
                  severity < 0.5 ? warm : hot,
                  severity < 0.5 ? severity * 2 : (severity - 0.5) * 2,
                );
            color.lerp(heatColor, Math.min(1, amount * 1.6 + 0.15));
          }
          colors.setXYZ(i, color.r, color.g, color.b);
        }
        colors.needsUpdate = true;
      }
      body.fibers.visible = p.layer === "muscle";
      for (const bone of body.bones) {
        bone.material.transparent = !!inspected;
        bone.material.opacity = inspected ? 0.15 : 1;
        bone.material.depthWrite = !inspected;
        bone.material.color.copy(bone.userData.base);
        if (p.mapped.includes(bone.userData.region!))
          bone.material.color.lerp(warm, 0.8);
        else if (bone.userData.region === p.selected)
          bone.material.color.lerp(cool, 0.7);
      }
      disposeGroup(pinGroup);
      pinGroup.clear();
      for (const point of p.points ?? []) {
        const pin = new T.Mesh(
          new T.SphereGeometry(0.025, 12, 10),
          new T.MeshBasicMaterial({ color: "#f9c68a" }),
        );
        pin.position.set(...point.position);
        pinGroup.add(pin);
      }
      dirty = 2;
    };
    const command = (type: string) => {
      const p = latest.current;
      const sign = p.view === "back" ? -1 : 1;
      if (type === "context") {
        inspected = "";
        update();
        return;
      }
      if (type.startsWith("muscle:")) {
        inspected = type.slice(7);
        inspectedSide = p.selected?.startsWith("left")
          ? 1
          : p.selected?.startsWith("right")
            ? -1
            : 0;
        const matching = body.muscles.filter(matchesInspection);
        if (matching.length) {
          const box = new T.Box3();
          matching.forEach((mesh) => box.union(mesh.geometry.boundingBox!));
          box.getCenter(targetLook);
          const distance = Math.max(
            0.65,
            box.getSize(new T.Vector3()).length() * 1.6,
          );
          targetPosition
            .copy(targetLook)
            .add(new T.Vector3(0, 0.06, distance * sign));
          startTransition();
          update();
          return;
        }
        inspected = "";
        update();
        return;
      }
      if (type.startsWith("surface:")) {
        inspected = "";
        update();
        const center = regions.find((r) => r.id === p.selected)?.center ?? [
          0, 1.9, 0,
        ];
        targetLook.set(...(center as [number, number, number]));
        const face = type.slice(8),
          side = p.selected?.startsWith("right") ? -1 : 1;
        const offset =
          face === "superior"
            ? new T.Vector3(0, 2.1, 0.05)
            : face === "lateral"
              ? new T.Vector3(side * 2.1, 0.1, 0)
              : new T.Vector3(0, 0.1, face === "posterior" ? -2.1 : 2.1);
        targetPosition.copy(targetLook).add(offset);
        startTransition();
        return;
      }
      if (
        type === "reset" ||
        type === "view" ||
        type === "focus" ||
        type.startsWith("point:")
      ) {
        inspected = "";
        update();
      }
      if (type === "zoom-in" || type === "zoom-out") {
        const offset = (easing ? targetPosition : camera.position)
          .clone()
          .sub(easing ? targetLook : controls.target)
          .multiplyScalar(type === "zoom-in" ? 0.8 : 1.25);
        offset.clampLength(0.35, 13);
        targetPosition.copy(controls.target).add(offset);
        targetLook.copy(controls.target);
      } else if (
        (type === "focus" || type.startsWith("point:")) &&
        p.selected
      ) {
        const region = regions.find((r) => r.id === p.selected)!;
        const pin = type.startsWith("point:")
          ? p.points?.find((point) => point.id === type.slice(6))
          : p.points?.filter((point) => point.region === p.selected).at(-1);
        targetLook.set(
          ...(pin?.position ??
            ([region.center[0], region.center[1], 0] as [
              number,
              number,
              number,
            ])),
        );
        targetPosition
          .copy(targetLook)
          .add(
            new T.Vector3(
              0,
              0.1,
              2.3 * (pin ? (pin.position[2] < 0 ? -1 : 1) : sign),
            ),
          );
      } else {
        targetLook.set(0, 0.4, 0);
        targetPosition.set(0.25 * sign, 0.65, 10 * sign);
      }
      startTransition();
    };
    engine.current = { update, command };
    update();
    loadAtlas()
      .then((atlas) => {
        if (disposed) {
          disposeGroup(atlas.group);
          return;
        }
        scene.remove(body.group);
        disposeGroup(body.group);
        body = {
          ...atlas,
          fibers: new T.LineSegments(
            new T.BufferGeometry(),
            new T.LineBasicMaterial(),
          ),
        };
        body.group.add(body.fibers);
        scene.add(body.group);
        root.dataset.atlas = "z-anatomy";
        setReady(true);
        update();
        if (latest.current.command.type.startsWith("muscle:"))
          command(latest.current.command.type);
      })
      .catch(() => {
        if (disposed) return;
        body.group.visible = true;
        root.dataset.atlas = "schematic-fallback";
        setReady(true);
        dirty = 2;
      });
    fetch("/heat.wasm")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.arrayBuffer();
      })
      .then((buffer) =>
        WebAssembly.instantiate(buffer, {
          env: {
            abort() {
              throw new Error("Heat kernel error");
            },
          },
        }),
      )
      .then(({ instance }) => {
        if (!disposed) {
          heat = instance.exports.heat as HeatFunction;
          root.dataset.heatEngine = "wasm";
          update();
        }
      })
      .catch(() => {
        root.dataset.heatEngine = "javascript";
      });
    const resize = () => {
      const width = root.clientWidth,
        height = root.clientHeight;
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      dirty = 2;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    resize();
    const raycaster = new T.Raycaster(),
      pointer = new T.Vector2();
    const gesture = new PinGesture();
    const stopEasing = () => {
      easing = false;
    };
    const down = (event: PointerEvent) => {
      gesture.down(event.pointerId, event.clientX, event.clientY);
      stopEasing();
    };
    const move = (event: PointerEvent) =>
      gesture.move(event.pointerId, event.clientX, event.clientY);
    const cancel = (event: PointerEvent) => gesture.cancel(event.pointerId);
    const click = (event: PointerEvent) => {
      if (
        !gesture.up(
          event.pointerId,
          event.clientX,
          event.clientY,
          event.button,
        ) ||
        !root.dataset.atlas
      )
        return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const meshes =
        latest.current.layer === "muscle"
          ? [...body.muscles, ...body.bones]
          : body.bones;
      const hit = raycaster
        .intersectObjects(
          meshes.filter((mesh) => mesh.visible && mesh.material.opacity > 0.5),
          false,
        )
        .find((hit) => hit.object.userData.region);
      if (hit) {
        const region =
          root.dataset.atlas === "z-anatomy"
            ? regionAt(hit.point, hit.object.name)
            : hit.object.userData.region;
        latest.current.onSelect(region);
        latest.current.onPoint?.({
          id: crypto.randomUUID(),
          region,
          position: hit.point.toArray() as [number, number, number],
          source: hit.object.userData.source ?? {
            atlas: "schematic-v1",
            layer: hit.object.userData.layer,
            mesh_name: hit.object.name,
          },
          structure:
            hit.object.name
              .replace(/\.[lr]\.\d+$/, "")
              .replace(/\.\d+$/, "")
              .replace(/_/g, " ") || "Selected surface",
        });
      }
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointerup", click);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointercancel", cancel);
    controls.addEventListener("start", stopEasing);
    const changed = () => {
      dirty = 2;
    };
    controls.addEventListener("change", changed);
    let previousFrame = performance.now();
    renderer.setAnimationLoop((time) => {
      const elapsedSeconds = (time - previousFrame) / 1000;
      previousFrame = time;
      if (document.hidden) return;
      if (easing) {
        easing = stepCamera(elapsedSeconds);
        dirty = 2;
      }
      controls.update();
      if (dirty > 0) {
        renderer.render(scene, camera);
        dirty--;
      }
    });
    return () => {
      disposed = true;
      engine.current = null;
      observer.disconnect();
      motionPreference.removeEventListener("change", motionChanged);
      controls.dispose();
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointerup", click);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointercancel", cancel);
      controls.removeEventListener("start", stopEasing);
      scene.traverse((object) => {
        if (object instanceof T.Mesh || object instanceof T.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  useEffect(
    () => engine.current?.update(),
    [props.selected, props.mapped, props.intensity, props.layer, props.points],
  );
  useEffect(() => engine.current?.command("view"), [props.view]);
  useEffect(() => {
    if (props.command.id) engine.current?.command(props.command.type);
  }, [props.command]);
  return (
    <div className="anatomy-canvas" ref={host}>
      {failure ? (
        <div className="canvas-fallback">
          <strong>Use the region picker to make your map.</strong>
          <p>
            3D graphics aren’t available in this browser. Your notes and hurt
            maps still work.
          </p>
        </div>
      ) : (
        !ready && (
          <div className="canvas-loading">
            Loading the body…
            <span />
          </div>
        )
      )}
    </div>
  );
}
