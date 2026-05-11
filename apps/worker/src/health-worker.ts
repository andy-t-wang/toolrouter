import { createServer } from "node:http";

import { createStore } from "@toolrouter/db";
import { createHealthWorker, executeEndpoint } from "@toolrouter/router-core";

const store = createStore();
const intervalMs = Number(process.env.TOOLROUTER_HEALTH_INTERVAL_MS || 12 * 60 * 60 * 1000);
const worker = createHealthWorker({
  db: store,
  executor: executeEndpoint,
  intervalMs,
  logger: console,
});

if (process.argv.includes("--once")) {
  const force = process.argv.includes("--force");
  const results = await worker.runOnce({ force, useRecentRequests: !force });
  console.log(JSON.stringify({ ok: true, checked: results.length, results }, null, 2));
} else {
  await worker.runOnce();
  worker.start();
  const port = Number(process.env.PORT || process.env.TOOLROUTER_WORKER_HEALTH_PORT || "8080");
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, service: "toolrouter-worker" }));
  });
  server.listen(port, "0.0.0.0");
  console.log(JSON.stringify({ service: "toolrouter-worker", intervalMs, healthPort: port }));
  process.stdin.resume();
}
