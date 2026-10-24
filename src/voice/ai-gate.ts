// Holds the first transcript that finishes before the availability check
// returns, so the first suggestion is not missed. Only the latest transcript
// is kept, and it is dropped if Apple Intelligence turns out to be off.
export type AvailabilityGate = ReturnType<typeof createAvailabilityGate>;

export function createAvailabilityGate() {
  let state: "checking" | "ready" | "off" = "checking";
  let pending: string | undefined;
  return {
    get state() {
      return state;
    },
    // Returns the transcript to read now, or undefined if it was queued or
    // Apple Intelligence is off.
    request(transcript: string): string | undefined {
      if (state === "ready") return transcript;
      if (state === "checking") pending = transcript;
      return undefined;
    },
    // Returns the queued transcript to read now, if any.
    settle(available: boolean): string | undefined {
      if (state !== "checking") return undefined;
      state = available ? "ready" : "off";
      const queued = pending;
      pending = undefined;
      return available ? queued : undefined;
    },
    // The person may turn Apple Intelligence on or off in Settings and come
    // back. A later check replaces the answer without touching a queued note.
    recheck(available: boolean): string | undefined {
      if (state === "checking") return this.settle(available);
      state = available ? "ready" : "off";
      return undefined;
    },
    clear() {
      pending = undefined;
    },
  };
}
