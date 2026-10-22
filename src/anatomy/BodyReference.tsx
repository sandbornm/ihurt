import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { useI18n } from "../i18n/react";

export default function BodyReference({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState<"female" | "male">("female");
  const [status, setStatus] = useState(t("ref.loading"));
  const turn = useRef<(angle: number) => void>(() => {});
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    const root = host.current!;
    let renderer: T.WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setStatus(t("ref.no3d"));
      return;
    }
    setStatus(t("ref.loading"));
    delete root.dataset.body;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x14211b, 1);
    renderer.domElement.setAttribute(
      "aria-label",
      t(body === "female" ? "ref.canvas.female" : "ref.canvas.male"),
    );
    renderer.domElement.setAttribute("role", "img");
    root.appendChild(renderer.domElement);
    const scene = new T.Scene(),
      camera = new T.PerspectiveCamera(35, 1, 0.01, 100);
    camera.position.set(0, 0.2, 8.7);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = 2;
    controls.maxDistance = 12;
    controls.enablePan = false;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 0.45;
    scene.add(new T.HemisphereLight(0xe1ebd5, 0x3d4d42, 2));
    const light = new T.DirectionalLight(0xffffff, 2);
    light.position.set(-3, 4, 5);
    scene.add(light);
    const rim = new T.DirectionalLight(0xa6c7ba, 1.8);
    rim.position.set(3, 3, -3);
    scene.add(rim);
    let dirty = true,
      disposed = false,
      looping = false;
    const release = (object: T.Object3D) =>
      object.traverse((child) => {
        if (child instanceof T.Mesh) {
          child.geometry.dispose();
          (Array.isArray(child.material)
            ? child.material
            : [child.material]
          ).forEach((m) => m.dispose());
        }
      });
    const draco = new DRACOLoader()
      .setDecoderPath("/draco/")
      .setDecoderConfig({ type: "wasm" })
      .setWorkerLimit(1);
    const loader = new GLTFLoader().setDRACOLoader(draco);
    loader
      .loadAsync(`/models/reference-${body}.glb`)
      .then((file) => {
        if (disposed) {
          release(file.scene);
          return;
        }
        const box = new T.Box3().setFromObject(file.scene),
          size = box.getSize(new T.Vector3()),
          center = box.getCenter(new T.Vector3());
        const wrapper = new T.Group();
        wrapper.add(file.scene);
        wrapper.scale.setScalar(4.5 / size.y);
        file.scene.position.sub(center);
        file.scene.traverse((child) => {
          if (child instanceof T.Mesh) {
            (Array.isArray(child.material)
              ? child.material
              : [child.material]
            ).forEach((m) => m.dispose());
            child.material = new T.MeshStandardMaterial({
              color: "#abb89d",
              roughness: 0.75,
            });
          }
        });
        scene.add(wrapper);
        root.dataset.body = body;
        setStatus("");
        dirty = true;
      })
      .catch(() => {
        if (!disposed)
          setStatus(
            t("ref.failed"),
          );
      });
    const resize = () => {
      renderer.setSize(root.clientWidth, root.clientHeight);
      camera.aspect = root.clientWidth / Math.max(1, root.clientHeight);
      camera.updateProjectionMatrix();
      kick();
    };
    function kick() {
      dirty = true;
      if (looping || disposed) return;
      looping = true;
      renderer.setAnimationLoop(() => {
        if (dirty) {
          renderer.render(scene, camera);
          dirty = false;
        } else {
          looping = false;
          renderer.setAnimationLoop(null);
        }
      });
    }
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    resize();
    controls.addEventListener("change", kick);
    turn.current = (angle) => {
      camera.position.applyAxisAngle(new T.Vector3(0, 1, 0), angle);
      controls.update();
      kick();
    };
    return () => {
      disposed = true;
      looping = false;
      observer.disconnect();
      controls.dispose();
      draco.dispose();
      renderer.setAnimationLoop(null);
      release(scene);
      renderer.dispose();
      renderer.domElement.remove();
      delete root.dataset.body;
    };
  }, [body]);
  return (
    <dialog
      className="body-reference"
      ref={dialog}
      onCancel={onClose}
      aria-label={t("ref.title")}
    >
      <div className="body-reference-heading">
        <div>
          <h2>{t("ref.title")}</h2>
          <p>{t("ref.subtitle")}</p>
        </div>
        <button className="secondary" onClick={onClose}>
          {t("ref.return")}
        </button>
      </div>
      <div className="layer-toggle" aria-label={t("ref.model")}>
        {(["female", "male"] as const).map((value) => (
          <button
            key={value}
            aria-pressed={body === value}
            className={body === value ? "active" : ""}
            onClick={() => setBody(value)}
          >
            {value === "female" ? t("ref.female") : t("ref.male")}
          </button>
        ))}
      </div>
      <div className="body-reference-canvas" ref={host} />
      {status && <p role="status">{status}</p>}
      <div className="body-reference-controls">
        <button
          className="secondary"
          onClick={() => turn.current(-Math.PI / 6)}
        >
          {t("ref.turnLeft")}
        </button>
        <span>{t("ref.dragHint")}</span>
        <button className="secondary" onClick={() => turn.current(Math.PI / 6)}>
          {t("ref.turnRight")}
        </button>
      </div>
      <p className="body-reference-note">
        {t("ref.note")}{" "}
        <a href="/models/ATTRIBUTION.md" target="_blank" rel="noreferrer">
          {t("ref.credits")}
        </a>
      </p>
    </dialog>
  );
}
