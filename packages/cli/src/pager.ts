import { spawnSync } from "node:child_process";

export function pageOutput(content: string) {
  if (!process.stdout.isTTY) {
    console.log(content);
    return;
  }

  const pager =
    process.env.PAGER ||
    (process.platform === "win32"
      ? "more"
      : "less -R");

  spawnSync(pager, {
    shell: true,
    input: content,
    stdio: ["pipe", "inherit", "inherit"],
  });
}
