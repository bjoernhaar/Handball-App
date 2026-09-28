// Tests der App-Parser (Browser-Code) gegen echte nuLiga-Seiten, mit jsdom
// als DOM-Ersatz.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, parseHtml } from "./helpers.mjs";
import { parseClubSearch, parseClubTeams, findClubTeamRow } from "../../src/parsers/clubParsers.js";
import { parseGroupTable } from "../../src/parsers/groupTableParser.js";
import { parseTeamStats } from "../../src/parsers/teamStatsParser.js";
import { parsePlayerStats } from "../../src/parsers/playerStatsParser.js";

const BASE = "https://hvnb-handball.liga.nu/cgi-bin/WebObjects/nuLigaHBDE.woa/wa/";
const skip = (name) => !fixture(name) && "Fixtures fehlen";

test("Vereinssuche 'Jever' findet HG Jever/Schortens ohne Kontaktdaten", { skip: skip("clubSearch.html") }, () => {
  const clubs = parseClubSearch(parseHtml(fixture("clubSearch.html")), BASE + "clubSearch");
  const hg = clubs.find((c) => c.clubId === "32684");
  assert.ok(hg);
  assert.equal(hg.name, "HG Jever/Schortens");
  assert.deepEqual(hg.members, ["MTV Jever", "Heidmühler FC"]);
  assert.ok(!JSON.stringify(clubs).includes("0175"), "Telefonnummer darf nicht übernommen werden");
});

test("Mannschaftsliste des Vereins mit Liga und Staffel", { skip: skip("clubTeams.html") }, () => {
  const { clubName, teams } = parseClubTeams(parseHtml(fixture("clubTeams.html")), BASE + "clubTeams");
  assert.equal(clubName, "HG Jever/Schortens");
  const mjb = teams.find((t) => t.group === "489041");
  assert.deepEqual(
    { ...mjb, rank: undefined, points: undefined },
    {
      section: "HR Bremen-Nordsee 2026/27",
      teamLabel: "männliche Jugend B",
      leagueName: "Landesliga männliche Jugend B",
      championship: "HRBN 26/27",
      group: "489041",
      rank: undefined,
      points: undefined,
    }
  );
  assert.ok(teams.some((t) => t.section === "HVNB 2026/27"));
  assert.ok(!JSON.stringify(teams).includes("Salbego"), "Verantwortliche dürfen nicht übernommen werden");
});

test("Mannschaft wird in der Staffeltabelle gefunden (auch 'II')", { skip: skip("groupPage.html") }, () => {
  const rows = parseGroupTable(parseHtml(fixture("groupPage.html")), BASE + "groupPage");
  assert.equal(findClubTeamRow(rows, "HG Jever/Schortens", "männliche Jugend B").teamtable, "2227521");

  const rows2 = parseGroupTable(parseHtml(fixture("groupPage2.html")), BASE + "groupPage");
  assert.equal(findClubTeamRow(rows2, "HG Jever/Schortens", "Männer II").teamtable, "2217274");
  assert.equal(findClubTeamRow(rows2, "HG Jever/Schortens", "Männer"), null, "1. Mannschaft spielt nicht in dieser Staffel");
});

test("Mannschaftsstatistik der Staffel", { skip: skip("teamStats.html") }, () => {
  const { group, teams } = parseTeamStats(parseHtml(fixture("teamStats.html")));
  assert.ok(group && group.played > 0);
  assert.ok(group.metrics["Tore"]);
  const own = teams.find((t) => t.name.startsWith("HG Jever/Schortens"));
  assert.ok(own, "eigene Mannschaft fehlt");
  assert.ok(own.metrics["7m-Trefferquote"]);
  assert.ok(teams.length >= 8);
});

test("Torschützenliste der Staffel", { skip: skip("playerGoals.html") }, () => {
  const rows = parsePlayerStats(parseHtml(fixture("playerGoals.html")), "Tore");
  assert.ok(rows.length > 10);
  assert.ok(rows.some((r) => r.club.includes("Jever")));
});
