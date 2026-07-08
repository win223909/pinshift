import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

const required = [
  "public/scripts/pinshift-proxy.js",
  "public/icon.png",
  "public/apple-touch-icon.png",
  "public/favicon-32.png",
  "public/modules/pinshift-shadowrocket.module",
  "public/modules/pinshift-stash.stoverride",
  "dist/index.html",
];

for (const file of required) {
  if (!existsSync(file)) fail(`missing ${file}`);
}

for (const file of ["public/modules/pinshift-shadowrocket.module", "public/modules/pinshift-stash.stoverride"]) {
  const content = readFileSync(file, "utf8");
  for (const text of ["PinShift", "pinshift-proxy.js?v=0.1.5", "gs-loc.apple.com", "/pinshift"]) {
    if (!content.includes(text)) fail(`${file} missing ${text}`);
  }
  if (!content.includes("icon.png")) fail(`${file} missing icon.png`);
  if (content.includes("{{BASE_URL}}")) fail(`${file} still contains template token`);
}

const stash = readFileSync("public/modules/pinshift-stash.stoverride", "utf8");
if (!stash.includes("name: PinShift") || !stash.includes("icon:")) fail("Stash override missing visible metadata");

const html = readFileSync("dist/index.html", "utf8");
for (const text of ["apple-touch-icon", "favicon-32.png", "icon.svg"]) {
  if (!html.includes(text)) fail(`dist/index.html missing ${text}`);
}

const proxy = readFileSync("public/scripts/pinshift-proxy.js", "utf8");
for (const text of ["pinshift_settings", "/pinshift/", "patchWlocBytes"]) {
  if (!proxy.includes(text)) fail(`proxy missing ${text}`);
}

verifyProxyFlow(proxy);

console.log("PinShift verify passed");

function fail(message) {
  console.error(`verify failed: ${message}`);
  process.exit(1);
}

function verifyProxyFlow(proxySource) {
  const store = new Map();
  const save = runProxy(proxySource, store, {
    $request: {
      url: "https://gs-loc.apple.com/pinshift/save?lat=31.230416&lon=121.473701&accuracy=18",
      headers: {},
    },
  });
  const saveBody = JSON.parse(save.response.body);
  if (!saveBody.ok || !saveBody.settings.enabled) fail("proxy save did not persist enabled settings");

  const wrappedSave = runProxy(proxySource, store, {
    $request: {
      url: "https://gs-loc.apple.com/pinshift/save?lat=31.230416&lon=481.473701&accuracy=18",
      headers: {},
    },
  });
  const wrappedSaveBody = JSON.parse(wrappedSave.response.body);
  if (!wrappedSaveBody.ok || wrappedSaveBody.settings.longitude < -180 || wrappedSaveBody.settings.longitude > 180) {
    fail("proxy did not normalize wrapped longitude");
  }

  const sourceBody = Uint8Array.from([8, 0, 16, 0, 24, 50]);
  const patched = runProxy(proxySource, store, {
    $request: {
      url: "https://gs-loc.apple.com/clls/wloc",
      headers: {},
    },
    $response: {
      status: 200,
      headers: { "Content-Encoding": "identity" },
      body: sourceBody,
    },
  });

  if (!patched.body || patched.body.length <= sourceBody.length) fail("proxy did not patch a simple WLOC payload");

  const status = runProxy(proxySource, store, {
    $request: {
      url: "https://gs-loc.apple.com/pinshift/status",
      headers: {},
    },
  });
  const statusBody = JSON.parse(status.response.body);
  if (!statusBody.diagnostics?.patched) fail("proxy diagnostics did not record patched WLOC");

  const clear = runProxy(proxySource, store, {
    $request: {
      url: "https://gs-loc.apple.com/pinshift/clear",
      headers: {},
    },
  });
  const clearBody = JSON.parse(clear.response.body);
  if (!clearBody.ok || store.has("pinshift_settings")) fail("proxy clear did not remove settings");
}

function runProxy(proxySource, store, globals) {
  let doneValue;
  const sandbox = {
    ...globals,
    console,
    $done(value) {
      doneValue = value || {};
    },
    $persistentStore: {
      read(key) {
        return store.get(key) || null;
      },
      write(value, key) {
        if (value === "" || value === null || value === undefined) {
          store.delete(key);
        } else {
          store.set(key, value);
        }
        return true;
      },
    },
  };
  vm.runInNewContext(proxySource, sandbox, { timeout: 1000 });
  return doneValue || {};
}
