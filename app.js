import {
  getFavorites,
  getFavorite,
  getMatches,
  getTable,
  getPlayerStats,
  getTeamStats,
  addFavorite,
  addFavoriteFromUrl,
  removeFavorite,
  refreshTeam,
  refreshAllFavorites,
  getVenue,
  searchClubs,
  getClubTeams,
  resolveClubTeam,
  teamIdFor,
} from "./src/data/repository.js";
import { PLAYER_STAT_TYPES, TEAM_STATS_KEY } from "./src/data/models.js";
import { buildGoogleCalendarUrl, seasonCalendarLinks } from "./src/calendar.js";
import { looselyEquals } from "./src/teamNameUtils.js";
import { parseTeamPortraitLink } from "./src/parsers/nuligaUrlParser.js";
import { runSync } from "./src/sync.js";
import { pushSupported, getPushState, enablePush, disablePush, syncPushFavorites } from "./src/push.js";

const LAST_SYNC_KEY = "lastGlobalSyncAt";
const SYNC_INTERVAL_MS = 30 * 60 * 1000; // beim Öffnen höchstens alle 30 Min. alles neu laden
const TEAM_STALE_MS = 15 * 60 * 1000; // Team-Detail lädt im Hintergrund nach, wenn älter
const CHANGE_HINT_MS = 14 * 24 * 60 * 60 * 1000; // "geändert"-Hinweis 14 Tage lang zeigen
const BANNER_DISMISSED_KEY = "notifyBannerDismissedAt";

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

let backTarget = "#/";

function setHeader({ title, showBack = false, backTo = "#/", actions = [] }) {
  pageTitle.textContent = title;
  backBtn.hidden = !showBack;
  backTarget = backTo;
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

backBtn.addEventListener("click", () => navigate(backTarget));

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
      await renderAddTeam(query.get("link"), query.get("q"));
    } else if (parts[0] === "club" && parts[1]) {
      await renderClubTeams(decodeURIComponent(parts[1]), query.get("name") || "");
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
// Erster router()-Aufruf ganz am Ende der Datei, wenn alle Modul-Variablen initialisiert sind.

// ---------------------------------------------------------------------------
// Service Worker: Installierbarkeit, Offline-Hülle, Push-Mitteilungen
// ---------------------------------------------------------------------------

let swRegistration = null;

async function initServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register("./service-worker.js");
  } catch (err) {
    console.warn("Service Worker konnte nicht registriert werden:", err);
    return;
  }

  // Tippen auf eine Mitteilung schickt uns hier eine Nachricht mit dem
  // Ziel-Hash (siehe service-worker.js, notificationclick).
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data && event.data.type === "navigate") {
      const hash = event.data.hash || "#/";
      if (location.hash === hash) router();
      else navigate(hash);
    }
  });
}

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // privater Modus o.Ä. - dann eben ohne Merken
  }
}

async function syncIfStale() {
  try {
    const lastSync = Number(storageGet(LAST_SYNC_KEY)) || 0;
    if (lastSync && Date.now() - lastSync < SYNC_INTERVAL_MS) return;

    await runSync(swRegistration);
    storageSet(LAST_SYNC_KEY, String(Date.now()));

    // Falls wir gerade auf der Übersicht sind, Ergebnisse sofort anzeigen.
    if (!parseHash().parts.length) router();
  } catch (err) {
    console.warn("Sync beim Öffnen fehlgeschlagen:", err);
  }
}

async function syncPushQuietly(force = false) {
  try {
    await syncPushFavorites(swRegistration, await getFavorites(), { force });
  } catch (err) {
    console.warn("Favoriten konnten nicht an den Server übertragen werden:", err);
  }
}

initServiceWorker()
  .then(() => Promise.all([syncIfStale(), syncPushQuietly()]))
  .then(updateNotifyBanner);

// ---------------------------------------------------------------------------
// Mitteilungen aktivieren (Banner + Glocke in der Übersicht)
// ---------------------------------------------------------------------------

async function updateNotifyBanner() {
  const state = await getPushState(swRegistration);
  const dismissedAt = Number(storageGet(BANNER_DISMISSED_KEY)) || 0;
  const dismissedRecently = Date.now() - dismissedAt < 30 * 24 * 60 * 60 * 1000;
  const hasFavorites = (await getFavorites()).length > 0;
  notifyBanner.hidden = state !== "off" || dismissedRecently || !hasFavorites;
}

async function turnOnPush() {
  try {
    await enablePush(swRegistration, await getFavorites());
    showToast("Mitteilungen aktiviert");
  } catch (err) {
    showToast(err.message);
  }
  await updateNotifyBanner();
  if (!parseHash().parts.length) renderFavorites();
}

async function togglePush() {
  const state = await getPushState(swRegistration);
  if (state === "on") {
    if (!confirm("Mitteilungen für dieses Gerät ausschalten?")) return;
    await disablePush(swRegistration);
    showToast("Mitteilungen ausgeschaltet");
    renderFavorites();
  } else if (state === "denied") {
    alert(
      "Mitteilungen sind für diese App blockiert. Du kannst sie in Chrome unter Einstellungen → Website-Einstellungen → Benachrichtigungen wieder erlauben."
    );
  } else if (state === "unsupported") {
    alert("Dieser Browser unterstützt keine Push-Mitteilungen. Tipp: Die App in Chrome öffnen und installieren.");
  } else {
    turnOnPush();
  }
}

notifyBanner.querySelector("button.enable").addEventListener("click", turnOnPush);
notifyBanner.querySelector("button.dismiss").addEventListener("click", () => {
  storageSet(BANNER_DISMISSED_KEY, String(Date.now()));
  notifyBanner.hidden = true;
});

// ---------------------------------------------------------------------------
// Favoriten-Übersicht
// ---------------------------------------------------------------------------

async function renderFavorites() {
  const pushState = await getPushState(swRegistration);
  const bell = {
    on: { icon: "🔔", title: "Mitteilungen sind an – tippen zum Ausschalten" },
    off: { icon: "🔕", title: "Mitteilungen einschalten" },
    denied: { icon: "🔕", title: "Mitteilungen blockiert" },
    unsupported: null,
  }[pushState];
  setHeader({
    title: "Handball Favoriten",
    showBack: false,
    actions: [
      ...(bell ? [{ ...bell, onClick: togglePush }] : []),
      { icon: "⟳", title: "Alle aktualisieren", onClick: refreshAllFromList },
    ],
  });

  clearRoot();
  const favorites = await getFavorites();

  if (favorites.length === 0) {
    root.appendChild(
      el("div", { class: "empty-state" }, [
        el("div", { class: "big-icon", text: "🤾" }),
        el("h2", { text: "Noch keine Lieblingsmannschaft" }),
        el("p", { text: 'Tippe auf "+" und suche deinen Verein – z.B. "Jever".' }),
        el("button", { class: "btn", text: "Mannschaft suchen", onclick: () => navigate("#add") }),
      ])
    );
  } else {
    const list = el("div", {});
    const allMatches = await Promise.all(favorites.map((t) => getMatches(t.id)));
    favorites.forEach((team, i) => list.appendChild(renderFavoriteCard(team, allMatches[i])));
    root.appendChild(list);
  }

  root.appendChild(el("button", { class: "fab", title: "Mannschaft suchen", onclick: () => navigate("#add") }, "+"));
}

function renderFavoriteCard(team, matches = []) {
  const today = todayIso();
  const next = matches.find((m) => m.homeScore == null && m.date && m.date >= today);
  let nextLine = null;
  if (next) {
    const opponent = looselyEquals(next.homeTeam, team.clubName) ? next.awayTeam : next.homeTeam;
    const recentlyChanged = next.lastChange && Date.now() - next.lastChange.at < CHANGE_HINT_MS;
    nextLine = el("div", { class: "next" }, [
      `Nächstes Spiel: ${formatDateTime(next)} · ${opponent}`,
      recentlyChanged ? el("span", { class: "change-badge", text: "geändert" }) : null,
    ]);
  }
  const info = el("div", { class: "info" }, [
    el("div", { class: "name", text: team.displayName }),
    team.leagueName ? el("div", { class: "league", text: team.leagueName }) : null,
    nextLine,
    !team.lastSyncedAt ? el("div", { class: "hint", text: "Noch nicht aktualisiert – zum Öffnen tippen" }) : null,
  ]);

  const deleteBtn = el("button", { class: "delete-btn", title: "Favorit entfernen", text: "✕" });
  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!confirm(`"${team.displayName}" aus den Favoriten entfernen?`)) return;
    await removeFavorite(team.id);
    showToast("Favorit entfernt");
    syncPushQuietly(true);
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
  const outcomes = await refreshAllFavorites();
  showToast(outcomes.length === favorites.length ? "Aktualisiert" : "Nicht alle Favoriten konnten aktualisiert werden");
  renderFavorites();
}

// ---------------------------------------------------------------------------
// Team hinzufügen
// ---------------------------------------------------------------------------

async function afterFavoriteAdded(team) {
  showToast(`"${team.displayName}" hinzugefügt`);
  syncPushQuietly(true);
  updateNotifyBanner();
  navigate(`#team/${encodeURIComponent(team.id)}`);
}

async function renderAddTeam(prefillLink, prefillQuery) {
  setHeader({ title: "Mannschaft suchen", showBack: true });
  clearRoot();

  // --- Vereinssuche -------------------------------------------------------
  const input = el("input", {
    type: "search",
    placeholder: "Vereinsname oder Ort, z.B. Jever",
    enterkeyhint: "search",
    autocomplete: "off",
  });
  if (prefillQuery) input.value = prefillQuery;
  const searchBtn = el("button", { class: "btn", text: "Suchen" });
  const results = el("div", { class: "result-list" });

  async function search() {
    const query = input.value.trim();
    if (query.length < 3) {
      results.replaceChildren(el("p", { class: "hint-text", text: "Bitte mindestens 3 Zeichen eingeben." }));
      return;
    }
    history.replaceState(null, "", `#add?q=${encodeURIComponent(query)}`);
    lastSearchQuery = query;
    results.replaceChildren(el("div", { class: "spinner" }));
    searchBtn.disabled = true;
    try {
      const clubs = await searchClubs(query);
      results.replaceChildren();
      if (clubs.length === 0) {
        results.appendChild(el("p", { class: "hint-text", text: `Kein Verein zu „${query}“ gefunden.` }));
      }
      for (const club of clubs) {
        results.appendChild(
          el(
            "button",
            {
              class: "list-item",
              onclick: () => navigate(`#club/${encodeURIComponent(club.clubId)}?name=${encodeURIComponent(club.name)}`),
            },
            [
              el("div", { class: "info" }, [
                el("div", { class: "name", text: club.name }),
                club.members.length ? el("div", { class: "league", text: club.members.join(" · ") }) : null,
              ]),
              el("span", { class: "chevron", text: "›" }),
            ]
          )
        );
      }
    } catch (err) {
      results.replaceChildren(el("p", { class: "error-text", text: err.message }));
    }
    searchBtn.disabled = false;
  }
  searchBtn.addEventListener("click", search);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") search();
  });

  // --- Alternative: Link einfügen -----------------------------------------
  const textarea = el("textarea", { rows: "3", placeholder: "nuLiga-Mannschaftsportrait-Link hier einfügen …" });
  if (prefillLink) textarea.value = prefillLink;
  const errorBox = el("div", { class: "error-text" });
  errorBox.hidden = true;
  const submitBtn = el("button", { class: "btn secondary", text: "Link hinzufügen" });

  async function submitLink() {
    const value = textarea.value.trim();
    if (!value) return;
    submitBtn.disabled = true;
    submitBtn.textContent = "Wird geladen …";
    errorBox.hidden = true;
    try {
      await afterFavoriteAdded(await addFavoriteFromUrl(value));
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Link hinzufügen";
    }
  }
  submitBtn.addEventListener("click", submitLink);

  const linkSection = el("details", { class: "link-section" }, [
    el("summary", { text: "Oder: Link einer nuLiga-Mannschaftsseite einfügen" }),
    el("div", { class: "field" }, [textarea]),
    submitBtn,
    errorBox,
    el("div", { class: "info-box" }, [
      "Du kannst den Link auch direkt aus Chrome über „Teilen“ an diese App schicken, wenn sie installiert ist.",
    ]),
  ]);
  if (prefillLink) linkSection.open = true;

  root.appendChild(
    el("div", {}, [
      el("div", { class: "field" }, [
        el("label", { text: "Verein im Handballverband Niedersachsen-Bremen" }),
        el("div", { class: "search-row" }, [input, searchBtn]),
      ]),
      results,
      linkSection,
    ])
  );

  if (prefillLink) submitLink();
  else if (prefillQuery) search();
  else input.focus();
}

// ---------------------------------------------------------------------------
// Mannschaften eines Vereins
// ---------------------------------------------------------------------------

/** Zurück aus der Vereinsansicht führt wieder zur letzten Suche. */
let lastSearchQuery = null;
function lastSearchHash() {
  return lastSearchQuery ? `#add?q=${encodeURIComponent(lastSearchQuery)}` : "#add";
}

async function renderClubTeams(clubId, clubNameHint) {
  setHeader({ title: clubNameHint || "Verein", showBack: true, backTo: lastSearchHash() });
  clearRoot();
  root.appendChild(el("div", { class: "spinner" }));

  let data;
  try {
    data = await getClubTeams(clubId);
  } catch (err) {
    clearRoot();
    root.appendChild(el("p", { class: "error-text", text: err.message }));
    return;
  }
  const clubName = data.clubName || clubNameHint;
  setHeader({ title: clubName, showBack: true, backTo: lastSearchHash() });
  clearRoot();

  if (data.teams.length === 0) {
    root.appendChild(el("div", { class: "empty-state" }, "Für diesen Verein sind aktuell keine Mannschaften gemeldet."));
    return;
  }

  const favoriteKeys = new Set((await getFavorites()).map((f) => `${f.championship}|${f.group}`));
  let section = null;
  for (const team of data.teams) {
    if (team.section !== section) {
      section = team.section;
      root.appendChild(el("div", { class: "section-title", text: section || "Spielbetrieb" }));
    }
    const isFav = favoriteKeys.has(`${team.championship}|${team.group}`);
    const status = el("span", { class: isFav ? "fav-mark" : "chevron", text: isFav ? "★" : "+" });
    const item = el("button", { class: "list-item" + (isFav ? " is-favorite" : "") }, [
      el("div", { class: "info" }, [
        el("div", { class: "name", text: team.teamLabel }),
        el("div", { class: "league", text: team.leagueName + (team.rank ? ` · Platz ${team.rank}` : "") }),
      ]),
      status,
    ]);
    item.addEventListener("click", async () => {
      if (isFav) {
        const fav = (await getFavorites()).find((f) => f.championship === team.championship && f.group === team.group);
        if (fav) navigate(`#team/${encodeURIComponent(fav.id)}`);
        return;
      }
      item.disabled = true;
      status.textContent = "⏳";
      try {
        const { row, rows } = await resolveClubTeam(clubName, team);
        const chosen = row || (await pickTeamFromGroup(team, rows, clubName));
        if (!chosen) {
          item.disabled = false;
          status.textContent = "+";
          return;
        }
        await afterFavoriteAdded(
          await addFavorite({ teamtable: chosen.teamtable, championship: team.championship, group: team.group })
        );
      } catch (err) {
        showToast(err.message);
        item.disabled = false;
        status.textContent = "+";
      }
    });
    root.appendChild(item);
  }
}

/**
 * Wenn die Mannschaft in der Staffeltabelle nicht eindeutig erkennbar ist
 * (z.B. Spielgemeinschaften mit abgekürztem Namen), wählt der Nutzer selbst.
 * @returns {Promise<object|null>}
 */
function pickTeamFromGroup(clubTeam, rows, clubName) {
  return new Promise((resolve) => {
    const backdrop = el("div", { class: "modal-backdrop" });
    const sheet = el("div", { class: "modal-sheet" });
    backdrop.appendChild(sheet);
    const close = (value) => {
      backdrop.remove();
      resolve(value);
    };
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(null);
    });

    sheet.appendChild(
      el("div", { class: "close-row" }, [el("button", { class: "icon-btn dark", text: "✕", onclick: () => close(null) })])
    );
    sheet.appendChild(el("h2", { text: "Welche Mannschaft?" }));
    sheet.appendChild(el("p", { class: "hint-text", text: `${clubTeam.teamLabel} · ${clubTeam.leagueName}` }));
    const sorted = [...rows].sort(
      (a, b) => Number(looselyEquals(b.teamName, clubName)) - Number(looselyEquals(a.teamName, clubName))
    );
    for (const row of sorted) {
      sheet.appendChild(
        el(
          "button",
          { class: "list-item" + (looselyEquals(row.teamName, clubName) ? " suggested" : ""), onclick: () => close(row) },
          [el("div", { class: "info" }, [el("div", { class: "name", text: row.teamName })]), el("span", { class: "chevron", text: "+" })]
        )
      );
    }
    document.body.appendChild(backdrop);
  });
}

// ---------------------------------------------------------------------------
// Team-Detail (Spielplan / Tabelle / Statistik)
// ---------------------------------------------------------------------------

let activeDetailTab = "schedule";
let activeStatKey = TEAM_STATS_KEY;

async function renderTeamDetail(id) {
  let team = await getFavorite(id);
  if (!team) {
    navigate("#/");
    return;
  }

  let refreshing = false;
  const isCurrent = () => location.hash === `#team/${encodeURIComponent(id)}`;

  async function refresh({ quiet = false } = {}) {
    refreshing = true;
    renderHeader();
    try {
      await refreshTeam(id);
      team = (await getFavorite(id)) || team;
      if (!quiet) showToast("Aktualisiert");
    } catch (err) {
      if (!quiet) showToast("Aktualisierung fehlgeschlagen: " + err.message);
    }
    refreshing = false;
    if (!isCurrent()) return;
    renderHeader();
    renderBody();
  }

  function renderHeader() {
    if (!isCurrent()) return;
    setHeader({
      title: team.displayName,
      showBack: true,
      actions: [
        {
          icon: refreshing ? "⏳" : "⟳",
          title: "Aktualisieren",
          disabled: refreshing,
          onClick: () => refresh(),
        },
      ],
    });
  }
  renderHeader();

  async function renderBody() {
    const scrollY = window.scrollY;
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
    window.scrollTo(0, scrollY);
  }

  await renderBody();

  // z.B. nach Tippen auf eine Mitteilung: veraltete Daten still nachladen.
  if (!team.lastSyncedAt || Date.now() - team.lastSyncedAt > TEAM_STALE_MS) {
    refresh({ quiet: true });
  }
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

  let nextMarked = false;
  for (const match of matches) {
    const card = renderMatchCard(team, match);
    if (!nextMarked && match.homeScore == null && match.date && match.date >= todayIso()) {
      card.classList.add("next-match");
      card.id = "next-match";
      nextMarked = true;
    }
    container.appendChild(card);
  }
  return container;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatChangeValue(field, value) {
  if (!value) return "offen";
  if (field === "date") {
    const [y, m, d] = value.split("-");
    return `${d}.${m}.${y}`;
  }
  if (field === "time") return `${value} Uhr`;
  return value;
}

function renderMatchCard(team, match) {
  const dateLabel = formatDateTime(match);
  const row1 = el("div", { class: "row1" }, [
    dateLabel
      ? el("span", { text: dateLabel })
      : el("span", { class: "open-date", text: match.note || "Termin offen" }),
    el("span", { text: "Nr. " + match.matchNumber }),
  ]);

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

  let changeNote = null;
  if (match.lastChange && Date.now() - match.lastChange.at < CHANGE_HINT_MS && match.homeScore == null) {
    changeNote = el(
      "div",
      { class: "change-note" },
      [
        el("span", { class: "change-badge", text: "geändert" }),
        match.lastChange.changes
          .map((c) => `${c.label}: ${formatChangeValue(c.field, c.from)} → ${formatChangeValue(c.field, c.to)}`)
          .join(" · "),
      ]
    );
  }

  return el("div", { class: "match-card" + (changeNote ? " changed" : "") }, [row1, teamsLine, changeNote, row3]);
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
  for (const type of [{ key: TEAM_STATS_KEY, label: "Mannschaften" }, ...PLAYER_STAT_TYPES]) {
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

  if (activeStatKey === TEAM_STATS_KEY) {
    container.appendChild(renderTeamStats(team, await getTeamStats(team.id)));
    return container;
  }

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

/** Mannschaftsvergleich der Staffel (nuLiga "Gruppen- und Mannschaftsstatistik"). */
function renderTeamStats(team, stats) {
  const wrap = el("div", {});
  if (!stats.teams.length) {
    wrap.appendChild(el("div", { class: "empty-state" }, "Noch keine Mannschaftsstatistik – aktualisieren (⟳) lädt sie nach."));
    return wrap;
  }

  const v = (s, label, kind = "total") => (s.metrics[label] && s.metrics[label][kind]) || "–";
  const own = stats.teams.find((s) => looselyEquals(s.name, team.clubName));

  if (own) {
    const tiles = [
      ["Tore/Spiel", v(own, "Tore", "perGame")],
      ["7m-Quote", v(own, "7m-Trefferquote")],
      ["Zeitstrafen/Spiel", v(own, "Zeitstrafen gesamt", "perGame")],
      ["Zuschauer/Spiel", v(own, "Zuschauer", "perGame")],
    ].filter(([, value]) => value && value !== "–" && value !== "-");
    wrap.appendChild(
      el(
        "div",
        { class: "stat-tiles" },
        tiles.map(([label, value]) =>
          el("div", { class: "stat-tile" }, [el("div", { class: "value", text: value }), el("div", { class: "label", text: label })])
        )
      )
    );
  }

  const columns = [
    ["Sp", (s) => String(s.played ?? "–")],
    ["Tore", (s) => v(s, "Tore")],
    ["∅", (s) => v(s, "Tore", "perGame")],
    ["7m", (s) => `${v(s, "7m-Tore")}/${v(s, "7m-Versuche")}`],
    ["7m %", (s) => v(s, "7m-Trefferquote")],
    ["2 Min", (s) => v(s, "Zeitstrafen gesamt")],
    ["Gelb", (s) => v(s, "Gelbe Karten")],
    ["Rot", (s) => v(s, "Rote Karten")],
  ];
  const sorted = [...stats.teams].sort(
    (a, b) => parseFloat(v(b, "Tore", "perGame").replace(",", ".")) - parseFloat(v(a, "Tore", "perGame").replace(",", ".")) || 0
  );

  const table = el("table", { class: "data-table" });
  table.appendChild(el("tr", {}, [el("th", { text: "Mannschaft" }), ...columns.map(([h]) => el("th", { text: h }))]));
  for (const s of sorted) {
    table.appendChild(
      el("tr", { class: s === own ? "own-team" : "" }, [el("td", { text: s.name }), ...columns.map(([, f]) => el("td", { text: f(s) }))])
    );
  }
  wrap.appendChild(el("div", { style: "overflow-x:auto;" }, table));

  if (stats.group) {
    wrap.appendChild(
      el("p", {
        class: "hint-text",
        text: `Staffel gesamt: ${stats.group.played} Spiele · ${v(stats.group, "Tore", "perGame")} Tore/Spiel · 7m-Quote ${v(
          stats.group,
          "7m-Trefferquote"
        )}`,
      })
    );
  }
  return wrap;
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

router();
