import type { RegionId } from "../types";
export const bodyAnchors: { name: string; region: RegionId }[] = [
  { name: "Neck", region: "neck" },
  { name: "Right shoulder", region: "right_shoulder" },
  { name: "Left shoulder", region: "left_shoulder" },
  { name: "Lower back", region: "lower_back" },
  { name: "Right knee", region: "right_knee" },
  { name: "Left knee", region: "left_knee" },
];
export function muscleGroups(
  region: RegionId | null,
): { name: string; match: string; back?: boolean }[] {
  if (!region) return [];
  if (region === "neck")
    return [
      { name: "Sternocleidomastoid", match: "sternocleidomastoid" },
      {
        name: "Upper trapezius",
        match: "descending part of trapezius",
        back: true,
      },
      { name: "Levator scapulae", match: "levator scapulae", back: true },
      { name: "Splenius capitis", match: "splenius capitis", back: true },
    ];
  if (region.includes("shoulder"))
    return [
      { name: "Deltoid", match: "deltoid" },
      { name: "Supraspinatus", match: "supraspinatus", back: true },
      { name: "Infraspinatus", match: "infraspinatus", back: true },
      { name: "Subscapularis", match: "subscapularis" },
      { name: "Teres minor", match: "teres minor", back: true },
    ];
  if (region.includes("elbow"))
    return [
      { name: "Biceps brachii", match: "biceps brachii" },
      { name: "Triceps brachii", match: "triceps", back: true },
      { name: "Brachioradialis", match: "brachioradialis" },
    ];
  if (region.includes("wrist"))
    return [
      { name: "Flexor carpi radialis", match: "flexor carpi radialis" },
      {
        name: "Extensor carpi radialis",
        match: "extensor carpi radialis",
        back: true,
      },
      { name: "Flexor digitorum", match: "flexor digitorum" },
    ];
  if (region.includes("hip"))
    return [
      { name: "Gluteus maximus", match: "gluteus maximus", back: true },
      { name: "Gluteus medius", match: "gluteus medius", back: true },
      { name: "Iliacus", match: "iliacus" },
    ];
  if (region.includes("thigh") || region.includes("knee"))
    return [
      { name: "Rectus femoris", match: "rectus femoris" },
      { name: "Vastus medialis", match: "vastus medialis" },
      { name: "Vastus lateralis", match: "vastus lateralis" },
      { name: "Biceps femoris", match: "biceps femoris", back: true },
    ];
  if (
    region.includes("calf") ||
    region.includes("ankle") ||
    region.includes("foot")
  )
    return [
      { name: "Gastrocnemius", match: "gastrocnemius", back: true },
      { name: "Soleus", match: "soleus", back: true },
      { name: "Tibialis anterior", match: "tibialis anterior" },
    ];
  if (region.includes("back"))
    return [
      { name: "Trapezius", match: "trapezius", back: true },
      { name: "Latissimus dorsi", match: "latissimus dorsi", back: true },
      {
        name: "Erector spinae · longissimus",
        match: "longissimus",
        back: true,
      },
    ];
  return [
    { name: "Pectoralis major", match: "pectoralis major" },
    { name: "Rectus abdominis", match: "rectus abdominis" },
    { name: "External oblique", match: "external oblique" },
  ];
}
