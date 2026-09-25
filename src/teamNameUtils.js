// Erkennt das "eigene" Team in Tabelle/Statistik/Spielplan per unscharfem
// Namensvergleich (nuLiga schreibt Vereinsnamen nicht überall exakt gleich,
// z.B. mit/ohne Zusatz "1." oder abweichende Schreibweisen von Sonderzeichen).

export function shortClubName(name) {
  return (name || "").replace(/\s+\d\.\s*$/, "").trim();
}

function normalize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9äöüß]+/gi, "");
}

export function looselyEquals(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}
