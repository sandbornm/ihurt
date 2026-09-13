import { Group, Mesh, MeshStandardMaterial, Vector3 } from "three";

export class LayerSpread {
  readonly group = new Group();
  private items: { source: Mesh; copy: Mesh; offset: Vector3 }[] = [];
  private amount = 0;
  private target = 0;
  get active() {
    return this.target > 0;
  }
  set(meshes: Mesh[], right: Vector3, up: Vector3) {
    this.clear();
    this.items = meshes.map((source, index) => {
      const material = (source.material as MeshStandardMaterial).clone();
      material.transparent = false;
      material.opacity = 1;
      material.depthWrite = true;
      const copy = new Mesh(source.geometry, material);
      copy.name = source.name;
      copy.position.copy(source.position);
      copy.quaternion.copy(source.quaternion);
      copy.scale.copy(source.scale);
      this.group.add(copy);
      return {
        source,
        copy,
        offset: right
          .clone()
          .multiplyScalar((index - (meshes.length - 1) / 2) * 0.7)
          .addScaledVector(up, index % 2 ? 0.15 : -0.05),
      };
    });
  }
  setAmount(value: number) {
    this.target = Math.max(0, Math.min(1, value));
    this.group.visible = this.active;
  }
  highlight(source: Mesh | null) {
    for (const item of this.items) {
      const material = item.copy.material as MeshStandardMaterial;
      material.emissive.set(item.source === source ? "#acd979" : "#172819");
      material.emissiveIntensity = item.source === source ? 0.35 : 0.08;
    }
  }
  tick(seconds: number, reduced: boolean) {
    if (Math.abs(this.amount - this.target) < 0.001) return false;
    this.amount = reduced
      ? this.target
      : this.amount +
        (this.target - this.amount) *
          (1 - Math.exp(-Math.min(seconds, 0.1) * 12));
    if (Math.abs(this.amount - this.target) < 0.001) this.amount = this.target;
    for (const item of this.items)
      item.copy.position
        .copy(item.source.position)
        .addScaledVector(item.offset, this.amount);
    return true;
  }
  clear() {
    for (const item of this.items)
      (item.copy.material as MeshStandardMaterial).dispose();
    this.items = [];
    this.group.clear();
    this.group.visible = false;
    this.amount = 0;
    this.target = 0;
  }
}
