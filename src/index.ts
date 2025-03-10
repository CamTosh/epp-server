import { Database } from "bun:sqlite";
import { handleEppRequest } from "./handlers/epp";
import { handleWhoisRequest } from "./handlers/whois";
import { initializeDatabase, queries } from "./database";
import { logger } from "./utils/logger";
import type { AppState } from "./types";
import { SessionManager } from "./logic/session";
import { UsageManager } from "./logic/usage";
import { handleRegistrarCreate } from "./routes/registrar";
import { handleLeaderboard } from "./routes/leaderboard";
import { handleAnalytics } from "./routes/analytics";
import { handleHello } from "./handlers/greeting";

const db = new Database("registry.sqlite", { create: true });
initializeDatabase(db);

const state: AppState = {
  db,
  rateLimit: new Map(),
  sessionManager: new SessionManager(),
  usageManager: new UsageManager({
    requestsPerHour: 5_000,
    requestsPerMinute: 500,
    penaltyThreshold: 5,
    penaltyDelay: 1_000,
    penaltyTokens: 2,
  }),
};

const servers = {
  epp: Bun.listen({
    hostname: "0.0.0.0",
    port: 700,
    socket: {
      open: (socket) => handleHello(socket),
      data: (socket, data) => handleEppRequest(socket, data, state),
      error: (_, error) => logger.error("EPP error:", error),
    },
  }),

  whois: Bun.listen({
    hostname: "0.0.0.0",
    port: 43,
    socket: {
      data: (socket, data) => handleWhoisRequest(socket, data, state),
      error: (_, error) => logger.error("WHOIS error:", error),
    },
  }),

  api: Bun.serve({
    port: 3000,
    routes: {
      "/health": new Response("OK"),
      "/": async () => {
        const htmlFile = await Bun.file("./src/index.html").text();
        return new Response(htmlFile, { headers: { "Content-Type": "text/html" } });
      },

      "/leaderboard": (req) => handleLeaderboard(req, state),
      "/analytics": (req) => handleAnalytics(req, state),

      "/registrar/create": (req) => handleRegistrarCreate(req, state),

      "/today-expiration": () => {
        const domains = queries.todayExpirationWithScore(state.db);
        const names = domains.map((domain) => domain.name);

        return new Response(JSON.stringify(names));
      },
    }
  }),
};

for (const [name, server] of Object.entries(servers)) {
  logger.info(`${name.toUpperCase()} server listening on ${server.hostname}:${server.port}`);
}

// Start session cleanup and log status
state.sessionManager.startCleanup();
logger.info(".TSH Registry started successfully");

process.on("SIGTERM", () => {
  state.sessionManager.stopCleanup();
  state.db.close();
  process.exit();
});
