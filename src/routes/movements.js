const express = require('express');
const prisma = require('../prismaClient');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { itemId, locationId, take = 50, skip = 0 } = req.query;
  const where = {
    ...(itemId ? { itemId } : {}),
    ...(locationId
      ? { OR: [{ fromLocationId: locationId }, { toLocationId: locationId }] }
      : {}),
  };
  const movements = await prisma.movement.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Number(take),
    skip: Number(skip),
    include: { item: true, fromLocation: true, toLocation: true, movedBy: true },
  });
  res.json(movements);
});

router.post('/', async (req, res) => {
  const { itemId, quantity = 1, fromLocationId, toLocationId, note, photoUrl } = req.body;

  if (!itemId || !toLocationId) {
    return res.status(400).json({ error: 'itemId and toLocationId are required' });
  }
  if (fromLocationId === toLocationId) {
    return res.status(400).json({ error: 'fromLocationId and toLocationId must differ' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (fromLocationId) {
        const sourceStock = await tx.stock.findUnique({
          where: { itemId_locationId: { itemId, locationId: fromLocationId } },
        });
        if (!sourceStock || sourceStock.quantity < quantity) {
          throw new Error('Not enough stock at the source location for this move');
        }
        await tx.stock.update({
          where: { itemId_locationId: { itemId, locationId: fromLocationId } },
          data: { quantity: { decrement: quantity } },
        });
      }

      await tx.stock.upsert({
        where: { itemId_locationId: { itemId, locationId: toLocationId } },
        update: { quantity: { increment: quantity } },
        create: { itemId, locationId: toLocationId, quantity },
      });

      const movement = await tx.movement.create({
        data: {
          itemId,
          quantity,
          fromLocationId: fromLocationId || null,
          toLocationId,
          movedById: req.user.id,
          note,
          photoUrl,
        },
        include: { item: true, fromLocation: true, toLocation: true, movedBy: true },
      });

      return movement;
    });

    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
