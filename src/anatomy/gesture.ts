export class PinGesture {
  private starts = new Map<number, [number, number]>();
  private moved = false;
  reset() {
    this.starts.clear();
    this.moved = false;
  }
  down(id: number, x: number, y: number) {
    if (!this.starts.size) this.moved = false;
    this.starts.set(id, [x, y]);
    if (this.starts.size > 1) this.moved = true;
  }
  move(id: number, x: number, y: number) {
    const start = this.starts.get(id);
    if (start && Math.hypot(x - start[0], y - start[1]) > 5) this.moved = true;
  }
  up(id: number, x: number, y: number, button: number) {
    const known = this.starts.has(id);
    this.move(id, x, y);
    this.starts.delete(id);
    return known && button === 0 && !this.moved && this.starts.size === 0;
  }
  cancel(id: number) {
    this.starts.delete(id);
    this.moved = true;
  }
}
