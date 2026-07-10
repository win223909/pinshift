import { CheckCircle2, Clipboard, Crosshair, ExternalLink, LocateFixed, MapPin, Power, RefreshCcw, Search, Star, Trash2, ShieldCheck } from "lucide-react";
import L from "leaflet";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { localeStorageKey, readLocale, translate } from "./i18n";
import type { Locale, MessageKey, Translate, UiMessage } from "./i18n";

type ClientId = "shadowrocket" | "stash";

type Pin = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

type Favorite = Pin & {
  id: string;
  name: string;
  createdAt: string;
};

type SearchResult = {
  place_id?: number;
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
};

type StatusPayload = {
  ok: boolean;
  runtime?: string;
  settings?: (Pin & { enabled?: boolean; updatedAt?: string }) | null;
  diagnostics?: {
    lastControlAt?: string;
    lastWlocAt?: string;
    patched?: boolean;
    error?: string;
    envelope?: string;
    hits?: number;
  };
};

const clients: Array<{ id: ClientId; name: string; moduleFile: string; importHintKey: MessageKey }> = [
  {
    id: "shadowrocket",
    name: "Shadowrocket",
    moduleFile: "pinshift-shadowrocket.module",
    importHintKey: "clientShadowrocketHint",
  },
  {
    id: "stash",
    name: "Stash",
    moduleFile: "pinshift-stash.stoverride",
    importHintKey: "clientStashHint",
  },
];

const defaultPin: Pin = {
  latitude: 37.3349,
  longitude: -122.00902,
  accuracy: 25,
};

const controlOrigin = "https://gs-loc.apple.com";
const favoritesKey = "pinshift_favorites_v1";
const urlPin = readPinFromUrl();

function App() {
  const [locale, setLocale] = useState<Locale>(() => readLocale());
  const t: Translate = (key, values) => translate(locale, key, values);
  const [pin, setPin] = useState<Pin>(urlPin || defaultPin);
  const [markerPosition, setMarkerPosition] = useState<Pin>(urlPin || defaultPin);
  const [currentLocation, setCurrentLocation] = useState<Pin | null>(null);
  const [favorites, setFavorites] = useState<Favorite[]>(() => readFavorites());
  const [favoriteName, setFavoriteName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchMessage, setSearchMessage] = useState<UiMessage | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [clientId, setClientId] = useState<ClientId>("shadowrocket");
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [message, setMessage] = useState<UiMessage>({ key: urlPin ? "initialImported" : "initialSetup" });
  const [lastError, setLastError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const currentMarkerRef = useRef<L.Marker | null>(null);
  const lastSearchAtRef = useRef(0);

  const baseUrl = useMemo(() => window.location.origin + normalizedBasePath(), []);
  const selectedClient = clients.find((client) => client.id === clientId) || clients[0];
  const moduleUrl = `${baseUrl}/modules/${selectedClient.moduleFile}`;
  const saveUrl = `${controlOrigin}/pinshift/save?lat=${encodeURIComponent(pin.latitude)}&lon=${encodeURIComponent(pin.longitude)}&accuracy=${encodeURIComponent(pin.accuracy)}`;
  const clearUrl = `${controlOrigin}/pinshift/clear`;
  const statusUrl = `${controlOrigin}/pinshift/status`;

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      window.localStorage.setItem(localeStorageKey, locale);
    } catch {
      // Language still works for this session when storage is unavailable.
    }
    setSearchResults([]);
    setSearchMessage(null);
  }, [locale]);

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return;

    const icon = L.divIcon({
      className: "pin-marker",
      html: "<span></span>",
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    const map = L.map(mapElementRef.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView([markerPosition.latitude, markerPosition.longitude], 15);

    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    const marker = L.marker([markerPosition.latitude, markerPosition.longitude], { icon, draggable: true }).addTo(map);
    marker.on("dragend", () => {
      selectMapLatLng(marker.getLatLng());
    });
    map.on("click", (event) => {
      selectMapLatLng(event.latlng);
    });

    mapRef.current = map;
    markerRef.current = marker;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    markerRef.current?.setLatLng([markerPosition.latitude, markerPosition.longitude]);
  }, [markerPosition.latitude, markerPosition.longitude]);

  useEffect(() => {
    window.localStorage.setItem(favoritesKey, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    if (!mapRef.current || !currentLocation) return;

    const icon = L.divIcon({
      className: "current-marker",
      html: "<span></span>",
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });

    if (!currentMarkerRef.current) {
      currentMarkerRef.current = L.marker([currentLocation.latitude, currentLocation.longitude], { icon }).addTo(mapRef.current);
    } else {
      currentMarkerRef.current.setLatLng([currentLocation.latitude, currentLocation.longitude]);
    }
  }, [currentLocation]);

  async function saveLocation() {
    await callControl(saveUrl, "saveSuccess");
  }

  async function restoreLocation() {
    await callControl(clearUrl, "restoreSuccess");
  }

  async function refreshStatus() {
    await callControl(statusUrl, "statusRefreshed");
  }

  function locateCurrentPosition() {
    if (!window.isSecureContext) {
      setMessage({ key: "secureContextRequired" });
      return;
    }

    if (!navigator.geolocation) {
      setMessage({ key: "geolocationUnsupported" });
      return;
    }

    setBusy(true);
    setMessage({ key: "locating" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = {
          latitude: normalizeLatitude(position.coords.latitude),
          longitude: normalizeLongitude(position.coords.longitude),
          accuracy: normalizeAccuracy(position.coords.accuracy || 25),
        };
        setCurrentLocation(next);
        setTargetPin(next);
        mapRef.current?.setView([next.latitude, next.longitude], Math.max(mapRef.current.getZoom(), 15));
        setMessage({ key: "locationLoaded" });
        setBusy(false);
      },
      (error) => {
        setMessage({ key: "locationError", values: { detail: error.message || t("locationPermission") } });
        setBusy(false);
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 12000 },
    );
  }

  function saveFavorite() {
    const name = favoriteName.trim() || t("favoriteDefault", { count: favorites.length + 1 });
    const next: Favorite = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      latitude: pin.latitude,
      longitude: pin.longitude,
      accuracy: pin.accuracy,
      createdAt: new Date().toISOString(),
    };
    setFavorites((current) => [next, ...current].slice(0, 30));
    setFavoriteName("");
    setMessage({ key: "favoriteSaved", values: { name } });
  }

  function applyFavorite(favorite: Favorite) {
    const next = {
      latitude: favorite.latitude,
      longitude: favorite.longitude,
      accuracy: favorite.accuracy,
    };
    setTargetPin(next);
    mapRef.current?.setView([next.latitude, next.longitude], Math.max(mapRef.current.getZoom(), 15));
    setMessage({ key: "favoriteSelected", values: { name: favorite.name } });
  }

  function removeFavorite(id: string) {
    setFavorites((current) => current.filter((favorite) => favorite.id !== id));
  }

  async function searchPlaces(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchMessage({ key: "searchEmpty" });
      return;
    }

    setSearchBusy(true);
    setSearchMessage({ key: "searching" });
    try {
      const now = Date.now();
      if (now - lastSearchAtRef.current < 1100) {
        setSearchMessage({ key: "searchTooFast" });
        return;
      }
      lastSearchAtRef.current = now;
      const params = new URLSearchParams({
        q: query,
        format: "jsonv2",
        addressdetails: "1",
        limit: "6",
        "accept-language": locale,
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as SearchResult[];
      const results = data.filter((item) => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)));
      setSearchResults(results);
      setSearchMessage(results.length ? { key: "searchFound", values: { count: results.length } } : { key: "searchNone" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setSearchResults([]);
      setSearchMessage({ key: "searchFailed", values: { detail } });
    } finally {
      setSearchBusy(false);
    }
  }

  function applySearchResult(result: SearchResult) {
    const next = {
      latitude: normalizeLatitude(Number(result.lat)),
      longitude: normalizeLongitude(Number(result.lon)),
      accuracy: pin.accuracy,
    };
    setTargetPin(next);
    mapRef.current?.setView([next.latitude, next.longitude], Math.max(mapRef.current.getZoom(), 16));
    setSearchQuery(result.display_name);
    setSearchMessage({ key: "searchSelected", values: { name: formatSearchTitle(result.display_name) } });
  }

  function selectMapLatLng(value: L.LatLng) {
    const display = {
      latitude: roundCoord(value.lat),
      longitude: roundCoord(value.lng),
      accuracy: pin.accuracy,
    };
    const next = normalizePin(display);
    setMarkerPosition(display);
    setPin(next);
  }

  function setTargetPin(next: Pin) {
    const normalized = normalizePin(next);
    setPin(normalized);
    setMarkerPosition(normalized);
  }

  async function callControl(url: string, okMessage: MessageKey) {
    setBusy(true);
    setMessage({ key: "controlRequest" });
    try {
      const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`, { cache: "no-store" });
      const data = (await response.json()) as StatusPayload;
      setStatus(data);
      setLastError("");
      setMessage(
        data.ok && data.runtime
          ? { key: "controlConnected", values: { message: t(okMessage), runtime: data.runtime } }
          : data.ok
            ? { key: okMessage }
            : { key: "controlFailed", values: { detail: JSON.stringify(data) } },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setLastError(detail);
      setStatus(null);
      setMessage({ key: "controlUnavailable", values: { detail } });
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, label: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        fallbackCopy(text);
      }
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1400);
    } catch {
      fallbackCopy(text);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1400);
    }
  }

  function openUrl(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <main className="app-shell">
      <section className="map-pane">
        <div className="map-topbar">
          <div className="brand">
            <div className="brand-mark">
              <MapPin size={20} />
            </div>
            <div>
              <h1>PinShift</h1>
              <p>{t("brandTagline")}</p>
            </div>
          </div>
          <div className="map-top-actions">
            <div className="language-switch" role="group" aria-label={t("languageLabel")}>
              <button className={locale === "zh-CN" ? "active" : ""} type="button" onClick={() => setLocale("zh-CN")} aria-pressed={locale === "zh-CN"} title="简体中文">
                中
              </button>
              <button className={locale === "en" ? "active" : ""} type="button" onClick={() => setLocale("en")} aria-pressed={locale === "en"} title="English">
                EN
              </button>
            </div>
            <button className="small-button" onClick={refreshStatus} disabled={busy} aria-label={t("statusButton")}>
              <RefreshCcw size={16} />
              <span>{t("statusButton")}</span>
            </button>
          </div>
        </div>
        <div className="map-actions">
          <button className="small-button" onClick={locateCurrentPosition} disabled={busy}>
            <LocateFixed size={16} />
            {t("currentLocationButton")}
          </button>
        </div>
        <div ref={mapElementRef} className="map" aria-label={t("mapLabel")} />
      </section>

      <aside className="control-pane">
        <section className="workflow-guide" aria-labelledby="workflow-title">
          <div className="workflow-heading">
            <span>{t("workflowEyebrow")}</span>
            <h2 id="workflow-title">{t("workflowTitle")}</h2>
            <p>{t("workflowIntro")}</p>
          </div>
          <ol className="workflow-steps">
            <li>
              <span className="step-number">1</span>
              <div>
                <strong>{t("stepInstallTitle")}</strong>
                <p>{t("stepInstallText")}</p>
                <a href="#module-setup">{t("stepInstallLink")}</a>
              </div>
            </li>
            <li>
              <span className="step-number">2</span>
              <div>
                <strong>{t("stepLocationTitle")}</strong>
                <p>{t("stepLocationText")}</p>
                <a href="#target-location">{t("stepLocationLink")}</a>
              </div>
            </li>
            <li>
              <span className="step-number">3</span>
              <div>
                <strong>{t("stepApplyTitle")}</strong>
                <p>{t("stepApplyText")}</p>
                <a href="#status-result">{t("stepApplyLink")}</a>
              </div>
            </li>
          </ol>
        </section>

        <section className="panel" id="target-location">
          <h2>{t("targetTitle")}</h2>
          <div className="coordinate-grid">
            <label>
              <span>{t("latitude")}</span>
              <input value={pin.latitude} inputMode="decimal" onChange={(event) => setTargetPin({ ...pin, latitude: Number(event.target.value) })} />
            </label>
            <label>
              <span>{t("longitude")}</span>
              <input value={pin.longitude} inputMode="decimal" onChange={(event) => setTargetPin({ ...pin, longitude: Number(event.target.value) })} />
            </label>
            <label>
              <span>{t("accuracyMeters")}</span>
              <input value={pin.accuracy} inputMode="numeric" onChange={(event) => setTargetPin({ ...pin, accuracy: Number(event.target.value) })} />
            </label>
          </div>
          <form className="search-form" onSubmit={searchPlaces}>
            <label>
              <span>{t("searchLocation")}</span>
              <div className="search-row">
                <input value={searchQuery} placeholder={t("searchPlaceholder")} onChange={(event) => setSearchQuery(event.target.value)} />
                <button className="small-button" type="submit" disabled={searchBusy}>
                  <Search size={16} />
                  {searchBusy ? t("searchBusy") : t("searchButton")}
                </button>
              </div>
            </label>
            <p className="hint">
              {searchMessage ? t(searchMessage.key, searchMessage.values) : (
                <>
                  {t("searchAttributionBefore")}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap/Nominatim</a>{t("searchAttributionAfter")}
                </>
              )}
            </p>
            {searchResults.length ? (
              <div className="search-results">
                {searchResults.map((result, index) => (
                  <button className="search-result" type="button" key={`${result.place_id || index}-${result.lat}-${result.lon}`} onClick={() => applySearchResult(result)}>
                    <strong>{formatSearchTitle(result.display_name)}</strong>
                    <span>{result.display_name}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </form>
          <p className="hint">{t("mapHint")}</p>
          <div className="primary-actions">
            <button className="save-button" onClick={saveLocation} disabled={busy}>
              <Crosshair size={18} />
              {t("modifyButton")}
            </button>
            <button className="restore-button" onClick={restoreLocation} disabled={busy}>
              <Power size={18} />
              {t("restoreButton")}
            </button>
          </div>
          {status?.settings && !status.diagnostics?.patched ? (
            <div className="next-action" role="status">
              <strong>{t("nextActionTitle")}</strong>
              <span>{t("nextActionText")}</span>
            </div>
          ) : null}
          <div className="message">{t(message.key, message.values)}</div>
        </section>

        <section className="panel favorites-panel">
          <h2>{t("favoritesTitle")}</h2>
          <div className="favorite-save">
            <input value={favoriteName} placeholder={t("favoritePlaceholder")} onChange={(event) => setFavoriteName(event.target.value)} />
            <button className="small-button" onClick={saveFavorite}>
              <Star size={16} />
              {t("saveFavoriteButton")}
            </button>
          </div>
          {favorites.length ? (
            <div className="favorite-list">
              {favorites.map((favorite) => (
                <div className="favorite-row" key={favorite.id}>
                  <button className="favorite-main" onClick={() => applyFavorite(favorite)}>
                    <strong>{favorite.name}</strong>
                    <span>{favorite.latitude.toFixed(6)}, {favorite.longitude.toFixed(6)}</span>
                  </button>
                  <button className="icon-button" onClick={() => removeFavorite(favorite.id)} aria-label={t("deleteFavorite", { name: favorite.name })}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">{t("favoritesEmpty")}</p>
          )}
        </section>

        <section className="panel" id="module-setup">
          <h2>{t("installTitle")}</h2>
          <p className="hint">{t("installSkip")}</p>
          <div className="client-tabs">
            {clients.map((client) => (
              <button key={client.id} className={clientId === client.id ? "active" : ""} onClick={() => setClientId(client.id)}>
                {client.name}
              </button>
            ))}
          </div>
          <p className="hint">{t(selectedClient.importHintKey)}</p>
          <div className="url-box">
            <span>{t("moduleUrl")}</span>
            <code>{moduleUrl}</code>
          </div>
          <div className="secondary-actions">
            <button className="small-button" onClick={() => copy(moduleUrl, "module")}>
              <Clipboard size={16} />
              {copied === "module" ? t("copied") : t("copyModule")}
            </button>
            <button className="small-button" onClick={() => openUrl(moduleUrl)}>
              <ExternalLink size={16} />
              {t("openModule")}
            </button>
          </div>
        </section>

        <section className="panel status-panel" id="status-result">
          <h2>{t("resultTitle")}</h2>
          <p className="status-intro">{t("resultIntro")}</p>
          <StatusRow icon={<ShieldCheck size={16} />} label={t("connectionLabel")} value={status?.runtime || t("notChecked")} />
          <StatusRow icon={<CheckCircle2 size={16} />} label={t("currentModeLabel")} value={status?.settings ? t("savedMode") : t("realMode")} />
          <StatusRow icon={<CheckCircle2 size={16} />} label={t("locationRequestLabel")} value={status?.diagnostics?.lastWlocAt ? formatTime(status.diagnostics.lastWlocAt, locale) : t("noRequest")} />
          <StatusRow icon={<CheckCircle2 size={16} />} label={t("resultLabel")} value={formatPatchStatus(status, t)} />
          {lastError ? <StatusRow icon={<CheckCircle2 size={16} />} label={t("connectionError")} value={lastError} /> : null}
          <div className="status-actions">
            <button className="small-button" onClick={refreshStatus} disabled={busy}>
              <RefreshCcw size={16} />
              {t("recheckButton")}
            </button>
          </div>
        </section>

        <details className="panel disclosure-panel activation-panel">
          <summary>
            <div className="activation-heading">
              <h2>{t("activationTitle")}</h2>
              <span>{t("activationRequired")}</span>
            </div>
          </summary>
          <div className="disclosure-content">
            <p className="activation-note">{t("activationNote")}</p>
            <ol>
              <li>{t("activationStep1")}</li>
              <li>{t("activationStep2")}</li>
              <li>{t("activationStep3")}</li>
              <li>{t("activationStep4")}</li>
            </ol>
          </div>
        </details>

        <details className="panel disclosure-panel setup-guide">
          <summary>
            <h2>{t("setupTitle")}</h2>
            <span>{t("setupSubtitle")}</span>
          </summary>
          <div className="disclosure-content">
            <p className="hint">{t("setupNote")}</p>
            <div className="setup-group">
              <h3>Shadowrocket</h3>
              <ol>
                <li>{t("shadowStep1")}</li>
                <li>{t("shadowStep2")}</li>
                <li>{t("shadowStep3")}</li>
                <li>{t("shadowStep4")}</li>
                <li>{t("shadowStep5")}</li>
              </ol>
            </div>
            <div className="setup-group">
              <h3>Stash</h3>
              <ol>
                <li>{t("stashStep1")}</li>
                <li>{t("stashStep2")}</li>
                <li>{t("stashStep3")}</li>
                <li>{t("stashStep4")}</li>
                <li>{t("stashStep5")}</li>
              </ol>
            </div>
          </div>
        </details>
      </aside>
    </main>
  );
}

function StatusRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="status-row">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function fallbackCopy(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function readFavorites() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(favoritesKey) || "[]") as Favorite[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.name === "string" && Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
      .map((item) => ({
        id: item.id || `${item.latitude}-${item.longitude}`,
        name: item.name,
        latitude: normalizeLatitude(item.latitude),
        longitude: normalizeLongitude(item.longitude),
        accuracy: normalizeAccuracy(item.accuracy),
        createdAt: item.createdAt || new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

function readPinFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const latValue = params.get("lat") || params.get("latitude");
    const lonValue = params.get("lon") || params.get("lng") || params.get("longitude");
    if (latValue === null || lonValue === null) return null;
    const lat = Number(latValue);
    const lon = Number(lonValue);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      latitude: normalizeLatitude(lat),
      longitude: normalizeLongitude(lon),
      accuracy: normalizeAccuracy(Number(params.get("accuracy") || params.get("acc") || defaultPin.accuracy)),
    };
  } catch {
    return null;
  }
}

function normalizedBasePath() {
  const base = import.meta.env.BASE_URL === "/" ? "" : import.meta.env.BASE_URL.replace(/\/$/, "");
  return base;
}

function roundCoord(value: number) {
  return Number(value.toFixed(6));
}

function normalizeLatitude(value: number) {
  if (!Number.isFinite(value)) return defaultPin.latitude;
  return roundCoord(Math.max(-90, Math.min(90, value)));
}

function normalizeLongitude(value: number) {
  if (!Number.isFinite(value)) return defaultPin.longitude;
  const wrapped = ((((value + 180) % 360) + 360) % 360) - 180;
  return roundCoord(wrapped === -180 ? 180 : wrapped);
}

function normalizeAccuracy(value: number) {
  if (!Number.isFinite(value)) return defaultPin.accuracy;
  return Math.max(1, Math.min(5000, Math.round(value)));
}

function normalizePin(value: Pin) {
  return {
    latitude: normalizeLatitude(value.latitude),
    longitude: normalizeLongitude(value.longitude),
    accuracy: normalizeAccuracy(value.accuracy),
  };
}

function formatTime(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatPatchStatus(status: StatusPayload | null, t: Translate) {
  if (!status) return t("notChecked");
  if (status.diagnostics?.patched) {
    const hits = status.diagnostics.hits || 0;
    return hits ? t("patchSuccessCount", { count: hits }) : t("patchSuccess");
  }

  const labels: Record<string, MessageKey> = {
    "waiting-wloc": "patchWaiting",
    "pass-through": "patchPassThrough",
    "empty-body": "patchEmpty",
    "gzip-body": "patchGzip",
    "no-patchable-location": "patchUnknown",
  };
  const error = status.diagnostics?.error;
  if (error && labels[error]) return t(labels[error]);
  if (status.settings) return t("patchWaiting");
  return error || t("patchNotModified");
}

function formatSearchTitle(value: string) {
  return value.split(",")[0]?.trim() || value;
}

export default App;
