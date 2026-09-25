import { clean, directTds, queryParam } from "./htmlTextUtils.js";

/**
 * Parst die Staffeltabelle einer groupPage.
 * Kopfzeile (bestätigt live, 20.09.2026): "", Rang, Mannschaft, Begegnungen,
 * S, U, N, Tore, +/-, Punkte  →  10 Spalten, Tabelle hat class="result-set".
 *
 * @param {Document} doc
 * @param {string} pageUrl
 * @returns {import('../data/models.js').TableRow[]}
 */
export function parseGroupTable(doc, pageUrl) {
  let table = null;
  for (const th of Array.from(doc.querySelectorAll("th"))) {
    if (clean(th.textContent) === "Mannschaft") {
      table = th.closest("table");
      break;
    }
  }
  if (!table) return [];

  const rows = Array.from(table.querySelectorAll("tr"));
  const result = [];

  for (const row of rows) {
    const cells = directTds(row);
    if (cells.length < 10) continue; // Kopfzeile / Trennzeile

    const rank = parseInt(clean(cells[1].textContent), 10);
    if (Number.isNaN(rank)) continue;

    const teamLink = cells[2].querySelector("a");
    const teamName = clean(cells[2].textContent);
    const teamtable = teamLink ? queryParam(teamLink.getAttribute("href"), "teamtable", pageUrl) : null;

    const played = parseInt(clean(cells[3].textContent), 10) || 0;
    const wins = parseInt(clean(cells[4].textContent), 10) || 0;
    const draws = parseInt(clean(cells[5].textContent), 10) || 0;
    const losses = parseInt(clean(cells[6].textContent), 10) || 0;

    const [goalsFor, goalsAgainst] = splitRatio(clean(cells[7].textContent));
    const [pointsFor, pointsAgainst] = splitRatio(clean(cells[9].textContent));

    result.push({
      rank,
      teamName,
      teamtable,
      played,
      wins,
      draws,
      losses,
      goalsFor,
      goalsAgainst,
      pointsFor,
      pointsAgainst,
    });
  }

  return result;
}

function splitRatio(text) {
  const match = text.match(/(-?\d+)\s*:\s*(-?\d+)/);
  if (!match) return [0, 0];
  return [parseInt(match[1], 10), parseInt(match[2], 10)];
}
