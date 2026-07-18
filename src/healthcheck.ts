import { loadConfig } from "./config.js";

// Docker HEALTHCHECK entrypoint. A container with the UI disabled is healthy
// by definition — there is simply no HTTP surface to probe.
try {
  const config = loadConfig();
  if (!config.ui.enabled) process.exit(0);
  const res = await fetch(`http://localhost:${config.ui.port}/api/health`);
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}
