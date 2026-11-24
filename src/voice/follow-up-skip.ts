// When asking would not help. The words below skip a question only when they
// describe where the pain is. "I took both pills", "desde las dos" or "my knee
// hurts all over" say nothing about the side, so the question stays.

// The whole body is the answer, so no part or side is left to ask for.
const wholeBody = new RegExp(
  [
    "(?:all over|throughout) (?:my|the) body",
    "(?:whole|entire|full) body",
    "todo (?:el|mi) cuerpo",
  ]
    .map((phrase) => `\\b${phrase}\\b`)
    .join("|"),
);
// "Everywhere" alone, with no part named. After a part ("my knee hurts all
// over") it does not say which side.
const anywhere =
  /\b(?:all over(?! (?:my|the|your|his|her)\b)|everywhere|en todas partes|por todos lados)\b/;

const fold = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "Both" or "las dos" counts as the side when it sits next to the part the
// person named ("both knees", "en las dos rodillas"), says "sides", or ends a
// phrase ("pain in both"). `spoken` is that part as said, e.g. "knee".
function bothSides(said: string, spoken: string): boolean {
  const noun = fold(spoken).trim().split(/\s+/).pop() ?? "";
  const part = noun ? `(?:\\w+ )?${escape(noun)}(?:s|es)?\\b` : "$^";
  const owner = "(?:(?:my|the|these|your|mis|sus|los|las) )?";
  const end = "\\s*(?:[.,;!?]|$)";
  return [
    `\\bboth (?:of )?${owner}${part}`,
    "\\bboth sides\\b",
    `\\b(?:in|on|of) both${end}`,
    `\\b(?:ambos|ambas|los dos|las dos) (?:\\w+ )?${escape(noun || "$^")}(?:s|es)?\\b`,
    "\\b(?:ambos|ambas|los dos|las dos) (?:lados|partes)\\b",
    `\\ben (?:ambos|ambas|los dos|las dos)${end}`,
  ].some((pattern) => new RegExp(pattern).test(said));
}

export function skipsFollowUp(
  location: { status: string; spoken?: string },
  transcript: string,
): boolean {
  const said = fold(transcript);
  if (location.status === "mapped") return false;
  if (wholeBody.test(said)) return true;
  if (location.status === "missing") return anywhere.test(said);
  return (
    location.status === "need-side" && bothSides(said, location.spoken ?? "")
  );
}
