import { clean, directTds, directThs } from "./htmlTextUtils.js";

/**
 * Parst die Mannschaftsstatistik einer Staffel
 * (groupMeetingStatistics?displayType=groupAndTeams, live geprüft 28.09.2026).
 *
 * Die Seite enthält mehrere kleine Tabellen: zuerst "Gruppenstatistik (17/132
 * Spiele)", dann je Mannschaft "Hagener SV (4/22 Spiele)". Jede hat die Zeilen
 * Tore, 7m-Versuche, 7m-Tore, 7m-Trefferquote, 1./2./3. Zeitstrafen,
 * Zeitstrafen gesamt, Gelbe Karten, Rote Karten, Zuschauer mit den Spalten
 * "Insgesamt" und "∅ pro Spiel".
 *
 * @returns {{group: TeamStat|null, teams: TeamStat[]}}
 * @typedef {{name: string, played: number|null, metrics: Object<string, {total: string, perGame: string}>}} TeamStat
 */
export function parseTeamStats(doc) {
  let group = null;
  const teams = [];

  for (const table of Array.from(doc.querySelectorAll("table.result-set"))) {
    const firstRow = table.querySelector("tr");
    if (!firstRow) continue;
    const titleCell = directThs(firstRow).find((th) => th.getAttribute("colspan"));
    if (!titleCell) continue;
    const title = clean(titleCell.textContent);
    const m = title.match(/^(.*?)\s*\((\d+)\s*\/\s*\d+\s*Spiele\)$/);
    if (!m) continue;

    const metrics = {};
    for (const row of Array.from(table.querySelectorAll("tr"))) {
      const cells = directTds(row);
      if (cells.length !== 3) continue;
      const label = clean(cells[0].textContent);
      if (!label) continue;
      metrics[label] = { total: clean(cells[1].textContent), perGame: clean(cells[2].textContent) };
    }

    const stat = { name: m[1], played: parseInt(m[2], 10), metrics };
    if (/^Gruppenstatistik$/i.test(m[1])) group = stat;
    else teams.push(stat);
  }

  return { group, teams };
}
