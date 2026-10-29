export function createSuggestOnce() {
  let suggested = -1;
  return {
    deliver(
      recording: number,
      active: number,
      transcript: string,
    ): string | undefined {
      if (recording !== active || suggested === recording) return;
      const value = transcript.slice(0, 3000).trim();
      if (!value) return;
      suggested = recording;
      return value;
    },
  };
}
