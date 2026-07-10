# PinShift

[简体中文](README.md) | [English](README.en.md)

PinShift is an iPhone WLOC location switcher for **Shadowrocket** and **Stash**.

Open PinShift: <https://win223909.github.io/pinshift/>

> PinShift changes Apple's network-location response. It does not directly control GPS. After saving coordinates, iOS location must be triggered again.

PinShift follows the browser language by default. Use the **中 / EN** switch at the top-right of the map to change it at any time. The preference stays only in the current browser.

## Three steps

1. **Install the module once**: Select Shadowrocket or Stash in PinShift, import the module URL, enable HTTPS decryption / MitM, and trust the certificate.
2. **Choose a target location**: Search for a place, tap or drag on the map, or select a favorite.
3. **Apply and recheck**: Tap **Change location**, turn off iPhone Location Services for about 10 seconds, turn it on again, then tap **Recheck**.

After the module is installed and connected, you only need steps 2 and 3 for daily use.

## First-time setup

### Shadowrocket

1. Select **Shadowrocket** under **First-time module setup** in PinShift.
2. Copy the module URL. In Shadowrocket, open **Configuration** → **Modules** → **+** → **Add from URL**, paste the URL, and enable it.
3. Open **Configuration** → **Local Files**, then open the active configuration.
4. Enable **HTTPS Decryption** and install the Shadowrocket certificate when prompted.
5. Open iPhone **Settings** → **General** → **About** → **Certificate Trust Settings**, then fully trust the Shadowrocket certificate.
6. Return to Shadowrocket, reconnect the proxy, then return to PinShift and tap **Recheck**.

### Stash

1. Select **Stash** under **First-time module setup** in PinShift.
2. Copy the module URL. In Stash, open **Overrides** → **Install Override**, paste the URL, and enable it.
3. On Stash Home, enable **Override / Rewrite / MitM / Script**.
4. Open Stash **Settings** → **MitM** and install the CA certificate.
5. Open iPhone **Settings** → **General** → **VPN & Device Management** and install the profile.
6. Then open **Settings** → **General** → **About** → **Certificate Trust Settings** and fully trust the Stash certificate.
7. Return to Stash, reconnect it, then return to PinShift and tap **Recheck**.

> Shadowsocks is only a node type. PinShift requires the Shadowrocket / Stash module, HTTPS decryption or MitM, and a trusted certificate.

## Daily use

1. Keep Shadowrocket or Stash connected.
2. Open PinShift and search, tap the map, or select a favorite.
3. Confirm the target coordinates, then tap **Change location**.
4. Open iPhone Settings, turn off **Location Services**, wait about 10 seconds, then turn it on again.
5. Return to PinShift and tap **Recheck**.

The change is complete when all three conditions are shown:

- **Module connection** shows **Shadowrocket** or **Stash**
- **Location request** shows a recent time
- **Change result** shows **Changed successfully**

If PinShift shows **Waiting for an iPhone location request**, repeat steps 4 and 5. If repeated attempts fail, restart the iPhone and try again.

## Restore real location

1. Tap **Restore real location**.
2. Close and reopen the app that uses location.
3. If it still shows the old location, turn Location Services off for about 10 seconds and turn it on again. Restart the iPhone if necessary.

## Troubleshooting

### Module connection shows "Not checked"

Tap **Recheck** first. If PinShift still cannot connect, verify that:

- Shadowrocket or Stash is connected
- The PinShift module or override is enabled
- HTTPS decryption / MitM is enabled
- The certificate is installed and fully trusted
- Stash has Override / Rewrite / MitM / Script enabled

### Target location saved, but the change is not successful

The proxy script has saved the coordinates, but the iPhone has not sent a new WLOC request. Turn Location Services off for about 10 seconds, turn it on again, then tap **Recheck**.

### Current Location is unavailable

Current Location uses Safari web geolocation. Open PinShift through HTTPS and allow Safari to access location in iPhone Settings. A local `http://192.168.1.x` page usually cannot use web geolocation.

### Are favorites shared with other users?

No. Favorites are stored in this browser's `localStorage`. They are not uploaded to GitHub and are not shared with other visitors.

## Privacy and limitations

- Target coordinates are stored locally by the proxy app.
- Favorites are stored only in the current browser.
- Place search is provided by OpenStreetMap / Nominatim, so search text is sent to that service.
- PinShift only changes Apple WLOC network location. Apps that rely on GPS, Bluetooth, cell towers, or their own risk controls may behave differently.
- Newer iOS versions may retain an old location cache, so Location Services or the iPhone may occasionally need to be restarted.

## How it works

1. The Shadowrocket / Stash module intercepts PinShift save, restore, and status requests.
2. The proxy script stores target coordinates locally in the proxy app.
3. When iOS requests Apple `/clls/wloc`, the script reads the target coordinates and patches the WLOC response.
4. **Restore real location** clears the target coordinates and returns the script to pass-through mode.

PinShift only handles these hosts:

```text
gs-loc.apple.com
gs-loc-cn.apple.com
```

## Local development

```bash
npm install
npm run dev
```

For iPhone testing on the same Wi-Fi network:

```bash
npm run dev:lan
```

The terminal prints an address such as `http://192.168.1.x:5191`. A local page is useful for module and map testing, but Safari web geolocation normally requires HTTPS.

Run all checks:

```bash
npm test
npx tsc --noEmit
```

## Official GitHub Pages deployment

Official page and module URLs:

```text
https://win223909.github.io/pinshift/
https://win223909.github.io/pinshift/modules/pinshift-shadowrocket.module
https://win223909.github.io/pinshift/modules/pinshift-stash.stoverride
```

Production files are published from the `gh-pages` branch. Source code is kept on `main`.

## Deploy to your own GitHub Pages

You can deploy a complete PinShift copy under your own GitHub account. No NAS, VPS, or always-on server is required. The page, modules, and proxy script will use your own GitHub Pages URL.

### Requirements

- A GitHub account
- Git and Node.js 24 or later installed locally
- A public repository is recommended; private-repository Pages availability depends on your GitHub plan

### First deployment

1. Open the [PinShift repository](https://github.com/win223909/pinshift) and click **Fork**.
2. In your fork, click **Code** and copy the repository URL.
3. Run the following commands. Replace `<your-username>` and `<repository-name>` with your values:

```bash
git clone https://github.com/<your-username>/<repository-name>.git
cd <repository-name>
npm install
npm run deploy:pages
```

`deploy:pages` reads the current `origin`, generates the correct page and module URLs, and publishes the build to that repository's `gh-pages` branch.

4. Open your repository's **Settings** → **Pages**.
5. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
6. Select the **gh-pages** branch and **/(root)** folder, then click **Save**.
7. Wait for GitHub Pages to finish. Your URL is normally:

```text
https://<your-username>.github.io/<repository-name>/
```

Open your own PinShift page and confirm that the module URL under **First-time module setup** starts with your GitHub Pages address. Import your module URL, not the official one from this repository.

### Updating your deployment

Sync your fork on GitHub, then run:

```bash
git pull
npm install
npm run deploy:pages
```

### Self-deployment notes

- `npm run deploy:pages` replaces the complete `gh-pages` branch. Do not store manual files there.
- The command only publishes static files. It does not upload favorites, target coordinates, or proxy-app data.
- If Pages returns 404, confirm that the source is `gh-pages` and `/(root)`, then wait a few minutes and refresh.
- If you rename the repository, run `npm run deploy:pages` again so the page path and module URLs are rebuilt.
- Use the default `github.io` address for the first deployment. Consider a custom domain only after the page and modules work correctly.
