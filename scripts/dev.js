/* eslint-disable @typescript-eslint/no-require-imports */
const net = require("node:net");
const { spawn } = require("node:child_process");

const startPort = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const extraArgs = process.argv.slice(2);

function canUsePort(port, listenHost) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", (error) => resolve(error.code !== "EADDRINUSE"));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, listenHost);
  });
}

async function canUsePortEverywhere(port) {
  const hosts = [host, "0.0.0.0", "127.0.0.1", "::", "::1"];
  const uniqueHosts = [...new Set(hosts)];
  const checks = await Promise.all(uniqueHosts.map((listenHost) => canUsePort(port, listenHost)));

  return checks.every(Boolean);
}

async function findPort(port) {
  let nextPort = port;

  while (!(await canUsePortEverywhere(nextPort))) {
    nextPort += 1;
  }

  return nextPort;
}

async function main() {
  const port = await findPort(startPort);
  const nextBin = require.resolve("next/dist/bin/next");

  console.log(`Starting Next.js dev server on port ${port}`);

  const child = spawn(process.execPath, [nextBin, "dev", "-H", host, "-p", String(port), ...extraArgs], {
    env: { ...process.env, PORT: String(port) },
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
