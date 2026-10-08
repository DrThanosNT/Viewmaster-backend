const express = require('express');
const prisma = require('../prismaClient');
const { requireAuth } = require('../middleware/auth');
const { sendError } = require('../utils/httpError');

const router = express.Router();
router.use(requireAuth);

const HISTORY_LIMIT = 5;

// Each damaged / temporary row comes back with the few log entries that
// explain it - who, when, how many and the note they left - newest first.
// This is what the app shows when you tap a row.
async function withHistory(rows, kindFilter, classify) {
  if (rows.length === 0) return rows;
  const itemIds = [...new Set(rows.map((r) => r.itemId))];
  const movements = await prisma.movement.findMany({
    where: { itemId: { in: itemIds }, OR: kindFilter },
    orderBy: { createdAt: 'desc' },
    take: 5000,
    select: {
      itemId: true, fromLocationId: true, toLocationId: true, eventId: true,
      quantity: true, note: true, createdAt: true, moverName: true,
      isDamage: true, isRepair: true, isTemporary: true,
    },
  });

  return rows.map((row) => {
    const history = [];
    for (const m of movements) {
      if (m.itemId !== row.itemId || (m.eventId ?? null) !== (row.eventId ?? null)) continue;
      const kind = classify(row, m);
      if (!kind) continue;
      history.push({ kind, quantity: m.quantity, note: m.note || null, createdAt: m.createdAt, moverName: m.moverName || null });
      if (history.length >= HISTORY_LIMIT) break;
    }
    return { ...row, history };
  });
}

// Damage and repair entries are logged with the same location on both sides.
function classifyDamaged(row, m) {
  if (m.toLocationId !== row.locationId) return null;
  if (m.isDamage) return 'damage';
  if (m.isRepair) return 'repair';
  return null;
}

// A borrowed import has no source; a return leaves this location.
function classifyTemporary(row, m) {
  if (!m.isTemporary) return null;
  if (m.fromLocationId === null && m.toLocationId === row.locationId) return 'temporary';
  if (m.fromLocationId === row.locationId) return 'return';
  return null;
}

router.get('/damaged', async (req, res) => {
  try {
    const rows = await prisma.stock.findMany({
      where: { damagedQuantity: { gt: 0 } },
      include: { item: true, location: true, event: true },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(await withHistory(rows, [{ isDamage: true }, { isRepair: true }], classifyDamaged));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/temporary', async (req, res) => {
  try {
    const rows = await prisma.stock.findMany({
      where: { temporaryQuantity: { gt: 0 } },
      include: { item: true, location: true, event: true },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(await withHistory(rows, [{ isTemporary: true }], classifyTemporary));
  } catch (err) {
    sendError(res, err);
  }
});

router.patch('/running-low', async (req, res) => {
  const { itemId, locationId, eventId = null, value } = req.body;
  if (!itemId || !locationId || typeof value !== 'boolean') {
    return res.status(400).json({ error: 'itemId, locationId and a boolean value are required' });
  }
  try {
    const updated = await prisma.stock.update({
      where: { itemId_locationId_eventKey: { itemId, locationId, eventKey: eventId || 'none' } },
      data: { runningLow: value },
      include: { item: true, location: true },
    });
    res.json(updated);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
