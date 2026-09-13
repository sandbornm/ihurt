import type { PainPoint } from "../types.ts";

export class MarkHistory {
  private entryId = "";
  private past: PainPoint[][] = [];
  private future: PainPoint[][] = [];
  select(id: string) {
    if (id !== this.entryId) {
      this.entryId = id;
      this.past = [];
      this.future = [];
    }
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  record(points: PainPoint[]) {
    this.past.push(structuredClone(points));
    this.past = this.past.slice(-30);
    this.future = [];
  }
  private restore(saved: PainPoint[], current: PainPoint[]) {
    return saved.map((point) => {
      const existing = current.find((p) => p.id === point.id);
      return existing ? { ...point, comment: existing.comment } : point;
    });
  }
  undo(current: PainPoint[]) {
    const points = this.past.pop();
    if (!points) return current;
    this.future.push(structuredClone(current));
    return this.restore(points, current);
  }
  redo(current: PainPoint[]) {
    const points = this.future.pop();
    if (!points) return current;
    this.past.push(structuredClone(current));
    return this.restore(points, current);
  }
}
