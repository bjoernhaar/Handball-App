import {
  getFavorites,
  getFavorite,
  getMatches,
  getTable,
  getPlayerStats,
  addFavoriteFromUrl,
  removeFavorite,
  refreshTeam,
  getVenue,
} from "./src/data/repository.js";
import { PLAYER_STAT_TYPES } from "./src/data/models.js";
import { buildGoogleCalendarUrl, seasonCalendarLinks } from "./src/calendar.js";
import { looselyEquals } from "./src/teamNameUtils.js";
import { parseTeamPortraitLink } from "./src/parsers/nuligaUrlParser.js";
import { runSync } from "./src/sync.js";

const LAST_SYNC_KEY = "lastGlobalSyncAt";
const SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 Stunden, wie in den anderen Varianten
const SYNC_TAG = "handball-sync";

const root = document.getElementById("app-root");
const pageTitle = document.getElementById("pageTitle");
const backBtn = document.getElementById("backBtn");
const topbarActions = document.getElementById("topbarActions");
const toastEl = document.getElementById("toast");
const notifyBanner = document.getElementById("notifyBanner");

let toastTimer = null;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 3500);
}

function navigate(hash) {
  location.hash = hash;
}

function setHeader({ title, showBack = false, actions = [] }) {
  pageTitle.textContent = title;
  backBtn.hidden = !showBack;
  topbarActions.innerHTML = "";
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.className = "icon-btn";
    btn.title = action.title;
    btn.setAttribute("aria-label", action.title);
    btn.textContent = action.icon;
    btn.disabled = !!action.disabled;
    btn.addEventListener("click", action.onClick);
    topbarActions.appendChild(btn);
  }
}

backBtn.addEventListener("click", () => navigate("#/"));

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function clearRoot() {
  root.innerHTML = "";
}

/** Öffnet einen Link in einem neuen Tab - Pendant zu chrome.tabs.create({url}). */
function openLink(url) {
  window.open(url, "_blank", "noopener");
}

// ---------------------------------------------------------------------------
// Web Share Target: kam die App über "Teilen" aus Chrome mit einem
// nuLiga-Link, wird der Link direkt ins "Team hinzufügen"-Formular
// übernommen (Pendant zum Android-Teilen-Intent bzw. zum Kontextmenü der
// Chrome-Erweiterung). Siehe manifest.webmanifest ("share_target").
// ---------------------------------------------------------------------------

(function handleShareTarget() {
  const params = new URLSearchParams(location.search);
  const shared = params.get("url") || params.get("text") || params.get("title");
  if (!shared) return;
  history.replaceState(null, "", location.pathname + location.hash);
  const parsed = parseTeamPortraitLink(shared);
  const link = parsed ? parsed.normalizedUrl : shared;
  location.hash = `#add?link=${encodeURIComponent(link)}`;
})();

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function parseHash() {
  const hash = location.hash.replace(/^#/, "");
  const [pathPart, queryPart] = hash.split("?");
  const query = new URLSearchParams(queryPart || "");
  const parts = pathPart.split("/").filter(Boolean);
  return { parts, query };
}

async function router() {
  const { parts, query } = parseHash();
  try {
    if (parts[0] === "add") {
      await renderAddTeam(query.get("link"));
    } else if (parts[0] === "team" && parts[1]) {
      await renderTeamDetail(decodeURIComponent(parts[1]));
    } else {
      await renderFavorites();
    }
  } catch (err) {
    console.error(err);
    clearRoot();
    root.appendChild(el("div", { class: "empty-state" }, [
      el("div", { class: "big-icon", text: "⚠️" }),
      el("p", { text: "Etwas ist schiefgelaufen: " + err.message }),
      el("button", { class: "btn", text: "Zur Übersicht", onclick: () => navigate("#/") }),
    ]));
  }
}

window.addEventListener("hashchange", router);
router();

// ---------------------------------------------------------------------------
// Service Worker: Installierbarkeit, Offline-Hülle, Hintergrund-Sync
// ---------------------------------------------------------------------------

let swRegistration = null;

async function initServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register("./service-worker.js", { type: "module" });
  } catch (err) {
    console.warn("Service Worker konnte nicht registriert werden:", err);
    return;
  }

  // Tippen auf eine Benachrichtigung schickt uns hier eine Nachricht mit dem
  // Ziel-Hash (siehe service-worker.js, notificationclick).
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data && event.data.type === "navigate") {
      navigate(event.data.hash || "#/");
    }
  });

  // Periodic Background Sync: nur in Chrome/Edge auf Android, nur für
  // installierte Apps, und nur wenn Chrome die Seite als "oft genutzt"
  // einstuft - rein optionaler Zusatz, kein Ersatz für den zuverlässigen
  // Sync-beim-Öffnen unten.
  try {
    const reg = await navigator.serviceWorker.ready;
    if ("periodicSync" in reg && "permissions" in navigator) {
      const status = await navigator.permissions.query({ name: "periodic-background-sync" });
      if (status.state === "granted") {
        await reg.periodicSync.register(SYNC_TAG, { minInterval: SYNC_INTERVAL_MS });
      }
    }
  } catch (err) {
    // Nicht unterstützt oder nicht erlaubt - kein Problem, siehe Hinweis oben.
    console.info("Periodic Background Sync nicht verfügbar:", err.message);
  }
}

async function syncIfStale() {
  try {
    const stored = localStorage.getItem(LAST_SYNC_KEY);
    const lastSync = stored ? Number(stored) : 0;
    if (lastSync && Date.now() - lastSync < SYNC_INTERVAL_MS) return;

    const reg = swRegistration || (await navigator.serviceWorker.ready.catch(() => null));
    await runSync(reg);
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));

    // Falls wir gerade auf der Übersicht sind, Ergebnisse sofort anzeigen.
    if (!parseHash().parts.length) router();
  } catch (err) {
    console.warn("Sync beim Öffnen fehlgeschlagen:", err);
  }
}

initServiceWorker().then(syncIfStale);

// ---------------------------------------------------------------------------
// Benachrichtigungen aktivieren (Banner)
// ---------------------------------------------------------------------------

function updateNotifyBanner() {
  if (!("Notification" in window) || Notification.permission !== "default") {
    notifyBanner.hidden = true;
    return;
  }
  notifyBanner.hidden = false;
}

notifyBanner.querySelector("button.enable").addEventListener("click", async () => {
  try {
    await Notification.requestPermission();
  } finally {
    updateNotifyBanner();
  }
});
notifyBanner.querySelector("button.dismiss").addEventListener("click", () => {
  notifyBanner.hidden = true;
});
updateNotifyBanner();

// ---------------------------------------------------------------------------
// Favoriten-Übersicht
// ---------------------------------------------------------------------------

async function renderFavorites() {
  setHeader({
    title: "Handball Favoriten",
    showBack: false,
    actions: [{ icon: "⟳", title: "Alle aktualisieren", onClick: refreshAllFromList }],
  });

  clearRoot();
  const favorites = await getFavorites();

  if (favorites.length === 0) {
    root.appendChild(
      el("div", { class: "empty-state" }, [
        el("div", { class: "big-icon", text: "🤾" }),
        el("h2", { text: "Noch keine Lieblingsmannschaft" }),
        el("p", {
          text:
            'Füge über "+" den Link einer nuLiga-Mannschaftsseite (teamPortrait) hinzu, z.B. von hvnb-handball.liga.nu.',
        }),
      ])
    );
  } else {
    const list = el("div", {});
    for (const team of favorites) {
      list.appendChild(renderFavoriteCard(team));
    }
    root.appendChild(list);
  }

  root.appendChild(el("button", { class: "fab", title: "Team hinzufügen", onclick: () => navigate("#add") }, "+"));
}

function renderFavoriteCard(team) {
  const info = el("div", { class: "info" }, [
    el("div", { class: "name", text: team.displayName }),
    team.leagueName ? el("div", { class: "league", text: team.leagueName }) : null,
    !team.lastSyncedAt ? el("div", { class: "hint", text: "Noch nicht aktualisiert – zum Öffnen tippen" }) : null,
  ]);

  const deleteBtn = el("button", { class: "delete-btn", title: "Favorit entfernen", text: "✕" });
  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!confirm(`"${team.displayName}" aus den Favoriten entfernen?`)) return;
    await removeFavorite(team.id);
    showToast("Favorit entfernt");
    renderFavorites();
  });

  const card = el("div", { class: "favorite-card", onclick: () => navigate(`#team/${encodeURIComponent(team.id)}`) }, [
    info,
    deleteBtn,
  ]);
  return card;
}

async function refreshAllFromList() {
  showToast("Aktualisiere alle Favoriten …");
  const favorites = await getFavorites();
  await Promise.all(favorites.map((t) => refreshTeam(t.id).catch((err) => console.warn(err))));
  showToast("Aktualisiert");
  renderFavorites();
}

// ---------------------------------------------------------------------------
// Team hinzufügen
// ---------------------------------------------------------------------------

async function renderAddTeam(prefillLink) {
  setHeader({ title: "Team hinzufügen", showBack: true });
  clearRoot();

  const textarea = el("textarea", { rows: "3", placeholder: "nuLiga-Mannschaftsportrait-Link hier einfügen …" });
  if (prefillLink) textarea.value = prefillLink;

  const errorBox = el("div", { class: "error-text" });
  errorBox.hidden = true;

  const submitBtn = el("button", { class: "btn", text: "Hinzufügen" });

  async function submit() {
    const value = textarea.value.trim();
    if (!value) return;
    submitBtn.disabled = true;
    submitBtn.textContent = "Wird geladen …";
    errorBox.hidden = true;
    try {
      const team = await addFavoriteFromUrl(value);
      showToast(`"${team.displayName}" hinzugefügt`);
      navigate(`#team/${encodeURIComponent(team.id)}`);
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Hinzufügen";
    }
  }
  submitBtn.addEventListener("click", submit);

  root.appendChild(
    el("div", {}, [
      el("div", { class: "field" }, [el("label", { text: "Link der teamPortrait-Seite" }), textarea]),
      submitBtn,
      errorBox,
      el("div", { class: "info-box" }, [
        "Tipp: Auf hvnb-handball.liga.nu die Mannschaftsseite („Mannschaftsportrait“) öffnen, Link kopieren und hier einfügen. " +
          "Du kannst den Link auch direkt aus Chrome über „Teilen“ an diese App schicken, wenn sie installiert ist.",
      ]),
    ])
  );

  if (prefillLink) {
    submit();
  }
}

// ---------------------------------------------------------------------------
// Team-Detail (Spielplan / Tabelle / Statistik)
// ---------------------------------------------------------------------------

let activeDetailTab = "schedule";
let activeStatKey = PLAYER_STAT_TYPES[0].key;

async function renderTeamDetail(id) {
  const team = await getFavorite(id);
  if (!team) {
    navigate("#/");
    return;
  }

  let refreshing = false;

  const renderHeader = () => {
    setHeader({
      title: team.displayName,
      showBack: true,
      actions: [
        {
          icon: refreshing ? "⏳" : "⟳",
          title: "Aktualisieren",
          disabled: refreshing,
          onClick: async () => {
            refreshing = true;
            renderHeader();
            try {
              await refreshTeam(id);
              showToast("Aktualisiert");
            } catch (err) {
              showToast("Aktualisierung fehlgeschlagen: " + err.message);
            }
            refreshing = false;
            renderBody();
          },
        },
      ],
    });
  };
  renderHeader();

  async function renderBody() {
    clearRoot();

    const tabs = el("div", { class: "tabs" });
    const tabDefs = [
      ["schedule", "Spielplan"],
      ["table", "Tabelle"],
      ["stats", "Statistik"],
    ];
    for (const [key, label] of tabDefs) {
      const btn = el("button", {
        class: "tab-btn" + (activeDetailTab === key ? " active" : ""),
        text: label,
        onclick: () => {
          activeDetailTab = key;
          renderBody();
        },
      });
      tabs.appendChild(btn);
    }
    root.appendChild(tabs);

    const content = el("div", {});
    root.appendChild(content);
    content.appendChild(el("div", { class: "spinner" }));

    if (activeDetailTab === "schedule") {
      const matches = await getMatches(id);
      content.innerHTML = "";
      content.appendChild(renderScheduleTab(team, matches));
    } else if (activeDetailTab === "table") {
      const rows = await getTable(id);
      content.innerHTML = "";
      content.appendChild(renderTableTab(team, rows));
    } else {
      content.innerHTML = "";
      content.appendChild(await renderStatsTab(team));
    }
  }

  await renderBody();
}

function renderScheduleTab(team, matches) {
  const container = el("div", {});
  const { downloadUrl } = seasonCalendarLinks(team);
  if (downloadUrl) {
    container.appendChild(
      el(
        "button",
        {
          class: "btn secondary",
          style: "margin-bottom:14px;",
          onclick: () => openLink(downloadUrl),
        },
        "📅 Kompletten Spielplan abonnieren"
      )
    );
  }

  if (matches.length === 0) {
    container.appendChild(el("div", { class: "empty-state" }, "Noch keine Spieltermine geladen."));
    return container;
  }

  for (const match of matches) {
    container.appendChild(renderMatchCard(team, match));
  }
  return container;
}

function renderMatchCard(team, match) {
  const dateLabel = formatDateTime(match);
  const row1 = el("div", { class: "row1" }, [el("span", { text: dateLabel }), el("span", { text: "Nr. " + match.matchNumber })]);

  const homeIsOwn = looselyEquals(match.homeTeam, team.clubName);
  const awayIsOwn = looselyEquals(match.awayTeam, team.clubName);
  const teamsLine = el("div", { class: "teams" }, [
    el(homeIsOwn ? "b" : "span", { class: homeIsOwn ? "own" : "", text: match.homeTeam }),
    document.createTextNode(" – "),
    el(awayIsOwn ? "b" : "span", { class: awayIsOwn ? "own" : "", text: match.awayTeam }),
  ]);

  const hasResult = match.homeScore != null && match.awayScore != null;
  if (hasResult) {
    teamsLine.appendChild(document.createTextNode("  "));
    teamsLine.appendChild(el("span", { class: "score", text: `${match.homeScore}:${match.awayScore}` }));
    if (match.halftimeInfo) {
      teamsLine.appendChild(el("span", { class: "halftime", text: `(${match.halftimeInfo})` }));
    }
  }

  const row3 = el("div", { class: "row3" });
  if (match.venueName) {
    row3.appendChild(
      el("button", { class: "chip", title: match.venueName, onclick: () => openVenueModal(team, match) }, "📍 " + match.venueName)
    );
  } else {
    row3.appendChild(el("span"));
  }

  const calUrl = buildGoogleCalendarUrl(match, team);
  if (calUrl) {
    row3.appendChild(
      el(
        "button",
        {
          class: "icon-link",
          title: "Zum Google Kalender hinzufügen",
          onclick: () => openLink(calUrl),
        },
        "🗓️"
      )
    );
  }

  return el("div", { class: "match-card" }, [row1, teamsLine, row3]);
}

function formatDateTime(match) {
  const dayNames = { Mo: "Mo", Di: "Di", Mi: "Mi", Do: "Do", Fr: "Fr", Sa: "Sa", So: "So" };
  const day = match.dayOfWeek && dayNames[match.dayOfWeek] ? dayNames[match.dayOfWeek] + ", " : "";
  let dateStr = "";
  if (match.date) {
    const [y, m, d] = match.date.split("-");
    dateStr = `${d}.${m}.${y}`;
  }
  const timeStr = match.time ? ` · ${match.time} Uhr` : "";
  return `${day}${dateStr}${timeStr}`;
}

function renderTableTab(team, rows) {
  if (rows.length === 0) {
    return el("div", { class: "empty-state" }, "Noch keine Tabelle geladen.");
  }
  const table = el("table", { class: "data-table" });
  table.appendChild(
    el("tr", {}, [
      el("th", { text: "#" }),
      el("th", { text: "Mannschaft" }),
      el("th", { text: "Sp" }),
      el("th", { text: "S" }),
      el("th", { text: "U" }),
      el("th", { text: "N" }),
      el("th", { text: "Tore" }),
      el("th", { text: "+/-" }),
      el("th", { text: "Pkt" }),
    ])
  );
  for (const row of rows) {
    const isOwn = (team.teamtable && row.teamtable === team.teamtable) || looselyEquals(row.teamName, team.clubName);
    const diff = row.goalsFor - row.goalsAgainst;
    table.appendChild(
      el("tr", { class: isOwn ? "own-team" : "" }, [
        el("td", { text: String(row.rank) }),
        el("td", { text: row.teamName }),
        el("td", { text: String(row.played) }),
        el("td", { text: String(row.wins) }),
        el("td", { text: String(row.draws) }),
        el("td", { text: String(row.losses) }),
        el("td", { text: `${row.goalsFor}:${row.goalsAgainst}` }),
        el("td", { text: (diff > 0 ? "+" : "") + diff }),
        el("td", { text: `${row.pointsFor}:${row.pointsAgainst}` }),
      ])
    );
  }
  return el("div", { style: "overflow-x:auto;" }, table);
}

async function renderStatsTab(team) {
  const container = el("div", {});
  const chips = el("div", { class: "stat-chips" });
  for (const type of PLAYER_STAT_TYPES) {
    chips.appendChild(
      el("button", {
        class: "stat-chip" + (activeStatKey === type.key ? " active" : ""),
        text: type.label,
        onclick: async () => {
          activeStatKey = type.key;
          const body = await renderStatsTab(team);
          const parent = container.parentElement;
          parent.replaceChild(body, container);
        },
      })
    );
  }
  container.appendChild(chips);

  const type = PLAYER_STAT_TYPES.find((t) => t.key === activeStatKey);
  const rows = await getPlayerStats(team.id, activeStatKey);

  if (rows.length === 0) {
    container.appendChild(el("div", { class: "empty-state" }, "Keine Daten für " + type.label + "."));
    return container;
  }

  const table = el("table", { class: "data-table" });
  table.appendChild(
    el("tr", {}, [
      el("th", { text: "#" }),
      el("th", { text: "Spieler" }),
      el("th", { text: "Verein" }),
      el("th", { text: type.label }),
      el("th", { text: "Spiele" }),
      el("th", { text: "∅" }),
    ])
  );
  for (const row of rows) {
    const isOwn = looselyEquals(row.club, team.clubName);
    table.appendChild(
      el("tr", { class: isOwn ? "own-team" : "" }, [
        el("td", { text: row.rank }),
        el("td", { text: row.playerName }),
        el("td", { text: row.club }),
        el("td", { text: row.value }),
        el("td", { text: row.matchesPlayed || "–" }),
        el("td", { text: row.average || "–" }),
      ])
    );
  }
  container.appendChild(el("div", { style: "overflow-x:auto;" }, table));
  return container;
}

// ---------------------------------------------------------------------------
// Spielort-Modal
// ---------------------------------------------------------------------------

async function openVenueModal(team, match) {
  const backdrop = el("div", { class: "modal-backdrop", onclick: (e) => { if (e.target === backdrop) close(); } });
  const sheet = el("div", { class: "modal-sheet" });
  backdrop.appendChild(sheet);

  function close() {
    backdrop.remove();
  }

  sheet.appendChild(el("div", { class: "close-row" }, [el("button", { class: "icon-btn", style: "color:#333;", text: "✕", onclick: close })]));
  sheet.appendChild(el("h2", { text: match.venueName || "Spielstätte" }));
  const body = el("div", {}, [el("div", { class: "spinner" })]);
  sheet.appendChild(body);
  document.body.appendChild(backdrop);

  if (!match.venueLocationId) {
    body.innerHTML = "";
    body.appendChild(el("p", { text: "Für diese Halle liegt keine Adresse vor." }));
    return;
  }

  try {
    const venue = await getVenue(team.host, match.venueLocationId);
    body.innerHTML = "";
    if (!venue) {
      body.appendChild(el("p", { text: "Für diese Halle liegt keine Adresse vor." }));
      return;
    }
    if (venue.street) body.appendChild(el("p", { text: venue.street }));
    if (venue.zipCity) body.appendChild(el("p", { text: venue.zipCity }));
    if (venue.phone) body.appendChild(el("p", { text: "☎ " + venue.phone }));
    if (venue.mapsUrl) {
      body.appendChild(
        el(
          "button",
          { class: "btn", style: "margin-top:12px;width:100%;", onclick: () => openLink(venue.mapsUrl) },
          "🧭 Route planen"
        )
      );
    }
  } catch (err) {
    body.innerHTML = "";
    body.appendChild(el("p", { class: "error-text", text: "Adresse konnte nicht geladen werden: " + err.message }));
  }
}
