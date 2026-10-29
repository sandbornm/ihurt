import assert from "node:assert/strict";
import test from "node:test";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import {
  formatMessage,
  placeholders,
  resolveLanguage,
} from "../src/i18n/core.ts";
import {
  formatDate,
  formatNumber,
  language,
  setLanguagePreference,
  speechLocale,
  translate,
} from "../src/i18n/index.ts";
import { regions } from "../src/types.ts";
import { activities, activityKey, activityName } from "../src/activities.ts";

test("Spanish has every English key and no extras", () => {
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
});

test("every message keeps the same placeholders and plural shape", () => {
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    const a = en[key],
      b = es[key];
    assert.deepEqual(placeholders(b), placeholders(a), key);
    assert.equal(typeof b, typeof a, key);
    if (typeof b === "string") assert.ok(b.trim(), `${key} is empty`);
    else
      assert.ok(
        b.other.includes("{count}") ||
          !String(typeof a === "string" ? a : a.other).includes("{count}"),
        key,
      );
  }
});

test("regions and activities have names in both languages", () => {
  for (const { id } of regions) {
    assert.ok(en[`region.${id}` as keyof typeof en], id);
    assert.notEqual(es[`region.${id}` as keyof typeof es], undefined, id);
  }
  for (const activity of activities) {
    assert.ok(es[activityKey(activity) as keyof typeof es], activity.name);
    assert.ok(activityName(activity, "es"), activity.name);
  }
});

test("interpolates variables and leaves unknown ones alone", () => {
  assert.equal(
    formatMessage("es", "Hola {name}, {missing}", { name: "Ana" }),
    "Hola Ana, {missing}",
  );
  assert.equal(
    translate("es", "extraction.sinceDate", {
      phrase: "ayer",
      date: "2026-10-21",
    }),
    "Desde ayer (2026-10-21)",
  );
});

test("plurals follow Intl.PluralRules for each language", () => {
  const message = { one: "{count} entrada", other: "{count} entradas" };
  assert.equal(formatMessage("es", message, { count: 1 }), "1 entrada");
  assert.equal(formatMessage("es", message, { count: 0 }), "0 entradas");
  assert.equal(formatMessage("es", message, { count: 3 }), "3 entradas");
  assert.equal(
    translate("en", "notebook.toast.imported", { count: 1 }),
    "Imported 1 entry.",
  );
  assert.equal(
    translate("en", "notebook.toast.imported", { count: 2 }),
    "Imported 2 entries.",
  );
  assert.match(translate("es", "notebook.toast.imported", { count: 2 }), /2/);
});

test("numbers in messages and dates use the language's format", () => {
  assert.equal(formatMessage("es", "{n}", { n: 0.5 }), "0.5");
  assert.equal(
    formatMessage("es", "{n}", { n: 1234.5 }),
    new Intl.NumberFormat("es-419").format(1234.5),
  );
  assert.equal(formatMessage("en", "{n}", { n: 1234.5 }), "1,234.5");
  assert.match(formatNumber(0.5, { style: "percent" }, "es"), /^50\s?%$/);
  const date = Date.UTC(2026, 9, 22, 12);
  assert.match(
    formatDate(date, { month: "long", timeZone: "UTC" }, "es"),
    /octubre/,
  );
  assert.match(
    formatDate(date, { month: "long", timeZone: "UTC" }, "en"),
    /October/,
  );
});

test("resolves the automatic language from the device list", () => {
  assert.equal(resolveLanguage(["es-MX", "en-US"]), "es");
  assert.equal(resolveLanguage(["fr-FR", "es_419"]), "es");
  assert.equal(resolveLanguage(["en-GB"]), "en");
  assert.equal(resolveLanguage(["fr-FR", "de"]), "en");
  assert.equal(resolveLanguage([]), "en");
  assert.equal(resolveLanguage([undefined, "ES"]), "es");
});

test("an explicit setting overrides the device language", () => {
  setLanguagePreference("es");
  assert.equal(language(), "es");
  assert.match(speechLocale(), /^es-/);
  setLanguagePreference("en");
  assert.equal(language(), "en");
  assert.match(speechLocale(), /^en-/);
  setLanguagePreference("auto");
});
