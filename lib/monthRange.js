// Shared with the frontend's monthRange() in public/app.js — keep in sync.
function monthRange(rows) {
  const dates = rows.flatMap(r => [r.start_date, r.deadline]).filter(Boolean).sort();
  if (!dates.length) return [];
  const first = dates[0].slice(0, 7), last = dates[dates.length - 1].slice(0, 7);
  const months = [];
  let [y, m] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return months;
}

module.exports = { monthRange };
