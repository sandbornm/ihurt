// stop() and the recognizer's end callback can both deliver one recording's
// final transcript. The first delivery owns that generation. A blank
// transcript does not start a suggestion. A final from a generation that
// cancel or unmount already moved past is ignored.
export function createSuggestOnce() {
  let suggested = -1;
  return {
    deliver(
      recording: number,
      active: number,
      transcript: string,
    ): string | undefined {
      if (recording !== active || suggested === recording) return;
      suggested = recording;
      const value = transcript.slice(0, 3000).trim();
      return value || undefined;
    },
  };
}
