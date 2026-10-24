import { regionNameIn, regions, type RegionId } from "../types.ts";
import { translate, type Language, type MessageKey } from "../i18n/index.ts";
import type {
  EvidenceExtraction,
  RawPainExtraction,
} from "../platform/on-device-ai.ts";
import type { DraftFields, VoiceDraftValue } from "./draft.ts";
import { verifyEvidence } from "./evidence.ts";

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
    /\bwrists?\b|\bhands?\b|\bfingers?\b|\bthumbs?\b|\bpalms?\b|\b(?:munecas?|manos?|pulgar(?:es)?)\b|\bdedos? de la mano\b|\bdedos? gordos? de la mano\b|\bpalmas? de la mano\b/,
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
    // "knee's" and "it's" compare as "knee" and "it". "o'clock" is not "'s".
    .replace(/'s\b/g, "")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export function partsIn(value: string): Part[] {
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

// Each body part named in the text, with the words that named it.
export function partMentions(value: string): { part: Part; text: string }[] {
  let rest = ` ${normalize(value)} `;
  const found: { part: Part; text: string }[] = [];
  for (const [part, pattern] of partWords) {
    const match = pattern.exec(rest);
    if (!match) continue;
    found.push({ part, text: match[0].trim() });
    rest = rest.replace(new RegExp(pattern.source, "g"), " ");
  }
  const back = bareBack.exec(rest);
  if (back) found.push({ part: "lower_back", text: back[1] });
  return found;
}

// "my back hurts" names a sore spot even though a bare "back" is not mapped to
// a region. "back at work", "my back to the wall" and "the back of my knee" do
// not.
const bareBack =
  /(?<!\b(?:sleep(?:s|ing)?|slept|lie|lies|lying|lay|laying|flat|duermo|dormir|duerme|acuesto|acostad[oa])\s+(?:on |in |en |sobre )?)\b(?:my|the|your|his|her|our|their|mi|la|su|tu)\s+(back|espalda)\b(?!\s+(?:of|to|at|home|then|from|up|in|on|off|door|seat|yard|porch|pocket|garden|side|de)\b)/;

const leftWords = /\b(?:left|izquierd[oa]s?)\b/;
const rightWords = /\b(?:right|derech[oa]s?)\b/;
// "derecho" after these is "straight" ("camino derecho", "voy derecho"), or
// the noun "right" ("tengo derecho"), not a side.
const straightWords =
  "todo|sig[ao]|sigue|seguir|camino|camina|caminar|caminas|caminamos|voy|va|vamos|ir|ando|corro|corre|correr|tengo|tiene";
const straightBefore = new RegExp(`^(?:${straightWords})$`);
const bothWords = /\b(?:both|ambos|ambas|los dos|las dos)\b/;
const sideDeterminer = new Set([
  "the",
  "on",
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
]);
const leftVerbSubject = new Set(["i", "we", "he", "she", "they", "you", "who"]);
const leftVerbPrev = new Set([
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
  "never",
  "still",
  "soon",
  "boss",
]);
const leftVerbNext = new Set([
  "because",
  "since",
  "early",
  "work",
  "home",
  "so",
  "after",
  "when",
  "while",
  "yesterday",
  "today",
  "last",
  "again",
  "already",
  "for",
  "from",
  "to",
  "at",
  "in",
]);
const verbSubject = new Set(["pain", "i", "we", "he", "she", "they", "it"]);

// "left" is a side when it modifies a part or a side word ("left knee",
// "the left", "left of my knee"). "I left the gym" and "left my brace" are
// the verb, and only then does the following determiner veto the side.
function leftIsSide(words: string[], index: number) {
  const prev = words[index - 1] ?? "";
  // "I left because my knee hurts": a pronoun before "left" makes it the verb.
  if (leftVerbSubject.has(prev)) return false;
  const next = words[index + 1] ?? "";
  if (next === "side" || next === "one") return true;
  if (sideDeterminer.has(prev)) return true;
  // "I just left because", "my boss left early": no pronoun before "left",
  // but what follows says it is the verb.
  // "still left knee hurts" and "I have left knee pain": a part right after
  // makes it a side.
  const after = words[index + 2] ?? "";
  const partNext =
    partsIn(next).length > 0 ||
    (!sideDeterminer.has(next) &&
      next !== "a" &&
      next !== "an" &&
      partsIn(`${next} ${after}`).length > 0);
  if ((leftVerbPrev.has(prev) && !partNext) || leftVerbNext.has(next))
    return false;
  if (sideDeterminer.has(next) || next === "a" || next === "an") return false;
  const ahead = words.slice(index + 1, index + 4);
  if (partsIn(ahead.join(" ")).length > 0) return true;
  return !next && !verbSubject.has(prev);
}

// "turn left", "turn to the right", "step to the left", "giro a la derecha":
// a direction of movement, not a side of the body. A side word followed by a
// body part ("turn my right knee") is still a side.
const motionVerb =
  /^(?:turn\w*|twist\w*|pivot\w*|swerv\w*|veer\w*|steer\w*|lean\w*|step\w*|go|goes|going|went|walk\w*|run|runs|running|ran|head\w*|look\w*|cut|cuts|cutting|curv\w*|swing\w*|rotat\w*|shift\w*|gir[aeo]\w*|dobl[aeo]\w*|vir[aeo]\w*|volte[aeo]\w*|tuerz\w*|tuerc\w*|inclin\w*|voy|vas|va|vamos|camin\w*|corr\w*|and[ao]\w*)$/;
const motionGap = new Set([
  // "turn left and right my knee hurts": both are directions.
  "left",
  "right",
  "izquierda",
  "derecha",
  "or",
  "o",
  "to",
  "the",
  "a",
  "la",
  "el",
  "al",
  "hacia",
  "toward",
  "towards",
  "and",
  "then",
  "y",
  "back",
  "over",
]);
const sideWord = (word: string) =>
  word === "left" || word === "right" || /^(?:izquierd|derech)/.test(word);
const toWord = /^(?:to|a|hasta|toward|towards|hacia)$/;
const dirDeterminer = new Set(["the", "la", "el", "al", "lado"]);
// "from left to right" and "de izquierda a derecha" name a direction, not a side.
function leftToRight(words: string[], index: number) {
  const skip = (at: number, step: number) => {
    while (dirDeterminer.has(words[at] ?? "")) at += step;
    return at;
  };
  const forward = skip(index + 1, 1);
  if (toWord.test(words[forward] ?? "")) {
    const other = words[skip(forward + 1, 1)] ?? "";
    if (sideWord(other) && other !== words[index]) return true;
  }
  const back = skip(index - 1, -1);
  if (toWord.test(words[back] ?? "")) {
    const other = words[skip(back - 1, -1)] ?? "";
    if (sideWord(other) && other !== words[index]) return true;
  }
  return false;
}
function isDirection(words: string[], index: number) {
  const next = words[index + 1] ?? "";
  const after = words[index + 2] ?? "";
  if (leftToRight(words, index)) return true;
  if (partsIn(next).length > 0) return false;
  if (!sideDeterminer.has(next) && partsIn(`${next} ${after}`).length > 0)
    return false;
  if (next === "one") return false;
  if (next === "side" && /^(?:of|de|del)$/.test(after)) return false;
  let cursor = index - 1;
  while (cursor >= 0 && cursor > index - 9 && motionGap.has(words[cursor]))
    cursor -= 1;
  return cursor >= 0 && cursor > index - 10 && motionVerb.test(words[cursor]);
}

const rightPlace = new Set([
  "into",
  "onto",
  "through",
  "across",
  "along",
  "toward",
  "towards",
  "up",
  "down",
  "where",
  "here",
  "there",
  "at",
  "on",
  "in",
  "above",
  "below",
  "under",
  "over",
  "behind",
  "beside",
  "near",
  "around",
  "by",
  "inside",
  "beneath",
  "underneath",
]);
const sideLead = new Set([
  "the",
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
  "a",
  "an",
  "on",
  "to",
  "this",
  "that",
  "el",
  "la",
]);
// One token's side, or null when this spot is an idiom or the verb "left".
// "right now", "all right" and "todo derecho" are not sides.
export function sideAt(
  words: string[],
  index: number,
): "left" | "right" | null {
  const word = words[index] ?? "";
  const prev = words[index - 1] ?? "";
  const next = words[index + 1] ?? "";
  if (
    (word === "left" ||
      word === "right" ||
      /^izquierd/.test(word) ||
      /^derech/.test(word)) &&
    isDirection(words, index)
  )
    return null;
  if (word === "left") return leftIsSide(words, index) ? "left" : null;
  if (/^izquierd/.test(word)) return "left";
  if (word === "right") {
    if (next === "now" || next === "away" || next === "after") return null;
    if (prev === "all") return null;
    // "it hurts right at my left knee": "right" means exactly there.
    if (rightPlace.has(next) && !sideLead.has(prev)) return null;
    return "right";
  }
  if (/^derech/.test(word)) {
    if (straightBefore.test(prev)) return null;
    return "right";
  }
  return null;
}

// A side counts only when the person said it. "right now" and "todo derecho"
// are not sides.
export function sideIn(value: string): "left" | "right" | "both" | null {
  const words = phraseTokens(value);
  const text = words.join(" ");
  let left = false;
  let right = false;
  for (let index = 0; index < words.length; index++) {
    const side = sideAt(words, index);
    if (side === "left") left = true;
    if (side === "right") right = true;
  }
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
        // "not sure, the left" and "no sé, la derecha" hedge; they do not deny.
        .replace(
          /\b(?:(?:i ?m|i am) )?not (?:really |that |very |entirely )?(?:sure|certain)\b/g,
          " ",
        )
        .replace(/\b(?:i )?(?:do not|don'?t|dont) know\b/g, " ")
        .replace(/\bno (?:se|estoy (?:muy |del todo )?segur[oa])\b/g, " ")
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
  "nopuede",
  "nopuedes",
  "nopueden",
  "nopuedan",
  "nopude",
  "nopudo",
  "nopodia",
  "nopodian",
  "nopodemos",
  "nopodria",
  "nopodrian",
  "nopodrias",
  "nopodias",
  "nopodriamos",
  "nopodiamos",
  "nopudieron",
  "nopudiste",
  "nopudimos",
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
  "nopuede",
  "nopuedes",
  "nopueden",
  "nopuedan",
  "nopude",
  "nopudo",
  "nopodia",
  "nopodian",
  "nopodemos",
  "nopodria",
  "nopodrian",
  "nopodrias",
  "nopodias",
  "nopodriamos",
  "nopodiamos",
  "nopudieron",
  "nopudiste",
  "nopudimos",
]);
// "no puedo" is rewritten to one token. It denies a quality, an activity or a
// rating, and it does not deny the body part ("no puedo doblar la rodilla").
for (const word of ["nopuedo", "nopude", "nopodia"]) negators.add(word);
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
const doubtVerbs = new Set([
  "tell",
  "say",
  "know",
  "sure",
  "decir",
  "saber",
  "seguro",
  "segura",
]);
// "doesn't hurt", "isn't sore" and "no me duele" deny the part when the tail
// after the hurt word is empty or only a time word, or is exactly "at all",
// "a bit", "anymore", "ya" (optionally followed by a time word). "doesn't hurt
// much", "doesn't hurt a bit more", "doesn't hurt anymore than yesterday" and
// "no me duele ya tanto" still say it hurts, and so does a correcting next
// clause: "isn't sore, it's aching".
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
  "dolia",
  "dolian",
  "dolio",
  "molestaba",
  "molestaban",
  "dolor",
  "dolores",
  "molestia",
  "molestias",
]);
// "no dolía ayer": the Spanish imperfect says how it was.
const pastHurt = new Set([
  "dolia",
  "dolian",
  "dolio",
  "molestaba",
  "molestaban",
]);
const painNouns = new Set(["dolor", "dolores", "molestia", "molestias"]);
// "no tiene mucho dolor" hedges before the noun.
const nounHedges = new Set([
  "mucho",
  "tanto",
  "tan",
  "muy",
  "demasiado",
  "much",
  "so",
  "too",
  "really",
]);
// "no es un dolor fuerte" says how strong it is, not that nothing hurts.
const painAdjectives = new Set([
  "fuerte",
  "fuertes",
  "grave",
  "graves",
  "intenso",
  "intensa",
  "intensos",
  "intensas",
  "serio",
  "seria",
  "serios",
  "serias",
  "terrible",
  "terribles",
]);
const timeWords = new Set([
  "today",
  "now",
  "tonight",
  "yesterday",
  "tomorrow",
  "earlier",
  "still",
  "hoy",
  "ahora",
  "ayer",
  "anoche",
  "todavia",
  "manana",
]);
const pastNegators =
  /^(?:didn't|didnt|wasn't|wasnt|weren't|werent|hadn't|hadnt)$/;
const pastMarkers = new Set(["earlier", "yesterday", "ayer", "anoche"]);
const denialTail =
  /^(?:at all|para nada|en absoluto|nada|a bit|anymore|any more|ya|all (?:day|week|month|morning|night|year)|lately|recently|so far)$/;
const contextTail =
  /^(?:at |when |while |during |if |on |en |cuando |mientras |al |durante |si )/;
const unlessWords = new Set(["unless"]);
const stopWords = new Set([
  "stop",
  "stopped",
  "stops",
  "cease",
  "ceased",
  "quit",
  "deja",
  "dejo",
  "dejado",
  "dejan",
  "dejaron",
]);
function deniesAfter(
  words: string[],
  end: number,
  corrected: boolean,
  current = false,
) {
  const next = words.slice(end + 1, end + 6);
  const at = next.findIndex(isNegator);
  if (at < 0 || at >= 3) return false;
  // The negator and hurt word are found nearby, but the tail is everything
  // left in the phrase: "has not been hurting at all" ends in "at all".
  const rest = next.slice(at + 1);
  if (rest.some((word) => deniedAfter.has(word))) return true;
  const hurt = rest.findIndex((word) => hurtWords.has(word));
  if (hurt < 0 || corrected) return false;
  // "hasn't stopped hurting" and "no deja de doler" say it still hurts.
  if (rest.slice(0, hurt).some((word) => stopWords.has(word))) return false;
  if (painNouns.has(rest[hurt]) && nounHedges.has(rest[hurt - 1] ?? ""))
    return false;
  if (painNouns.has(rest[hurt]) && painAdjectives.has(rest[hurt + 1] ?? ""))
    return false;
  const tail = words.slice(end + 1 + at + 1 + hurt + 1);
  const popped: string[] = [];
  while (tail.length && timeWords.has(tail[tail.length - 1]))
    popped.push(tail.pop() as string);
  // "didn't hurt earlier" says how it was, not how it is now.
  const negator = next[at];
  const pastNegation =
    pastNegators.test(negator) ||
    (negator === "not" && /^(?:did|was|were|had)$/.test(next[at - 1] ?? "")) ||
    pastHurt.has(rest[hurt]);
  // It only grounds the part when something later says it hurts now.
  if (pastNegation && popped.some((word) => pastMarkers.has(word)))
    return !current;
  if (!tail.length || denialTail.test(tail.join(" "))) return true;
  // "doesn't hurt at rest" or "when I walk" says when it does not hurt. That
  // is still no pain reported, unless the same phrase goes on to say it hurts.
  // A later "but it hurts when I run" is that report.
  return (
    !current &&
    contextTail.test(tail.join(" ")) &&
    !tail.some((word) => unlessWords.has(word)) &&
    !/\b(?:a menos que|salvo que)\b/.test(tail.join(" ")) &&
    !tail.some((word) => hurtWords.has(word) || isNegator(word))
  );
}

// Spanish idioms that look like denials but are not: "nada mas" and "no mas"
// mean "only" in Mexico ("me duele nada mas la rodilla"), "sin duda" means
// "certainly". "ya no mas" (no longer) stays a denial. "no puedo" is ability.
const idioms = (text: string) =>
  text
    .replace(/\b(?<!ya )(?:nada|no) mas\b/g, "solo")
    .replace(/\bsin (?:duda|embargo)\b/g, "seguro")
    // "no puede estar la rodilla" denies the part; "no puede estar de pie por
    // la rodilla" is ability.
    .replace(
      /\bno (?:puede|pueden|podria|podrian) ser(?= (?:en |por |debido a |a causa de |por culpa de )?(?:mi|mis|la|el|las|los|su|sus|tu|tus|un|una)\b)/g,
      "no es",
    )
    .replace(
      /\bno (?:puede|pueden|podria|podrian) estar(?= (?:en )?(?:mi|mis|la|el|las|los|su|sus|tu|tus|un|una)\b)/g,
      "no esta",
    )
    .replace(
      /\bno (pued[oe]s?|pueden|puedan|pude|pudo|pudiste|pudieron|pudimos|podias?|podian|podemos|podr(?:ia|ian|ias|iamos)|podiamos)\b/g,
      "no$1",
    );

// "is fine" and "esta bien" clear a part. "is not fine" and "no esta bien" do not.
const fineWords = new Set(["fine", "okay", "ok", "alright", "bien"]);
// "bien" before an adjective means "very" ("esta bien fuerte"), so it only
// clears at the end of the phrase or before "ya", "ahora" and the like.
const bienEnds = new Set([
  "ya",
  "ahora",
  "hoy",
  "y",
  "pero",
  "gracias",
  "desde",
  "despues",
  "otra",
]);
function fineAfter(words: string[], end: number) {
  const next = words.slice(end + 1, end + 5);
  const at = next.findIndex((word) => fineWords.has(word));
  if (at < 0) return false;
  if (next[at] === "bien" && next[at + 1] && !bienEnds.has(next[at + 1]))
    return false;
  const lead = next.slice(0, at);
  if (lead.some((word) => denies(word))) return false;
  return true;
}

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

// Span checks keep the note's words. Denial checks rewrite "nada mas",
// "no mas", "sin duda" and "no puedo" first.
export const phraseTokens = (text: string) =>
  normalize(text).split(" ").filter(Boolean);
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
const beFiller = new Set([
  "in",
  "on",
  "my",
  "the",
  "his",
  "her",
  "their",
  "our",
  "your",
  "this",
  "that",
  "a",
  "an",
  "of",
  "left",
  "right",
  "both",
  "one",
]);
const beCause =
  /^(?:because of|because|from|due to|owing to|on account of)(?= |$)/;
// "no me duele la rodilla cuando camino pero me duele cuando corro": a denial
// that only says when it does not hurt is not one when a later phrase says it
// hurts.
const stillHurtsBefore =
  /\bno se (?:me )?(?:ha |han )?(?:quito|quitado|paso|pasado|fue|ido|va|quita|pasa)\b|\bno (?:ha |han )?(?:dejado|deja|dejo|dejan) de\b/;
function deniedBefore(
  words: string[],
  at: number,
  part: boolean,
  current: boolean,
  needed: string[],
) {
  const before = words.slice(0, at);
  if (!before.some((word) => denies(word, part))) return false;
  // "no se me quito el dolor de la rodilla" says it is still there.
  if (stillHurtsBefore.test(before.join(" "))) return false;
  const after = words.slice(at + 1);
  while (after.length && needed.some((want) => matches(after[0], want)))
    after.shift();
  return !(
    current &&
    before.some((word) => hurtWords.has(word)) &&
    contextTail.test(after.join(" ")) &&
    !after.some((word) => hurtWords.has(word) || isNegator(word))
  );
}
function covers(
  words: string[],
  needed: string[],
  part = false,
  corrected = false,
  current = false,
) {
  // "it can't be my left knee", "can't be in my left knee" and "can't be on my
  // left knee" deny the part. "can't be walking" and "can't be at work because
  // of my left knee" are ability: only a bare run of articles, sides and "in"
  // or "on" between "be" and the part makes it a denial.
  words = words.map((word, i) => {
    if (!ability.has(word) || words[i + 1] !== "be") return word;
    let next = i + 2;
    // "it can't be because of my left knee" says the knee is not the cause.
    const cause = beCause.exec(words.slice(next, next + 3).join(" "));
    if (cause) next += cause[0].split(" ").length;
    while (beFiller.has(words[next] ?? "")) next++;
    const said = words[next];
    return said !== undefined &&
      !/ing$/.test(said) &&
      needed.some((want) => matches(said, want))
      ? "isn't"
      : word;
  });
  let last = -1;
  const found = needed.every((want) => {
    const at = words.findIndex((said) => matches(said, want));
    last = Math.max(last, at);
    return at >= 0 && !deniedBefore(words, at, part, current, needed);
  });
  if (!found || deniesAfter(words, last, corrected, current)) return false;
  // "I can't tell if my left knee is the problem" still denies it, but "I
  // can't walk because my left knee is the problem" does not.
  const before = words.slice(0, last);
  const exempt = before.some(
    (word, i) =>
      ability.has(word) &&
      before.slice(i + 1, i + 3).some((next) => doubtVerbs.has(next)),
  );
  if (exempt && words.slice(last + 1).some((w) => deniedAfter.has(w)))
    return false;
  // "está bien" can sit inside the quoted span. Clear from the part itself,
  // not only from the last quoted word.
  const cleared =
    part &&
    needed.some((want) => {
      const at = words.findIndex((said) => matches(said, want));
      return at >= 0 && fineAfter(words, at);
    });
  return !cleared;
}

// "nothing hurts except the knee" affirms the knee. "everything hurts except
// the knee" denies it. "nada más" is rewritten earlier and is not this split.
const exceptWord = /^(?:except|excepto|salvo)$/;
const noneWord = new Set(["nothing", "none", "nada"]);

function exceptSides(
  clause: string,
): { affirmed: string[]; denied: string[] } | null {
  const words = tokens(clause);
  const at = words.findIndex((word) => exceptWord.test(word));
  if (at < 0) return null;
  const left = words.slice(0, at);
  const right = words.slice(at + 1);
  if (!right.length) return null;
  if (left.some((word) => noneWord.has(word)))
    return { affirmed: right, denied: left };
  return { affirmed: left, denied: right };
}

// The pain went away, so no body part in that phrase is current. "I left my
// brace and my knee hurts" is a different phrase and still counts.
const bodyWord =
  "(?:knee|leg|foot|feet|ankle|hip|shoulder|arm|hand|wrist|elbow|side|calf|thigh|heel|toe|back|neck|chest|head|hamstring|shin)";
// "the pain has gone down into my knee" and "the pain is over here" move or
// place the pain. They do not end it.
const placeAfter =
  "(?! (?:down|into|to|up|through|from|over|on|in|out|around|across|toward|towards|onto|under|there|here|by|near|where|along|up|at)\\b)";
const notPainSubject =
  "(?: (?!(?:i|we|he|she|they|you|so|because|and|but)\\b)[a-z']+){0,5}";
function painGone(words: string[]) {
  // "hasn't stopped hurting" and "no se me quito el dolor" say it is still
  // there.
  if (words.some(isNegator)) return false;
  const text = words.join(" ");
  return (
    new RegExp(`\\bpain left\\b(?! ${bodyWord}\\b)`).test(text) ||
    new RegExp(
      `\\bpain (?:is|was|has been|has|been) gone\\b${placeAfter}`,
    ).test(text) ||
    /\bpain went away\b/.test(text) ||
    /\bdolor (?:se fue|ya paso|paso)\b/.test(text) ||
    // "my knee stopped hurting", "the pain in my knee is gone",
    // "se me quito el dolor", "dejo de doler". A bare "se quito" can be a
    // jacket.
    /\b(?:stopped|ceased|quit) (?:hurting|aching)\b/.test(text) ||
    new RegExp(
      `\\b(?:pain|ache|soreness)\\b${notPainSubject} (?:is|was|has been|has|been|went|had gone|has gone) (?:gone|away)\\b${placeAfter}`,
    ).test(text) ||
    new RegExp(
      `\\b(?:pain|ache|soreness) (?:disappeared|vanished|subsided|cleared up|is over)\\b${placeAfter}`,
    ).test(text) ||
    /\b(?:dejo de doler(?:me)?|se (?:me )?(?:quito|paso)(?: (?:el|la) (?:dolor|molestia)| por completo| del todo| por fin)|ya paso el dolor|el dolor (?:ya )?(?:se )?(?:fue|paso|quito)|(?:dolor|molestia) (?:\w+ )?desaparecio)\b/.test(
      text,
    ) ||
    /\bdesaparecio (?:el )?(?:dolor|molestia)\b/.test(text)
  );
}

// A phrase that says the pain is there now: "it hurts today", "but now it
// does". "didn't hurt yesterday" alone is not a current pain.
const currentWords = new Set([
  "now",
  "today",
  "tonight",
  "currently",
  "still",
  "then",
  "hoy",
  "ahora",
  "actualmente",
  "todavia",
  "aun",
  "luego",
  "despues",
]);
const reviveFiller = new Set([
  "it",
  "that",
  "this",
  "the",
  "pain",
  "again",
  "really",
  "very",
  "so",
  "just",
  "also",
  "too",
  "already",
  "me",
  "lo",
  "le",
  "se",
  "otra",
  "vez",
  "ya",
  "tambien",
  "dolor",
]);
const reaffirms = new Set(["does", "do", "is", "are", "si", "yes"]);
// A later phrase brings back a denied part only when it is about that part
// ("my left knee hurts now"), or about nothing in particular and says it
// hurts ("it hurts today", "but now it does"). "Then I went home", "hoy
// camine" and "my back hurts" do not.
const painVerbs = new Set([
  "ache",
  "aches",
  "aching",
  "throbs",
  "throbbing",
  "stings",
  "burns",
]);
function revives(words: string[], needed: string[]) {
  if (words.some(isNegator)) return false;
  const hurt = words.some((word) => hurtWords.has(word) || painVerbs.has(word));
  const now = words.some((word) => currentWords.has(word));
  const said = partsIn(words.join(" "));
  if (said.length) {
    const wanted = partsIn(needed.join(" "));
    return wanted.some((part) => said.includes(part)) && (hurt || now);
  }
  // Only a pronoun or filler may stand before "hurts": "my back hurts" names
  // something else.
  const lead = words.findIndex(
    (word) => hurtWords.has(word) || painVerbs.has(word),
  );
  const plain = (lead < 0 ? words : words.slice(0, lead)).every(
    (word) =>
      reviveFiller.has(word) || currentWords.has(word) || reaffirms.has(word),
  );
  return plain && (hurt || (now && words.some((word) => reaffirms.has(word))));
}

// A phrase that says something hurts and does not deny it.
export const saysHurt = (clause: string) => {
  const words = tokens(clause);
  return words.some((word) => hurtWords.has(word)) && !words.some(isNegator);
};

// With `together`, the words must share one conjunction-free part, so "my
// left knee and right foot" does not ground "left foot". Without it, words
// joined only by conjunctions still count ("left knee and ankle"), as long as
// none comes from a denied part. `part` marks the body-part check, where
// ability negators ("can't bend", "no puedo doblar") do not deny it.
const recoveredNow =
  /^(?:but |pero )?(?:ahora |now )?(?:(?:it(?: is)?|its|ya esta|esta|ya) (?:(?:fine|ok|okay|healed|gone|curad[oa]|sano)\b|bien(?=$| (?:ya|ahora|hoy|y|pero|gracias|desde|despues|otra)\b))|not (?:hurting )?(?:now|today|anymore)\b|no (?:me )?(?:duele|dolor) (?:hoy|ahora)\b)/;
function clauseGrounds(
  clause: string,
  needed: string[],
  together: boolean,
  part: boolean,
  corrected: boolean,
  current = false,
) {
  const split = exceptSides(clause);
  if (split) {
    const onAffirmed = covers(split.affirmed, needed, part);
    const onDenied = needed.every((want) =>
      split.denied.some((said) => matches(said, want)),
    );
    // A word that sits on the except boundary stays on that side.
    if (onAffirmed || onDenied) return onAffirmed && !onDenied;
  }
  // "my knee stopped hurting but it still hurts" brings the pain back.
  const all = softParts(clause);
  const soft = all.filter(
    (words, i) =>
      !(
        together &&
        painGone(words) &&
        !all.slice(i + 1).some((later) => revives(later, needed))
      ),
  );
  // "my left knee didn't hurt yesterday and it doesn't hurt today": the first
  // part only says how it was, and the second says it is not hurting now.
  if (
    !corrected &&
    soft.some(
      (words, i) =>
        words.some((word) => pastMarkers.has(word)) &&
        soft
          .slice(i + 1)
          .some(
            (next) =>
              partsIn(next.join(" ")).length === 0 &&
              next.some(
                (word) => isNegator(word) && !pastNegators.test(word),
              ) &&
              (next.includes("tampoco") ||
                next.some((word) => hurtWords.has(word))),
          ),
    )
  )
    return false;
  // "my left knee hurt yesterday but it's fine now": it hurt, and now it is
  // not hurting.
  if (
    !corrected &&
    soft.some(
      (words, i) =>
        words.some((word) => pastMarkers.has(word)) &&
        !words.some(isNegator) &&
        soft
          .slice(i + 1)
          .some(
            (next) =>
              partsIn(next.join(" ")).length === 0 &&
              recoveredNow.test(next.join(" ")),
          ),
    )
  )
    return false;
  if (
    soft.some((words, i) =>
      covers(
        words,
        needed,
        part,
        corrected,
        current || soft.slice(i + 1).some((later) => revives(later, needed)),
      ),
    )
  )
    return true;
  if (together) return false;
  const affirmative = soft.filter((words) => !words.some(isNegator));
  return covers(affirmative.flat(), needed, false, corrected);
}

// "isn't sore, it's aching" / "no duele, es un ardor": a next clause that starts "it's ..." describes the
// pain instead. "it's fine", "it's gone" and "it's not" clear it further.
const clearing =
  /^(?:(?:fine|ok|okay|alright|gone|resolved|healed|nothing|not|no|nada)\b|bien(?=$| (?:ya|ahora|hoy|y|pero|gracias|desde|despues|otra)\b))|^(?:over|stopped|finished|done)(?: now| already)?(?: hurting)?(?: now| already| for (?:today|now|the day))?$|^(?:good|better|great|mejor)\b(?! (?:pain|than|que))|^(?:ya (?:no(?: me| se me)? (?:duele|duelen|molesta|molestan|siento|hay|tengo|aparece|sale)\b|no$|paso|termino|se (?:me )?(?:quito|paso|fue|acabo|calmo|curo|alivio)\b)|se (?:me )?(?:quito|paso|fue|acabo)|paso$|termino$|(?:ya |todavia |aun )?esta (?:mejor\b(?! que)|bien(?=$| (?:ya|ahora|hoy|y|pero|gracias|desde|despues|otra)\b))|(?:todavia |aun )?sigue (?:bien(?=$| (?:ya|ahora|hoy|y|pero|gracias|desde|despues|otra)\b)|(?:mejor|sin)\b))/;
// "it's not gone" and "it's not better" say the pain is still there, and so do
// "no se ha ido", "no está mejor" and "todavía sigue".
const stillThere =
  /^(?:not|no) (?:gone|over|better|good|great|fine|ok|okay|resolved|healed|finished|done|stopped|improved)\b|^no (?:se (?:me )?(?:ha |han )?(?:ido|quitado|pasado|quita|pasa|va)|esta mejor|ha (?:mejorado|pasado)|mejoro)\b|^no esta bien\b|^ya no (?:se (?:me )?)?(?:quita|pasa|va|mejora|calma|baja|alivia)\b|^(?:todavia|aun) (?:sigue(?! (?:bien|mejor|sin)\b)|esta(?! (?:mejor|bien)\b)|me)\b|^sigue\b(?! (?:bien|mejor|sin)\b)/;
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
    clauseGrounds(
      clause,
      needed,
      together,
      part,
      // "isn't sore, it's aching": the next clause corrects the denial.
      corrects(said[i + 1] ?? ""),
      said
        .slice(i + 1)
        .some((later) =>
          softParts(later).some((words) => revives(words, needed)),
        ),
    ),
  );
}

// The span must occur in the transcript as consecutive words, ignoring case,
// accents and plural endings. A location stitched together from words said in
// different places does not count.
// Token range of an exact contiguous span, or null. Plural endings match.
export function findSpan(value: string, transcript: string) {
  const span = phraseTokens(value);
  const said = phraseTokens(transcript);
  if (!span.length) return null;
  for (let start = 0; start + span.length <= said.length; start++)
    if (span.every((word, i) => matches(word, said[start + i])))
      return { start, end: start + span.length };
  return null;
}

export function spanIn(value: string, transcript: string) {
  return findSpan(value, transcript) !== null;
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
  | { status: "need-side"; spoken: string; part: Part }
  | { status: "both"; spoken: string; side: "both" };

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
    // "Both knees" and "las dos rodillas" have no single region.
    if (sideIn(words) === "both")
      return { status: "both", spoken: words, side: "both" };
    // A side counts only when the person said it.
    // The model's side is used only when the note names this one part and
    // says that side without denying it. "me duele la rodilla. La mano
    // izquierda esta bien" asks which knee.
    // "right at my knee" and "left work" are not sides.
    const loose = tokens(words).some(
      (word, i, all) =>
        (word === "left" || word === "right") &&
        notModifiers.has(all[i + 1] ?? ""),
    );
    // The same words can be a direction in the note: "from left to the right
    // knee" is where it moves, not which knee.
    const said = phraseTokens(transcript);
    const at = findSpan(words, transcript);
    const sayable = (found: "left" | "right" | "both" | null) =>
      found === "both" ||
      !at ||
      range(at.start, at.end).some((i) => sideAt(said, i) === found)
        ? found
        : null;
    const stated =
      (loose ? null : sayable(sideIn(words))) ??
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
    if (
      side === "both" &&
      sideIn(transcript) === "both" &&
      partsIn(transcript).length === 1
    )
      return { status: "both", spoken: words, side: "both" };
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
  /\b(?:about|around|maybe|roughly|a|an|(?:i'?m|i am|estoy) (?:at|en)(?: a| un)?|(?:pain|it|it's|its|that|rating|level|intensity) (?:is|was)|rate|rated|rated it|rating|level|pain|intensity|un|una|(?:dolor|intensidad|nivel|calificacion) (?:es|era|esta|estaba|de)|nivel|intensidad|calificacion|doy|daria|le doy|le daria)$/;
const ratingAfter =
  /^(?:out of (?:10|ten)|of (?:10|ten)|(?:de|sobre) (?:10|diez))(?: (.*))?$/;
const notRatingAfter =
  /^(?:minutes?|hours?|days?|weeks?|months?|years?|times?|miles?|km|sets?|reps?|laps?|games?|people|places?|spots?|fingers?|toes?|am|pm|a m|p m|o'clock|oclock|minutos?|horas?|dias?|semanas?|meses|mes|anos?|veces|vez|kilometros?|partidos?|series|vueltas?|sitios?|lugares|partes|dedos?|personas|feet|foot|ft|inch|inches|lbs?|pounds?|de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)|de la (?:manana|tarde|noche)|en punto|blocks?|steps?|flights?|yards?|met(?:er|re)s?|pills?|doses?|tablets?|cups?|glasses|in the (?:morning|afternoon|evening)|of may|may(?= \d|$)|(?:of )?(?:january|february|march|april|june|july|august|september|october|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre))\b/;
// "October 7", "May 7" and "mayo 7" name a date, not a rating.
const monthBefore =
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)$/;
// A bare "about 7" or "around seven" is a rating only when nothing follows
// it but a hedge: "around seven in the morning" is a time.
// "May 7 or 8", "7 or 8 of May" and "7 u 8 de mayo" are dates, not ratings.
const monthName =
  "january|february|march|april|may|june|july|august|september|october|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";
const dayJoin = "\\s+(?:or|and|to|through|y|o|u|al?)\\s+";
const dayOne = "\\d{1,2}";
const dayList = `${dayOne}(?:${dayJoin}${dayOne})*`;
// Two or more days are always a date ("May 7 or 8 out of 10"). One day stays a
// rating when a scale follows ("May 7 out of 10").
const dayMany = `${dayOne}(?:${dayJoin}${dayOne})+`;
const scaleAfter = "(?!\\s*(?:/|out of|(?:of|de|sobre) (?:10|ten|diez)))";
// "7 or 8 May" is a date, but "may" also a verb: it counts only at the end of
// the phrase.
const mayEnds = "(?=\\s*(?:$|[,.;!?]|(?:and|but|or|then|so|y|pero)\\b))";
const dateRange = new RegExp(
  `\\b(?:${monthName})\\s+(?:${dayMany}\\b|${dayOne}\\b${scaleAfter})|\\b${dayList}\\s+(?:(?:of |de )(?:${monthName})|(?:${monthName.replace("|may|", "|")})|may${mayEnds})\\b`,
  "gi",
);
const withoutDates = (text: string) => text.replace(dateRange, " ");
const genericBefore =
  /\b(?:about|around|maybe|roughly|(?:i'?m|i am|estoy) (?:at|en)(?: a| un)?)$/;
// "I'm at 7 when I walk" and "I'm at 7 when I wake up" say how bad it gets.
const imAt = /\b(?:i'?m|i am|estoy) (?:at|en)(?: a| un)?$/;
const whenTail = /^(?:when|while|during|if|cuando|mientras|al|durante|si)\b/;
const genericAfter =
  /^(?:|or so|ish|i guess|i think|now|today|right now|at (?:most|worst|best)|at the moment|aproximadamente|mas o menos|creo|ahora|ahorita|hoy)$/;
// A prompt telling the model to set a number is not a rating the person gave.
const instructed =
  /\b(?:ignore|instructions?|prompt|system|pon|coloca|establece|cambia|set)\b/;

// "on the 7/10", "since 7/10": the number is a date, not a rating.
const dateLead =
  /\b(?:on|since|from|until|till|by|before|after|started|dated|as of|desde|del|hasta|para)(?:\s+(?:the|a|an))?$/;

export function ratedIn(transcript: string, value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 10) return false;
  const number = new RegExp(
    `^(?:${value}|${numberWords[value]}|${spanishNumbers[value]})$`,
  );
  for (const clause of clauses(withoutDates(transcript))) {
    // "7/10" is one rating; the slash would otherwise split it. A date such
    // as "on 7/10", "el 7/10" or "7/10/26" is not.
    const slash = clause.match(
      new RegExp(`(?:^|[^0-9/])${value}\\s*/\\s*10\\b(?!\\s*/)`),
    );
    const slashed = new RegExp(`(?:^|[^0-9/])${value}\\s*/\\s*10\\b`).test(
      clause,
    );
    if (slash) {
      const afterSlash = normalize(
        clause.slice(slash.index! + slash[0].length),
      );
      const before = tokens(clause.slice(0, slash.index! + 1));
      const last = before[before.length - 1];
      const tail = tokens(
        clause.slice(slash.index! + slash[0].length).replace(/^\s*\/?/, ""),
      ).join(" ");
      // "le doy el 7/10" rates the pain; "el 7/10" alone is a date.
      const rated =
        !dateLead.test(before.join(" ")) &&
        (last === "el"
          ? /\b(?:doy|daria|pongo|pondria|es|era|seria|sera|dolor|nivel)$/.test(
              before.slice(0, -1).join(" "),
            )
          : !["on", "since", "desde", "del"].includes(last));
      if (
        !notRatingAfter.test(afterSlash) &&
        !before.some(isNegator) &&
        !instructed.test(before.join(" ")) &&
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
        // The "7" of "7/10" was judged above, with the unit after it.
        if (slashed && /^10\b/.test(after)) continue;
        if (
          before.some(isNegator) ||
          instructed.test(before.join(" ")) ||
          notRatingAfter.test(after)
        )
          continue;
        const scale = after.match(ratingAfter);
        // "3 out of 10 days" counts days, not pain.
        if (scale) {
          if (!notRatingAfter.test(scale[1] ?? "")) return true;
          continue;
        }
        const lead = before.join(" ");
        if (monthBefore.test(lead)) continue;
        if (
          genericBefore.test(lead) &&
          !genericAfter.test(after) &&
          !(imAt.test(lead) && whenTail.test(after))
        )
          continue;
        if (ratingBefore.test(lead)) return true;
      }
  }
  return false;
}

export function parseIntensityAnswer(answer: string): number | null {
  answer = withoutDates(answer);
  const normalized = idioms(normalize(answer));
  // "not a 7 but an 8" keeps 8. "7 but not 8" keeps 7. "not seven" stays blank.
  const but = normalized.match(/^(.*?)\b(?:but|sino)\b(.*)$/);
  const text = but
    ? (but[1].split(" ").some(isNegator) ? but[2] : but[1]).trim()
    : normalized;
  if (text.split(" ").some(isNegator)) return null;
  const folded = answer.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  // The same "but" split, on the text that still has its slashes.
  const foldedBut = folded.match(/^(.*?)\b(?:but|sino)\b(.*)$/);
  const lower =
    but && foldedBut
      ? (but[1].split(" ").some(isNegator) ? foldedBut[2] : foldedBut[1]).trim()
      : folded;
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
      dateLead.test(before) ||
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
        (/\b(?:i'?m|i am) at(?: a)?$/.test(bare.slice(0, match.index).trim()) ||
          !/\b(?:age|aged|edad|tengo|tiene|tienes|tuve|las|los|dia|day|at)$/.test(
            bare.slice(0, match.index).trim(),
          )) &&
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
const futureOnset =
  /\b(?:next|upcoming|this coming|tomorrow|proximo|siguiente|que viene)\b|(?<!\b(?:esta|la|una|de la|por la|en la|de) )\bmanana\b/;

// "Next Monday" and "el próximo lunes" are not a past start.
export function isFutureOnset(phrase: string) {
  return futureOnset.test(normalize(phrase));
}

export function resolveOnset(
  phrase: string,
  today: string,
): { phrase: string; date?: string } {
  const text = normalize(phrase);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return { phrase };
  // "A week ago tomorrow" is counted from the offset, not read as future.
  if (isFutureOnset(phrase) && !/\b(?:ago|hace)\b/.test(text))
    return { phrase };
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
    // "hizo" counts days only after a day word: "ayer hizo una semana".
    // "hizo ejercicio dos dias" and "hizo dos dias de reposo" are not dates.
    if (
      ago[0].startsWith("hizo") &&
      !/\b(?:ayer|anteayer|antier|anoche|hoy)(?: (?:por|en|de) la (?:manana|tarde|noche))?$/.test(
        lead,
      )
    )
      return { phrase };
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
  transcript: string,
  lang: Language,
): FollowUp | null {
  // At most one question, and only about where. Optional fields stay blank.
  if (location.status === "both") return null;
  if (location.status === "missing")
    return {
      key: "location",
      question: translate(lang, "extraction.ask.location"),
    };
  // A named part that is not on the map already answered where.
  if (location.status === "unmapped") {
    if (spanIn(location.spoken, transcript)) return null;
    return {
      key: "location",
      question: translate(lang, "extraction.ask.location"),
    };
  }
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
  return null;
}

// Keeps the person's word, accents included, for display.
export const displayPhrase = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' -]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

function proposalFromEvidence(
  evidence: EvidenceExtraction,
  transcript: string,
  today: string,
  lang: Language,
): PainProposal {
  const verified = verifyEvidence(evidence, transcript, today);
  const fields: DraftFields = {};
  if (verified.qualities.length) fields.quality = verified.qualities.join(", ");
  if (verified.intensity !== null) fields.intensity = verified.intensity;
  if (verified.activity) fields.activity = verified.activity;
  const onset = verified.onset ?? undefined;
  if (onset) {
    fields.duration = onset.date
      ? translate(lang, "extraction.sinceDate", {
          phrase: onset.phrase,
          date: onset.date,
        })
      : translate(lang, "extraction.since", { phrase: onset.phrase });
  }
  return {
    transcript,
    location: verified.location,
    fields,
    onset,
    followUp: followUpFor(verified.location, transcript, lang),
    asked: false,
    language: lang,
  };
}

export function buildProposal(
  raw: RawPainExtraction,
  transcript: string,
  today: string,
  lang: Language = "en",
): PainProposal {
  if (raw.evidence)
    return proposalFromEvidence(raw.evidence, transcript, today, lang);
  const fields: DraftFields = {};
  const seen = new Set<string>();
  const qualities: string[] = [];
  for (const quality of raw.qualities) {
    const word = displayPhrase(quality);
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
  // "three weeks ago". Spanish phrases use the same contiguous-span check.
  if (
    grounded(raw.onsetPhrase, transcript) &&
    spanIn(raw.onsetPhrase, transcript) &&
    !isFutureOnset(raw.onsetPhrase)
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
    followUp: followUpFor(location, transcript, lang),
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
    case "both":
      return translate(lang, "extraction.location.both");
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

function range(start: number, end: number) {
  const out: number[] = [];
  for (let i = start; i < end; i++) out.push(i);
  return out;
}
