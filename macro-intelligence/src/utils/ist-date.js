/**
 * IST Date Utility
 * Returns today's date in IST as both display string and ISO format.
 * Respects DATE_OVERRIDE env var for manual/historical runs.
 */
export function getISTDate() {
  const override = process.env.DATE_OVERRIDE;

  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) {
    // Pin the date parts to IST regardless of the host timezone (same
    // technique as the no-override path). The old midnight-IST parse read
    // LOCAL date parts, so on a UTC runner a manual backfill for
    // 2026-04-08 silently wrote 2026-04-07 output and overwrote the real
    // 04-07 Supabase row.
    const d = new Date(
      new Date(override + 'T12:00:00+05:30').toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
    );
    return formatDate(d);
  }

  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return formatDate(ist);
}

function formatDate(d) {
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                   'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  const isoDate = `${year}-${String(d.getMonth() + 1).padStart(2, '0')}-${day}`;
  return { dateStr: `${day} ${month} ${year}`, isoDate };
}
