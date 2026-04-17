const { defineConfig, devices } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')

// Test-Isolation: temporaeres CONFIG_DIR pro Playwright-Lauf.
//
// Wird HIER (und nicht in global-setup.js) angelegt, weil playwright.config.js
// _vor_ globalSetup evaluiert wird: webServer.env wird beim Spawnen aus
// process.env gemergt, und wir muessen CONFIG_DIR garantiert zu diesem
// Zeitpunkt bereits gesetzt haben.
//
// WICHTIG: Playwright re-importiert diese Config in jedem Worker-Prozess.
// Ohne den env-Check wuerden Worker und webServer in unterschiedliche
// Temp-Verzeichnisse schreiben. Deshalb: wenn bereits gesetzt (vom Parent
// geerbt), diesen Wert weiterverwenden. Nur der erste Load (Main-Prozess)
// legt den Pfad an.
let TEST_CONFIG_DIR = process.env.CONFIG_DIR
if (!TEST_CONFIG_DIR || !TEST_CONFIG_DIR.includes('faecherlofts-test-')) {
  TEST_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'faecherlofts-test-'))
  process.env.CONFIG_DIR = TEST_CONFIG_DIR

  // Pfad an global-teardown.js durchreichen, damit dieser das Verzeichnis
  // nach dem Lauf zuverlaessig wieder loeschen kann.
  fs.writeFileSync(
    path.join(__dirname, 'tests', '.test-config-dir.tmp'),
    TEST_CONFIG_DIR,
    'utf-8'
  )
  console.log(`[playwright.config] CONFIG_DIR=${TEST_CONFIG_DIR}`)
}

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false, // serial: wir aendern shared state (apartments.json)
  workers: 1,           // ein Worker verhindert Race-Conditions auf apartments.json
  retries: 0,
  reporter: 'list',
  globalTeardown: require.resolve('./tests/global-teardown.js'),
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } }, // Chromium-based mobile
  ],
  webServer: {
    command: 'node server.js',
    url: 'http://localhost:3100',
    // Frischer Server pro Test-Lauf, damit CONFIG_DIR garantiert greift.
    reuseExistingServer: false,
    env: {
      PORT: '3100',
      CONFIG_DIR: TEST_CONFIG_DIR
    },
  },
})
