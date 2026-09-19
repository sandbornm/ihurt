import {
  classifyPose,
  type HandPose,
  type HandTap,
  type Landmark,
} from "./hands.ts";

export type HandTarget = { key: string; label: string };
export type HandPin = { id: string; label: string };
export type HandEntryControls = {
  entryId: string;
  onIntensity: (value: number) => void;
  onSave: () => Promise<boolean>;
  onRemovePin: (id: string) => void;
};
export type HandEntryPhase = "aim" | "rate" | "saving" | "saved";
export type HandEntryState = {
  phase: HandEntryPhase;
  pin: HandPin | null;
  hint: string;
  progress: number;
  turning: boolean;
};
export type HandEntryAction =
  | { type: "pin"; point: HandTap }
  | { type: "intensity"; value: number }
  | { type: "save" };

export const HAND_ENTRY_TUNING = {
  pinHoldMs: 950,
  saveHoldMs: 850,
  steadyRadius: 0.035,
  maxFrameGapMs: 250,
  degreesPerStep: 18,
  pinchOn: 0.45,
  pinchOff: 0.75,
};

function distance(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

function palmSize(hand: Landmark[]) {
  return distance(hand[5], hand[17]);
}

export function thumbsUp(hand: Landmark[]) {
  const size = palmSize(hand);
  // The thumb must extend above curled fingers, in the camera image.
  return (
    size > 0.0001 &&
    [5, 9, 13, 17].every(
      (base) => distance(hand[base + 3], hand[base]) < size * 0.9,
    ) &&
    hand[4].y < Math.min(hand[5].y, hand[9].y, hand[17].y) - size * 0.65 &&
    hand[4].y < hand[3].y - size * 0.25 &&
    distance(hand[4], hand[5]) > size * 0.8
  );
}

function roll(hand: Landmark[], aspect: number) {
  // Mirror X like the camera preview; clockwise on screen increases the dial.
  return Math.atan2(hand[5].y - hand[17].y, -(hand[5].x - hand[17].x) * aspect);
}

/** A deliberate pin → rate → save flow, separate from camera navigation. */
export class HandEntryGesture {
  state: HandEntryState = {
    phase: "aim",
    pin: null,
    hint: "Point and hold on the body to pin",
    progress: 0,
    turning: false,
  };
  private lastFrame: number | null = null;
  private hold: { start: number; key: string; point: HandTap } | null = null;
  private lastRoll: number | null = null;
  private dialValue = 0;
  private dialTurn = 0;
  private saveStart: number | null = null;
  private saveArmed = false;
  private releasedAt: number | null = null;
  private saveFailed = false;

  reset() {
    this.state = {
      phase: "aim",
      pin: null,
      hint: "Point and hold on the body to pin",
      progress: 0,
      turning: false,
    };
    this.lastFrame = null;
    this.saveFailed = false;
    this.interrupt();
  }

  interrupt() {
    this.hold = null;
    this.lastRoll = null;
    this.saveStart = null;
    this.saveArmed = false;
    this.releasedAt = null;
    this.state.progress = 0;
    this.state.turning = false;
  }

  pinned(pin: HandPin) {
    this.interrupt();
    this.saveFailed = false;
    this.state = {
      phase: "rate",
      pin,
      progress: 0,
      turning: false,
      hint: "Pinch and twist to rate · Hold thumbs-up to save",
    };
  }

  saving() {
    if (this.state.phase !== "rate") return false;
    this.interrupt();
    this.state.phase = "saving";
    this.state.hint = "Saving on your device…";
    return true;
  }

  saved(success: boolean) {
    if (this.state.phase !== "saving") return;
    this.interrupt();
    this.state.phase = success ? "saved" : "rate";
    this.saveFailed = !success;
    this.state.hint = success
      ? "Saved. Open your hand for another pin."
      : "Could not save. Try again or export your entry.";
  }

  frame({
    hand,
    pose,
    point,
    target,
    intensity,
    now,
    aspect = 1,
  }: {
    hand: Landmark[] | null;
    pose: HandPose;
    point: HandTap | null;
    target: HandTarget | null;
    intensity: number | null;
    now: number;
    aspect?: number;
  }): HandEntryAction | null {
    if (
      this.lastFrame !== null &&
      (now - this.lastFrame > HAND_ENTRY_TUNING.maxFrameGapMs ||
        now < this.lastFrame)
    )
      this.interrupt();
    this.lastFrame = now;
    if (!hand) {
      this.interrupt();
      return null;
    }
    if (this.state.phase === "saving") return null;
    if (this.state.phase === "saved") {
      if (classifyPose(hand) === "open") {
        this.releasedAt ??= now;
        if (now - this.releasedAt >= 300) this.reset();
      } else this.releasedAt = null;
      return null;
    }
    if (this.state.phase === "aim") {
      if (pose !== "point" || !point || !target) {
        this.hold = null;
        this.state.progress = 0;
        return null;
      }
      if (
        !this.hold ||
        this.hold.key !== target.key ||
        Math.hypot(point.x - this.hold.point.x, point.y - this.hold.point.y) >
          HAND_ENTRY_TUNING.steadyRadius
      ) {
        this.hold = { start: now, key: target.key, point: { ...point } };
      }
      this.state.progress = Math.min(
        1,
        (now - this.hold.start) / HAND_ENTRY_TUNING.pinHoldMs,
      );
      if (this.state.progress < 1) return null;
      this.hold = null;
      this.state.progress = 0;
      return { type: "pin", point: { ...point } };
    }

    const up = thumbsUp(hand);
    if (!up) {
      this.saveArmed = true;
      this.saveStart = null;
      this.state.progress = 0;
      if (!this.saveFailed)
        this.state.hint = "Pinch and twist to rate · Hold thumbs-up to save";
    } else {
      this.lastRoll = null;
      this.state.turning = false;
      if (!this.saveArmed) {
        if (!this.saveFailed)
          this.state.hint = "Lower your thumb, then hold thumbs-up to save.";
        return null;
      }
      this.state.hint = "Hold thumbs-up to save…";
      this.saveStart ??= now;
      this.state.progress = Math.min(
        1,
        (now - this.saveStart) / HAND_ENTRY_TUNING.saveHoldMs,
      );
      if (this.state.progress >= 1) {
        this.saving();
        return { type: "save" };
      }
      return null;
    }

    const gap = distance(hand[4], hand[8]) / palmSize(hand);
    const pinched =
      gap <
      (this.lastRoll === null
        ? HAND_ENTRY_TUNING.pinchOn
        : HAND_ENTRY_TUNING.pinchOff);
    this.state.turning = pinched;
    if (!pinched) {
      this.lastRoll = null;
      return null;
    }
    const angle = roll(hand, aspect);
    if (this.lastRoll === null) {
      this.lastRoll = angle;
      this.dialValue = intensity ?? 0;
      this.dialTurn = 0;
      return null;
    }
    const delta = Math.atan2(
      Math.sin(angle - this.lastRoll),
      Math.cos(angle - this.lastRoll),
    );
    this.lastRoll = angle;
    // A large single-frame jump is tracking loss, not an intentional dial turn.
    if (Math.abs(delta) > Math.PI / 4) return null;
    this.dialTurn += delta;
    this.dialValue = Math.max(
      0,
      Math.min(
        10,
        this.dialValue +
          (delta * 180) / Math.PI / HAND_ENTRY_TUNING.degreesPerStep,
      ),
    );
    const value = Math.round(this.dialValue);
    if (
      value === intensity ||
      (intensity === null && Math.abs(this.dialTurn) < Math.PI / 18)
    )
      return null;
    return { type: "intensity", value };
  }
}
