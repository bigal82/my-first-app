/**
 * Downsampling fuer Minut-Zeitreihen (PROJ-8)
 *
 * Einfaches Bucket-Average: unterteilt die Serie in N Buckets gleicher
 * Breite und berechnet den Mittelwert jedes Buckets. Fuer Chart-Anzeige
 * ausreichend (keine Spitzen-Erhaltung wie LTTB, aber viel einfacher).
 *
 * Bei weniger Punkten als Ziel-Buckets wird die Serie unveraendert
 * zurueckgegeben.
 */

function bucketAverage(series, targetPoints = 200) {
  if (!Array.isArray(series) || series.length <= targetPoints) return series || [];

  const bucketSize = series.length / targetPoints;
  const result = [];
  for (let i = 0; i < targetPoints; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.floor((i + 1) * bucketSize);
    const slice = series.slice(start, end);
    if (slice.length === 0) continue;

    // Repraesentativen Zeitstempel aus der Mitte des Buckets nehmen
    const midIdx = Math.floor(slice.length / 2);
    const mid = slice[midIdx];

    // Average ueber alle nicht-null values
    const validValues = slice
      .map(p => (p && typeof p.value === 'number') ? p.value : null)
      .filter(v => v !== null);
    const avg = validValues.length > 0
      ? validValues.reduce((s, v) => s + v, 0) / validValues.length
      : null;

    result.push({
      timestamp: mid.timestamp,
      value: avg !== null ? Math.round(avg * 100) / 100 : null
    });
  }
  return result;
}

/**
 * Ziel-Punktzahl je nach Range.
 */
function targetPointsForRange(range) {
  if (range === '30d') return 200;
  if (range === '7d')  return 150;
  if (range === '24h') return 144; // pro 10 Min ein Punkt
  return 100;
}

module.exports = { bucketAverage, targetPointsForRange };
