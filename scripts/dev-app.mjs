import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const viteBin = join(rootDir, "node_modules", ".bin", isWindows ? "vite.cmd" : "vite");

const children = [
  spawn(process.execPath, [join(rootDir, "scripts", "api-proxy.mjs")], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env
  }),
  spawn(viteBin, ["--host", "127.0.0.1"], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
    shell: isWindows
  })
];

let shuttingDown = false;

for (const child of children) {
  child.on("exit", (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const other of children) {
      if (other !== child && !other.killed) {
        other.kill();
      }
    }
    process.exit(code ?? 0);
  });
}

function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
