import { CheckCircle2, Clipboard, Crosshair, ExternalLink, LocateFixed, MapPin, Power, RefreshCcw, Star, Trash2, ShieldCheck } from "lucide-react";
import L from "leaflet";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

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

const clients: Array<{ id: ClientId; name: string; moduleFile: string; importHint: string }> = [
  {
    id: "shadowrocket",
    name: "Shadowrocket",
    moduleFile: "pinshift-shadowrocket.module",
    importHint: "配置 -> 模块 -> 右上角 + -> 来自 URL",
  },
  {
    id: "stash",
    name: "Stash",
    moduleFile: "pinshift-stash.stoverride",
    importHint: "覆写 -> 安装覆写 -> 粘贴 URL；首页打开 覆写 / 改写 / MitM / 脚本",
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
  const [pin, setPin] = useState<Pin>(urlPin || defaultPin);
  const [markerPosition, setMarkerPosition] = useState<Pin>(urlPin || defaultPin);
  const [currentLocation, setCurrentLocation] = useState<Pin | null>(null);
  const [favorites, setFavorites] = useState<Favorite[]>(() => readFavorites());
  const [favoriteName, setFavoriteName] = useState("");
  const [clientId, setClientId] = useState<ClientId>("shadowrocket");
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [message, setMessage] = useState(urlPin ? "已从链接导入坐标，可以直接保存或加入收藏。" : "先安装模块并开启 MITM，然后在地图上选点。");
  const [lastError, setLastError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const currentMarkerRef = useRef<L.Marker | null>(null);

  const baseUrl = useMemo(() => window.location.origin + normalizedBasePath(), []);
  const selectedClient = clients.find((client) => client.id === clientId) || clients[0];
  const moduleUrl = `${baseUrl}/modules/${selectedClient.moduleFile}`;
  const saveUrl = `${controlOrigin}/pinshift/save?lat=${encodeURIComponent(pin.latitude)}&lon=${encodeURIComponent(pin.longitude)}&accuracy=${encodeURIComponent(pin.accuracy)}`;
  const clearUrl = `${controlOrigin}/pinshift/clear`;
  const statusUrl = `${controlOrigin}/pinshift/status`;

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
    await callControl(saveUrl, "已写入坐标。打开地图 App 触发定位，再点状态检查。");
  }

  async function restoreLocation() {
    await callControl(clearUrl, "已恢复透传模式。高版本 iOS 如仍不变，重启后再验证。");
  }

  async function refreshStatus() {
    await callControl(statusUrl, "状态已刷新。");
  }

  function locateCurrentPosition() {
    if (!window.isSecureContext) {
      setMessage("当前位置需要 HTTPS 页面。当前是 HTTP 局域网测试地址，iPhone Safari 通常不会开放网页定位；可先手动选点，或发布到 GitHub Pages/Cloudflare HTTPS 后再用。");
      return;
    }

    if (!navigator.geolocation) {
      setMessage("当前浏览器不支持定位。可以先用地图手动选点。");
      return;
    }

    setBusy(true);
    setMessage("正在读取浏览器当前位置...");
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
        setMessage("已在地图上显示当前位置，并填入目标位置。");
        setBusy(false);
      },
      (error) => {
        setMessage(`无法读取当前位置：${error.message || "请检查 Safari 定位权限。"} 如果页面已是 HTTPS，请到 iOS 设置里允许 Safari 获取位置。`);
        setBusy(false);
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 12000 },
    );
  }

  function saveFavorite() {
    const name = favoriteName.trim() || `收藏 ${favorites.length + 1}`;
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
    setMessage(`已收藏：${name}`);
  }

  function applyFavorite(favorite: Favorite) {
    const next = {
      latitude: favorite.latitude,
      longitude: favorite.longitude,
      accuracy: favorite.accuracy,
    };
    setTargetPin(next);
    mapRef.current?.setView([next.latitude, next.longitude], Math.max(mapRef.current.getZoom(), 15));
    setMessage(`已选中收藏位置：${favorite.name}`);
  }

  function removeFavorite(id: string) {
    setFavorites((current) => current.filter((favorite) => favorite.id !== id));
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

  async function callControl(url: string, okMessage: string) {
    setBusy(true);
    setMessage("正在请求手机代理脚本...");
    try {
      const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`, { cache: "no-store" });
      const data = (await response.json()) as StatusPayload;
      setStatus(data);
      setLastError("");
      setMessage(data.ok && data.runtime ? `${okMessage} 已连接 ${data.runtime}。` : data.ok ? okMessage : `失败：${JSON.stringify(data)}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setLastError(detail);
      setStatus(null);
      setMessage(`没有连到代理脚本。Stash 首页要同时打开 覆写、改写、MitM、脚本；还要确认 VPN 已连接、证书已信任。${detail}`);
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
              <p>地图选点，一键修改，一键恢复</p>
            </div>
          </div>
          <button className="small-button" onClick={refreshStatus} disabled={busy}>
            <RefreshCcw size={16} />
            状态
          </button>
        </div>
        <div className="map-actions">
          <button className="small-button" onClick={locateCurrentPosition} disabled={busy}>
            <LocateFixed size={16} />
            当前位置
          </button>
        </div>
        <div ref={mapElementRef} className="map" aria-label="地图选点" />
      </section>

      <aside className="control-pane">
        <section className="panel activation-panel">
          <div className="activation-heading">
            <h2>生效步骤</h2>
            <span>Stash / Shadowrocket 通用</span>
          </div>
          <p className="activation-note">使用 Shadowsocks 节点测试时也一样，修改定位后需要重新触发 iOS 定位。</p>
          <ol>
            <li>到 iPhone 设置里关闭「定位服务」。</li>
            <li>等待约 10 秒，再重新打开「定位服务」。</li>
            <li>回到 PinShift，点击「重新检测」。</li>
            <li>如果显示成功，就是修改成功；多次不成功时，重启手机后再试。</li>
          </ol>
        </section>

        <section className="panel">
          <h2>目标位置</h2>
          <div className="coordinate-grid">
            <label>
              <span>纬度</span>
              <input value={pin.latitude} inputMode="decimal" onChange={(event) => setTargetPin({ ...pin, latitude: Number(event.target.value) })} />
            </label>
            <label>
              <span>经度</span>
              <input value={pin.longitude} inputMode="decimal" onChange={(event) => setTargetPin({ ...pin, longitude: Number(event.target.value) })} />
            </label>
            <label>
              <span>精度 米</span>
              <input value={pin.accuracy} inputMode="numeric" onChange={(event) => setTargetPin({ ...pin, accuracy: Number(event.target.value) })} />
            </label>
          </div>
          <p className="hint">点击地图或拖动标记即可选点。第一版不做搜索，先保证保存和恢复闭环稳定。</p>
          <div className="primary-actions">
            <button className="save-button" onClick={saveLocation} disabled={busy}>
              <Crosshair size={18} />
              一键修改定位
            </button>
            <button className="restore-button" onClick={restoreLocation} disabled={busy}>
              <Power size={18} />
              一键恢复真实定位
            </button>
          </div>
          <div className="message">{message}</div>
        </section>

        <section className="panel favorites-panel">
          <h2>收藏夹</h2>
          <div className="favorite-save">
            <input value={favoriteName} placeholder="名称，例如 公司 / 家 / 学校" onChange={(event) => setFavoriteName(event.target.value)} />
            <button className="small-button" onClick={saveFavorite}>
              <Star size={16} />
              收藏当前点
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
                  <button className="icon-button" onClick={() => removeFavorite(favorite.id)} aria-label={`删除 ${favorite.name}`}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">常用地址会保存在当前手机浏览器里，不上传到服务器。</p>
          )}
        </section>

        <section className="panel">
          <h2>安装模块</h2>
          <div className="client-tabs">
            {clients.map((client) => (
              <button key={client.id} className={clientId === client.id ? "active" : ""} onClick={() => setClientId(client.id)}>
                {client.name}
              </button>
            ))}
          </div>
          <p className="hint">{selectedClient.importHint}</p>
          <div className="url-box">
            <span>模块 URL</span>
            <code>{moduleUrl}</code>
          </div>
          <div className="secondary-actions">
            <button className="small-button" onClick={() => copy(moduleUrl, "module")}>
              <Clipboard size={16} />
              {copied === "module" ? "已复制" : "复制模块"}
            </button>
            <button className="small-button" onClick={() => openUrl(moduleUrl)}>
              <ExternalLink size={16} />
              打开模块
            </button>
          </div>
        </section>

        <section className="panel status-panel">
          <h2>状态</h2>
          <StatusRow icon={<ShieldCheck size={16} />} label="代理环境" value={status?.runtime || "未连接"} />
          <StatusRow icon={<CheckCircle2 size={16} />} label="已保存" value={status?.settings ? `${status.settings.latitude.toFixed(6)}, ${status.settings.longitude.toFixed(6)}` : "透传真实定位"} />
          <StatusRow icon={<CheckCircle2 size={16} />} label="最近 WLOC" value={status?.diagnostics?.lastWlocAt ? formatTime(status.diagnostics.lastWlocAt) : "暂无"} />
          <StatusRow icon={<CheckCircle2 size={16} />} label="Patch" value={status?.diagnostics?.patched ? `成功 ${status.diagnostics.hits || 0}` : status?.diagnostics?.error || "暂无"} />
          {lastError ? <StatusRow icon={<CheckCircle2 size={16} />} label="连接错误" value={lastError} /> : null}
          <div className="status-actions">
            <button className="small-button" onClick={refreshStatus} disabled={busy}>
              <RefreshCcw size={16} />
              重新检测
            </button>
          </div>
        </section>
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

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export default App;
