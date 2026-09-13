import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

export default function BodyReference({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState<"female" | "male">("female");
  const [status, setStatus] = useState("Loading reference…");
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
      setStatus("3D graphics are unavailable.");
      return;
    }
    setStatus("Loading reference…");
    delete root.dataset.body;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x14211b, 1);
    renderer.domElement.setAttribute(
      "aria-label",
      `${body} outer-body reference`,
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
      disposed = false;
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
            "This reference could not load. Your notebook is still available.",
          );
      });
    const resize = () => {
      renderer.setSize(root.clientWidth, root.clientHeight);
      camera.aspect = root.clientWidth / Math.max(1, root.clientHeight);
      camera.updateProjectionMatrix();
      dirty = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    resize();
    controls.addEventListener("change", () => {
      dirty = true;
    });
    turn.current = (angle) => {
      camera.position.applyAxisAngle(new T.Vector3(0, 1, 0), angle);
      controls.update();
      dirty = true;
    };
    renderer.setAnimationLoop(() => {
      if (dirty) {
        renderer.render(scene, camera);
        dirty = false;
      }
    });
    return () => {
      disposed = true;
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
      aria-label="Body references"
    >
      <div className="body-reference-heading">
        <div>
          <h2>Body references</h2>
          <p>Outer-body shapes from the Human Reference Atlas.</p>
        </div>
        <button className="secondary" onClick={onClose}>
          Return to map
        </button>
      </div>
      <div className="layer-toggle" aria-label="Reference model">
        {(["female", "male"] as const).map((value) => (
          <button
            key={value}
            aria-pressed={body === value}
            className={body === value ? "active" : ""}
            onClick={() => setBody(value)}
          >
            {value === "female" ? "Female" : "Male"}
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
          Turn left
        </button>
        <span>Drag to turn · Scroll to zoom</span>
        <button className="secondary" onClick={() => turn.current(Math.PI / 6)}>
          Turn right
        </button>
      </div>
      <p className="body-reference-note">
        These references have no muscle layers. Place pins in the muscle atlas;
        saved pins are not transferred between models.{" "}
        <a href="/models/ATTRIBUTION.md" target="_blank" rel="noreferrer">
          Model credits ↗
        </a>
      </p>
    </dialog>
  );
}
