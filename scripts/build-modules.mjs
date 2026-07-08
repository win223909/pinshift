import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { moduleFiles } from "./module-files.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const baseUrl = resolveBaseUrl();
const outDir = path.join(root, "public", "modules");

await mkdir(outDir, { recursive: true });

for (const [templateFile, outputFile] of moduleFiles) {
  const template = await readFile(path.join(root, "modules", templateFile), "utf8");
  await writeFile(path.join(outDir, outputFile), template.replaceAll("{{BASE_URL}}", baseUrl));
}

console.log(`built modules with base ${baseUrl}`);

function resolveBaseUrl() {
  if (process.env.PUBLIC_BASE_URL) return clean(process.env.PUBLIC_BASE_URL);
  const repository = process.env.GITHUB_REPOSITORY;
  if (repository?.includes("/")) {
    const [owner, repo] = repository.split("/", 2);
    return `https://${owner}.github.io/${repo}`;
  }
  return "http://127.0.0.1:5191";
}

function clean(value) {
  return String(value).replace(/\/+$/, "");
}

