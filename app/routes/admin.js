const express = require('express');
const fs = require('fs');
const { CONFIG_DIR, configFile } = require('../config-path');

const router = express.Router();

const BACKUP_FILES = [
  'apartments.json',
  'integrations.json',
  'tado-tokens.json'
];

// DELETE /api/admin/log — Aktions-Log leeren
router.delete('/log', (req, res) => {
  try {
    for (const name of ['automation-log.json', 'automation-state.json', 'daily-report-state.json']) {
      const p = configFile(name);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    res.json({ success: true, message: 'Log und State zurueckgesetzt.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function readJsonFile(name) {
  const p = configFile(name);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJsonFile(name, data) {
  fs.writeFileSync(configFile(name), JSON.stringify(data, null, 2), 'utf-8');
}

// GET /api/admin/backup — alle Config-Dateien als ein JSON-Download
router.get('/backup', (req, res) => {
  try {
    const backup = {
      version: 1,
      createdAt: new Date().toISOString(),
      configDir: CONFIG_DIR,
      files: {}
    };
    for (const name of BACKUP_FILES) {
      const data = readJsonFile(name);
      if (data !== null) backup.files[name] = data;
    }
    const filename = `faecherlofts-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(backup);
  } catch (err) {
    console.error('Backup fehlgeschlagen:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/restore — Config aus Backup-JSON wiederherstellen
router.post('/restore', (req, res) => {
  try {
    const backup = req.body;
    if (!backup || !backup.files || typeof backup.files !== 'object') {
      return res.status(400).json({ error: 'Ungueltiges Backup-Format.' });
    }

    const restored = [];
    const skipped = [];

    for (const name of BACKUP_FILES) {
      if (backup.files[name] !== undefined && backup.files[name] !== null) {
        writeJsonFile(name, backup.files[name]);
        restored.push(name);
      } else {
        skipped.push(name);
      }
    }

    console.log(`[admin] Restore: ${restored.length} Dateien wiederhergestellt, ${skipped.length} uebersprungen`);
    res.json({
      success: true,
      restored,
      skipped,
      message: `${restored.length} Dateien wiederhergestellt.`
    });
  } catch (err) {
    console.error('Restore fehlgeschlagen:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
