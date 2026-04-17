const express = require('express');
const statusService = require('../services/status');

const router = express.Router();

// GET /api/status – Globale Aggregation aus allen Caches
router.get('/', (req, res) => {
  try {
    const data = statusService.aggregate();
    res.json(data);
  } catch (err) {
    console.error('Status-Aggregation Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
