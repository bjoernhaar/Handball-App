import { clean, directTds, linesByBr, queryParam } from "./htmlTextUtils.js";

/**
 * Parst das Ergebnis der nuLiga-Vereinssuche (clubSearch?searchFor=...).
 * Tabelle (live geprüft 28.09.2026): Vereinsname (Link clubInfoDisplay?club=ID,
 * dahinter "(Vereinsnummer)") | Spielgemeinschaften/Stammvereine | Kontakt.
 * Die Kontaktspalte wird bewusst NICHT übernommen (personenbezogene Daten).
 *
 * @returns {{clubId: string, name: string, members: string[]}[]}
 */
export function parseClubSearch(doc, pageUrl) {
  const result = [];
  for (const link of Array.from(doc.querySelectorAll('a[href*="clubInfoDisplay"]'))) {
    const clubId = queryParam(link.getAttribute("href"), "club", pageUrl);
    const cell = link.closest("td");
    if (!clubId || !cell || result.some((c) => c.clubId === clubId)) continue;
    const row = cell.parentElement;
    const cells = directTds(row);
    const members = cells[1] ? linesByBr(cells[1]).map((l) => l.replace(/\s*\(\d+\)\s*$/, "")) : [];
    result.push({ clubId, name: clean(link.textContent), members });
  }
  return result;
}

/**
 * Parst "Mannschaften und Ligeneinteilung" eines Vereins (clubTeams?club=ID).
 * Aufbau: je Spielbetrieb eine <h2>-Zeile (z.B. "HR Bremen-Nordsee 2026/27"),
 * darunter Zeilen: Mannschaft | Liga (Link groupPage) | Verantwortlicher | Rang | Punkte.
 * Die Spalte "Mannschaftsverantwortlicher" wird bewusst NICHT übernommen.
 *
 * @returns {{clubName: string, teams: {section: string, teamLabel: string, leagueName: string, championship: string, group: string, rank: string, points: string}[]}}
 */
export function parseClubTeams(doc, pageUrl) {
  const h1 = doc.querySelector("h1");
  const clubName = h1 ? linesByBr(h1)[0] || "" : "";
  const teams = [];
  const table = doc.querySelector("table.result-set");
  if (!table) return { clubName, teams };

  let section = "";
  for (const row of Array.from(table.querySelectorAll("tr"))) {
    const h2 = row.querySelector("h2");
    if (h2) {
      section = clean(h2.textContent);
      continue;
    }
    const cells = directTds(row);
    if (cells.length < 2) continue;
    const link = cells[1].querySelector('a[href*="groupPage"]');
    if (!link) continue;
    const href = link.getAttribute("href");
    const championship = queryParam(href, "championship", pageUrl);
    const group = queryParam(href, "group", pageUrl);
    if (!championship || !group) continue;
    teams.push({
      section,
      teamLabel: clean(cells[0].textContent),
      leagueName: clean(link.textContent),
      championship,
      group,
      rank: cells[3] ? clean(cells[3].textContent) : "",
      points: cells[4] ? clean(cells[4].textContent) : "",
    });
  }
  return { clubName, teams };
}

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };

/** "Männer II" -> 2, "männliche Jugend B" -> 1, "Frauen 3" -> 3 */
function teamOrdinal(text) {
  const m = clean(text).match(/\s(I{1,3}|IV|V|VI{1,3}|\d)\.?$/);
  if (!m) return 1;
  return ROMAN[m[1]] || parseInt(m[1], 10) || 1;
}

function normalize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9äöüß]+/g, "");
}

/**
 * Findet in der Staffeltabelle die Zeile der gesuchten Vereinsmannschaft
 * (liefert deren teamtable-ID). Die Tabelle nennt nur "HG Jever/Schortens II",
 * die Vereinsliste nur "Männer II" - daher Abgleich über Vereinsname +
 * Mannschaftsnummer. Bei Zweifeln null, dann wählt der Nutzer selbst.
 *
 * @param {import('../data/models.js').TableRow[]} rows
 */
export function findClubTeamRow(rows, clubName, teamLabel) {
  const club = normalize(clubName);
  if (!club) return null;
  const wanted = teamOrdinal(teamLabel);
  const candidates = rows.filter(
    (r) => r.teamtable && normalize(r.teamName).startsWith(club) && teamOrdinal(r.teamName) === wanted
  );
  return candidates.length === 1 ? candidates[0] : null;
}
