// Baut den "Termin einfügen"-Link für den Google Kalender - kein OAuth, keine
// Kalender-Berechtigung nötig, einfach ein Klick öffnet einen vorausgefüllten
// Termin-Entwurf, den man dort mit einem weiteren Klick speichert. Das
// Pendant zum ACTION_INSERT-Intent der Android-Version.

const DEFAULT_DURATION_MINUTES = 90; // nuLiga liefert keine Spieldauer (wie in der Android-Version dokumentiert)

function pad(n) {
  return String(n).padStart(2, "0");
}

function toGoogleDateTime(date) {
  return (
    date.getFullYear().toString() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    "T" +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    "00"
  );
}

/**
 * @param {import('./data/models.js').Match} match
 * @param {import('./data/models.js').FavoriteTeam} team
 * @returns {string|null} Google-Calendar-"render"-URL, oder null wenn Datum/Zeit fehlen.
 */
export function buildGoogleCalendarUrl(match, team) {
  if (!match.date || !match.time) return null;

  const start = new Date(`${match.date}T${match.time}:00`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + DEFAULT_DURATION_MINUTES * 60 * 1000);

  const title = `${match.homeTeam} - ${match.awayTeam}`;
  const detailsLines = [team.leagueName, match.matchNumber ? `Spiel Nr. ${match.matchNumber}` : null].filter(Boolean);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${toGoogleDateTime(start)}/${toGoogleDateTime(end)}`,
    details: detailsLines.join("\n"),
    ctz: "Europe/Berlin",
  });
  if (match.venueName) params.set("location", match.venueName);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Für das "kompletten Spielplan abonnieren": nuLiga liefert unter derselben
 * URL sowohl einen direkten https-ICS-Download als auch dieselbe Adresse
 * mit webcal://-Schema (für Kalender-Apps mit Protokoll-Handler). Wir öffnen
 * primär den https-Link (funktioniert überall als Download) und geben die
 * URL zusätzlich zurück, damit die UI sie zum Abonnieren-per-URL kopieren
 * lassen kann (z.B. Google Kalender: "Weitere Kalender" -> "Per URL").
 */
export function seasonCalendarLinks(team) {
  return {
    downloadUrl: team.icsDownloadUrl || null,
    webcalUrl: team.icsWebcalUrl || null,
  };
}
