// Der Regex-Parser des Workers muss exakt dieselben Spiele liefern wie der
// DOM-Parser der App - sonst würden Worker und App unterschiedliche
// "Änderungen" sehen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, parseHtml } from "./helpers.mjs";
import { parseTeamPortraitHtml } from "../src/schedule.js";
import { parseTeamPortrait } from "../../src/parsers/teamPortraitParser.js";

const html = fixture("teamPortrait.html");
const URL_ = "https://hvnb-handball.liga.nu/cgi-bin/WebObjects/nuLigaHBDE.woa/wa/teamPortrait?teamtable=2227521&championship=HRBN+26%2F27&group=489041";

test("Worker-Parser liest den Spielplan von HG Jever/Schortens mJB", { skip: !html && "Fixtures fehlen" }, () => {
  const parsed = parseTeamPortraitHtml(html);
  assert.equal(parsed.leagueName, "Landesliga männliche Jugend B");
  assert.match(parsed.displayName, /^HG Jever\/Schortens 1\. männliche Jugend B$/);
  assert.ok(parsed.matches.length >= 10, `nur ${parsed.matches.length} Spiele`);
  const first = parsed.matches.find((m) => m.matchNumber === "15004");
  assert.deepEqual(
    { ...first, venueLocationId: undefined },
    {
      matchNumber: "15004",
      date: "2026-09-05",
      time: "12:00",
      venueName: "Jever, SZ",
      venueLocationId: undefined,
      homeTeam: "HG Jever/Schortens",
      awayTeam: "VfL Rastede",
      homeScore: 18,
      awayScore: 21,
      note: null,
    }
  );
});

test("Worker- und App-Parser liefern identische Spiele", { skip: !html && "Fixtures fehlen" }, () => {
  const worker = parseTeamPortraitHtml(html).matches;
  const app = parseTeamPortrait(parseHtml(html), URL_).matches;
  const pick = (m) => ({
    matchNumber: m.matchNumber,
    date: m.date,
    time: m.time,
    venueName: m.venueName,
    venueLocationId: m.venueLocationId,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    note: m.note,
  });
  assert.deepEqual(worker.map(pick), app.map(pick));
});

test("verlegtes Spiel ('Termin offen', colspan) wird korrekt gelesen", { skip: !html && "Fixtures fehlen" }, () => {
  for (const matches of [parseTeamPortraitHtml(html).matches, parseTeamPortrait(parseHtml(html), URL_).matches]) {
    const m = matches.find((x) => x.matchNumber === "15015");
    assert.ok(m, "Spiel 15015 fehlt");
    assert.equal(m.date, null);
    assert.equal(m.time, null);
    assert.equal(m.homeTeam, "HG Jever/Schortens");
    assert.equal(m.awayTeam, "Elsflether TB");
    assert.equal(m.venueName, "Jever, SZ");
    assert.equal(m.homeScore, null, "0:0 ohne Spielbericht ist kein Ergebnis");
    assert.equal(m.note, "Termin offen – verlegt auf unbestimmten Termin");
  }
  assert.ok(
    parseTeamPortraitHtml(html).matches.every((m) => /^\d+$/.test(m.matchNumber)),
    "alle Spielnummern müssen numerisch sein (keine verrutschten Spalten)"
  );
});
