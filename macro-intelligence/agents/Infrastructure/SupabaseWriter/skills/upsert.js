/**
 * Supabase Upsert Skill — Chunked upsert with retry logic.
 */

const CHUNK_SIZE = 20;

function getHeaders(serviceKey) {
  return {
    'Content-Type': 'application/json',
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Prefer': 'resolution=merge-duplicates,return=minimal',
  };
}

async function postWithRetry(url, body, headers, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const latency = Date.now() - start;

      if (!res.ok) {
        const errorText = await res.text().catch(() => 'unknown');
        const err = new Error(`HTTP ${res.status}: ${errorText}`);
        err.status = res.status;
        if (attempt < retries) {
          console.warn(`[Upsert] ${url} failed (${res.status}), retrying in 5s...`);
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        throw err;
      }

      return { status: res.status, latency, rows: Array.isArray(body) ? body.length : 1 };
    } catch (err) {
      if (attempt < retries && !err.status) {
        console.warn(`[Upsert] ${url} network error, retrying in 5s...`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Upsert rows to a Supabase table, chunking at CHUNK_SIZE.
 */
export async function upsert(table, rows, supabaseUrl, serviceKey, onConflict) {
  const conflict = onConflict ? `?on_conflict=${onConflict}` : '';
  const url = `${supabaseUrl}/rest/v1/${table}${conflict}`;
  const headers = getHeaders(serviceKey);
  const rowArray = Array.isArray(rows) ? rows : [rows];
  const results = [];

  for (let i = 0; i < rowArray.length; i += CHUNK_SIZE) {
    const chunk = rowArray.slice(i, i + CHUNK_SIZE);
    const result = await postWithRetry(url, chunk, headers);
    results.push(result);
    console.log(`[Upsert] ${table}: chunk ${Math.floor(i / CHUNK_SIZE) + 1} — ${result.rows} rows — ${result.status} — ${result.latency}ms`);
  }

  return {
    table,
    totalRows: rowArray.length,
    chunks: results.length,
    allSuccess: results.every(r => r.status >= 200 && r.status < 300),
  };
}

/**
 * Fetch a single row by query param.
 */
export async function fetchOne(table, queryParam, supabaseUrl, serviceKey) {
  const url = `${supabaseUrl}/rest/v1/${table}?${queryParam}&limit=1`;
  const headers = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
  };

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`fetchOne ${table}: HTTP ${res.status}`);
  const data = await res.json();
  return data[0] || null;
}
