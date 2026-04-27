/**
 * OpsManager Agent — Generates the Operations Cockpit HTML.
 *
 * Pure code. No LLM. Reads JSON state files + pings Supabase tables,
 * then renders a self-contained HTML health report.
 *
 * Called by the orchestrator after Validator passes, before GitPublisher.
 * Non-blocking — if it fails, the pipeline logs a warning and continues.
 */

import { generateCockpit } from './skills/ops-cockpit.js';

export class OpsManager {
  async report({ dateStr, isoDate, agentMetas, feedHealth, runStartTime }) {
    const start = Date.now();

    const result = await generateCockpit({
      dateStr,
      isoDate,
      agentMetas,
      feedHealth,
      runStartTime,
    });

    const latency = Date.now() - start;
    console.log(`[OpsManager] Cockpit generated in ${latency}ms`);

    return {
      outputPath: result.outputPath,
      meta: {
        agent: 'OpsManager',
        model: 'none',
        latency_ms: latency,
        tokens: { input: 0, output: 0 },
      },
    };
  }
}
