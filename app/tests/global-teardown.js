/**
 * Globales Playwright-Teardown: loescht das temporaere CONFIG_DIR, das in
 * global-setup.js angelegt wurde. Das reale `app/config/` wird niemals
 * beruehrt.
 */
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '.test-config-dir.tmp');

module.exports = async function globalTeardown() {
  if (!fs.existsSync(STATE_FILE)) return;
  let tmpDir = '';
  try {
    tmpDir = fs.readFileSync(STATE_FILE, 'utf-8').trim();
  } catch {}
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`[global-teardown] removed ${tmpDir}`);
  }
  fs.unlinkSync(STATE_FILE);
};
