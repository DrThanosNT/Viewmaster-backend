const express = require('express');
const prisma = require('../prismaClient');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { search, category, kind } = req.query;
  const items = await prisma.item.findMany({
    where: {
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      ...(category ? { category } : {}),
      ...(kind ? { kind } : {}),
    },
    include: {
      stock: { include: { location: true } },
      consumableLogs: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { location: true },
      },
    },
    orderBy: { name: 'asc' },
  });
  res.json(items);
});

router.get('/:id', async (req, res) => {
  const item = await prisma.item.findUnique({
    where: { id: req.params.id },
    include: {
      stock: { include: { location: true } },
      movements: {
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: { fromLocation: true, toLocation: true, movedBy: true },
      },
      consumableLogs: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { location: true, setBy: true },
      },
    },
  });
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

router.post('/', async (req, res) => {
  try {
    const { name, kind, category, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const item = await prisma.item.create({
      data: { name, kind: kind || 'DISCRETE', category, notes },
    });
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { name, category, notes, isBroken, brokenNote, photoUrl } = req.body;
    const item = await prisma.item.update({
      where: { id: req.params.id },
      data: { name, category, notes, isBroken, brokenNote, photoUrl },
    });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
