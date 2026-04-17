/**
 * User-Verwaltung (admin-only).
 */
const express = require('express');
const userStore = require('../services/userStore');
const router = express.Router();

// GET /api/users — alle User (ohne Hashes)
router.get('/', (req, res) => {
  res.json(userStore.listUsers());
});

// POST /api/users — neuen User erstellen
router.post('/', async (req, res) => {
  try {
    const user = await userStore.createUser(req.body);
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/users/:id — User aktualisieren
router.put('/:id', async (req, res) => {
  try {
    const user = await userStore.updateUser(req.params.id, req.body);
    if (!user) return res.status(404).json({ error: 'User nicht gefunden.' });
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/users/:id — User loeschen
router.delete('/:id', (req, res) => {
  try {
    const ok = userStore.deleteUser(req.params.id);
    if (!ok) return res.status(404).json({ error: 'User nicht gefunden.' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
