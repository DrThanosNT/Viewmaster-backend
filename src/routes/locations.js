const express = require('express');
const prisma = require('../prismaClient');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { type } = req.query;
  const locations = await prisma.location.findMany({
    where: type ? { type } : {},
    include: { stock: { include: { item: true } } },
    orderBy: { name: 'asc' },
  });
  res.json(locations);
});

router.get('/:id', async (req, res) => {
  const location = await prisma.location.findUnique({
    where: { id: req.params.id },
    include: {
      stock: { include: { item: true } },
      consumableLogs: {
        include: { item: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
    },
  });
  if (!location) return res.status(404).json({ error: 'Not found' });
  res.json(location);
});

router.post('/', async (req, res) => {
  try {
    const { name, type, address, latitude, longitude } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
    const location = await prisma.location.create({
      data: { name, type, address, latitude, longitude },
    });
    res.status(201).json(location);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { name, address, latitude, longitude, isActive } = req.body;
    const location = await prisma.location.update({
      where: { id: req.params.id },
      data: { name, address, latitude, longitude, isActive },
    });
    res.json(location);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
