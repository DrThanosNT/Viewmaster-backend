const express = require('express');
const prisma = require('../prismaClient');
const { requireAuth, requireRole } = require('../middleware/auth');
const { HttpError, sendError } = require('../utils/httpError');

const router = express.Router();
router.use(requireAuth);

const MOVER_SELECT = { id: true, name: true, role: true, photoUrl: true };

router.get('/', async (req, res) => {
  const { search, category, kind } = req.query;
  const items = await prisma.item.findMany({
    where: {
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      ...(category ? { category } : {}),
      ...(kind ? { kind } : {}),
    },
    include: { stock: { include: { location: true, event: true } } },
    orderBy: { name: 'asc' },
  });
  res.json(items);
});

router.get('/:id', async (req, res) => {
  const item = await prisma.item.findUnique({
    where: { id: req.params.id },
    include: {
      stock: { include: { location: true, event: true } },
      movements: {
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: { fromLocation: true, toLocation: true, movedBy: { select: MOVER_SELECT } },
      },
    },
  });
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

router.post('/', async (req, res) => {
  try {
    const { kind, category, notes } = req.body;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) throw new HttpError(400, 'Χρειάζεται όνομα.');
    const item = await prisma.item.create({ data: { name, kind: kind || 'DISCRETE', category, notes } });
    res.status(201).json(item);
  } catch (err) {
    sendError(res, err);
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { name, category, notes, isBroken, brokenNote, photoUrl } = req.body;
    const item = await prisma.item.update({ where: { id: req.params.id }, data: { name, category, notes, isBroken, brokenNote, photoUrl } });
    res.json(item);
  } catch (err) {
    sendError(res, err);
  }
});

// Real delete, refused while any is still in stock somewhere. Stock sitting
// in a system location (Κατανάλωση) is only a running total of what was
// used up, so it doesn't count. Log entries keep the item's name.
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const id = req.params.id;
    await prisma.$transaction(async (tx) => {
      const item = await tx.item.findUnique({ where: { id } });
      if (!item) throw new HttpError(404, 'Το αντικείμενο δεν βρέθηκε.');

      const occupied = await tx.stock.count({
        where: {
          itemId: id,
          location: { isSystem: false },
          OR: [{ quantity: { gt: 0 } }, { damagedQuantity: { gt: 0 } }, { temporaryQuantity: { gt: 0 } }],
        },
      });
      if (occupied > 0) {
        throw new HttpError(400, 'Δεν μπορείς να διαγράψεις αυτό το αντικείμενο - υπάρχει ακόμα απόθεμα. Μετέφερέ το ή κατανάλωσέ το πρώτα.');
      }

      await tx.stock.deleteMany({ where: { itemId: id } });
      await tx.item.delete({ where: { id } });
    });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
