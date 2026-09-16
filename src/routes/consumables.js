const express = require('express');
const prisma = require('../prismaClient');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/status', async (req, res) => {
  const { itemId, locationId, status } = req.body;
  if (!itemId || !locationId || !status) {
    return res.status(400).json({ error: 'itemId, locationId and status are required' });
  }
  try {
    const log = await prisma.consumableStatusLog.create({
      data: { itemId, locationId, status, setById: req.user.id },
      include: { item: true, location: true },
    });
    res.status(201).json(log);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/low', async (req, res) => {
  const logs = await prisma.consumableStatusLog.findMany({
    orderBy: { createdAt: 'desc' },
    include: { item: true, location: true },
  });
  const latestByPair = new Map();
  for (const log of logs) {
    const key = `${log.itemId}-${log.locationId}`;
    if (!latestByPair.has(key)) latestByPair.set(key, log);
  }
  const low = [...latestByPair.values()].filter((l) => l.status !== 'FULL');
  res.json(low);
});

module.exports = router;
