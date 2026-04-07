/**
 * Web Search Skill — Uses Claude Haiku + web_search tool to search and extract data.
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export async function searchAndExtract(query, extractionPrompt) {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: [{
      type: 'text',
      text: 'You are a data extraction assistant. Search for the query. Return ONLY structured JSON between <<<JSON and >>> markers. No explanation. No prose. JSON only.',
      cache_control: { type: 'ephemeral' },
    }],
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{
      role: 'user',
      content: `${query}\n\nExtract: ${extractionPrompt}`,
    }],
  });

  // Concatenate all text blocks from the response
  let fullText = '';
  for (const block of response.content) {
    if (block.type === 'text') {
      fullText += block.text;
    }
  }

  // Extract JSON between markers
  const jsonMatch = fullText.match(/<<<JSON\s*([\s\S]*?)\s*>>>/);
  if (!jsonMatch) {
    // Fallback: try to find raw JSON object
    const rawJsonMatch = fullText.match(/\{[\s\S]*\}/);
    if (rawJsonMatch) {
      try {
        return {
          data: JSON.parse(rawJsonMatch[0]),
          tokens: {
            input: response.usage?.input_tokens || 0,
            output: response.usage?.output_tokens || 0,
          },
        };
      } catch {
        // fall through
      }
    }
    return {
      error: 'parse_failed',
      raw: fullText,
      tokens: {
        input: response.usage?.input_tokens || 0,
        output: response.usage?.output_tokens || 0,
      },
    };
  }

  try {
    return {
      data: JSON.parse(jsonMatch[1]),
      tokens: {
        input: response.usage?.input_tokens || 0,
        output: response.usage?.output_tokens || 0,
      },
    };
  } catch {
    return {
      error: 'parse_failed',
      raw: jsonMatch[1],
      tokens: {
        input: response.usage?.input_tokens || 0,
        output: response.usage?.output_tokens || 0,
      },
    };
  }
}
