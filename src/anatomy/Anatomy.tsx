import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createBody } from "./model";
import { regions, type RegionId, type PainPoint } from "../types";
import { loadAtlas, regionAt } from "./atlas";
import { PinGesture } from "./gesture";
import { advanceCamera, nudgeCamera } from "./motion";
import { nearbySurfaces, surfaceNearViewCenter } from "./selection";
import { intensityColor } from "./intensity";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Layers3,
  X,
} from "lucide-react";

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
  navigation?: boolean;
}
type Candidate = { mesh: T.Object3D; point: PainPoint };
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
    preview: (candidate: Candidate | null) => void;
  } | null>(null);
  const [dragMode, setDragMode] = useState<"turn" | "move">("turn");
  const [layers, setLayers] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [muscleBrowser, setMuscleBrowser] = useState(false);
  const [muscleQuery, setMuscleQuery] = useState("");
  const [muscleOptions, setMuscleOptions] = useState<
    { id: string; name: string; region: RegionId }[]
  >([]);
  const [activeMuscle, setActiveMuscle] = useState("");
  const [surroundings, setSurroundings] = useState(0);
  const [pickHint, setPickHint] = useState("");
  const interaction = useRef({ dragMode, layers, surroundings });
  interaction.current = { dragMode, layers, surroundings };
  const picker = useRef<HTMLDivElement>(null);
  const layersButton = useRef<HTMLButtonElement>(null);
  const closePicker = () => {
    setCandidates([]);
    engine.current?.preview(null);
    layersButton.current?.focus({ preventScroll: true });
  };
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
      "Interactive anatomy. Click to pin a spot. Use Turn or Move and the arrow buttons to adjust the view. Layers lets you choose overlapping structures.",
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
    controls.zoomToCursor = false;
    controls.minDistance = 0.35;
    controls.maxDistance = 13;
    controls.zoomSpeed = 0.4;
    controls.panSpeed = 0.5;
    controls.rotateSpeed = 0.4;
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
      warm = new T.Color("#ffb265");
    let heat: HeatFunction = fallbackHeat;
    let disposed = false,
      dirty = 2;
    const targetPosition = camera.position.clone(),
      targetLook = controls.target.clone();
    let easing = false;
    let inspected = "";
    let exactMesh = "";
    let inspectedSide = 0;
    let previewMesh: T.Object3D | null = null;
    const matchesInspection = (mesh: T.Mesh) =>
      exactMesh
        ? mesh.uuid === exactMesh
        : !inspected ||
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
      controls.mouseButtons.LEFT =
        interaction.current.dragMode === "move" ? T.MOUSE.PAN : T.MOUSE.ROTATE;
      root.dataset.dragMode = interaction.current.dragMode;
      root.dataset.inspected = exactMesh || inspected || "none";
      for (const mesh of body.muscles) {
        const matches = matchesInspection(mesh);
        const faded = (!!previewMesh && mesh !== previewMesh) || !matches;
        mesh.visible =
          p.layer === "muscle" &&
          (!faded || interaction.current.surroundings > 0);
        mesh.material.transparent = faded;
        mesh.material.opacity = faded ? interaction.current.surroundings : 1;
        mesh.material.depthWrite = !faded && matches;
        mesh.material.emissive.set(
          mesh === previewMesh
            ? "#91c655"
            : matches && inspected
              ? "#426020"
              : "#000000",
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
            heatColor.set(intensityColor(p.intensity));
            color.lerp(heatColor, Math.min(1, amount * 1.6 + 0.15));
          }
          colors.setXYZ(i, color.r, color.g, color.b);
        }
        colors.needsUpdate = true;
      }
      body.fibers.visible = p.layer === "muscle";
      for (const bone of body.bones) {
        const faded =
          (!!previewMesh && bone !== previewMesh) || !!exactMesh || !!inspected;
        bone.visible = !faded || interaction.current.surroundings > 0;
        bone.material.transparent = faded || !!inspected;
        bone.material.opacity = faded ? interaction.current.surroundings : 1;
        bone.material.depthWrite = !faded && !inspected;
        bone.material.color.copy(bone.userData.base);
        if (bone === previewMesh) bone.material.color.lerp(cool, 0.8);
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
      previewMesh = null;
      setCandidates([]);
      setPickHint("");
      if (
        ["context", "reset", "view", "focus"].includes(type) ||
        type.startsWith("muscle:") ||
        type.startsWith("surface:") ||
        type.startsWith("point:")
      ) {
        exactMesh = "";
        setActiveMuscle("");
      }
      update();
      const p = latest.current;
      const sign = p.view === "back" ? -1 : 1;
      if (type === "pin-center") {
        if (!exactMesh && p.selected) command("focus");
        if (easing) {
          camera.position.copy(targetPosition);
          controls.target.copy(targetLook);
          easing = false;
          controls.update();
        }
        camera.updateMatrixWorld();
        const rect = renderer.domElement.getBoundingClientRect();
        pickAt(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
          true,
          exactMesh ? undefined : (p.selected ?? undefined),
        );
        return;
      }
      if (type === "context") {
        inspected = "";
        update();
        return;
      }
      if (type.startsWith("muscle:") || type.startsWith("mesh:")) {
        exactMesh = type.startsWith("mesh:") ? type.slice(5) : "";
        setActiveMuscle(exactMesh);
        inspected = exactMesh ? "" : type.slice(7);
        inspectedSide = p.selected?.startsWith("left")
          ? 1
          : p.selected?.startsWith("right")
            ? -1
            : 0;
        const matching = body.muscles.filter(matchesInspection);
        if (matching.length) {
          if (exactMesh) latest.current.onSelect(matching[0].userData.region!);
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
      if (type.startsWith("nudge:")) {
        const next = nudgeCamera(
          easing ? targetPosition : camera.position,
          easing ? targetLook : controls.target,
          type.slice(6),
          interaction.current.dragMode === "move",
        );
        // The drag controls and buttons share the same pan boundary.
        const correction = next.look.clone().sub(controls.cursor);
        if (correction.length() > controls.maxTargetRadius) {
          const bounded = correction
            .clone()
            .clampLength(0, controls.maxTargetRadius)
            .add(controls.cursor);
          next.position.add(bounded.clone().sub(next.look));
          next.look.copy(bounded);
        }
        targetPosition.copy(next.position);
        targetLook.copy(next.look);
      } else if (type === "zoom-in" || type === "zoom-out") {
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
    engine.current = {
      update,
      command,
      preview: (candidate) => {
        previewMesh = candidate?.mesh ?? null;
        update();
      },
    };
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
        setMuscleOptions(
          body.muscles
            .map((mesh) => ({
              id: mesh.uuid,
              name:
                mesh.name.replace(/\.[lr]\.\d+$/, "").replace(/_/g, " ") +
                (/\.l\./.test(mesh.name)
                  ? " · Left"
                  : /\.r\./.test(mesh.name)
                    ? " · Right"
                    : ""),
              region: mesh.userData.region!,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
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
      if (previewMesh) {
        previewMesh = null;
        setCandidates([]);
        update();
      }
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
      pickAt(event.clientX, event.clientY);
    };
    function pickAt(
      clientX: number,
      clientY: number,
      forcePicker = false,
      targetRegion?: RegionId,
    ) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        (-(clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const meshes =
        latest.current.layer === "muscle"
          ? [...body.muscles, ...body.bones]
          : body.bones;
      let hits = raycaster
        .intersectObjects(
          meshes.filter((mesh) => mesh.visible && mesh.material.opacity > 0.5),
          false,
        )
        .filter(
          (hit) =>
            hit.object.userData.region &&
            (!targetRegion ||
              regionAt(hit.point, hit.object.name) === targetRegion),
        );
      if (!hits.length && forcePicker && (exactMesh || targetRegion)) {
        const surfaces = meshes.filter(
          (mesh) =>
            mesh.visible &&
            mesh.material.opacity > 0.5 &&
            (exactMesh
              ? mesh.uuid === exactMesh
              : mesh.userData.region === targetRegion),
        );
        let closest = Infinity;
        for (const mesh of surfaces) {
          const surface = surfaceNearViewCenter(mesh, camera);
          if (
            !surface ||
            (targetRegion &&
              regionAt(surface.point, mesh.name) !== targetRegion)
          )
            continue;
          const projected = surface.point.clone().project(camera);
          const distance = projected.x ** 2 + projected.y ** 2;
          if (distance < closest) {
            closest = distance;
            hits = [surface];
          }
        }
      }
      const options = nearbySurfaces(hits).map((hit): Candidate => {
        const region =
          root.dataset.atlas === "z-anatomy"
            ? regionAt(hit.point, hit.object.name)
            : hit.object.userData.region;
        return {
          mesh: hit.object,
          point: {
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
          },
        };
      });
      if (
        options.length &&
        latest.current.navigation &&
        (interaction.current.layers || forcePicker)
      ) {
        setCandidateIndex(0);
        setCandidates(options);
        setMuscleBrowser(false);
        previewMesh = options[0].mesh;
        update();
      } else if (options[0]) {
        latest.current.onSelect(options[0].point.region);
        latest.current.onPoint?.(options[0].point);
      } else if (forcePicker) {
        setLayers(true);
        setPickHint("Click the visible muscle to choose a pin location");
      }
    }
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
    [
      props.selected,
      props.mapped,
      props.intensity,
      props.layer,
      props.points,
      dragMode,
      surroundings,
    ],
  );
  useEffect(() => {
    setCandidates([]);
    engine.current?.command("context");
  }, [props.layer, layers]);
  useEffect(() => {
    if (candidates.length)
      picker.current
        ?.querySelector<HTMLButtonElement>("[aria-pressed=true]")
        ?.focus({ preventScroll: true });
  }, [candidates]);
  useEffect(() => engine.current?.command("view"), [props.view]);
  useEffect(() => {
    if (props.command.id) engine.current?.command(props.command.type);
  }, [props.command]);
  return (
    <div className="anatomy-canvas" ref={host}>
      {props.navigation && ready && !failure && (
        <>
          <div className="anatomy-navigation" aria-label="Model controls">
            <div className="navigation-modes">
              <button
                aria-pressed={muscleBrowser}
                onClick={() => {
                  setMuscleBrowser((v) => !v);
                  setCandidates([]);
                  engine.current?.preview(null);
                }}
              >
                Muscle list
              </button>
              {(["turn", "move"] as const).map((mode) => (
                <button
                  key={mode}
                  aria-pressed={dragMode === mode}
                  onClick={() => setDragMode(mode)}
                >
                  {mode === "turn" ? "Turn" : "Move"}
                </button>
              ))}
              <button
                ref={layersButton}
                aria-pressed={layers}
                onClick={() => setLayers((v) => !v)}
              >
                <Layers3 size={14} /> Layers
              </button>
            </div>
            <div className="navigation-arrows">
              {(
                [
                  ["left", ArrowLeft],
                  ["up", ArrowUp],
                  ["down", ArrowDown],
                  ["right", ArrowRight],
                ] as const
              ).map(([direction, Icon]) => (
                <button
                  key={direction}
                  aria-label={`${dragMode === "turn" ? "Turn" : "Move"} ${direction}`}
                  onClick={() => engine.current?.command(`nudge:${direction}`)}
                >
                  <Icon size={17} />
                </button>
              ))}
            </div>
            <small>
              {pickHint ||
                (layers
                  ? "Click the body to choose a layer"
                  : `${dragMode === "turn" ? "Drag to turn" : "Drag to move"} · Click to pin`)}
            </small>
          </div>
          {muscleBrowser && (
            <div
              className="anatomy-layer-picker"
              role="dialog"
              aria-label="Muscle browser"
              onKeyDown={(event) => {
                if (event.key === "Escape") setMuscleBrowser(false);
              }}
            >
              <div className="layer-picker-heading">
                <strong>Choose a muscle</strong>
                <button
                  aria-label="Close muscle list"
                  onClick={() => setMuscleBrowser(false)}
                >
                  <X size={16} />
                </button>
              </div>
              <input
                className="notebook-input"
                aria-label="Find a muscle"
                placeholder="Search muscle names…"
                value={muscleQuery}
                onChange={(event) => setMuscleQuery(event.target.value)}
              />
              <label className="layer-context-control">
                Surrounding anatomy
                <input
                  type="range"
                  min="0"
                  max="0.3"
                  step="0.05"
                  value={surroundings}
                  onChange={(event) =>
                    setSurroundings(Number(event.target.value))
                  }
                />
              </label>
              <div className="muscle-browser-list">
                {muscleOptions
                  .filter((muscle) =>
                    muscleQuery
                      ? muscle.name
                          .toLowerCase()
                          .includes(muscleQuery.toLowerCase())
                      : !props.selected || muscle.region === props.selected,
                  )
                  .slice(0, 60)
                  .map((muscle) => (
                    <button
                      key={muscle.id}
                      aria-pressed={activeMuscle === muscle.id}
                      onClick={() =>
                        engine.current?.command("mesh:" + muscle.id)
                      }
                    >
                      {muscle.name}
                    </button>
                  ))}
              </div>
              <div className="muscle-browser-actions">
                <button
                  className="secondary"
                  disabled={!activeMuscle}
                  onClick={() => {
                    setMuscleBrowser(false);
                    engine.current?.command("pin-center");
                  }}
                >
                  Add pin to muscle
                </button>
                <button
                  className="text-button"
                  onClick={() => engine.current?.command("context")}
                >
                  Show whole body
                </button>
              </div>
            </div>
          )}
          {!!candidates.length && (
            <div
              className="anatomy-layer-picker"
              role="dialog"
              aria-label="Choose anatomy layer"
              ref={picker}
              onKeyDown={(event) => {
                if (event.key === "Escape") closePicker();
              }}
            >
              <div className="layer-picker-heading">
                <strong>At this spot</strong>
                <button aria-label="Close layers" onClick={closePicker}>
                  <X size={16} />
                </button>
              </div>
              <p>Surfaces along this view. Choose one to see its shape.</p>
              <label className="layer-context-control">
                Surrounding anatomy
                <input
                  type="range"
                  min="0"
                  max="0.3"
                  step="0.05"
                  value={surroundings}
                  onChange={(event) =>
                    setSurroundings(Number(event.target.value))
                  }
                />
              </label>
              <div className="layer-choices">
                {candidates.map((candidate, index) => (
                  <button
                    key={candidate.point.id}
                    aria-pressed={candidateIndex === index}
                    onClick={() => {
                      setCandidateIndex(index);
                      engine.current?.preview(candidate);
                    }}
                  >
                    <span
                      className="layer-depth"
                      style={{ marginLeft: index * 3 }}
                    >
                      {index + 1}
                    </span>
                    <span>
                      {candidate.point.structure}
                      <small>
                        {index === 0
                          ? "Closest to you"
                          : "Behind the first surface"}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
              <p className="layer-picker-note">
                Model depth helps locate a pin. It does not identify what hurts.
              </p>
              <button
                className="primary"
                onClick={() => {
                  const { point } = candidates[candidateIndex];
                  latest.current.onSelect(point.region);
                  latest.current.onPoint?.(point);
                  closePicker();
                }}
              >
                Pin this structure
              </button>
            </div>
          )}
        </>
      )}
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
