import { spawn, spawnSync } from "node:child_process";
import os from "node:os";

const port = Number(process.env.PORT || 5191);
const ip = process.env.LAN_IP || findLanIp();
const baseUrl = `http://${ip}:${port}`;

if (!ip) {
  console.error("No LAN IP found. Set LAN_IP=your.ip.address and retry.");
  process.exit(1);
}

console.log(`PinShift LAN URL: ${baseUrl}`);

const build = spawnSync("npm", ["run", "build:modules"], {
  env: { ...process.env, PUBLIC_BASE_URL: baseUrl },
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status || 1);

const vite = spawn("npx", ["vite", "--host", "0.0.0.0", "--port", String(port)], {
  env: { ...process.env, PUBLIC_BASE_URL: baseUrl },
  stdio: "inherit",
});

vite.on("exit", (code) => process.exit(code || 0));

function findLanIp() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const item of entries || []) {
      if (item.family === "IPv4" && !item.internal) return item.address;
    }
  }
  return "";
}

