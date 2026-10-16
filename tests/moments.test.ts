import test from "node:test";
import assert from "node:assert/strict";
import {
  dayKeys,
  dayTitle,
  historyMatch,
  localDayKey,
  momentLabel,
  momentsOnDay,
} from "../src/moments.ts";

test("day title uses the local calendar", () => {
  const now = new Date(2026, 9, 13, 15, 0, 0);
  assert.equal(dayTitle(localDayKey(now), now), "Today");
  const yesterday = new Date(2026, 9, 12, 23, 30, 0);
  assert.equal(dayTitle(localDayKey(yesterday), now), "Yesterday");
  assert.match(dayTitle("2026-01-05", now), /5/);
});

test("moments stay on the day they were written", () => {
  const now = new Date(2026, 9, 13, 9, 0, 0);
  const morning = new Date(2026, 9, 13, 8, 0, 0).toISOString();
  const older = new Date(2026, 8, 12, 12, 0, 0).toISOString();
  const saved = [
    { id: "a", created: morning },
    { id: "b", created: older },
  ];
  const today = localDayKey(now);
  assert.deepEqual(
    momentsOnDay(saved, { id: "draft", created: morning }, today).map(
      (item) => item.id,
    ),
    ["a", "draft"],
  );
  assert.deepEqual(
    momentsOnDay(saved, { id: "a", created: morning }, today).map(
      (item) => item.id,
    ),
    ["a"],
  );
  const keys = dayKeys([morning, older], [], now);
  assert.ok(keys.includes(today));
  assert.ok(keys.includes(localDayKey(new Date(older))));
});

test("moment label prefers the written title, then the activity", () => {
  assert.equal(
    momentLabel({ map: { title: "Morning tennis", activity: "Tennis" } }),
    "Morning tennis",
  );
  assert.equal(
    momentLabel({ map: { title: "  ", activity: "Tennis" } }),
    "Tennis",
  );
  assert.equal(
    momentLabel({ map: { title: "", activity: "" } }),
    "Untitled moment",
  );
});

test("history search uses written notes and activities", () => {
  const entry = {
    note: "Stiff after serving",
    map: { title: "", activity: "Tennis", quality: "" },
    points: [{ comment: "left trap", structure: "trapezius" }],
  };
  assert.equal(historyMatch(entry, " "), true);
  assert.equal(historyMatch(entry, "serving"), true);
  assert.equal(historyMatch(entry, "tennis"), true);
  assert.equal(historyMatch(entry, "trapezius"), true);
  assert.equal(historyMatch(entry, "knee"), false);
});
