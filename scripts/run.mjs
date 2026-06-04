import { spawn } from "child_process";

const mode = process.argv[2] || "dev";

function run(label, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
    ...options
  });
  return child;
}

const backend = run("backend", "npm", ["--prefix", "backend", "run", mode]);
const frontend = run("frontend", "npm", ["--prefix", "frontend", "run", mode]);
let shuttingDown = false;

function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  backend.kill("SIGTERM");
  frontend.kill("SIGTERM");
}

backend.on("exit", (code, signal) => {
  stop();
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code || 0;
});

frontend.on("exit", (code, signal) => {
  stop();
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code || 0;
});

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
