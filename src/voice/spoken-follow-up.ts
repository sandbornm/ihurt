// Follow-up questions appear on screen. Reading them aloud is opt-in, because
// speech from a phone speaker in a waiting room is a surprise nobody asked for.
// There is no settings screen yet: the choice is the localStorage key below.
export const speakFollowUpKey = "ihurt.speakFollowUp";

export function speaksFollowUps(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): boolean {
  try {
    return storage?.getItem(speakFollowUpKey) === "1";
  } catch {
    return false;
  }
}
