/**
 * Vitest Setup (per Worker)
 *
 * Legt ein temporaeres CONFIG_DIR unter os.tmpdir() an und setzt
 * process.env.CONFIG_DIR, bevor Test-Dateien oder App-Module geladen werden.
 *
 * Dadurch greifen alle routes/services (ueber app/config-path.js) auf das
 * temporaere Verzeichnis zu. Das reale app/config/ wird niemals angefasst.
 *
 * Mit `pool: forks, singleFork: true` laeuft dieses File exakt einmal pro
 * Test-Lauf im Worker.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.CONFIG_DIR || !fs.existsSync(process.env.CONFIG_DIR)) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faecherlofts-vitest-'));
  process.env.CONFIG_DIR = tmpDir;

  // Cleanup beim Worker-Shutdown. process.on('exit') laeuft synchron, deshalb
  // rmSync statt async. Best-effort — wenn der Worker hart gekillt wird,
  // laesst das Betriebssystem das Temp-Verzeichnis ohnehin stehen bis zum
  // naechsten OS-Cleanup.
  process.on('exit', () => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });
}
