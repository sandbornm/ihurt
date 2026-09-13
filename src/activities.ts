import type { RegionId } from "./types.ts";
type Activity = { name: string; regions: RegionId[]; terms?: string[] };
const shoulders: RegionId[] = ["left_shoulder", "right_shoulder", "upper_back"];
const legs: RegionId[] = [
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
];
const arms: RegionId[] = [
  ...shoulders,
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
];
export const commonActivities: Activity[] = [
  { name: "Walking", regions: legs, terms: ["walk"] },
  { name: "Running", regions: legs, terms: ["run", "jog"] },
  {
    name: "Strength training",
    regions: [...shoulders, "lower_back", ...legs],
    terms: ["weights", "lifting", "gym"],
  },
  {
    name: "Cycling",
    regions: ["neck", "lower_back", ...legs],
    terms: ["bike", "cycling"],
  },
  { name: "Swimming", regions: [...shoulders, "neck"], terms: ["swim"] },
  {
    name: "Tennis",
    regions: [...arms, "neck"],
    terms: ["serve", "tennis", "racket"],
  },
  { name: "Yoga", regions: ["lower_back", ...legs, ...shoulders] },
  { name: "Hiking", regions: legs, terms: ["hike"] },
  { name: "Basketball", regions: [...legs, ...shoulders] },
  { name: "Soccer", regions: legs, terms: ["football"] },
  { name: "Pickleball", regions: [...arms, ...legs], terms: ["racket"] },
  { name: "Golf", regions: ["lower_back", ...arms], terms: ["swing"] },
  {
    name: "Desk work",
    regions: ["neck", "upper_back", "lower_back", "left_wrist", "right_wrist"],
    terms: ["desk", "computer", "sitting"],
  },
  {
    name: "Sleep",
    regions: ["neck", "upper_back", "left_shoulder", "right_shoulder"],
    terms: ["sleep", "slept", "bed"],
  },
];
const more: [string, RegionId[]][] = [
  ["American football", [...legs, ...shoulders]],
  ["Archery", arms],
  ["Badminton", arms],
  ["Baseball", [...arms, ...legs]],
  ["Bouldering", arms],
  ["Bowling", arms],
  ["Boxing", arms],
  ["Calisthenics", arms],
  ["Canoeing", arms],
  ["Cheerleading", [...legs, ...arms]],
  ["Climbing", arms],
  ["Cricket", [...arms, ...legs]],
  ["Cross-country skiing", legs],
  ["Curling", [...legs, ...arms]],
  ["Dance", legs],
  ["Disc golf", arms],
  ["Dodgeball", arms],
  ["Fencing", [...legs, ...arms]],
  ["Field hockey", legs],
  ["Figure skating", legs],
  ["Gardening", ["lower_back", ...arms]],
  ["Gymnastics", [...arms, ...legs]],
  ["Horse riding", ["lower_back", ...legs]],
  ["Housework", ["lower_back", ...arms]],
  ["Ice hockey", [...legs, ...arms]],
  ["Inline skating", legs],
  ["Jump rope", legs],
  ["Kayaking", arms],
  ["Kendo", arms],
  ["Lacrosse", [...arms, ...legs]],
  ["Martial arts", [...arms, ...legs]],
  ["Mountain biking", [...arms, ...legs]],
  ["Padel", arms],
  ["Parkour", [...arms, ...legs]],
  ["Pilates", ["lower_back", ...legs]],
  ["Pole fitness", arms],
  ["Powerlifting", ["lower_back", ...arms, ...legs]],
  ["Racquetball", arms],
  ["Roller derby", legs],
  ["Rowing", ["lower_back", ...arms]],
  ["Rugby", [...arms, ...legs]],
  ["Sailing", arms],
  ["Skateboarding", legs],
  ["Skiing", legs],
  ["Snowboarding", legs],
  ["Softball", arms],
  ["Squash", arms],
  ["Stand-up paddleboarding", ["lower_back", ...arms]],
  ["Surfing", [...arms, ...legs]],
  ["Table tennis", arms],
  ["Tai chi", legs],
  ["Trail running", legs],
  ["Trampoline", legs],
  ["Triathlon", [...legs, ...shoulders]],
  ["Ultimate frisbee", [...arms, ...legs]],
  ["Underwater hockey", [...arms, ...legs]],
  ["Volleyball", [...legs, ...arms]],
  ["Water polo", shoulders],
  ["Windsurfing", arms],
  ["Wrestling", [...arms, ...legs]],
];
export const activities: Activity[] = [
  ...commonActivities,
  ...more.map(([name, regions]) => ({ name, regions })),
];
export function activityMatch(value: string): Activity | undefined {
  const text = value.toLowerCase();
  return (
    activities.find((a) => text === a.name.toLowerCase()) ??
    activities.find(
      (a) =>
        text.includes(a.name.toLowerCase()) ||
        a.terms?.some((t) => text.split(/\W+/).includes(t)),
    )
  );
}
export const activityRegions = (value: string) =>
  activityMatch(value)?.regions ?? [];
export const activitySearchText = (value: string) =>
  [value, ...(activityMatch(value)?.terms ?? [])].join(" ");
