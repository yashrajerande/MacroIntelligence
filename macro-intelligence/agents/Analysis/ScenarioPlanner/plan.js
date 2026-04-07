/**
 * ScenarioPlanner — Uses Claude Haiku for scenario narratives.
 * Probability labels are fixed. LLM fills names + descriptions.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { buildScenarioContext, mergeScenarios } from './skills/scenario-logic.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const persona = readFileSync(join(__dirname, 'Persona.md'), 'utf-8');
const client = new Anthropic();

export class ScenarioPlanner {
  async plan(allData) {
    const start = Date.now();

    const context = buildScenarioContext(allData.regime.data, allData.signals.data);

    const prompt = `${context}

Based on this regime and signals data, generate three scenarios for the India macro outlook.

Return JSON wrapped in <<<JSON and >>> markers:
{
  "base_name": "3-5 word evocative name",
  "base_desc": "2-3 sentences. Path of least resistance.",
  "bull_name": "3-5 word evocative name",
  "bull_desc": "2-3 sentences. Requires 2+ positive developments.",
  "bear_name": "3-5 word evocative name",
  "bear_desc": "2-3 sentences. Plausible but non-consensus tail."
}

Names must be specific to the current macro environment. Not generic.`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: [{ type: 'text', text: persona, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    });

    const tokens = { input: response.usage?.input_tokens || 0, output: response.usage?.output_tokens || 0 };
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');

    let llmOutput;
    const jsonMatch = text.match(/<<<JSON\s*([\s\S]*?)\s*>>>/) || text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      llmOutput = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    } else {
      throw new Error('[ScenarioPlanner] Failed to extract JSON from response');
    }

    const scenarios = mergeScenarios(llmOutput);

    const latency = Date.now() - start;
    console.log(`[ScenarioPlanner] Done in ${latency}ms.`);

    return {
      data: scenarios,
      meta: {
        agent: 'ScenarioPlanner',
        model: 'claude-haiku-4-5-20251001',
        latency_ms: latency,
        tokens,
      },
    };
  }
}
