import type { SavedMap } from "./types";
export function exampleEntry(): SavedMap {
  return {
    id: "neck-and-tennis-example",
    created: "2026-09-12T12:00:00.000Z",
    updated: "2026-09-12T12:00:00.000Z",
    provider: "Your notes",
    answers: [],
    note: "My left upper trap and high left neck feel stiff after sleeping on my side and stomach. I noticed it again while serving in tennis. Looking down slowly and turning left brings it on.",
    points: [
      {
        id: "example-trap",
        region: "neck",
        position: [0.2468409206, 2.4054569904, -0.2847309166],
        structure: "Transverse part of trapezius muscle",
        comment: "Stiff across the left upper trap after serving.",
      },
      {
        id: "example-neck",
        region: "neck",
        position: [0.0855042436, 2.7435860312, -0.2117095312],
        structure: "Ascending part of trapezius muscle",
        comment: "High left neck when looking down or turning left.",
      },
    ],
    map: {
      title: "Example: A stiff neck after sleep and tennis",
      summary: "",
      regions: ["neck"],
      quality: "Stiff",
      activity: "Tennis",
      duration: "Since yesterday",
      intensity: null,
      question: null,
      urgent: false,
      safety_message: null,
    },
  };
}
