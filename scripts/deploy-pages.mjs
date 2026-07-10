import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const remoteName = process.env.PINSHIFT_REMOTE || "origin";
const dryRun = process.argv.includes("--dry-run");
const remoteUrl = capture("git", ["remote", "get-url", remoteName], root);
const repository = process.env.GITHUB_REPOSITORY || parseGitHubRepository(remoteUrl);

if (!repository) {
  fail(`Cannot determine the GitHub repository from remote "${remoteName}". Set GITHUB_REPOSITORY=owner/repository and retry.`);
}

const [owner, repo] = repository.split("/", 2);
const pageUrl = `https://${owner}.github.io/${repo}/`;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

console.log(`Building PinShift for ${repository}`);
run(npm, ["run", "build"], root, {
  ...process.env,
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: repository,
});

const deployDir = await mkdtemp(path.join(os.tmpdir(), "pinshift-pages-"));

try {
  await cp(path.join(root, "dist"), deployDir, { recursive: true });
  await writeFile(path.join(deployDir, ".nojekyll"), "");

  run("git", ["init", "--initial-branch=gh-pages"], deployDir);
  run("git", ["add", "."], deployDir);
  run(
    "git",
    [
      "-c",
      "user.name=PinShift Deploy",
      "-c",
      "user.email=pinshift-deploy@users.noreply.github.com",
      "commit",
      "-m",
      "Deploy PinShift Pages",
    ],
    deployDir,
  );

  if (dryRun) {
    console.log("Dry run complete. The gh-pages branch was not pushed.");
  } else {
    run("git", ["remote", "add", "origin", remoteUrl], deployDir);
    run("git", ["push", "--force", "origin", "gh-pages"], deployDir);
    console.log(`Published PinShift to ${pageUrl}`);
  }
} finally {
  await rm(deployDir, { recursive: true, force: true });
}

function parseGitHubRepository(value) {
  const cleaned = String(value || "").trim().replace(/\.git$/, "");
  const match = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)$/i);
  return match ? `${match[1]}/${match[2]}` : "";
}

function capture(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) fail(result.stderr || `${command} failed`);
  return result.stdout.trim();
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
