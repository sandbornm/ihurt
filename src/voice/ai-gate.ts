export type AvailabilityGate = ReturnType<typeof createAvailabilityGate>;

export function createAvailabilityGate() {
  let state: "checking" | "ready" | "off" = "checking";
  let pending: string | undefined;
  let latest = 0;
  return {
    begin(): number {
      return ++latest;
    },
    get state() {
      return state;
    },
    get latest() {
      return latest;
    },
    request(transcript: string): string | undefined {
      if (state === "ready") return transcript;
      if (state === "checking") pending = transcript;
      return undefined;
    },
    settle(available: boolean): string | undefined {
      if (state !== "checking") return undefined;
      state = available ? "ready" : "off";
      const queued = pending;
      pending = undefined;
      return available ? queued : undefined;
    },
    recheck(available: boolean, check?: number): string | undefined {
      if (check !== undefined && check !== latest) return undefined;
      if (state === "checking") return this.settle(available);
      state = available ? "ready" : "off";
      return undefined;
    },
    clear() {
      pending = undefined;
    },
  };
}
