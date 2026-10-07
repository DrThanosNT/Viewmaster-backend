const express = require('express');
const prisma = require('../prismaClient');
const { requireAuth } = require('../middleware/auth');
const { sendError } = require('../utils/httpError');

const router = express.Router();
router.use(requireAuth);

router.get('/damaged', async (req, res) => {
  const rows = await prisma.stock.findMany({
    where: { damagedQuantity: { gt: 0 } },
    include: { item: true, location: true, event: true },
    orderBy: { updatedAt: 'desc' },
  });
  res.json(rows);
});

router.get('/temporary', async (req, res) => {
  const rows = await prisma.stock.findMany({
    where: { temporaryQuantity: { gt: 0 } },
    include: { item: true, location: true, event: true },
    orderBy: { updatedAt: 'desc' },
  });
  res.json(rows);
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
