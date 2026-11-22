import type { SavedMap } from "./types";
import { t } from "./i18n/index.ts";
export function exampleEntry(): SavedMap {
  return {
    id: "neck-and-tennis-example",
    created: "2026-09-12T12:00:00.000Z",
    updated: "2026-09-12T12:00:00.000Z",
    provider: t("data.yourNotes"),
    answers: [],
    note: t("example.note"),
    points: [
      {
        id: "example-trap",
        region: "neck",
        position: [0.2468409206, 2.4054569904, -0.2847309166],
        structure: "Transverse part of trapezius muscle",
        comment: t("example.trap"),
      },
      {
        id: "example-neck",
        region: "neck",
        position: [0.0855042436, 2.7435860312, -0.2117095312],
        structure: "Ascending part of trapezius muscle",
        comment: t("example.neck"),
      },
    ],
    map: {
      title: t("example.title"),
      summary: "",
      regions: ["neck"],
      quality: t("example.quality"),
      activity: t("example.activity"),
      duration: t("example.duration"),
      intensity: null,
      question: null,
      urgent: false,
      safety_message: null,
    },
  };
}
