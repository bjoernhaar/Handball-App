// Erkennt Änderungen zwischen zwei Ständen eines Spielplans und baut daraus
// die Texte der Mitteilungen. Reines JS ohne DOM - wird identisch von der App
// (src/data/repository.js) und vom Cloudflare Worker (worker/src/index.js)
// verwendet, damit beide Seiten exakt gleich entscheiden, wann es eine
// Mitteilung gibt.
//
// Ein Spiel wird über seine Spielnummer (matchNumber) wiedererkannt.

export const EVENT_TYPES = {
  changed: "changed", // Datum, Uhrzeit oder Halle geändert
  added: "added", // neues Spiel im Spielplan
  removed: "removed", // Spiel nicht mehr im Spielplan (abgesetzt/verlegt ohne Termin)
  result: "result", // neues Endergebnis
  reminder: "reminder", // Spiel beginnt bald
};

/** Erinnerung so lange vor Anpfiff (in Minuten). */
export const REMINDER_LEAD_MINUTES = 120;

const WATCHED_FIELDS = [
  ["date", "Datum"],
  ["time", "Uhrzeit"],
  ["venueName", "Halle"],
];

function hasScore(m) {
  return m.homeScore != null && m.awayScore != null;
}

/**
 * @param {Array} previous - bisher bekannter Spielplan (leer/undefined = Team neu, keine Mitteilungen)
 * @param {Array} next - frisch geladener Spielplan
 * @returns {Array<{type: string, match: object, before?: object, changes?: Array<{field: string, label: string, from: any, to: any}>}>}
 */
export function diffMatches(previous, next) {
  if (!previous || previous.length === 0) return [];
  const events = [];
  const prevByNumber = new Map(previous.map((m) => [m.matchNumber, m]));
  const nextNumbers = new Set();

  for (const match of next) {
    nextNumbers.add(match.matchNumber);
    const before = prevByNumber.get(match.matchNumber);
    if (!before) {
      events.push({ type: EVENT_TYPES.added, match });
      continue;
    }
    const changes = WATCHED_FIELDS.filter(([field]) => (before[field] || null) !== (match[field] || null)).map(
      ([field, label]) => ({ field, label, from: before[field] || null, to: match[field] || null })
    );
    // Nach dem Spiel ändert nuLiga manchmal noch Kleinigkeiten - für
    // beendete Spiele interessiert nur noch das Ergebnis.
    if (changes.length && !hasScore(match)) {
      events.push({ type: EVENT_TYPES.changed, match, before, changes });
    }
    if (hasScore(match) && !hasScore(before)) {
      events.push({ type: EVENT_TYPES.result, match });
    }
  }

  // Ein komplett leerer neuer Spielplan ist eher ein Lade-/Saisonwechsel-
  // Problem als 18 gleichzeitig abgesagte Spiele - dann keine Meldungen.
  if (next.length > 0) {
    for (const before of previous) {
      if (!nextNumbers.has(before.matchNumber) && !hasScore(before)) {
        events.push({ type: EVENT_TYPES.removed, match: before });
      }
    }
  }
  return events;
}

/**
 * Wandelt Datum/Uhrzeit (deutsche Ortszeit, wie nuLiga sie anzeigt) in einen
 * UTC-Zeitstempel um - unabhängig von der Zeitzone des ausführenden Geräts
 * (der Worker läuft in UTC).
 */
export function berlinTimeToEpoch(date, time) {
  if (!date || !time) return null;
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(asUtc)) return null;
  const offset = (ms) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/Berlin",
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
        .formatToParts(new Date(ms))
        .map((p) => [p.type, p.value])
    );
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - ms;
  };
  let guess = asUtc - offset(asUtc);
  guess = asUtc - offset(guess); // zweiter Schritt für die Nacht der Zeitumstellung
  return guess;
}

/** Spiele ohne Ergebnis, deren Anpfiff in (from, to] Minuten ab nowMs liegt. */
export function matchesStartingBetween(matches, nowMs, fromMinutes, toMinutes) {
  return matches.filter((m) => {
    if (hasScore(m)) return false;
    const start = berlinTimeToEpoch(m.date, m.time);
    if (start == null) return false;
    const diffMin = (start - nowMs) / 60000;
    return diffMin > fromMinutes && diffMin <= toMinutes;
  });
}

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export function formatMatchDate(date, time) {
  if (!date) return "ohne Termin";
  const [y, m, d] = date.split("-");
  const weekday = WEEKDAYS[new Date(Date.UTC(+y, +m - 1, +d)).getUTCDay()];
  return `${weekday}, ${d}.${m}.${y}${time ? `, ${time} Uhr` : ""}`;
}

function formatValue(field, value) {
  if (!value) return "offen";
  if (field === "date") return formatMatchDate(value, null);
  if (field === "time") return `${value} Uhr`;
  return value;
}

function matchTitle(match) {
  return `${match.homeTeam} – ${match.awayTeam}`;
}

/**
 * @returns {{title: string, body: string, tag: string}}
 *   tag ist für App und Worker identisch - so ersetzt eine Mitteilung ggf.
 *   eine gleichartige, statt doppelt zu erscheinen.
 */
export function describeEvent(event, teamId, teamName) {
  const { match } = event;
  const tag = `${event.type}::${teamId}::${match.matchNumber}`;
  const when = formatMatchDate(match.date, match.time);
  switch (event.type) {
    case EVENT_TYPES.changed:
      return {
        tag,
        title: `Spielplanänderung: ${teamName}`,
        body:
          `${matchTitle(match)}\n` +
          event.changes.map((c) => `${c.label}: ${formatValue(c.field, c.from)} → ${formatValue(c.field, c.to)}`).join("\n") +
          (match.note ? `\n(${match.note})` : ""),
      };
    case EVENT_TYPES.added:
      return {
        tag,
        title: `Neues Spiel: ${teamName}`,
        body: `${matchTitle(match)}\n${when}${match.venueName ? `, ${match.venueName}` : ""}`,
      };
    case EVENT_TYPES.removed:
      return {
        tag,
        title: `Spiel entfällt: ${teamName}`,
        body: `${matchTitle(match)} (${when}) steht nicht mehr im Spielplan.`,
      };
    case EVENT_TYPES.result:
      return {
        tag,
        title: `Ergebnis: ${teamName}`,
        body: `${matchTitle(match)}  ${match.homeScore}:${match.awayScore}`,
      };
    case EVENT_TYPES.reminder:
      return {
        tag,
        title: `Gleich geht's los: ${teamName}`,
        body: `${matchTitle(match)} um ${match.time} Uhr${match.venueName ? ` in ${match.venueName}` : ""}.`,
      };
    default:
      return { tag, title: teamName, body: matchTitle(match) };
  }
}
