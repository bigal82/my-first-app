import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['**/*.test.js'],   // nur *.test.js – keine Playwright *.spec.js
    exclude: ['node_modules', 'tests/**'],
    setupFiles: ['./tests/vitest-setup.js'],
    // Mehrere Test-Dateien teilen sich config/apartments.json auf der Disk.
    // Ohne serielle Ausfuehrung schreiben parallele Worker in dieselbe Datei.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true }
    }
  },
})
