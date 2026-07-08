import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function githubBase() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!process.env.GITHUB_ACTIONS || !repository?.includes("/")) return "/";
  return `/${repository.split("/")[1]}/`;
}

export default defineConfig({
  base: githubBase(),
  plugins: [react()],
});

