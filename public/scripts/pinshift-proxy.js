/* PinShift proxy script. Handles save/clear/status and Apple WLOC response patching. */
(function () {
  "use strict";

  var SETTINGS_KEY = "pinshift_settings";
  var DIAG_KEY = "pinshift_diagnostics";
  var CONTROL_PATH = "/pinshift/";
  var SCALE = 100000000;
  var TWO64 = 1n << 64n;
  var TWO63 = 1n << 63n;

  var request = safeGlobal("$request");
  var response = safeGlobal("$response");

  if (request && isControlUrl(request.url || "")) {
    finish(controlResponse(request.url || ""));
    return;
  }

  if (request && !response && isWlocUrl(request.url || "")) {
    finish(prepareRequest(request));
    return;
  }

  if (request && response && isWlocUrl(request.url || "")) {
    finish(patchResponse(request, response));
    return;
  }

  finish({});

  function controlResponse(url) {
    var action = actionFromUrl(url);
    var query = parseQuery(url);

    if (action === "save") {
      var settings = normalizeSettings({
        latitude: query.lat || query.latitude,
        longitude: query.lon || query.lng || query.longitude,
        accuracy: query.accuracy || query.acc || 25,
      });

      if (settings.latitude === null || settings.longitude === null) {
        return json({ ok: false, error: "invalid-coordinate", runtime: runtimeName() }, 400);
      }

      settings.enabled = true;
      settings.updatedAt = new Date().toISOString();
      settings.source = "pinshift";
      var ok = storeWrite(SETTINGS_KEY, JSON.stringify(settings));
      writeDiagnostics({ lastControlAt: settings.updatedAt, settings: settings, patched: false, error: "waiting-wloc" });
      return json({ ok: ok, action: "save", runtime: runtimeName(), settings: settings });
    }

    if (action === "clear") {
      var cleared = storeRemove(SETTINGS_KEY);
      writeDiagnostics({ lastControlAt: new Date().toISOString(), settings: null, patched: false, error: "pass-through" });
      return json({ ok: cleared, action: "clear", runtime: runtimeName() });
    }

    if (action === "status") {
      return json({
        ok: true,
        runtime: runtimeName(),
        settings: readSettings(),
        diagnostics: readDiagnostics(),
      });
    }

    return json({ ok: false, error: "unknown-action", runtime: runtimeName() }, 404);
  }

  function prepareRequest(req) {
    var headers = copyHeaders(req.headers || {});
    headers["Accept-Encoding"] = "identity";
    headers["Cache-Control"] = "no-cache";
    return { headers: headers };
  }

  function patchResponse(req, res) {
    var settings = readSettings();
    var now = new Date().toISOString();

    if (!settings || !settings.enabled || settings.latitude === null || settings.longitude === null) {
      writeDiagnostics({ lastWlocAt: now, patched: false, error: "pass-through", settings: settings });
      return {};
    }

    var body = toBytes(res.bodyBytes || res.rawBody || res.body);
    if (!body.length) {
      writeDiagnostics({ lastWlocAt: now, patched: false, error: "empty-body", settings: settings });
      return {};
    }

    if (body[0] === 31 && body[1] === 139) {
      writeDiagnostics({ lastWlocAt: now, patched: false, error: "gzip-body", settings: settings });
      return {};
    }

    try {
      var result = patchWlocBytes(body, settings);
      if (!result.patched) {
        writeDiagnostics({ lastWlocAt: now, patched: false, error: result.error || "no-location", settings: settings });
        return {};
      }

      var out = Uint8Array.from(result.bytes);
      var bodyBytes = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
      var headers = copyHeaders(res.headers || {});
      deleteHeader(headers, "content-encoding");
      deleteHeader(headers, "transfer-encoding");
      deleteHeader(headers, "content-length");
      headers["Content-Length"] = String(out.length);

      writeDiagnostics({
        lastWlocAt: now,
        patched: true,
        error: "",
        envelope: result.envelope,
        hits: result.hits,
        settings: settings,
      });

      return {
        status: res.status || res.statusCode || 200,
        headers: headers,
        body: out,
        bodyBytes: bodyBytes,
        rawBody: bodyBytes,
      };
    } catch (error) {
      writeDiagnostics({ lastWlocAt: now, patched: false, error: String(error && error.message ? error.message : error), settings: settings });
      return {};
    }
  }

  function patchWlocBytes(bytes, settings) {
    var frame = patchFramed(bytes, settings);
    if (frame.patched) return frame;

    var bare = patchMessage(bytes, settings, { hits: 0 }, 0);
    if (bare.patched) return { patched: true, bytes: bare.bytes, envelope: "bare", hits: bare.stats.hits };

    var raw = patchRawScan(bytes, settings);
    if (raw.patched) return raw;

    return { patched: false, error: "no-patchable-location" };
  }

  function patchFramed(bytes, settings) {
    var max = Math.min(96, Math.max(0, bytes.length - 10));
    for (var offset = 0; offset <= max; offset += 1) {
      var length = (bytes[offset + 8] << 8) | bytes[offset + 9];
      if (length <= 0 || offset + 10 + length > bytes.length) continue;
      var payload = bytes.slice(offset + 10, offset + 10 + length);
      var patched = patchMessage(payload, settings, { hits: 0 }, 0);
      if (!patched.patched || patched.bytes.length > 65535) continue;
      return {
        patched: true,
        envelope: "frame",
        hits: patched.stats.hits,
        bytes: concat([bytes.slice(0, offset + 8), [patched.bytes.length >> 8, patched.bytes.length & 255], patched.bytes, bytes.slice(offset + 10 + length)]),
      };
    }
    return { patched: false };
  }

  function patchRawScan(bytes, settings) {
    var max = Math.min(160, bytes.length);
    for (var offset = 1; offset <= max; offset += 1) {
      var stats = { hits: 0 };
      var patched = patchMessage(bytes.slice(offset), settings, stats, 0);
      if (patched.patched) {
        return {
          patched: true,
          envelope: "raw-scan",
          hits: patched.stats.hits,
          bytes: concat([bytes.slice(0, offset), patched.bytes]),
        };
      }
    }
    return { patched: false };
  }

  function patchMessage(bytes, settings, stats, depth) {
    if (depth > 8 || bytes.length < 2) return { patched: false, bytes: bytes, stats: stats };
    var fields = readFields(bytes);
    if (!fields || !fields.length) return { patched: false, bytes: bytes, stats: stats };

    if (looksLikeLocation(fields)) {
      var parts = fields.map(function (field) {
        if (field.no === 1 && field.type === 0) return makeField(field.no, field.type, encodeSigned(Math.round(settings.latitude * SCALE)));
        if (field.no === 2 && field.type === 0) return makeField(field.no, field.type, encodeSigned(Math.round(settings.longitude * SCALE)));
        if (field.no === 3 && field.type === 0) return makeField(field.no, field.type, encodeVarint(BigInt(settings.accuracy)));
        return field.raw;
      });
      stats.hits += 1;
      return { patched: true, bytes: concat(parts), stats: stats };
    }

    var changed = false;
    var out = fields.map(function (field) {
      if (field.type !== 2 || !field.value || field.value.length < 2) return field.raw;
      var nested = patchMessage(field.value, settings, stats, depth + 1);
      if (!nested.patched) return field.raw;
      changed = true;
      return makeField(field.no, 2, nested.bytes);
    });

    return { patched: changed, bytes: changed ? concat(out) : bytes, stats: stats };
  }

  function looksLikeLocation(fields) {
    var lat = null;
    var lon = null;
    for (var i = 0; i < fields.length; i += 1) {
      if (fields[i].no === 1 && fields[i].type === 0) lat = signedToNumber(fields[i].value) / SCALE;
      if (fields[i].no === 2 && fields[i].type === 0) lon = signedToNumber(fields[i].value) / SCALE;
    }
    return lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  function readFields(bytes) {
    var fields = [];
    var offset = 0;
    try {
      while (offset < bytes.length) {
        var start = offset;
        var tag = readVarint(bytes, offset);
        offset = tag.next;
        var no = Number(tag.value >> 3n);
        var type = Number(tag.value & 7n);
        var value;
        if (no <= 0 || [0, 1, 2, 5].indexOf(type) < 0) return null;
        if (type === 0) {
          var v = readVarint(bytes, offset);
          value = v.value;
          offset = v.next;
        } else if (type === 1) {
          if (offset + 8 > bytes.length) return null;
          value = bytes.slice(offset, offset + 8);
          offset += 8;
        } else if (type === 2) {
          var len = readVarint(bytes, offset);
          offset = len.next;
          var size = Number(len.value);
          if (!Number.isSafeInteger(size) || size < 0 || offset + size > bytes.length) return null;
          value = bytes.slice(offset, offset + size);
          offset += size;
        } else {
          if (offset + 4 > bytes.length) return null;
          value = bytes.slice(offset, offset + 4);
          offset += 4;
        }
        fields.push({ no: no, type: type, value: value, raw: bytes.slice(start, offset) });
      }
      return fields;
    } catch (_) {
      return null;
    }
  }

  function makeField(no, type, value) {
    var tag = encodeVarint(BigInt(no * 8 + type));
    if (type === 0) return concat([tag, value]);
    if (type === 1 || type === 5) return concat([tag, value]);
    return concat([tag, encodeVarint(BigInt(value.length)), value]);
  }

  function readVarint(bytes, offset) {
    var value = 0n;
    var shift = 0n;
    for (var i = 0; i < 10; i += 1) {
      if (offset + i >= bytes.length) throw new Error("truncated varint");
      var b = BigInt(bytes[offset + i]);
      value |= (b & 127n) << shift;
      if ((b & 128n) === 0n) return { value: value, next: offset + i + 1 };
      shift += 7n;
    }
    throw new Error("varint too long");
  }

  function encodeSigned(value) {
    var big = BigInt(value);
    if (big < 0n) big += TWO64;
    return encodeVarint(big);
  }

  function encodeVarint(value) {
    var out = [];
    var n = BigInt(value);
    do {
      var b = Number(n & 127n);
      n >>= 7n;
      if (n !== 0n) b |= 128;
      out.push(b);
    } while (n !== 0n);
    return out;
  }

  function signedToNumber(value) {
    var signed = value >= TWO63 ? value - TWO64 : value;
    return Number(signed);
  }

  function normalizeSettings(raw) {
    var latitude = toNumber(raw.latitude);
    var longitude = toNumber(raw.longitude);
    var accuracy = Math.round(toNumber(raw.accuracy) || 25);
    if (latitude !== null && (latitude < -90 || latitude > 90)) latitude = null;
    if (longitude !== null) longitude = normalizeLongitude(longitude);
    return { latitude: latitude, longitude: longitude, accuracy: Math.max(1, Math.min(5000, accuracy)) };
  }

  function normalizeLongitude(value) {
    var wrapped = ((((value + 180) % 360) + 360) % 360) - 180;
    return wrapped === -180 ? 180 : wrapped;
  }

  function readSettings() {
    var raw = storeRead(SETTINGS_KEY);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      var settings = normalizeSettings(parsed);
      settings.enabled = parsed.enabled !== false;
      settings.updatedAt = parsed.updatedAt || "";
      settings.source = parsed.source || "pinshift";
      return settings;
    } catch (_) {
      return null;
    }
  }

  function writeDiagnostics(next) {
    var prev = readDiagnostics();
    storeWrite(DIAG_KEY, JSON.stringify(Object.assign({}, prev, next, { runtime: runtimeName() })));
  }

  function readDiagnostics() {
    var raw = storeRead(DIAG_KEY);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch (_) {
      return {};
    }
  }

  function json(data, status) {
    return {
      response: {
        status: status || 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Cache-Control": "no-store",
        },
        body: JSON.stringify(data),
      },
    };
  }

  function storeRead(key) {
    try {
      if (typeof $persistentStore !== "undefined") return $persistentStore.read(key);
      if (typeof $prefs !== "undefined") return $prefs.valueForKey(key);
    } catch (_) {}
    return null;
  }

  function storeWrite(key, value) {
    try {
      if (typeof $persistentStore !== "undefined") return $persistentStore.write(value, key);
      if (typeof $prefs !== "undefined") return $prefs.setValueForKey(value, key);
    } catch (_) {}
    return false;
  }

  function storeRemove(key) {
    try {
      if (typeof $persistentStore !== "undefined") return $persistentStore.write("", key) || $persistentStore.write(null, key);
      if (typeof $prefs !== "undefined") return $prefs.removeValueForKey(key);
    } catch (_) {}
    return false;
  }

  function runtimeName() {
    if (typeof $rocket !== "undefined") return "Shadowrocket";
    if (typeof $environment !== "undefined" && $environment && $environment["stash-version"]) return "Stash";
    if (typeof $environment !== "undefined" && $environment && $environment["surge-version"]) return "Surge";
    if (typeof $loon !== "undefined") return "Loon";
    if (typeof $task !== "undefined") return "Quantumult X";
    return "Unknown";
  }

  function toBytes(value) {
    if (!value) return [];
    if (value instanceof Uint8Array) return Array.prototype.slice.call(value);
    if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) return Array.prototype.slice.call(new Uint8Array(value));
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(value)) {
      return Array.prototype.slice.call(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    }
    if (typeof value === "string") {
      var out = [];
      for (var i = 0; i < value.length; i += 1) out.push(value.charCodeAt(i) & 255);
      return out;
    }
    if (typeof value.length === "number") return Array.prototype.slice.call(value).map(function (n) { return n & 255; });
    return [];
  }

  function concat(parts) {
    var length = 0;
    for (var i = 0; i < parts.length; i += 1) length += parts[i].length;
    var out = new Array(length);
    var offset = 0;
    for (var p = 0; p < parts.length; p += 1) {
      for (var j = 0; j < parts[p].length; j += 1) out[offset++] = parts[p][j] & 255;
    }
    return out;
  }

  function parseQuery(url) {
    var result = {};
    var idx = url.indexOf("?");
    if (idx < 0) return result;
    var query = url.slice(idx + 1).split("&");
    for (var i = 0; i < query.length; i += 1) {
      if (!query[i]) continue;
      var pair = query[i].split("=");
      result[decodeURIComponent(pair[0])] = decodeURIComponent((pair[1] || "").replace(/\+/g, " "));
    }
    return result;
  }

  function actionFromUrl(url) {
    var path = url.split("?")[0] || "";
    var idx = path.indexOf(CONTROL_PATH);
    return idx >= 0 ? path.slice(idx + CONTROL_PATH.length).replace(/\/$/, "") : "";
  }

  function isControlUrl(url) {
    return url.indexOf(CONTROL_PATH) >= 0;
  }

  function isWlocUrl(url) {
    return /https?:\/\/gs-loc(-cn)?\.apple\.com\/clls\/wloc/.test(url);
  }

  function copyHeaders(headers) {
    var out = {};
    for (var key in headers) out[key] = headers[key];
    return out;
  }

  function deleteHeader(headers, name) {
    var lower = name.toLowerCase();
    for (var key in headers) {
      if (key.toLowerCase() === lower) delete headers[key];
    }
  }

  function toNumber(value) {
    if (value === undefined || value === null || value === "") return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function safeGlobal(name) {
    try {
      return globalThis[name];
    } catch (_) {
      return undefined;
    }
  }

  function finish(value) {
    if (typeof $done === "function") $done(value);
  }
})();
