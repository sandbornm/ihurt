import { PinMarkers } from "./pins";
import { useEffect, useRef, useState, type RefObject } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createBody } from "./model";
import { regions, type RegionId, type PainPoint } from "../types";
import { loadAtlas, regionAt } from "./atlas";
import { PinGesture } from "./gesture";
import { advanceCamera, applyHandDelta, nudgeCamera } from "./motion";
import HandCamera from "./HandCamera";
import type { HandDelta, HandTap } from "./hands";
import type { HandEntryControls, HandPin, HandTarget } from "./hand-entry";
import { nearbySurfaces, surfaceNearViewCenter } from "./selection";
import { captureViewport, type ViewportCapture } from "./capture";
import { LayerSpread } from "./spread";
import {
  fallbackHeat,
  paintHeat,
  samplesNear,
  type HeatFunction,
} from "./heat";
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
  advancedControls?: boolean;
  captureRef?: RefObject<(() => ViewportCapture | null) | null>;
  showSkeleton?: boolean;
  onOrientation?: (view: "front" | "back" | null) => void;
  handEntry?: HandEntryControls;
}
type Candidate = { mesh: T.Object3D; point: PainPoint };

export default function Anatomy(props: Props) {
  const mappedKey = props.mapped.join("|");
  const pointsKey = JSON.stringify(
    props.points?.map((point) => [
      point.id,
      point.region,
      point.position,
      point.area,
    ]),
  );
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const handRatingActive = useRef(false);
  const engine = useRef<{
    update: () => void;
    command: (type: string) => void;
    preview: (candidate: Candidate | null) => void;
    spread: (amount: number, options: Candidate[]) => void;
    hands: (delta: HandDelta) => void;
    handsAim: (point: HandTap | null) => HandTarget | null;
    handsPin: (point: HandTap) => HandPin | null;
  } | null>(null);
  const [dragMode, setDragMode] = useState<
    "pin" | "turn" | "move" | "highlight"
  >(props.navigation ? "pin" : "turn");
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
  const [spreadAmount, setSpreadAmount] = useState(0);
  const [hands, setHands] = useState(false);
  const interaction = useRef({ dragMode, layers, surroundings });
  interaction.current = { dragMode, layers, surroundings };
  const picker = useRef<HTMLDivElement>(null);
  const muscleSearch = useRef<HTMLInputElement>(null);
  const closePicker = () => {
    setCandidates([]);
    setSpreadAmount(0);
    engine.current?.preview(null);
  };
  const [failure, setFailure] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const root = host.current;
    delete root.dataset.atlas;
    delete root.dataset.heatEngine;
    let renderer: T.WebGLRenderer;
    const compact = window.matchMedia("(max-width: 670px)").matches;
    try {
      renderer = new T.WebGLRenderer({
        antialias: !compact,
        alpha: true,
        powerPreference: "low-power",
        stencil: false,
      });
    } catch {
      setFailure(true);
      return;
    }
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, compact ? 1.25 : 1.5),
    );
    renderer.setClearColor(0x111a18, 0);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive anatomy. Tap to pin a spot, drag to turn, or use two fingers to zoom and move. Use Turn or Move and the arrow buttons to adjust the view. Layers lets you choose overlapping structures.",
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
    const emptyFibers = new T.LineSegments(
      new T.BufferGeometry(),
      new T.LineBasicMaterial(),
    );
    let body = {
      group: new T.Group(),
      muscles: [] as ReturnType<typeof createBody>["muscles"],
      bones: [] as ReturnType<typeof createBody>["bones"],
      fibers: emptyFibers,
    };
    body.group.add(body.fibers);
    body.group.visible = false;
    scene.add(body.group);
    const pinGroup = new PinMarkers();
    scene.add(pinGroup);
    const spread = new LayerSpread();
    scene.add(spread.group);
    let beforeSpread: { position: T.Vector3; look: T.Vector3 } | null = null;
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
    const cool = new T.Color("#c4ed76"),
      warm = new T.Color("#ffb265");
    let heat: HeatFunction = fallbackHeat;
    let disposed = false,
      dirty = 2,
      looping = false;
    let previousFrame = performance.now();
    function kick() {
      dirty = 2;
      if (looping || disposed) return;
      looping = true;
      previousFrame = performance.now();
      renderer.setAnimationLoop(frame);
    }
    function frame(time: number) {
      const elapsedSeconds = (time - previousFrame) / 1000;
      previousFrame = time;
      if (document.hidden) {
        looping = false;
        renderer.setAnimationLoop(null);
        return;
      }
      if (easing) {
        easing = stepCamera(elapsedSeconds);
        dirty = 2;
      }
      if (spread.tick(elapsedSeconds, motionPreference.matches)) dirty = 2;
      if (controls.update()) dirty = 2;
      if (dirty > 0) {
        renderer.render(scene, camera);
        dirty--;
      } else if (!easing) {
        looping = false;
        renderer.setAnimationLoop(null);
      }
    }
    const targetPosition = camera.position.clone(),
      targetLook = controls.target.clone();
    let easing = false;
    let inspected = "";
    let exactMesh = "";
    let inspectedSide = 0;
    let previewMesh: T.Object3D | null = null;
    let aimMesh: T.Object3D | null = null;
    let lastHandsHint = "";
    const inspectCenter = new T.Vector3();
    const matchesInspection = (mesh: T.Mesh) =>
      exactMesh
        ? mesh.uuid === exactMesh
        : !inspected ||
          (mesh.name.toLowerCase().includes(inspected) &&
            (!inspectedSide ||
              mesh.geometry.boundingBox!.getCenter(inspectCenter).x *
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
      kick();
    };
    const motionChanged = () => {
      controls.enableDamping = !motionPreference.matches;
      if (easing) easing = stepCamera(0);
      kick();
    };
    motionPreference.addEventListener("change", motionChanged);
    const update = () => {
      const p = latest.current;
      controls.enabled = interaction.current.dragMode !== "highlight";
      controls.enableRotate = true;
      controls.enablePan = true;
      controls.touches.ONE =
        interaction.current.dragMode === "move" ? T.TOUCH.PAN : T.TOUCH.ROTATE;
      controls.touches.TWO = T.TOUCH.DOLLY_PAN;
      controls.mouseButtons.LEFT =
        interaction.current.dragMode === "move" ? T.MOUSE.PAN : T.MOUSE.ROTATE;
      root.dataset.dragMode = interaction.current.dragMode;
      root.dataset.inspected = exactMesh || inspected || "none";
      root.dataset.exploded = spread.active ? "true" : "false";
      root.dataset.bones =
        p.layer === "bone" || p.showSkeleton !== false ? "visible" : "hidden";
      pinGroup.visible = !spread.active;
      const mappedKey = p.mapped.join("|");
      const samples = (p.points ?? []).flatMap((point) =>
        (point.area?.path ?? [point.position]).map((position) => ({
          position,
          radius: point.area?.radius ?? 0.27,
        })),
      );
      const mappedWithoutPins = p.mapped.filter(
        (id) => !p.points?.some((point) => point.region === id),
      );
      for (const mesh of body.muscles) {
        const matches = matchesInspection(mesh);
        const faded =
          spread.active || (!!previewMesh && mesh !== previewMesh) || !matches;
        mesh.visible =
          p.layer === "muscle" &&
          (!faded || interaction.current.surroundings > 0);
        mesh.material.transparent = faded;
        mesh.material.opacity = faded ? interaction.current.surroundings : 1;
        mesh.material.depthWrite = !faded && matches;
        mesh.material.emissive.set(
          mesh === previewMesh || mesh === aimMesh
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
        const nearby = samplesNear(samples, bounds);
        const regionHeat = mappedWithoutPins.includes(region!)
          ? (regions.find((item) => item.id === region) ?? null)
          : null;
        const cacheKey = [
          isSelected ? 1 : 0,
          nearby.length || regionHeat ? p.intensity : "unpainted",
          mappedKey,
          nearby.length,
          nearby
            .map((sample) => [...sample.position, sample.radius].join())
            .join(";"),
          regionHeat?.id ?? "",
        ].join("|");
        if (colorCache.get(mesh) === cacheKey) continue;
        colorCache.set(mesh, cacheKey);
        paintHeat(
          mesh.geometry.attributes.position as T.BufferAttribute,
          mesh.geometry.attributes.color as T.BufferAttribute,
          mesh.matrix,
          mesh.userData.base,
          isSelected && !p.mapped.includes(region!),
          nearby,
          regionHeat
            ? {
                position: [
                  regionHeat.center[0],
                  regionHeat.center[1],
                  regionHeat.center[2],
                ],
                radius: 0.65,
              }
            : null,
          p.intensity,
          heat,
        );
      }
      body.fibers.visible = p.layer === "muscle";
      for (const bone of body.bones) {
        const faded =
          spread.active ||
          (!!previewMesh && bone !== previewMesh) ||
          !!exactMesh ||
          !!inspected;
        bone.visible =
          (p.layer === "bone" || p.showSkeleton !== false) &&
          (!faded || interaction.current.surroundings > 0);
        bone.material.transparent = faded || !!inspected;
        bone.material.opacity = faded ? interaction.current.surroundings : 1;
        bone.material.depthWrite = !faded && !inspected;
        bone.material.color.copy(bone.userData.base);
        if (bone === previewMesh || bone === aimMesh)
          bone.material.color.lerp(cool, 0.8);
        if (p.mapped.includes(bone.userData.region!))
          bone.material.color.lerp(warm, 0.8);
        else if (bone.userData.region === p.selected)
          bone.material.color.lerp(cool, 0.7);
      }
      pinGroup.setPoints(p.points ?? []);
      kick();
    };
    const command = (type: string) => {
      clearStroke();
      if (
        !root.dataset.atlas &&
        /^(layers:|point:|muscle:|mesh:|pin-center)/.test(type)
      )
        return;
      if (spread.active) {
        spread.clear();
        setSpreadAmount(0);
        if (beforeSpread) {
          camera.position.copy(beforeSpread.position);
          controls.target.copy(beforeSpread.look);
          beforeSpread = null;
          controls.update();
        }
      }
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
      if (type.startsWith("layers:")) {
        const point = p.points?.find((item) => item.id === type.slice(7));
        if (!point) return;
        command("point:" + point.id);
        camera.position.copy(targetPosition);
        controls.target.copy(targetLook);
        easing = false;
        controls.update();
        camera.updateMatrixWorld();
        const projected = new T.Vector3(...point.position).project(camera);
        const rect = renderer.domElement.getBoundingClientRect();
        pickAt(
          rect.left + ((projected.x + 1) * rect.width) / 2,
          rect.top + ((1 - projected.y) * rect.height) / 2,
          true,
        );
        return;
      }
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
      hands: (delta: HandDelta) => {
        if (previewMesh || spread.active) return;
        easing = false;
        const next = applyHandDelta(camera.position, controls.target, delta, {
          minDistance: controls.minDistance,
          maxDistance: controls.maxDistance,
          maxTargetRadius: controls.maxTargetRadius,
          cursor: controls.cursor,
        });
        camera.position.copy(next.position);
        controls.target.copy(next.look);
        controls.update();
        kick();
      },
      preview: (candidate) => {
        if (!candidate) {
          spread.clear();
          setSpreadAmount(0);
          if (beforeSpread) {
            targetPosition.copy(beforeSpread.position);
            targetLook.copy(beforeSpread.look);
            beforeSpread = null;
            startTransition();
          }
        }
        previewMesh = candidate?.mesh ?? null;
        spread.highlight((candidate?.mesh as T.Mesh) ?? null);
        update();
      },
      spread: (amount, options) => {
        if (amount > 0 && !spread.active) {
          beforeSpread = {
            position: camera.position.clone(),
            look: controls.target.clone(),
          };
          const right = new T.Vector3(1, 0, 0).applyQuaternion(
              camera.quaternion,
            ),
            up = new T.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
          spread.set(
            options.map((o) => o.mesh as T.Mesh),
            right,
            up,
          );
          spread.setAmount(1);
          spread.tick(1, true);
          const box = new T.Box3().setFromObject(spread.group),
            size = box.getSize(new T.Vector3());
          box.getCenter(targetLook);
          const mobile = root.clientWidth <= 670;
          const reserved = mobile ? 0 : 330 / root.clientWidth;
          const tangent = Math.tan(T.MathUtils.degToRad(camera.fov / 2));
          const distance =
            Math.max(
              2.3,
              size.length() /
                (2 *
                  tangent *
                  Math.min(1, camera.aspect * (1 - reserved - 0.08))),
            ) * (mobile ? 1.6 : 1);
          targetLook.addScaledVector(
            right,
            reserved * distance * tangent * camera.aspect,
          );
          if (mobile) targetLook.addScaledVector(up, -distance * tangent * 0.5);
          targetPosition
            .copy(targetLook)
            .addScaledVector(
              camera.position.clone().sub(controls.target).normalize(),
              distance,
            );
          spread.setAmount(0);
          spread.tick(1, true);
          startTransition();
        }
        spread.setAmount(amount);
        if (!amount && beforeSpread) {
          targetPosition.copy(beforeSpread.position);
          targetLook.copy(beforeSpread.look);
          beforeSpread = null;
          startTransition();
        }
        spread.highlight(previewMesh as T.Mesh | null);
        update();
      },
      handsAim: () => null,
      handsPin: () => null,
    };
    if (latest.current.captureRef)
      latest.current.captureRef.current = () => {
        if (!root.dataset.atlas) return null;
        camera.updateMatrixWorld();
        // Reports show the actual anatomy at this angle, without display-only offsets.
        const wasSpread = spread.active;
        const visibility = [...body.muscles, ...body.bones].map(
          (mesh) => [mesh, mesh.visible] as const,
        );
        try {
          if (wasSpread) {
            spread.group.visible = false;
            for (const mesh of [...body.muscles, ...body.bones]) {
              mesh.visible =
                mesh.userData.layer === "bone"
                  ? latest.current.layer === "bone" ||
                    latest.current.showSkeleton !== false
                  : latest.current.layer === "muscle";
              mesh.material.opacity = 1;
              mesh.material.transparent = false;
              mesh.material.depthWrite = true;
            }
            pinGroup.visible = true;
          }
          return captureViewport(
            renderer,
            scene,
            camera,
            latest.current.points ?? [],
            [...body.muscles, ...body.bones].filter(
              (mesh) => mesh.visible && mesh.material.opacity > 0.5,
            ),
            `${wasSpread ? "3D view with layers returned to their anatomical positions" : "Current 3D view"} · ${latest.current.layer === "muscle" ? (latest.current.showSkeleton === false ? "Muscles, bones hidden" : "Muscles and skeleton") : "Skeleton"} · ${root.dataset.atlas === "z-anatomy" ? "Z-Anatomy / BodyParts3D" : "Schematic fallback"}`,
          );
        } finally {
          if (wasSpread) {
            for (const [mesh, visible] of visibility) mesh.visible = visible;
            spread.group.visible = true;
            update();
          }
        }
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
        if (latest.current.command.id) command(latest.current.command.type);
      })
      .catch(() => {
        if (disposed) return;
        scene.remove(body.group);
        disposeGroup(body.group);
        body = createBody();
        body.group.visible = true;
        scene.add(body.group);
        root.dataset.atlas = "schematic-fallback";
        setReady(true);
        update();
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
      kick();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    resize();
    const raycaster = new T.Raycaster(),
      pointer = new T.Vector2();
    const gesture = new PinGesture();
    let strokePointer: number | null = null;
    let stroke: Candidate[] = [];
    const strokeLine = new T.Line(
      new T.BufferGeometry(),
      new T.LineBasicMaterial({ color: "#f4bc71", depthTest: false }),
    );
    strokeLine.renderOrder = 5;
    scene.add(strokeLine);
    const clearStroke = () => {
      if (
        strokePointer !== null &&
        renderer.domElement.hasPointerCapture(strokePointer)
      )
        renderer.domElement.releasePointerCapture(strokePointer);
      strokePointer = null;
      stroke = [];
      strokeLine.geometry.dispose();
      strokeLine.geometry = new T.BufferGeometry();
      kick();
    };
    const paint = (event: PointerEvent) => {
      if (!root.dataset.atlas || stroke.length >= 48) return;
      camera.updateMatrixWorld();
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
      );
      raycaster.setFromCamera(pointer, camera);
      const surfaces =
        latest.current.layer === "muscle"
          ? [...body.muscles, ...body.bones]
          : body.bones;
      const hit = raycaster.intersectObjects(
        surfaces.filter((mesh) => mesh.visible && mesh.material.opacity > 0.5),
        false,
      )[0];
      if (!hit) return;
      const previous = stroke.at(-1);
      if (previous) {
        const distance = hit.point.distanceTo(
          new T.Vector3(...previous.point.position),
        );
        if (distance < 0.045 || distance > 0.5) return;
      }
      stroke.push(candidateAt(hit));
      strokeLine.geometry.dispose();
      strokeLine.geometry = new T.BufferGeometry().setFromPoints(
        stroke.map((item) => new T.Vector3(...item.point.position)),
      );
      kick();
    };
    const stopEasing = () => {
      easing = false;
      if (previewMesh) {
        previewMesh = null;
        setCandidates([]);
        spread.clear();
        setSpreadAmount(0);
        beforeSpread = null;
        update();
      }
    };
    const down = (event: PointerEvent) => {
      if (interaction.current.dragMode === "highlight") {
        event.preventDefault();
        if (!event.isPrimary || event.button !== 0) {
          clearStroke();
          return;
        }
        stopEasing();
        clearStroke();
        strokePointer = event.pointerId;
        renderer.domElement.setPointerCapture(event.pointerId);
        paint(event);
        return;
      }
      const choosing = !!previewMesh;
      gesture.down(event.pointerId, event.clientX, event.clientY);
      if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        gesture.cancel(event.pointerId);
      renderer.domElement.setPointerCapture(event.pointerId);
      stopEasing();
      if (choosing) gesture.cancel(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId === strokePointer) {
        paint(event);
        return;
      }
      gesture.move(event.pointerId, event.clientX, event.clientY);
    };
    const cancel = (event: PointerEvent) => {
      gesture.cancel(event.pointerId);
      if (event.pointerId === strokePointer) clearStroke();
    };
    const click = (event: PointerEvent) => {
      if (event.pointerId === strokePointer) {
        paint(event);
        const first = stroke[0]?.point;
        if (first) {
          const point: PainPoint =
            stroke.length > 1
              ? {
                  ...first,
                  structure: `Area starting at ${first.structure}`,
                  area: {
                    path: stroke.map((item) => item.point.position),
                    radius: 0.12,
                  },
                }
              : first;
          latest.current.onSelect(point.region);
          latest.current.onPoint?.(point);
        }
        clearStroke();
        return;
      }
      if (interaction.current.dragMode === "highlight") return;
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
      if (
        latest.current.navigation &&
        interaction.current.dragMode !== "pin" &&
        !interaction.current.layers
      )
        return;
      pickAt(event.clientX, event.clientY);
    };
    function candidateAt(hit: T.Intersection): Candidate {
      return {
        mesh: hit.object,
        point: {
          id: crypto.randomUUID(),
          region:
            root.dataset.atlas === "z-anatomy"
              ? regionAt(hit.point, hit.object.name)
              : hit.object.userData.region,
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
    }
    function pickAt(
      clientX: number,
      clientY: number,
      forcePicker = false,
      targetRegion?: RegionId,
      intent: "commit" | "preview" | "pick" | "hands" = "commit",
    ) {
      if (!root.dataset.atlas) return;
      camera.updateMatrixWorld();
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
      if (intent === "preview") {
        const surface = hits[0]?.object ?? null;
        const name =
          surface?.name
            .replace(/\.[lr]\.\d+$/, "")
            .replace(/\.\d+$/, "")
            .replace(/_/g, " ") || "Selected surface";
        const hint = surface
          ? `Pointing at ${name} · hold still to pin`
          : "Point at a muscle and hold still";
        if (aimMesh === surface && lastHandsHint === hint) return;
        lastHandsHint = hint;
        setPickHint(hint);
        setAim(surface);
        return;
      }
      const options = nearbySurfaces(hits).map(candidateAt);
      if (intent === "pick") clearAim();
      if (
        options.length &&
        latest.current.navigation &&
        intent !== "hands" &&
        (interaction.current.layers ||
          forcePicker ||
          (intent === "pick" && options.length > 1))
      ) {
        setCandidateIndex(0);
        setCandidates(options);
        setMuscleBrowser(false);
        previewMesh = options[0].mesh;
        update();
      } else if (options[0]) {
        aimMesh = null;
        latest.current.onSelect(options[0].point.region);
        latest.current.onPoint?.(options[0].point);
        return options[0].point;
      } else if (forcePicker || intent === "pick") {
        setLayers(intent !== "pick");
        setPickHint(
          intent === "pick"
            ? "Point at a muscle and hold still"
            : "Click the visible muscle to choose a pin location",
        );
      }
    }
    function setAim(mesh: T.Object3D | null) {
      const previous = aimMesh;
      aimMesh = mesh;
      for (const item of [previous, mesh]) {
        if (
          !(item instanceof T.Mesh) ||
          !(item.material instanceof T.MeshStandardMaterial)
        )
          continue;
        if (item.userData.layer === "bone") {
          item.material.color.copy(item.userData.base);
          if (item === aimMesh || item === previewMesh)
            item.material.color.lerp(cool, 0.8);
          if (latest.current.mapped.includes(item.userData.region))
            item.material.color.lerp(warm, 0.8);
          else if (item.userData.region === latest.current.selected)
            item.material.color.lerp(cool, 0.7);
        } else {
          item.material.emissive.set(
            item === aimMesh || item === previewMesh
              ? "#91c655"
              : matchesInspection(item) && inspected
                ? "#426020"
                : "#000000",
          );
        }
      }
      kick();
    }
    function clearAim() {
      if (!aimMesh && !lastHandsHint) return;
      lastHandsHint = "";
      setAim(null);
      setPickHint("");
    }
    const overlayPoint = (point: HandTap) => {
      const rect = renderer.domElement.getBoundingClientRect();
      return {
        x: rect.left + point.x * rect.width,
        y: rect.top + point.y * rect.height,
      };
    };
    if (engine.current) {
      engine.current.handsAim = (point) => {
        if (
          !point ||
          interaction.current.dragMode === "highlight" ||
          previewMesh ||
          spread.active
        ) {
          clearAim();
          return null;
        }
        const at = overlayPoint(point);
        pickAt(at.x, at.y, false, undefined, "preview");
        return aimMesh ? { key: aimMesh.uuid, label: aimMesh.name } : null;
      };
      engine.current.handsPin = (point) => {
        if (
          interaction.current.dragMode === "highlight" ||
          previewMesh ||
          spread.active
        )
          return null;
        const at = overlayPoint(point);
        const placed = pickAt(at.x, at.y, false, undefined, "hands");
        clearAim();
        return placed ? { id: placed.id, label: placed.structure } : null;
      };
    }
    renderer.domElement.addEventListener("pointerdown", down, true);
    renderer.domElement.addEventListener("pointerup", click);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointercancel", cancel);
    renderer.domElement.addEventListener("lostpointercapture", cancel);
    const onStart = () => {
      stopEasing();
      kick();
    };
    controls.addEventListener("start", onStart);
    let orientation: "front" | "back" | null | undefined;
    const changed = () => {
      const offset = camera.position.clone().sub(controls.target);
      const next =
        Math.abs(offset.x) < Math.abs(offset.z) * 0.16
          ? offset.z >= 0
            ? "front"
            : "back"
          : null;
      if (next !== orientation) {
        orientation = next;
        latest.current.onOrientation?.(next);
      }
      kick();
    };
    controls.addEventListener("change", changed);
    const resetGesture = () => {
      gesture.reset();
      clearStroke();
    };
    const onVisibility = () => {
      resetGesture();
      if (!document.hidden) kick();
      else {
        looping = false;
        renderer.setAnimationLoop(null);
      }
    };
    window.addEventListener("blur", resetGesture);
    document.addEventListener("visibilitychange", onVisibility);
    kick();
    return () => {
      disposed = true;
      looping = false;
      clearStroke();
      engine.current = null;
      spread.clear();
      if (latest.current.captureRef) latest.current.captureRef.current = null;
      observer.disconnect();
      motionPreference.removeEventListener("change", motionChanged);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", resetGesture);
      controls.dispose();
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener("pointerdown", down, true);
      renderer.domElement.removeEventListener("pointerup", click);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointercancel", cancel);
      renderer.domElement.removeEventListener("lostpointercapture", cancel);
      controls.removeEventListener("start", onStart);
      scene.traverse((object) => {
        if (object instanceof T.Mesh || object instanceof T.Line) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((m) => m.dispose());
        }
      });
      pinGroup.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      delete root.dataset.atlas;
      delete root.dataset.heatEngine;
    };
  }, []);
  useEffect(
    () => engine.current?.update(),
    [
      props.selected,
      mappedKey,
      props.layer,
      props.showSkeleton,
      pointsKey,
      dragMode,
      surroundings,
    ],
  );
  useEffect(() => {
    if (!handRatingActive.current) engine.current?.update();
  }, [props.intensity]);
  useEffect(() => {
    setCandidates([]);
    engine.current?.command("context");
  }, [props.layer, props.showSkeleton, layers, dragMode]);
  useEffect(() => {
    if (candidates.length)
      picker.current
        ?.querySelector<HTMLButtonElement>("[aria-pressed=true]")
        ?.focus({ preventScroll: true });
  }, [candidates]);
  useEffect(() => {
    if (muscleBrowser) muscleSearch.current?.focus({ preventScroll: true });
  }, [muscleBrowser]);
  useEffect(() => engine.current?.command("view"), [props.view]);
  useEffect(() => {
    if (!props.command.id) return;
    const type = props.command.type;
    if (type === "tools:muscle") {
      setMuscleBrowser((value) => !value);
      setCandidates([]);
      engine.current?.preview(null);
      return;
    }
    if (type === "tools:layers") {
      setLayers((value) => !value);
      return;
    }
    if (type === "tools:hands") {
      setHands((value) => !value);
      return;
    }
    engine.current?.command(type);
  }, [props.command]);
  useEffect(() => {
    if (props.advancedControls === false) {
      setLayers(false);
      setMuscleBrowser(false);
      setHands(false);
      if (dragMode === "move") setDragMode("pin");
    }
  }, [props.advancedControls]);
  return (
    <div
      className="anatomy-canvas"
      ref={host}
      data-hands={hands ? "on" : "off"}
    >
      {props.navigation && ready && !failure && (
        <>
          <div className="anatomy-navigation" aria-label="Model controls">
            <div className="navigation-modes">
              {(["pin", "turn", "highlight", "move"] as const).map((mode) => (
                <button
                  key={mode}
                  hidden={mode === "move" && props.advancedControls === false}
                  aria-pressed={dragMode === mode}
                  onClick={() => setDragMode(mode)}
                >
                  {mode === "pin"
                    ? "Pin"
                    : mode === "turn"
                      ? "Turn"
                      : mode === "move"
                        ? "Move"
                        : "Highlight"}
                </button>
              ))}
              <button
                hidden={!layers}
                aria-pressed={layers}
                onClick={() => setLayers(false)}
              >
                <Layers3 size={14} /> Layers
              </button>
            </div>
            <div
              className="navigation-arrows"
              hidden={dragMode === "pin" || dragMode === "highlight"}
            >
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
                  aria-label={`${dragMode === "move" ? "Move" : "Turn"} ${direction}`}
                  onClick={() => engine.current?.command(`nudge:${direction}`)}
                >
                  <Icon size={17} />
                </button>
              ))}
            </div>
            <small>
              {pickHint ||
                (hands
                  ? "Fist to turn · Two fists pull to zoom · Point and hold to pin"
                  : dragMode === "highlight"
                    ? "Drag over the body to highlight an area"
                    : layers
                      ? "Click the body to choose a layer"
                      : dragMode === "pin"
                        ? "Tap to pin · Drag to turn · Two fingers to zoom or move"
                        : `${dragMode === "turn" ? "Drag to turn" : "Drag to move"} · Switch to Pin to mark a spot`)}
            </small>
          </div>
          <HandCamera
            active={hands}
            onMotion={(delta) => engine.current?.hands(delta)}
            onAim={(point) => engine.current?.handsAim(point) ?? null}
            onPin={(point) => engine.current?.handsPin(point) ?? null}
            intensity={props.intensity}
            onRatingActive={(active) => {
              if (handRatingActive.current === active) return;
              handRatingActive.current = active;
              if (!active) engine.current?.update();
            }}
            entryControls={props.handEntry}
            hasPin={(id) =>
              !!latest.current.points?.some((point) => point.id === id)
            }
          />
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
                ref={muscleSearch}
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
                    onMouseEnter={() => {
                      setCandidateIndex(index);
                      engine.current?.preview(candidate);
                    }}
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
              {candidates.length > 1 && (
                <div className="layer-spread-control">
                  <button
                    className="secondary"
                    aria-pressed={spreadAmount > 0}
                    onClick={() => {
                      const amount = spreadAmount > 0 ? 0 : 0.8;
                      setSpreadAmount(amount);
                      engine.current?.spread(amount, candidates);
                    }}
                  >
                    Spread layers
                  </button>
                  {spreadAmount > 0 && (
                    <label className="layer-context-control">
                      Separation
                      <input
                        type="range"
                        aria-label="Layer separation"
                        min="0.1"
                        max="1"
                        step="0.1"
                        value={spreadAmount}
                        onChange={(event) => {
                          const amount = Number(event.target.value);
                          setSpreadAmount(amount);
                          engine.current?.spread(amount, candidates);
                        }}
                      />
                    </label>
                  )}
                </div>
              )}
              <p className="layer-picker-note">
                {spreadAmount > 0
                  ? "Spreading the view does not move your saved marks."
                  : "Model depth helps locate a pin. It does not identify what hurts."}
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
