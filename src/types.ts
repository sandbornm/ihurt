export const regions = [
  { id: "neck", name: "Neck", group: "Head & torso", center: [0, 2.48, 0] },
  { id: "chest", name: "Chest", group: "Head & torso", center: [0, 1.96, 0.2] },
  {
    id: "upper_back",
    name: "Upper back",
    group: "Head & torso",
    center: [0, 1.98, -0.2],
  },
  {
    id: "lower_back",
    name: "Lower back",
    group: "Head & torso",
    center: [0, 1.12, -0.22],
  },
  {
    id: "abdomen",
    name: "Abdomen",
    group: "Head & torso",
    center: [0, 1.18, 0.2],
  },
  ...(["left", "right"] as const).flatMap((side) => {
    const s = side === "left" ? 1 : -1;
    return [
      {
        id: `${side}_shoulder`,
        name: `${side} shoulder`,
        group: "Arms & shoulders",
        center: [s * 0.72, 2.02, 0],
      },
      {
        id: `${side}_elbow`,
        name: `${side} elbow`,
        group: "Arms & shoulders",
        center: [s * 1.04, 1.2, 0],
      },
      {
        id: `${side}_wrist`,
        name: `${side} wrist & hand`,
        group: "Arms & shoulders",
        center: [s * 1.25, 0.45, 0.03],
      },
      {
        id: `${side}_hip`,
        name: `${side} hip`,
        group: "Hips & legs",
        center: [s * 0.4, 0.5, 0],
      },
      {
        id: `${side}_thigh`,
        name: `${side} thigh`,
        group: "Hips & legs",
        center: [s * 0.36, -0.15, 0.02],
      },
      {
        id: `${side}_knee`,
        name: `${side} knee`,
        group: "Hips & legs",
        center: [s * 0.34, -0.9, 0.04],
      },
      {
        id: `${side}_calf`,
        name: `${side} calf`,
        group: "Hips & legs",
        center: [s * 0.33, -1.52, -0.05],
      },
      {
        id: `${side}_ankle`,
        name: `${side} ankle`,
        group: "Hips & legs",
        center: [s * 0.32, -2.14, 0],
      },
      {
        id: `${side}_foot`,
        name: `${side} foot`,
        group: "Hips & legs",
        center: [s * 0.32, -2.4, 0.2],
      },
    ];
  }),
] as const;

export type RegionId = (typeof regions)[number]["id"];
export type QuestionKey =
  "location" | "quality" | "intensity" | "duration" | "activity" | "spread";
export interface Answer {
  key: QuestionKey;
  text: string;
}
export interface PainPoint {
  id: string;
  region: RegionId;
  position: [number, number, number];
  structure: string;
  comment?: string;
  area?: {
    path: [number, number, number][];
    radius: number;
  };
  source?: {
    atlas: "z-anatomy-v1" | "schematic-v1";
    layer: "muscle" | "bone";
    asset?: string;
    node_index?: number;
    mesh_name?: string;
  };
}
export interface HurtMap {
  title: string;
  summary: string;
  regions: RegionId[];
  quality: string;
  intensity: number | null;
  activity: string;
  duration: string;
  question: { key: QuestionKey; prompt: string; options: string[] } | null;
  urgent: boolean;
  safety_message: string | null;
}
export type ProviderId = "demo" | "openai" | "anthropic" | "grok" | "local";
export interface Session {
  provider: ProviderId;
  providers: { id: ProviderId; name: string; available: boolean }[];
  remaining: number;
  limit: number;
  turn_limit: number;
  turnstile_site_key: string;
  max_audio_seconds: number;
  transcription_available: boolean;
  transcription_provider: "ElevenLabs" | "OpenAI" | null;
}
export interface SavedMap {
  research?: {
    activity: string;
    description?: string;
    regions: RegionId[];
    checked: string;
    references: NonNullable<SavedMap["references"]>;
  };
  id: string;
  created: string;
  updated?: string;
  note: string;
  map: HurtMap;
  answers: Answer[];
  provider: string;
  points?: PainPoint[];
  ai?: {
    provider: string;
    created: string;
    based_on: string;
    map: HurtMap;
    answers: Answer[];
  };
  references?: {
    title: string;
    url: string;
    publisher: string;
    checked: string;
    kind?: "article" | "video";
    context_url?: string;
  }[];
}
export const regionName = (id: string) =>
  regions
    .find((r) => r.id === id)
    ?.name.replace(/^\w/, (c) => c.toUpperCase()) ?? id;
