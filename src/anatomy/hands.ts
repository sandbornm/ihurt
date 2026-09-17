export type Landmark = { x: number; y: number; z?: number };
export type HandDelta = {
  rotateX: number;
  rotateY: number;
  panX: number;
  panY: number;
  zoom: number;
};
export type GrabberMode = "rest" | "turn" | "zoom" | "slide" | "point";
export type Grabber = {
  x: number;
  y: number;
  mode: GrabberMode;
  pinch: number;
};
export type HandPose = "unknown" | "open" | "fist" | "pinch" | "point";
export type HandTap = { x: number; y: number };
export type HandLogEvent = {
  pose: string;
  mode: string;
  action: string;
  x?: number;
  y?: number;
  pinch?: number;
};

export const HAND_TUNING = {
  deadzone: 0.008,
  pinchOn: 0.08,
  pinchOff: 0.11,
  poseHold: 5,
  rotateSmooth: 0.55,
  rotateX: 3.6,
  rotateY: 2.4,
  panScale: 2.2,
  pointSmoothMs: 65,
};

const WRIST = 0,
  THUMB_TIP = 4,
  INDEX_MCP = 5,
  INDEX_TIP = 8,
  MIDDLE_MCP = 9,
  MIDDLE_TIP = 12,
  RING_MCP = 13,
  RING_TIP = 16,
  PINKY_MCP = 17,
  PINKY_TIP = 20;
const FINGERS = [
  [INDEX_MCP, INDEX_MCP + 1, INDEX_TIP],
  [MIDDLE_MCP, MIDDLE_MCP + 1, MIDDLE_TIP],
  [RING_MCP, RING_MCP + 1, RING_TIP],
  [PINKY_MCP, PINKY_MCP + 1, PINKY_TIP],
] as const;

let log: Array<HandLogEvent & { t: number }> = [];

export function recordHandEvent(event: HandLogEvent) {
  log.push({ t: Date.now(), ...event });
  if (log.length > 200) log.shift();
}

export function resetHandLog() {
  log = [];
}

export function handLogEntries() {
  return log.slice();
}

export function formatHandLog() {
  return log
    .map((event) => {
      const at =
        event.x != null && event.y != null
          ? `\t${event.x.toFixed(3)}\t${event.y.toFixed(3)}`
          : "";
      const pinch =
        event.pinch != null ? `\tpinch=${event.pinch.toFixed(3)}` : "";
      return `${new Date(event.t).toISOString()}\t${event.pose}\t${event.mode}\t${event.action}${at}${pinch}`;
    })
    .join("\n");
}

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
  return (
    (Math.hypot(thumb.x - index.x, thumb.y - index.y) / palmScale(hand)) * 0.08
  );
}

function dist(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

function palmScale(hand: Landmark[]) {
  return dist(hand[INDEX_MCP], hand[PINKY_MCP]) || 0.08;
}

function validHand(hand: unknown): hand is Landmark[] {
  return (
    Array.isArray(hand) &&
    hand.length >= 21 &&
    hand
      .slice(0, 21)
      .every(
        (point) =>
          point &&
          Number.isFinite(point.x) &&
          Number.isFinite(point.y) &&
          (point.z === undefined || Number.isFinite(point.z)),
      ) &&
    dist(hand[INDEX_MCP], hand[PINKY_MCP]) > 0.0001
  );
}

export function validHands(value: unknown): Landmark[][] {
  return Array.isArray(value) ? value.filter(validHand).slice(0, 2) : [];
}

function fingerCurled(
  hand: Landmark[],
  mcp: number,
  _pip: number,
  tip: number,
) {
  return dist(hand[tip], hand[mcp]) <= palmScale(hand) * 0.9;
}

function fingerExtended(
  hand: Landmark[],
  mcp: number,
  pip: number,
  tip: number,
) {
  if (fingerCurled(hand, mcp, pip, tip)) return false;
  return (
    dist(hand[tip], hand[WRIST]) > dist(hand[pip], hand[WRIST]) * 1.05 &&
    dist(hand[tip], hand[mcp]) > palmScale(hand) * 0.65
  );
}

function still(): HandDelta {
  return { rotateX: 0, rotateY: 0, panX: 0, panY: 0, zoom: 1 };
}

function pinchAmount(gap: number) {
  return Math.max(
    0,
    Math.min(1, (HAND_TUNING.pinchOff - gap) / HAND_TUNING.pinchOff),
  );
}

function mirror(point: { x: number; y: number }): HandTap {
  return { x: 1 - point.x, y: point.y };
}

export function classifyPose(
  hand: Landmark[],
  previous: HandPose = "unknown",
): HandPose {
  if (!validHand(hand)) return "unknown";
  const extended = FINGERS.map(([mcp, pip, tip]) =>
    fingerExtended(hand, mcp, pip, tip),
  );
  const curled = FINGERS.map(([mcp, pip, tip]) =>
    fingerCurled(hand, mcp, pip, tip),
  );
  const gap = pinchGap(hand);
  const indexOut = extended[0];
  const othersCurled = curled.slice(1).filter(Boolean).length;
  const othersExtended = extended.slice(1).filter(Boolean).length;
  const curledCount = curled.filter(Boolean).length;
  const extendedCount = extended.filter(Boolean).length;
  if (previous === "point") {
    if (extendedCount >= 3) return "open";
    if (!indexOut && curledCount >= 3) return "fist";
    if (othersCurled >= 1) return "point";
  }
  if (previous === "fist" && curledCount >= 2 && !indexOut) return "fist";
  if (
    previous === "pinch" &&
    indexOut &&
    gap < HAND_TUNING.pinchOff &&
    othersCurled <= 1
  )
    return "pinch";
  if (indexOut && othersCurled >= 2) return "point";
  if (curledCount >= 3) return "fist";
  if (indexOut && othersExtended >= 2 && gap < HAND_TUNING.pinchOn)
    return "pinch";
  if (extendedCount >= 3) return "open";
  if (curledCount >= 2 && !indexOut) return "fist";
  return "unknown";
}

function grabberFor(hand: Landmark[], mode: GrabberMode): Grabber {
  const gap = pinchGap(hand);
  const point =
    mode === "point"
      ? hand[INDEX_TIP]
      : mode === "zoom"
        ? {
            x: (hand[THUMB_TIP].x + hand[INDEX_TIP].x) / 2,
            y: (hand[THUMB_TIP].y + hand[INDEX_TIP].y) / 2,
          }
        : palm(hand);
  const shown = mirror(point);
  return { x: shown.x, y: shown.y, mode, pinch: pinchAmount(gap) };
}

function modeFor(pose: HandPose): GrabberMode {
  if (pose === "fist" || pose === "pinch") return "turn";
  if (pose === "point") return "point";
  if (pose === "open") return "rest";
  return "rest";
}

function isClosed(pose: HandPose) {
  return pose === "fist" || pose === "pinch";
}

function closedCount(hands: Landmark[][], previous: HandPose) {
  return hands.filter((hand) => isClosed(classifyPose(hand, previous))).length;
}

function spanOf(hands: Landmark[][]) {
  const a = palm(hands[0]),
    b = palm(hands[1]);
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const POSE_RANK: Record<HandPose, number> = {
  point: 4,
  fist: 3,
  pinch: 2,
  open: 1,
  unknown: 0,
};

function pickActive(
  hands: Landmark[][],
  previous: HandPose,
): { hand: Landmark[]; pose: HandPose } | null {
  let best = -1;
  let bestRank = 0;
  let bestPose: HandPose = "unknown";
  hands.forEach((hand, index) => {
    const pose = classifyPose(hand, previous);
    const rank = POSE_RANK[pose];
    if (rank > bestRank) {
      best = index;
      bestRank = rank;
      bestPose = pose;
    }
  });
  if (best < 0 || bestRank <= POSE_RANK.open) return null;
  return { hand: hands[best], pose: bestPose };
}

export function describeGrabbers(hands: Landmark[][]): Grabber[] {
  const live = validHands(hands);
  if (live.length > 1) {
    if (closedCount(live, "unknown") >= 2)
      return live.map((hand) => grabberFor(hand, "zoom"));
    return live.map((hand) => grabberFor(hand, "slide"));
  }
  if (live.length === 1)
    return [grabberFor(live[0], modeFor(classifyPose(live[0])))];
  return [];
}

export class HandNavigator {
  private palm: { x: number; y: number } | null = null;
  private mid: { x: number; y: number } | null = null;
  private span: number | null = null;
  private pose: HandPose = "unknown";
  private lastHands: Landmark[][] = [];
  private smooth = { x: 0, y: 0 };
  private lastAim: HandTap | null = null;
  private lastLogged = "";
  private hold = 0;
  private active: Landmark[] | null = null;
  private frameTime = 0;
  private pointTime = 0;

  reset() {
    this.palm = null;
    this.mid = null;
    this.span = null;
    this.pose = "unknown";
    this.lastHands = [];
    this.smooth = { x: 0, y: 0 };
    this.lastAim = null;
    this.hold = 0;
    this.lastLogged = "";
    this.active = null;
  }

  aim() {
    return this.lastAim;
  }

  currentPose() {
    return this.pose;
  }

  activeHand() {
    return this.active;
  }

  grabbers() {
    const live = this.lastHands;
    if (live.length > 1 && closedCount(live, "unknown") >= 2)
      return live.map((hand) => grabberFor(hand, "zoom"));
    if (live.length > 1) {
      const active = pickActive(live, this.pose);
      if (active) {
        const grabber = grabberFor(active.hand, modeFor(this.pose));
        return [
          {
            ...grabber,
            ...(this.pose === "point" && this.lastAim ? this.lastAim : {}),
          },
        ];
      }
    }
    return describeGrabbers(live).map((grabber) =>
      live.length === 1
        ? {
            ...grabber,
            mode: modeFor(this.pose),
            ...(this.pose === "point" && this.lastAim ? this.lastAim : {}),
          }
        : grabber,
    );
  }

  apply(hands: Landmark[][], now = performance.now()): HandDelta | null {
    this.frameTime = now;
    this.active = null;
    const live = validHands(hands);
    if (!live.length) {
      if (this.pose !== "unknown") this.note("unknown", "rest", "cancel");
      this.reset();
      return null;
    }
    this.lastHands = live;
    if (live.length > 1) {
      if (closedCount(live, "unknown") >= 2) return this.twoFistZoom(live);
      this.span = null;
      const active = pickActive(live, this.pose);
      if (active) return this.oneHand(active.hand);
      this.pose = "open";
      this.lastAim = null;
      return this.pan(live);
    }
    this.mid = null;
    this.span = null;
    return this.oneHand(live[0]);
  }

  private note(
    pose: string,
    mode: string,
    action: string,
    point?: HandTap,
    pinch?: number,
  ) {
    const key = `${pose}:${mode}:${action}`;
    if (action !== "cancel" && key === this.lastLogged) return;
    this.lastLogged = key;
    recordHandEvent({
      pose,
      mode,
      action,
      x: point?.x,
      y: point?.y,
      pinch,
    });
  }

  private twoFistZoom(hands: Landmark[][]): HandDelta | null {
    this.palm = null;
    this.mid = null;
    this.smooth = { x: 0, y: 0 };
    this.lastAim = null;
    this.pose = "fist";
    const span = spanOf(hands);
    const previous = this.span;
    this.span = span;
    if (previous === null || span < 1e-4) return null;
    const zoom = Math.min(1.18, Math.max(0.85, span / previous));
    if (Math.abs(zoom - 1) < 0.01) return null;
    const mid = {
      x: (palm(hands[0]).x + palm(hands[1]).x) / 2,
      y: (palm(hands[0]).y + palm(hands[1]).y) / 2,
    };
    this.note("two", "zoom", "zoom", mirror(mid));
    return { ...still(), zoom };
  }

  private pan(hands: Landmark[][]): HandDelta | null {
    this.palm = null;
    this.span = null;
    this.smooth = { x: 0, y: 0 };
    const a = palm(hands[0]),
      b = palm(hands[1]);
    const next = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const previous = this.mid;
    this.mid = next;
    if (!previous) return null;
    const panX = next.x - previous.x,
      panY = next.y - previous.y;
    if (Math.hypot(panX, panY) < HAND_TUNING.deadzone) return null;
    this.note("two", "slide", "pan", mirror(next));
    return {
      ...still(),
      panX: panX * HAND_TUNING.panScale,
      panY: panY * HAND_TUNING.panScale,
    };
  }

  private oneHand(hand: Landmark[]): HandDelta | null {
    this.active = hand;
    this.mid = null;
    const next = classifyPose(hand, this.pose);
    let pose = next;
    if (
      next === "unknown" &&
      (this.pose === "point" ||
        this.pose === "fist" ||
        this.pose === "pinch") &&
      this.hold < HAND_TUNING.poseHold
    ) {
      pose = this.pose;
      this.hold += 1;
    } else {
      this.hold = 0;
      pose = next;
    }
    const switched = pose !== this.pose;
    this.pose = pose;
    if (switched) {
      this.palm = null;
      this.smooth = { x: 0, y: 0 };
      if (pose !== "point") this.lastAim = null;
    }
    if (next === "unknown") {
      this.palm = null;
      this.smooth = { x: 0, y: 0 };
      this.lastAim = null;
      return null;
    }
    if (pose === "pinch") return this.turn(hand);
    if (pose === "point") return this.point(hand);
    if (pose === "fist") return this.turn(hand);
    this.note(pose, modeFor(pose), "idle", mirror(palm(hand)));
    return null;
  }

  private turn(hand: Landmark[]): HandDelta | null {
    const next = palm(hand);
    const previous = this.palm;
    this.palm = next;
    if (!previous) return null;
    const rawX = (next.x - previous.x) * HAND_TUNING.rotateX;
    const rawY = (next.y - previous.y) * HAND_TUNING.rotateY;
    const blend = HAND_TUNING.rotateSmooth;
    this.smooth.x += (rawX - this.smooth.x) * blend;
    this.smooth.y += (rawY - this.smooth.y) * blend;
    if (
      Math.hypot(this.smooth.x, this.smooth.y) <
      HAND_TUNING.deadzone * HAND_TUNING.rotateX
    )
      return null;
    this.note("fist", "turn", "turn", mirror(next));
    return { ...still(), rotateX: this.smooth.x, rotateY: this.smooth.y };
  }

  private point(hand: Landmark[]): HandDelta | null {
    this.palm = null;
    const tip = mirror(hand[INDEX_TIP]);
    const blend =
      1 -
      Math.exp(
        -Math.max(0, this.frameTime - this.pointTime) /
          HAND_TUNING.pointSmoothMs,
      );
    this.lastAim = this.lastAim
      ? {
          x: this.lastAim.x + (tip.x - this.lastAim.x) * blend,
          y: this.lastAim.y + (tip.y - this.lastAim.y) * blend,
        }
      : tip;
    this.pointTime = this.frameTime;
    this.note("point", "point", "aim", tip);
    return null;
  }
}
