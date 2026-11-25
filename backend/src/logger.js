// Log strutturati in JSON (pino): leggibili da qualsiasi sistema di log aggregation.
import pino from "pino";

export function createLogger(level = "info") {
  return pino({
    level,
    base: { service: "backend" },
    redact: { paths: ["req.headers.authorization", "req.headers.cookie", "*.apiKey", "*.token"], censor: "[redatto]" },
  });
}
