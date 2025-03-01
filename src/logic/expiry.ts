import { logger } from "../utils/logger";
import type { AppState } from "../types";
import { queries } from "../database";

const SESSION_DURATION = 42 * 60 * 1000; // 42 minutes

export async function handleDomainExpiry(state: AppState, duration = SESSION_DURATION) {
  const sessionStart = new Date();
  const sessionEnd = new Date(sessionStart.getTime() + duration);

  logger.info(`
=== Domain Expiry Session ===
Started: ${sessionStart.toISOString()}
Expected end: ${sessionEnd.toISOString()}
Duration: ${duration / 1000 / 60} minutes
=========================`);


  const expiringDomains = queries.todayExpiration(state.db);
  if (expiringDomains.length === 0) {
    logger.info("No domains expiring today");
    logger.info("=== Session ended (no domains) ===");

    return;
  }

  logger.info(`Processing ${expiringDomains.length} expiring domains`);

  const releaseTimes = expiringDomains.map(domain => ({
    name: domain.name,
    releaseTime: Date.now() + secureRandom(duration)
  })).sort((a, b) => a.releaseTime - b.releaseTime);

  for (const { name, releaseTime } of releaseTimes) {
    const now = Date.now();
    if (now < releaseTime) {
      await Bun.sleep(releaseTime - now);
    }

    try {
      state.db.prepare(`
        UPDATE domains
        SET status = 'inactive',
        updated_at = ?
        WHERE name = ?
      `).run(Date.now(), name);

      logger.info(`Domain ${name} inactive and released at ${new Date().toISOString()}`);
    } catch (error) {
      logger.error(`Failed to expire domain ${name}:`, error);
    }
  }

  logger.info(`
=== Session completed ===
Started: ${sessionStart.toISOString()}
Ended: ${new Date().toISOString()}
Domains processed: ${expiringDomains.length}
======================`);
}

function secureRandom(range: number): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] % range;
}
