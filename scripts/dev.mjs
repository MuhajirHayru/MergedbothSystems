/**
 * GreenPath development entry point.
 *
 * Starts the marketplace Django API (port 8000) and the real application
 * frontend in greenpath-farm-to-market-ai (Vite + Express host, port 3000).
 *
 *   npm run dev                 marketplace frontend + API
 *   npm run dev:frontend        only the marketplace frontend
 *   npm run dev:backend         only the marketplace Django API
 *   npm run dev:driver          DriverApp frontend (3001) + API (8001)
 *   npm run dev:all             all four services
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const backendDir = path.join(root, "TheWholeDashboards here", "backend");
const frontendDir = path.join(root, "greenpath-farm-to-market-ai");

const frontendOnly = process.argv.includes("--frontend-only");
const backendOnly = process.argv.includes("--backend-only");
const driverOnly = process.argv.includes("--driver-only");
const all = process.argv.includes("--all");

const driverDir = path.join(root, "GreenPathDriverApp");
const driverBackendDir = path.join(driverDir, "backend");
const driverFrontendDir = path.join(driverDir, "frontend");

const isWindows = process.platform === "win32";
const venvPython = path.join(
  root,
  "TheWholeDashboards here",
  ".venv",
  ...(isWindows ? ["Scripts", "python.exe"] : ["bin", "python"])
);
const python = existsSync(venvPython) ? venvPython : isWindows ? "python" : "python3";
const driverPython = existsSync(
  path.join(driverBackendDir, ".venv", ...(isWindows ? ["Scripts", "python.exe"] : ["bin", "python"]))
)
  ? path.join(
      driverBackendDir,
      ".venv",
      ...(isWindows ? ["Scripts", "python.exe"] : ["bin", "python"])
    )
  : python;
const npmCli = path.join(
  path.dirname(process.execPath),
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js"
);
const npm = existsSync(npmCli) ? process.execPath : isWindows ? "npm.cmd" : "npm";
const npmArgs = existsSync(npmCli) ? [npmCli] : [];

const children = [];
let shuttingDown = false;

function run(name, command, args, cwd, color) {
  const child = spawn(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    // The bundled npm CLI runs under node, and a shell would split the
    // virtualenv python path on the space in "TheWholeDashboards here".
    shell: isWindows && command.toLowerCase().endsWith(".cmd"),
    env: process.env,
  });
  children.push(child);

  const prefix = `[${name}]`;
  const forward = (stream, target) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) target.write(`${color}${prefix}\x1b[0m ${line}\n`);
    });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`${prefix} exited (${signal ?? code}). Stopping the other process.`);
    shutdown(code ?? 1);
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(code), 300);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const startMarketplaceFrontend = !backendOnly && !driverOnly;
const startMarketplaceBackend = !frontendOnly && !driverOnly;
const startDriver = driverOnly || all;

if (frontendOnly && backendOnly) {
  console.error("Nothing to start: pass at most one of --frontend-only / --backend-only.");
  process.exit(1);
}

if (startMarketplaceFrontend) {
  console.log("Starting frontend: greenpath-farm-to-market-ai on http://localhost:3000");
  run("frontend", npm, [...npmArgs, "run", "dev"], frontendDir, "\x1b[32m");
}

if (startMarketplaceBackend) {
  console.log("Starting marketplace API: Django on http://127.0.0.1:8000");
  run(
    "backend",
    python,
    ["manage.py", "runserver", "127.0.0.1:8000", "--noreload"],
    backendDir,
    "\x1b[36m"
  );
}

if (startDriver) {
  console.log("Starting DriverApp frontend on http://localhost:3001");
  run("driver-ui", npm, [...npmArgs, "run", "dev"], driverFrontendDir, "\x1b[33m");
  console.log("Starting DriverApp API: Django on http://127.0.0.1:8001");
  run(
    "driver-api",
    driverPython,
    ["manage.py", "runserver", "127.0.0.1:8001", "--noreload"],
    driverBackendDir,
    "\x1b[35m"
  );
}
