import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diffMatches,
  berlinTimeToEpoch,
  matchesStartingBetween,
  describeEvent,
  EVENT_TYPES,
} from "../../src/shared/matchEvents.js";

const base = {
  matchNumber: "15010",
  date: "2026-10-04",
  time: "12:00",
  venueName: "Jever, SZ",
  homeTeam: "HG Jever/Schortens",
  awayTeam: "TV Neerstedt",
  homeScore: null,
  awayScore: null,
};

test("Uhrzeit-/Hallenänderung wird als Spielplanänderung erkannt", () => {
  const events = diffMatches([base], [{ ...base, time: "14:30", venueName: "Schortens, IGS" }]);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, EVENT_TYPES.changed);
  assert.deepEqual(events[0].changes.map((c) => c.field), ["time", "venueName"]);
  const text = describeEvent(events[0], "id", "HG Jever/Schortens 1. mJB");
  assert.match(text.title, /^Spielplanänderung/);
  assert.match(text.body, /Uhrzeit: 12:00 Uhr → 14:30 Uhr/);
  assert.match(text.body, /Halle: Jever, SZ → Schortens, IGS/);
});

test("neues Ergebnis, neues und entfallenes Spiel", () => {
  const other = { ...base, matchNumber: "15020", date: "2026-11-08" };
  const events = diffMatches(
    [base, other],
    [{ ...base, homeScore: 25, awayScore: 20 }, { ...base, matchNumber: "15099", date: "2027-01-10" }]
  );
  assert.deepEqual(events.map((e) => e.type).sort(), ["added", "removed", "result"]);
  assert.equal(events.find((e) => e.type === "removed").match.matchNumber, "15020");
});

test("keine Meldungen beim ersten Laden oder bei leerem Spielplan", () => {
  assert.deepEqual(diffMatches([], [base]), []);
  assert.deepEqual(diffMatches(undefined, [base]), []);
  assert.deepEqual(diffMatches([base], []), []);
});

test("Änderungen an beendeten Spielen lösen keine Spielplanänderung aus", () => {
  const done = { ...base, homeScore: 20, awayScore: 20 };
  assert.deepEqual(diffMatches([done], [{ ...done, venueName: "anders" }]), []);
});

test("deutsche Ortszeit wird korrekt nach UTC umgerechnet (Sommer- und Winterzeit)", () => {
  assert.equal(new Date(berlinTimeToEpoch("2026-10-04", "12:00")).toISOString(), "2026-10-04T10:00:00.000Z");
  assert.equal(new Date(berlinTimeToEpoch("2026-11-08", "12:00")).toISOString(), "2026-11-08T11:00:00.000Z");
  assert.equal(berlinTimeToEpoch(null, "12:00"), null);
});

test("Erinnerungsfenster: jedes Spiel fällt in genau einen 15-Minuten-Lauf", () => {
  const start = berlinTimeToEpoch(base.date, base.time);
  let hits = 0;
  for (let t = start - 4 * 3600e3; t < start; t += 15 * 60e3) {
    if (matchesStartingBetween([base], t, 105, 120).length) hits++;
  }
  assert.equal(hits, 1);
  assert.equal(matchesStartingBetween([{ ...base, homeScore: 1, awayScore: 0 }], start - 110 * 60e3, 105, 120).length, 0);
});
