/**
 * IST Date Utility
 * Returns today's date in IST as both display string and ISO format.
 * Respects DATE_OVERRIDE env var for manual/historical runs.
 */
export function getISTDate() {
  const override = process.env.DATE_OVERRIDE;

  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) {
    const d = new Date(override + 'T00:00:00+05:30');
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
