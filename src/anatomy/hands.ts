export type Landmark = { x: number; y: number };
export type HandDelta = {
  rotateX: number;
  rotateY: number;
  panX: number;
  panY: number;
  zoom: number;
};
export type Grabber = {
  x: number;
  y: number;
  mode: "turn" | "zoom" | "slide";
  pinch: number;
};

const WRIST = 0,
  THUMB_TIP = 4,
  INDEX_MCP = 5,
  INDEX_TIP = 8,
  PINKY_MCP = 17;
const DEADZONE = 0.008;
const PINCH_ON = 0.08;
const PINCH_OFF = 0.11;

function palm(hand: Landmark[]) {
  const wrist = hand[WRIST],
    index = hand[INDEX_MCP],
    pinky = hand[PINKY_MCP];
  return {
    x: (wrist.x + index.x + pinky.x) / 3,
    y: (wrist.y + index.y + pinky.y) / 3,
  };
}

function pinchGap(hand: Landmark[]) {
  const thumb = hand[THUMB_TIP],
    index = hand[INDEX_TIP];
  return Math.hypot(thumb.x - index.x, thumb.y - index.y);
}

function still(): HandDelta {
  return { rotateX: 0, rotateY: 0, panX: 0, panY: 0, zoom: 1 };
}

function pinchAmount(gap: number) {
  return Math.max(0, Math.min(1, (PINCH_OFF - gap) / PINCH_OFF));
}

function grabber(hand: Landmark[], mode: Grabber["mode"]): Grabber {
  const point = palm(hand);
  return {
    x: 1 - point.x,
    y: point.y,
    mode,
    pinch: pinchAmount(pinchGap(hand)),
  };
}

export function describeGrabbers(hands: Landmark[][]): Grabber[] {
  const live = hands.filter((hand) => hand.length >= 21);
  if (live.length > 1) return live.map((hand) => grabber(hand, "slide"));
  if (live.length === 1)
    return [grabber(live[0], pinchGap(live[0]) < PINCH_ON ? "zoom" : "turn")];
  return [];
}

export class HandNavigator {
  private palm: { x: number; y: number } | null = null;
  private mid: { x: number; y: number } | null = null;
  private pinch: number | null = null;

  reset() {
    this.palm = null;
    this.mid = null;
    this.pinch = null;
  }

  apply(hands: Landmark[][]): HandDelta | null {
    const live = hands.filter((hand) => hand.length >= 21);
    if (!live.length) {
      this.reset();
      return null;
    }
    if (live.length > 1) return this.pan(live);
    return this.oneHand(live[0]);
  }

  private pan(hands: Landmark[][]): HandDelta | null {
    this.palm = null;
    this.pinch = null;
    const a = palm(hands[0]),
      b = palm(hands[1]);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const previous = this.mid;
    this.mid = mid;
    if (!previous) return null;
    const panX = mid.x - previous.x,
      panY = mid.y - previous.y;
    if (Math.hypot(panX, panY) < DEADZONE) return null;
    return { ...still(), panX: panX * 2.2, panY: panY * 2.2 };
  }

  private oneHand(hand: Landmark[]): HandDelta | null {
    this.mid = null;
    const gap = pinchGap(hand);
    const pinching = gap < PINCH_ON || (this.pinch !== null && gap < PINCH_OFF);
    if (pinching) {
      this.palm = null;
      const previous = this.pinch;
      this.pinch = gap;
      if (previous === null || gap < 1e-4) return null;
      return {
        ...still(),
        zoom: Math.min(1.18, Math.max(0.85, previous / gap)),
      };
    }
    this.pinch = null;
    const next = palm(hand);
    const previous = this.palm;
    this.palm = next;
    if (!previous) return null;
    const rotateX = (next.x - previous.x) * 3.6,
      rotateY = (next.y - previous.y) * 2.4;
    if (Math.hypot(rotateX, rotateY) < DEADZONE * 3.6) return null;
    return { ...still(), rotateX, rotateY };
  }
}
