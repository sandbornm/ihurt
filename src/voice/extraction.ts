import { regionNameIn, regions, type RegionId } from "../types.ts";
import { translate, type Language, type MessageKey } from "../i18n/index.ts";
import type { RawPainExtraction } from "../platform/on-device-ai.ts";
import type { DraftFields, VoiceDraftValue } from "./draft.ts";

// The on-device model only quotes the note. Everything here is deterministic:
// a field survives only when its words appear in what the person said, and a
// location maps only to an id in the fixed anatomy list. The checks work the
// same in English and Spanish: the lexicon below holds both languages, and
// the model's own region guess is never used.

export const anatomyList: RegionId[] = regions.map(({ id }) => id);

export type Part =
  | "foot"
  | "ankle"
  | "calf"
  | "knee"
  | "thigh"
  | "hip"
  | "wrist"
  | "elbow"
  | "shoulder"
  | "neck"
  | "chest"
  | "upper_back"
  | "lower_back"
  | "abdomen";

const sided = new Set<Part>([
  "foot",
  "ankle",
  "calf",
  "knee",
  "thigh",
  "hip",
  "wrist",
  "elbow",
  "shoulder",
]);

// Patterns run on normalized text: lowercase, accents removed. Order matters:
// "upper back" and "shoulder blade" are checked before "shoulder", and
// "dedo gordo del pie" before "pie". A bare "back", "espalda" or "dedo" is
// ambiguous and is asked about instead. "de pie" means standing, so only
// "pie" without a preceding "de" counts.
const partWords: [Part, RegExp][] = [
  [
    "upper_back",
    /\b(?:upper|mid|middle) back\b|\bshoulder ?blades?\b|\bparte (?:alta|superior|media) de la espalda\b|\bespalda (?:alta|superior|media)\b|\b(?:omoplatos?|escapulas?)\b/,
  ],
  [
    "lower_back",
    /\blower back\b|\blumbar\b|\bparte baja de la espalda\b|\bespalda baja\b|\bzona lumbar\b|\blumbares\b/,
  ],
  [
    "foot",
    /\b(?:toes?|heels?|arch(?:es)?|foot|feet|soles?|instep|bunion)\b|\bdedos? (?:gordos? |pequenos? |chiquitos? )?del pie\b|\bdedo gordo\b(?! de la mano)|\b(?:juanetes?|talon(?:es)?|empeines?)\b|\bplantas? del pie\b|\barco del pie\b|(?<!\bde )\bpies?\b/,
  ],
  ["ankle", /\bankles?\b|\btobillos?\b/],
  ["calf", /\bcalf\b|\bcalves\b|\b(?:pantorrillas?|gemelos?|chamorros?)\b/],
  ["knee", /\bknees?\b|\bkneecaps?\b|\b(?:rodillas?|rotulas?)\b/],
  [
    "thigh",
    /\bthighs?\b|\bhamstrings?\b|\bquads?\b|\bquadriceps\b|\b(?:muslos?|isquiotibiales|cuadriceps)\b/,
  ],
  ["hip", /\bhips?\b|\bcaderas?\b/],
  [
    "wrist",
    /\bwrists?\b|\bhands?\b|\bfingers?\b|\bthumbs?\b|\bpalms?\b|\b(?:munecas?|manos?|pulgar(?:es)?)\b|\bdedos? de la mano\b|\bpalmas? de la mano\b/,
  ],
  ["elbow", /\belbows?\b|\bcodos?\b/],
  ["shoulder", /\bshoulders?\b|\bhombros?\b/],
  ["neck", /\bneck\b|\bcuello\b|\bnuca\b/],
  ["chest", /\bchest\b|\bpecho\b|\btorax\b/],
  [
    "abdomen",
    /\babdomen\b|\bstomach\b|\bbelly\b|\b(?:estomago|panza|barriga|vientre)\b/,
  ],
];

// Lowercase, accents removed (NFD, then combining marks dropped), punctuation
// to spaces. "Articulación" and "articulacion" compare equal; letters such as
// ñ keep their base letter instead of being dropped.
export const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

function partsIn(value: string): Part[] {
  let rest = ` ${normalize(value)} `;
  const found: Part[] = [];
  for (const [part, pattern] of partWords) {
    if (pattern.test(rest)) {
      found.push(part);
      // Remove the matched words so "shoulder blade" does not also count as
      // "shoulder".
      rest = rest.replace(new RegExp(pattern.source, "g"), " ");
    }
  }
  return found;
}

const leftWords = /\b(?:left|izquierd[oa]s?)\b/;
const rightWords = /\b(?:right|derech[oa]s?)\b/;
// "derecho" after these is "straight" ("camino derecho", "voy derecho"), or
// the noun "right" ("tengo derecho"), not a side.
const straightWords =
  "todo|sig[ao]|sigue|seguir|camino|camina|caminar|caminas|caminamos|voy|va|vamos|ir|ando|corro|corre|correr|tengo|tiene";
const straightBefore = new RegExp(`^(?:${straightWords})$`);
// Words that look like a side but are not one.
const notSide = new RegExp(
  `\\bright (?:now|away|after)\\b|\\b(?:${straightWords}) derech[oa]\\b`,
  "g",
);
const bothWords = /\b(?:both|ambos|ambas|los dos|las dos)\b/;

// A side counts only when the person said it. "right now" and "todo derecho"
// are not sides.
function sideIn(value: string): "left" | "right" | "both" | null {
  const text = normalize(value);
  const left = leftWords.test(text),
    right = rightWords.test(text.replace(notSide, " "));
  if (bothWords.test(text) || (left && right)) return "both";
  return left ? "left" : right ? "right" : null;
}

// A side said on its own about the one part: "the left one",
// "la izquierda", "el derecho", "del lado izquierdo".
const sideReference = {
  left: /\b(?:the left one|(?:el|la|lado) izquierd[oa])\b/,
  right: /\b(?:the right one|(?:el|la|lado) derech[oa])\b/,
};

// The side word exactly as said, such as "left" or "izquierda", so a follow-up
// answer can be added to the spoken location in the person's own words.
function sideWordIn(value: string, side: "left" | "right") {
  const pattern = side === "left" ? leftWords : rightWords;
  const words = value.trim().split(/\s+/);
  const found = words.find((word) => pattern.test(normalize(word)));
  return found ? found.replace(/[^\p{L}\p{M}']/gu, "") : side;
}

const sideSubjects = new Set([
  "i",
  "we",
  "he",
  "she",
  "they",
  "it",
  "that",
  "who",
]);
const sideObjects = new Set([
  "my",
  "the",
  "a",
  "an",
  "his",
  "her",
  "their",
  "our",
  "your",
  "this",
  "that",
  "it",
  "them",
  "work",
  "home",
  "early",
  "again",
]);

// Words that make "left" a verb: "I left", "just left", "I have left".
const leftVerbBefore = new Set([
  ...sideSubjects,
  "just",
  "have",
  "has",
  "had",
  "ive",
  "weve",
  "already",
  "then",
  "also",
  "finally",
  "we",
  "who",
]);
// "turn left", "head right": a direction, not the side of the body.
const motionBefore = new Set([
  "turn",
  "turns",
  "turned",
  "turning",
  "go",
  "goes",
  "going",
  "went",
  "head",
  "heading",
  "veer",
  "bear",
  "steer",
  "lean",
  "leaning",
  "step",
  "walk",
  "walking",
  "look",
  "looking",
  "swing",
  "swinging",
  // Spanish: "me fui a la izquierda", "doblé a la derecha".
  "fui",
  "voy",
  "vamos",
  "va",
  "doble",
  "dobla",
  "doblo",
  "doblar",
  "gire",
  "gira",
  "giro",
  "girar",
  "camine",
  "camino",
  "corri",
  "corro",
  "mire",
  "mira",
  "mirar",
  "ir",
]);
const sideDeterminers = new Set([
  "the",
  "my",
  "that",
  "this",
  "its",
  "la",
  "el",
  "lo",
  "mi",
  "esa",
  "ese",
]);

// The answer to "left or right?" must say one side, plainly. "not left" and
// "no es la izquierda" are denials, "derecho" in "voy derecho" means straight, "I left work" and "just left" use the verb, and "left and right" or
// "left, right" name both, so none of them supplies a side. A negator denies
// only the next side word: "not the left, the right" is the right.
function sideAnswer(reply: string): "left" | "right" | null {
  // "sin duda, la derecha" (without a doubt) and "no más la izquierda" (only
  // the left) are not denials.
  const clauses = reply
    .split(/[,.;:!?\n]+/)
    .map((clause) =>
      normalize(clause)
        .replace(/\bsin duda\b/g, " ")
        .replace(/\bno mas\b/g, " ")
        .split(" ")
        .filter(Boolean),
    )
    .filter((clause) => clause.length > 0);
  // "no, the right one" and "no, es la derecha" answer the question; a bare
  // "no" before a clause that states a side is not a denial. "no, left" stays
  // unclear, and "no es la derecha" in one clause stays a denial.
  if (
    clauses.length > 1 &&
    clauses[0].length === 1 &&
    clauses[0][0] === "no" &&
    (sideDeterminers.has(clauses[1][0]) ||
      ["es", "son", "it's", "its", "it", "is"].includes(clauses[1][0]))
  )
    clauses.shift();
  if (clauses.reduce((n, clause) => n + clause.length, 0) > 8) return null;
  const found = new Set<"left" | "right">();
  const denied = new Set<"left" | "right">();
  const notNow = ["now", "away", "after", "right"];
  let pending = 0;
  for (const words of clauses)
    words.forEach((word, i) => {
      const prev = words[i - 1] ?? "";
      const next = words[i + 1] ?? "";
      let side: "left" | "right" | null = null;
      const toward = [1, 2, 3].some((back) =>
        motionBefore.has(words[i - back] ?? ""),
      );
      if (
        rightWords.test(word) &&
        !toward &&
        !notNow.includes(next) &&
        !["all", "right"].includes(prev) &&
        !straightBefore.test(prev)
      )
        side = "right";
      if (
        leftWords.test(word) &&
        !toward &&
        (word !== "left" || prev === "that" || !leftVerbBefore.has(prev)) &&
        (next === "one" ||
          next === "side" ||
          (!sideObjects.has(next) &&
            next !== "now" &&
            next !== "away" &&
            next !== "after" &&
            !(next === "right" && notNow.includes(words[i + 2] ?? ""))))
      )
        side = "left";
      if (!side) {
        if (isNegator(word)) pending = 4;
        else if (pending > 0) pending -= 1;
        return;
      }
      (pending > 0 ? denied : found).add(side);
      pending = 0;
    });
  // "left, no wait, right" and "the left, sorry, the right" correct themselves,
  // and a trailing "no" retracts the answer: ask again.
  // "left, no, right" and "derecha no, izquierda" name both sides around a
  // "no", which could take back either one: ask again.
  const all = clauses.flat();
  if (
    isNegator(all[all.length - 1] ?? "") ||
    (found.size + denied.size > 1 &&
      clauses.some(
        (clause, i) => i > 0 && clause.length === 1 && isNegator(clause[0]),
      )) ||
    (found.size + denied.size > 1 &&
      clauses.some(
        (clause, i) =>
          i < clauses.length - 1 && isNegator(clause[clause.length - 1]),
      )) ||
    (found.size + denied.size > 1 &&
      all.some((word) =>
        ["wait", "sorry", "actually", "mean", "scratch", "oops"].includes(word),
      ))
  )
    return null;
  for (const side of denied) found.delete(side);
  return found.size === 1 ? [...found][0] : null;
}

const stop = new Set([
  "the",
  "and",
  "my",
  "on",
  "in",
  "at",
  "of",
  "a",
  "an",
  "to",
  "was",
  "it",
  "i",
  // Spanish articles, prepositions and pronouns.
  "el",
  "la",
  "los",
  "las",
  "lo",
  "de",
  "del",
  "en",
  "mi",
  "mis",
  "y",
  "un",
  "una",
  "al",
  "me",
  "se",
  "que",
  "con",
  "por",
]);

const irregular: Record<string, string> = {
  feet: "foot",
  calves: "calf",
  halves: "half",
  teeth: "tooth",
};

// Rough singular forms so "knee" matches "both knees", "foot" matches "feet",
// "rodilla" matches "rodillas" and "talon" matches "talones". Any form that
// is not in the transcript fails closed.
function forms(word: string) {
  const out = new Set([word]);
  if (irregular[word]) out.add(irregular[word]);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss"))
    out.add(word.slice(0, -1));
  if (word.length > 4 && word.endsWith("es")) out.add(word.slice(0, -2));
  return out;
}

const matches = (a: string, b: string) => {
  if (a === b) return true;
  const fb = forms(b);
  for (const form of forms(a)) if (fb.has(form)) return true;
  return false;
};

// "n't" covers isn't, don't, can't, and the rest. The bare forms are the same
// words when speech drops the apostrophe. Spanish denials, after accents are
// removed: "no es", "no me duele", "sin", "nunca", "tampoco", "ni", "ningun".
const contraction = [
  "isn't",
  "wasn't",
  "don't",
  "doesn't",
  "didn't",
  "can't",
  "won't",
  "wouldn't",
  "couldn't",
  "shouldn't",
  "aren't",
  "weren't",
  "haven't",
  "hasn't",
  "hadn't",
  "mustn't",
  "ain't",
];
const negators = new Set([
  "not",
  "no",
  "never",
  "without",
  "nothing",
  "none",
  "cannot",
  "neither",
  "nor",
  "deny",
  "denies",
  ...contraction,
  ...contraction.map((word) => word.replaceAll("'", "")),
  "sin",
  "nunca",
  "jamas",
  "tampoco",
  "ni",
  "ningun",
  "ninguna",
  "ninguno",
  "nada",
  "nadie",
  "niego",
  "niega",
  // "no puedo" is joined by idioms(). It denies an activity ("no puedo
  // correr") but not a body part ("no puedo doblar la rodilla").
  "nopuedo",
  "nopude",
  "nopodia",
]);

const isNegator = (word: string) => word.includes("n't") || negators.has(word);

// For a body part, "I can't bend my left knee" and "no puedo doblar la
// rodilla" say the part is affected, not that it is fine. Other fields keep
// every negator ("I couldn't run").
const ability = new Set([
  "can't",
  "cant",
  "cannot",
  "couldn't",
  "couldnt",
  "nopuedo",
  "nopude",
  "nopodia",
]);
const denies = (word: string, part = false) =>
  isNegator(word) && !(part && ability.has(word));

// After the value, "is not the problem", "doesn't hurt" or "no me duele"
// denies it, while "isn't burning, it's aching" only describes it.
const deniedAfter = new Set([
  "problem",
  "issue",
  "one",
  "where",
  "what",
  "it",
  "bothering",
  "affected",
  "involved",
  "problema",
  "afectado",
  "afectada",
  "lastimado",
  "lastimada",
]);
// "doesn't hurt", "isn't sore" or "no me duele" denies the part, unless hedged
// ("doesn't hurt much", "no me duele mucho") or corrected by the next clause
// ("isn't sore, it's aching").
const hurtWords = new Set([
  "hurt",
  "hurts",
  "hurting",
  "sore",
  "painful",
  "duele",
  "duelen",
  "molesta",
  "molestan",
  "dolor",
  "dolores",
  "molestia",
  "molestias",
]);
const painNouns = new Set(["dolor", "dolores", "molestia", "molestias"]);
const hedges = new Set([
  "much",
  "that",
  "as",
  "so",
  "too",
  "really",
  "badly",
  "a",
  "mucho",
  "tanto",
  "tan",
  "demasiado",
]);
function deniesAfter(words: string[], end: number, corrected: boolean) {
  const next = words.slice(end + 1, end + 6);
  const at = next.findIndex(isNegator);
  if (at < 0 || at >= 3) return false;
  const rest = next.slice(at + 1);
  if (rest.some((word) => deniedAfter.has(word))) return true;
  const hurt = rest.findIndex((word) => hurtWords.has(word));
  // "no tiene mucho dolor" hedges before a noun, "no duele mucho" after a verb.
  return (
    hurt >= 0 &&
    !corrected &&
    !hedges.has(rest[hurt + 1] ?? "") &&
    !(painNouns.has(rest[hurt]) && hedges.has(rest[hurt - 1] ?? ""))
  );
}

// Spanish idioms that look like denials but are not: "nada mas" and "no mas"
// mean "only" in Mexico ("me duele nada mas la rodilla"), "sin duda" means
// "certainly". "ya no mas" (no longer) stays a denial. "no puedo" is ability.
const idioms = (text: string) =>
  text
    .replace(/\b(?<!ya )(?:nada|no) mas\b/g, "solo")
    .replace(/\bsin (?:duda|embargo)\b/g, "seguro")
    .replace(/\bno (?:puede|pueden|podria|podrian) ser\b/g, "no es")
    .replace(/\bno (?:puede|pueden|podria|podrian) estar\b/g, "no esta")
    .replace(/\bno (pued[oe]|pude|podia)\b/g, "no$1");

// Words that join two phrases. A denial on one side does not cancel the
// other: "it isn't burning and my left knee hurts", "no es ardor pero duele".
const conjunctions = new Set([
  "and",
  "but",
  "or",
  "though",
  "although",
  "y",
  "e",
  "pero",
  "o",
  "u",
  "aunque",
  "sino",
]);

const tokens = (text: string) =>
  idioms(normalize(text)).split(" ").filter(Boolean);

// Punctuation separates clauses; conjunctions separate the soft parts inside
// one clause.
function softParts(clause: string) {
  const parts: string[][] = [[]];
  for (const word of tokens(clause))
    if (conjunctions.has(word)) parts.push([]);
    else parts[parts.length - 1].push(word);
  return parts.filter((words) => words.length);
}

const clauses = (transcript: string) =>
  transcript.split(/[.!?;:,\n¿¡]+/).filter((clause) => clause.trim());

// True when every wanted word occurs, and no negator stands before it.
// "my left knee isn't burning" keeps the knee and drops "burning";
// "no me duele la rodilla" drops the knee.
// The words after it must not deny it either: "my left knee doesn't hurt".
function covers(
  words: string[],
  needed: string[],
  part = false,
  corrected = false,
) {
  // "it can't be my left knee" says it is not the knee.
  // "it can't be in my left knee" and "can't be on my left knee" deny it too;
  // "can't be walking" is ability.
  words = words.map((word, i) =>
    ability.has(word) &&
    words[i + 1] === "be" &&
    !/ing$/.test(words[i + 2] ?? "")
      ? "isn't"
      : word,
  );
  let last = -1;
  const found = needed.every((want) => {
    const at = words.findIndex((said) => matches(said, want));
    last = Math.max(last, at);
    return at >= 0 && !words.slice(0, at).some((word) => denies(word, part));
  });
  if (!found || deniesAfter(words, last, corrected)) return false;
  // "I can't tell if my left knee is the problem" still denies it.
  const exempt = words.slice(0, last).some((word) => ability.has(word));
  return !(exempt && words.slice(last + 1).some((w) => deniedAfter.has(w)));
}

// With `together`, the words must share one conjunction-free part, so "my
// left knee and right foot" does not ground "left foot". Without it, words
// joined only by conjunctions still count ("left knee and ankle"), as long as
// none comes from a denied part. `part` marks the body-part check, where
// ability negators ("can't bend", "no puedo doblar") do not deny it.
function clauseGrounds(
  clause: string,
  needed: string[],
  together: boolean,
  part: boolean,
  corrected: boolean,
) {
  const soft = softParts(clause);
  if (soft.some((words) => covers(words, needed, part, corrected))) return true;
  if (together) return false;
  const affirmative = soft.filter((words) => !words.some(isNegator));
  return covers(affirmative.flat(), needed, false, corrected);
}

// "isn't sore, it's aching" / "no duele, es un ardor": a next clause that starts "it's ..." describes the
// pain instead. "it's fine", "it's gone" and "it's not" clear it further.
const clearing =
  /^(?:fine|ok|okay|alright|gone|resolved|healed|nothing|not|no|bien|nada)\b|^(?:over|stopped|finished|done)(?: now| already)?$|^(?:good|better|great|mejor)\b(?! (?:pain|than|que))|^(?:ya (?:no\b|paso|termino|se )|se (?:me )?(?:quito|paso|fue|acabo)|paso$|termino$|(?:ya |todavia |aun )?esta (?:mejor|bien)\b(?! que)|(?:todavia |aun )?sigue (?:bien|mejor|sin)\b)/;
// "it's not gone" and "it's not better" say the pain is still there, and so do
// "no se ha ido", "no está mejor" and "todavía sigue".
const stillThere =
  /^(?:not|no) (?:gone|over|better|good|great|fine|ok|okay|resolved|healed|finished|done)\b|^no (?:se (?:me )?(?:ha |han )?(?:ido|quitado|pasado|quita|pasa|va)|esta mejor|ha (?:mejorado|pasado)|mejoro)\b|^no esta bien\b|^(?:todavia|aun) (?:sigue(?! (?:bien|mejor|sin)\b)|esta(?! (?:mejor|bien)\b)|me)\b|^sigue\b(?! (?:bien|mejor|sin)\b)/;
function corrects(next: string) {
  const match = /^\s*(?:it['\u2019]s|its|it is|es|son)\s+(.*)$/i.exec(next);
  if (match === null) return false;
  // "es que ya pasó": the "que" only introduces the clause.
  const rest = normalize(match[1]).replace(/^que /, "");
  // "it's not gone from my knee" says the pain is still there.
  if (stillThere.test(rest)) return true;
  // "it's my ankle": the pain moved to a different part.
  if (partsIn(rest).length > 0) return false;
  return !clearing.test(rest);
}

// Every meaningful word must appear in the transcript, in a clause that is
// not denying it. This keeps model paraphrases, guesses, invented details and
// denied details out of the proposal, in English and Spanish.
export function grounded(
  value: string,
  transcript: string,
  together = false,
  part = false,
): boolean {
  const parts = softParts(value);
  // "knee and ankle" names two parts; each must be said together on its own.
  if (together && parts.length > 1)
    return parts.every((piece) =>
      grounded(piece.join(" "), transcript, true, part),
    );
  const needed = tokens(value).filter((word) => !stop.has(word));
  if (!needed.length) return false;
  const said = clauses(transcript);
  return said.some((clause, i) =>
    clauseGrounds(clause, needed, together, part, corrects(said[i + 1] ?? "")),
  );
}

// The span must occur in the transcript as consecutive words, ignoring case,
// accents and plural endings. A location stitched together from words said in
// different places does not count.
export function spanIn(value: string, transcript: string) {
  const span = tokens(value);
  const said = tokens(transcript);
  if (!span.length) return false;
  for (let start = 0; start + span.length <= said.length; start++)
    if (span.every((word, i) => matches(word, said[start + i]))) return true;
  return false;
}

// "left knee" or "left big toe", not the verb in "I left work because my knee
// hurts" or "I left my knee brace", nor "it hurts right at my knee". Only the
// English words are checked; Spanish sides may follow the part ("rodilla
// izquierda").
const notModifiers = new Set([
  "my",
  "the",
  "a",
  "an",
  "his",
  "her",
  "their",
  "our",
  "your",
  "this",
  "that",
  "it",
  "at",
  "in",
  "on",
]);
function sideNextTo(side: string, transcript: string) {
  const word = normalize(side);
  if (word !== "left" && word !== "right") return true;
  const words = tokens(transcript);
  return words.some((said, i) => {
    if (said !== word) return false;
    const next = words[i + 1] ?? "";
    return (
      partsIn(next).length > 0 ||
      (!notModifiers.has(next) &&
        partsIn(`${next} ${words[i + 2] ?? ""}`).length > 0)
    );
  });
}

export type LocationResult =
  | { status: "mapped"; region: RegionId; spoken: string }
  | { status: "missing" }
  | { status: "unmapped"; spoken: string }
  | { status: "ambiguous"; spoken: string }
  | { status: "need-side"; spoken: string; part: Part };

export function mapLocation(
  spoken: string,
  side: RawPainExtraction["side"],
  transcript: string,
  allowed: readonly string[] = anatomyList,
): LocationResult {
  const words = spoken.trim();
  if (!words) return { status: "missing" };
  // A side and a body part count only when said together, as one phrase.
  if (!grounded(words, transcript, true, true) || !spanIn(words, transcript))
    return { status: "unmapped", spoken: words };
  const parts = partsIn(words);
  if (parts.length === 0) return { status: "unmapped", spoken: words };
  if (parts.length > 1) return { status: "ambiguous", spoken: words };
  const part = parts[0];
  let region: string = part;
  if (sided.has(part)) {
    // A side counts only when the person said it.
    // The model's side is used only when the note names this one part and
    // says that side without denying it. "me duele la rodilla. La mano
    // izquierda esta bien" asks which knee.
    // "right at my knee" and "left work" are not sides.
    const loose = ["left", "right"].some(
      (word) => tokens(words).includes(word) && !sideNextTo(word, words),
    );
    const stated =
      (loose ? null : sideIn(words)) ??
      ((side === "left" || side === "right") &&
      sideIn(transcript) === side &&
      partsIn(transcript).length === 1 &&
      grounded(sideWordIn(transcript, side), transcript) &&
      // "my right knee", "the left one", "la izquierda" or "del lado
      // derecho", not the verb in "I left work".
      ((grounded(
        `${sideWordIn(transcript, side)} ${words}`,
        transcript,
        true,
      ) &&
        sideNextTo(sideWordIn(transcript, side), transcript)) ||
        sideReference[side].test(normalize(transcript)))
        ? side
        : null);
    if (stated !== "left" && stated !== "right")
      return { status: "need-side", spoken: words, part };
    region = `${stated}_${part}`;
  }
  if (!allowed.includes(region)) return { status: "unmapped", spoken: words };
  return { status: "mapped", region: region as RegionId, spoken: words };
}

const numberWords = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];
// "un" and "una" are left out: they are usually articles ("un dolor").
const spanishNumbers = [
  "cero",
  "uno",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
];
const numberPattern = ["10", "[0-9]", ...numberWords, ...spanishNumbers].join(
  "|",
);
const numberValue = (word: string) =>
  /^\d+$/.test(word)
    ? Number(word)
    : numberWords.includes(word)
      ? numberWords.indexOf(word)
      : spanishNumbers.indexOf(word);

// A number counts as a rating only when it is said as one: "7 out of 10",
// "7/10", "about a six", "pain is 4", "I rated it 7", "7 de 10", "un siete",
// "dolor de 6", "la intensidad es 5". "3 days ago", "at 7 am", "my son is 7",
// "en 3 sitios" or "hace 3 dias" is not a rating, and neither is a number
// after a denial ("no es un 8"). When unsure, drop it so the follow-up
// question can ask.
const ratingBefore =
  /\b(?:about|around|maybe|roughly|a|an|(?:pain|it|it's|its|that|rating|level|intensity) (?:is|was)|rate|rated|rated it|rating|level|pain|intensity|un|una|(?:dolor|intensidad|nivel|calificacion) (?:es|era|esta|estaba|de)|nivel|intensidad|calificacion|doy|daria|le doy|le daria)$/;
const ratingAfter =
  /^(?:out of (?:10|ten)|of (?:10|ten)|(?:de|sobre) (?:10|diez))(?: (.*))?$/;
const notRatingAfter =
  /^(?:minutes?|hours?|days?|weeks?|months?|years?|times?|miles?|km|sets?|reps?|laps?|games?|people|places?|spots?|fingers?|toes?|am|pm|a m|p m|o'clock|oclock|minutos?|horas?|dias?|semanas?|meses|mes|anos?|veces|vez|kilometros?|partidos?|series|vueltas?|sitios?|lugares|partes|dedos?|personas|feet|foot|ft|inch|inches|lbs?|pounds?|de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)|de la (?:manana|tarde|noche)|en punto|blocks?|steps?|flights?|yards?|met(?:er|re)s?|pills?|doses?|tablets?|cups?|glasses|in the (?:morning|afternoon|evening)|of may|may(?= \d|$)|(?:of )?(?:january|february|march|april|june|july|august|september|october|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre))\b/;
// "October 7", "May 7" and "mayo 7" name a date, not a rating.
const monthBefore =
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)$/;
// A bare "about 7" or "around seven" is a rating only when nothing follows
// it but a hedge: "around seven in the morning" is a time.
const genericBefore = /\b(?:about|around|maybe|roughly)$/;
const genericAfter =
  /^(?:|or so|ish|i guess|i think|now|today|right now|at (?:most|worst|best)|aproximadamente|mas o menos|creo)$/;

export function ratedIn(transcript: string, value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 10) return false;
  const number = new RegExp(
    `^(?:${value}|${numberWords[value]}|${spanishNumbers[value]})$`,
  );
  for (const clause of clauses(transcript)) {
    // "7/10" is one rating; the slash would otherwise split it. A date such
    // as "on 7/10", "el 7/10" or "7/10/26" is not.
    const slash = clause.match(
      new RegExp(`(?:^|[^0-9/])${value}\\s*/\\s*10\\b(?!\\s*/)`),
    );
    if (slash) {
      const before = tokens(clause.slice(0, slash.index! + 1));
      const last = before[before.length - 1];
      const tail = tokens(
        clause.slice(slash.index! + slash[0].length).replace(/^\s*\/?/, ""),
      ).join(" ");
      // "le doy el 7/10" rates the pain; "el 7/10" alone is a date.
      const rated =
        last === "el"
          ? /\b(?:doy|daria|pongo|pondria|es|era|seria|sera|dolor|nivel)$/.test(
              before.slice(0, -1).join(" "),
            )
          : !["on", "since", "desde", "del"].includes(last);
      if (
        !before.some(isNegator) &&
        rated &&
        !notRatingAfter.test(tail) &&
        !/^(?:(?:last|past|previous)\s+(?:day|week|month|year)s?|(?:days?|weeks?|months?|years?)\s+ago)\b/.test(
          tail,
        )
      )
        return true;
    }
    for (const words of softParts(clause))
      for (const [at, word] of words.entries()) {
        if (!number.test(word)) continue;
        const before = words.slice(0, at);
        const after = words.slice(at + 1).join(" ");
        if (before.some(isNegator) || notRatingAfter.test(after)) continue;
        const scale = after.match(ratingAfter);
        // "3 out of 10 days" counts days, not pain.
        if (scale) {
          if (!notRatingAfter.test(scale[1] ?? "")) return true;
          continue;
        }
        const lead = before.join(" ");
        if (monthBefore.test(lead)) continue;
        if (genericBefore.test(lead) && !genericAfter.test(after)) continue;
        if (ratingBefore.test(lead)) return true;
      }
  }
  return false;
}

export function parseIntensityAnswer(answer: string): number | null {
  // "sin duda un siete" (certainly a seven) is not a denial.
  const text = idioms(normalize(answer));
  // "not seven" or "no es un siete" is not a rating; the field stays blank.
  if (text.split(" ").some(isNegator)) return null;
  const lower = answer.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  // "7 out of 10", "7/10" and "7 de 10": the first number is the rating, the
  // scale is the 10. A date ("on 7/10", "since 7/10", "7/10/26") or a count of
  // days ("7/10 days ago") is not one.
  const scale = lower.match(
    new RegExp(
      `\\b(${numberPattern})\\s*(?:out of|of|de|sobre|/)\\s*(?:10|ten|diez)\\b(?!\\s*/\\s*\\d)`,
    ),
  );
  if (scale) {
    const before = lower.slice(0, scale.index).trim();
    const after = lower.slice((scale.index ?? 0) + scale[0].length).trim();
    if (
      /\b(?:on|since|from|until|till|by|before|after|started|dated|as of|desde|del|hasta|para)(?:\s+(?:the|a|an))?$/.test(
        before,
      ) ||
      (/\bel$/.test(before) &&
        !/\b(?:doy|daria|pongo|pondria|es|era|seria|sera|dolor|nivel)\s+el$/.test(
          before,
        )) ||
      /\baround\s+the$/.test(before) ||
      notRatingAfter.test(after) ||
      /^(?:(?:last|past|previous)\s+(?:day|week|month|year)s?|(?:days?|weeks?|months?|years?)\s+ago)\b/.test(
        after,
      )
    )
      return null;
    // A second number that is not the scale ("6/10 and 4/10") is unclear.
    const rest = lower.replace(scale[0], " ");
    return new RegExp(`\\b(?:${numberPattern})\\b`).test(rest)
      ? null
      : numberValue(scale[1]);
  }
  if (/\d\s*\/\s*\d+\s*\/\s*\d/.test(lower)) return null;
  // "out of 10" or "/10" alone names the top of the scale, not a rating.
  const bare = idioms(
    normalize(
      lower
        .replace(/(?:out of|of|de|sobre|\/)\s*(?:10|ten|diez)\b/g, " ")
        .replace(/[^a-z0-9' ]+/g, " "),
    ),
  );
  // "seven days ago", "7 miles" and "7 years old" are not ratings.
  const found = [...bare.matchAll(new RegExp(`\\b(${numberPattern})\\b`, "g"))]
    .filter(
      (match) =>
        !notRatingAfter.test(
          bare.slice(match.index + match[0].length).trim(),
        ) &&
        !/\b(?:age|aged|edad|tengo|tiene|tienes|tuve|las|los|dia|day|at)$/.test(
          bare.slice(0, match.index).trim(),
        ) &&
        !monthBefore.test(bare.slice(0, match.index).trim()) &&
        !/\b(?:del|desde|hasta|since|from|until|till)(?: (?:el|the))?$/.test(
          bare.slice(0, match.index).trim(),
        ),
    )
    .map((match) => numberValue(match[1]))
    .filter((value) => value >= 0);
  return found.length === 1 ? found[0] : null;
}

const weekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const spanishWeekdays = [
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
];

function shift(today: string, days: number) {
  const [y, m, d] = today.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - days));
  return date.toISOString().slice(0, 10);
}

export function localToday(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Resolves common relative phrases in English and Spanish against the
// device's local date. Anything else keeps the person's words without a date.
export function resolveOnset(
  phrase: string,
  today: string,
): { phrase: string; date?: string } {
  const text = normalize(phrase);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return { phrase };
  const [y, m, d] = today.split("-").map(Number);
  if (Number.isNaN(Date.UTC(y, m - 1, d))) return { phrase };
  // Counted offsets come first: "a week ago today" is a week ago.
  const ago =
    text.match(
      new RegExp(
        `\\b(\\d{1,2}|${numberWords.slice(1).join("|")}|a) (day|days|week|weeks) ago\\b`,
      ),
    ) ??
    text.match(
      new RegExp(
        `\\b(?:hace|hizo) (\\d{1,2}|un|una|${spanishNumbers.slice(1).join("|")}) (dia|dias|semana|semanas)\\b`,
      ),
    );
  if (ago) {
    const n = ["a", "un", "una"].includes(ago[1]) ? 1 : numberValue(ago[1]);
    // "a week and two days ago" has more than the matched part: leave it as
    // the person's words instead of resolving only "two days ago".
    const lead = text.slice(0, ago.index ?? 0).trim();
    const compound =
      /\b(?:and|plus|y|mas)$/.test(lead) ||
      /\b(?:day|days|week|weeks|month|months|year|years|hour|hours|dia|dias|semana|semanas|mes|meses|ano|anos|hora|horas)$/.test(
        lead,
      );
    const tail = text.slice((ago.index ?? 0) + ago[0].length).trim();
    const more = new RegExp(
      `^(?:and|plus|y) (?:\\d{1,2}|a|an|un|una|half|media|medio|${numberWords.slice(1).join("|")}|${spanishNumbers.slice(1).join("|")})\\b`,
    );
    if (compound || more.test(tail)) return { phrase };
    if (n >= 0) {
      // "a week ago yesterday" and "ayer hizo una semana" are a day before
      // the week-ago date.
      // A bare "manana" is "tomorrow" or "morning": leave the words alone.
      if (/^manana$/.test(tail) || /^manana$/.test(lead)) return { phrase };
      const day =
        "(?: (?:(?:por|en|de) la |in the )?(?:morning|afternoon|evening|night|manana|tarde|noche))?$";
      const nudge =
        new RegExp(`^(?:yesterday|ayer)${day}`).test(tail) ||
        new RegExp(`^(?:yesterday|ayer)${day}`).test(lead)
          ? 1
          : new RegExp(`^(?:tomorrow|manana)${day}`).test(tail)
            ? -1
            : 0;
      return {
        phrase,
        date: shift(
          today,
          (/^(?:week|semana)/.test(ago[2]) ? n * 7 : n) + nudge,
        ),
      };
    }
  }
  if (/\b(?:day before yesterday|anteayer|antier|antes de ayer)\b/.test(text))
    return { phrase, date: shift(today, 2) };
  if (/\b(?:yesterday|last night|ayer|anoche)\b/.test(text))
    return { phrase, date: shift(today, 1) };
  if (
    // "Earlier" and "mas temprano" are today only on their own or with this
    // day ("earlier this morning", "mas temprano hoy"), not "earlier this
    // week" or "mas temprano este ano".
    text === "earlier" ||
    text === "mas temprano" ||
    /\b(?:today|this morning|this afternoon|this evening|tonight|earlier this (?:morning|afternoon|evening)|a little while ago|hoy|esta manana|esta tarde|esta noche|hace un rato|hace rato|hace unas horas|hace unos minutos|mas temprano hoy)\b/.test(
      text,
    )
  )
    return { phrase, date: today };
  const weekday =
    text.match(
      /\b(?:last |on |this past )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
    ) ??
    text.match(
      /\b(?:el )?(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/,
    );
  // An onset is in the past. "el proximo lunes", "el lunes que viene" and
  // "next monday" name a day ahead, so they keep the words without a date.
  if (
    weekday &&
    /\b(?:next|coming|proxim[oa]|que viene|siguiente|entrante)\b/.test(text)
  )
    return { phrase };
  if (weekday) {
    const current = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const index = weekdays.includes(weekday[1])
      ? weekdays.indexOf(weekday[1])
      : spanishWeekdays.indexOf(weekday[1]);
    let back = (current - index + 7) % 7;
    if (back === 0) back = 7;
    return { phrase, date: shift(today, back) };
  }
  return { phrase };
}

// Whether the pin option stays on after a follow-up answer. A person who
// unchecked "Propose a pin" keeps that choice; the option turns on only when
// the answer first supplies a mapped location.
export function pinAfterAnswer(
  current: boolean,
  before: LocationResult,
  after: LocationResult,
) {
  if (after.status !== "mapped") return false;
  return before.status === "mapped" ? current : true;
}

export type FollowUp =
  | { key: "location"; question: string }
  | { key: "side"; question: string }
  | { key: "intensity"; question: string };

export interface PainProposal {
  transcript: string;
  location: LocationResult;
  fields: DraftFields;
  onset?: { phrase: string; date?: string };
  followUp: FollowUp | null;
  asked: boolean;
  language: Language;
}

function followUpFor(
  location: LocationResult,
  fields: DraftFields,
  lang: Language,
): FollowUp | null {
  if (location.status === "missing" || location.status === "unmapped")
    return {
      key: "location",
      question: translate(lang, "extraction.ask.location"),
    };
  if (location.status === "ambiguous")
    return {
      key: "location",
      question: translate(lang, "extraction.ask.oneSpot"),
    };
  if (location.status === "need-side")
    return {
      key: "side",
      question: translate(
        lang,
        `extraction.ask.side.${location.part}` as MessageKey,
      ),
    };
  if (fields.intensity === undefined)
    return {
      key: "intensity",
      question: translate(lang, "extraction.ask.intensity"),
    };
  return null;
}

// Keeps the person's word, accents included, for display.
const display = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' -]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export function buildProposal(
  raw: RawPainExtraction,
  transcript: string,
  today: string,
  lang: Language = "en",
): PainProposal {
  const fields: DraftFields = {};
  const seen = new Set<string>();
  const qualities: string[] = [];
  for (const quality of raw.qualities) {
    const word = display(quality);
    const key = normalize(word);
    if (!key || seen.has(key) || !grounded(word, transcript)) continue;
    seen.add(key);
    qualities.push(word);
  }
  if (qualities.length) fields.quality = qualities.join(", ");
  if (raw.intensity !== null && ratedIn(transcript, raw.intensity))
    fields.intensity = raw.intensity;
  // The activity must be said as one phrase: "running tennis" is not "went
  // running and played tennis".
  const activity =
    grounded(raw.activity, transcript) && spanIn(raw.activity, transcript)
      ? raw.activity
      : "";
  // A surface is kept only when said with this activity, so "ran on pavement
  // and played tennis on clay" never becomes "ran on clay".
  const surface =
    activity && grounded(`${raw.activity} ${raw.surface}`, transcript, true)
      ? raw.surface
      : "";
  if (activity)
    fields.activity = surface
      ? translate(lang, "extraction.activityOn", { activity, surface })
      : activity;
  let onset: PainProposal["onset"];
  // The onset must be said as one phrase: "three miles ... weeks ago" is not
  // "three weeks ago".
  if (
    grounded(raw.onsetPhrase, transcript) &&
    spanIn(raw.onsetPhrase, transcript)
  ) {
    onset = resolveOnset(raw.onsetPhrase, today);
    fields.duration = onset.date
      ? translate(lang, "extraction.sinceDate", {
          phrase: onset.phrase,
          date: onset.date,
        })
      : translate(lang, "extraction.since", { phrase: onset.phrase });
  }
  const location = mapLocation(raw.spokenLocation, raw.side, transcript);
  return {
    transcript,
    location,
    fields,
    onset,
    followUp: followUpFor(location, fields, lang),
    asked: false,
    language: lang,
  };
}

// Applies the single follow-up answer without another model call. The proposal
// never asks a second question; anything still missing stays blank.
export function answerFollowUp(
  proposal: PainProposal,
  answer: string,
): PainProposal {
  // A reply that would be cut from the saved transcript is not used, so every
  // field keeps its source text.
  const trimmed = answer.trim().slice(0, 300);
  const reply =
    proposal.transcript.length + 1 + trimmed.length <= 3000 ? trimmed : "";
  const transcript = reply
    ? `${proposal.transcript}\n${reply}`
    : proposal.transcript;
  const next: PainProposal = {
    ...proposal,
    transcript,
    fields: { ...proposal.fields },
    followUp: null,
    asked: true,
  };
  if (!reply || !proposal.followUp) return next;
  const key = proposal.followUp.key;
  if (key === "intensity") {
    const value = parseIntensityAnswer(reply);
    if (value !== null) next.fields.intensity = value;
  } else if (key === "side" && proposal.location.status === "need-side") {
    const side = sideAnswer(reply);
    if (side) {
      // The side is added in the person's own word: "left ankle" in English,
      // "tobillo izquierdo" in Spanish, where the side follows the noun. The
      // reply itself is not part of the text that grounds the location.
      const word = sideWordIn(reply, side);
      const spoken =
        proposal.language === "es"
          ? `${proposal.location.spoken} ${word}`
          : `${word} ${proposal.location.spoken}`;
      // Its own clause: a "no mucho" or "not badly" ending the note must not
      // deny it. If it still does not ground, the old location stays.
      const location = mapLocation(
        spoken,
        side,
        `${proposal.transcript}\n${spoken}`,
      );
      if (location.status === "mapped") next.location = location;
    }
  } else if (key === "location") {
    const location = mapLocation(reply, "unspecified", reply);
    if (location.status === "mapped") next.location = location;
  }
  return next;
}

export function proposedRegion(proposal: PainProposal): RegionId | null {
  return proposal.location.status === "mapped"
    ? proposal.location.region
    : null;
}

export function describeLocation(
  location: LocationResult,
  lang: Language = "en",
) {
  switch (location.status) {
    case "mapped":
      return translate(lang, "extraction.location.mapped", {
        region: regionNameIn(lang, location.region),
        spoken: location.spoken,
      });
    case "missing":
      return translate(lang, "extraction.location.missing");
    case "need-side":
      return translate(lang, "extraction.location.needSide", {
        spoken: location.spoken,
      });
    case "ambiguous":
      return translate(lang, "extraction.location.ambiguous", {
        spoken: location.spoken,
      });
    default:
      return translate(lang, "extraction.location.unmapped", {
        spoken: location.spoken,
      });
  }
}

// Ticks fields the proposal newly suggests so they are not dropped on "Add to
// entry". A field that would replace a value already in the entry keeps the
// person's current choice. Fields they already saw keep their choice too.
export function seedSuggestedFields(
  choice: Record<string, boolean>,
  previous: DraftFields,
  next: DraftFields,
  existing: DraftFields,
): Record<string, boolean> {
  const seeded = { ...choice };
  for (const key of Object.keys(next) as (keyof DraftFields)[]) {
    if (key in previous) continue;
    const current = existing[key];
    if (current === undefined || current === null || current === "")
      seeded[key] = true;
  }
  return seeded;
}

// The confirm gate. Without an explicit confirmation the caller gets nothing
// to save; the proposal itself lives only in the voice panel's state.
export function confirmProposal(
  proposal: PainProposal,
  choice: {
    confirmed: boolean;
    fields: Partial<Record<keyof DraftFields, boolean>>;
    pin: boolean;
  },
): VoiceDraftValue {
  if (choice.confirmed !== true)
    throw new Error(translate(proposal.language, "extraction.confirmFirst"));
  const fields: DraftFields = {};
  for (const key of Object.keys(proposal.fields) as (keyof DraftFields)[])
    if (choice.fields[key])
      Object.assign(fields, { [key]: proposal.fields[key] });
  const region = proposedRegion(proposal);
  return {
    text: proposal.transcript,
    fields,
    ...(region ? { region, proposePin: choice.pin } : {}),
  };
}

// A proposed pin is drawn apart from saved pins and becomes a real pin only on
// an explicit confirm. Selecting another region or dismissing drops it.
export type ProposedPinAction =
  | { type: "propose"; region: RegionId }
  | { type: "confirm" }
  | { type: "dismiss" }
  | { type: "select"; region: RegionId | null };

export function proposedPinStep(
  state: RegionId | null,
  action: ProposedPinAction,
): { state: RegionId | null; command: "pin-center" | null } {
  switch (action.type) {
    case "propose":
      return { state: action.region, command: null };
    case "confirm":
      return { state: null, command: state ? "pin-center" : null };
    case "dismiss":
      return { state: null, command: null };
    case "select":
      return { state: action.region === state ? state : null, command: null };
  }
}
