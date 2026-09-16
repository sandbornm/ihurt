import {
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  SphereGeometry,
} from "three";
import type { PainPoint } from "../types";

// One draw call for all markers. Grow capacity only when the buffer fills.
export class PinMarkers extends Group {
  private geometry = new SphereGeometry(0.025, 12, 10);
  private material = new MeshBasicMaterial({ color: "#f9c68a" });
  private markers: InstancedMesh | null = null;
  private capacity = 0;
  private instanceTransform = new Matrix4();

  setPoints(points: readonly PainPoint[]) {
    if (points.length > this.capacity) {
      if (this.markers) {
        this.remove(this.markers);
        this.markers.dispose();
      }
      this.capacity = Math.max(16, this.capacity * 2, points.length);
      this.markers = new InstancedMesh(
        this.geometry,
        this.material,
        this.capacity,
      );
      this.add(this.markers);
    }
    if (!this.markers) return;
    this.markers.count = points.length;
    points.forEach((point, index) => {
      this.instanceTransform.makeTranslation(...point.position);
      this.markers!.setMatrixAt(index, this.instanceTransform);
    });
    this.markers.instanceMatrix.needsUpdate = true;
    this.markers.computeBoundingSphere();
  }

  dispose() {
    this.markers?.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.clear();
  }
}
