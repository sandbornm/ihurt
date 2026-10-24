// When asking would not help. "All over" has no single spot to ask for. "Both"
// answers the side question ("both feet"), but not which part: "my knee and my
// hip both hurt" still asks where.
const whole = new RegExp(
  [
    "all over",
    "everywhere",
    "(?:whole|entire|full) body",
    "todo (?:el|mi) cuerpo",
    "(?:en|por) todas? partes",
    "por todos lados",
  ]
    .map((phrase) => `\\b${phrase}\\b`)
    .join("|"),
);
const both = /\bboth\b|\b(?:los|las) dos\b|\bambos\b|\bambas\b/;

const fold = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function skipsFollowUp(
  location: { status: string },
  transcript: string,
): boolean {
  const said = fold(transcript);
  if (location.status === "mapped") return false;
  if (whole.test(said)) return true;
  return location.status === "need-side" && both.test(said);
}
