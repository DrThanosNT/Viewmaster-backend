const express = require('express');
const prisma = require('../prismaClient');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { type, includeSystem } = req.query;
  const locations = await prisma.location.findMany({
    where: { ...(type ? { type } : {}), ...(includeSystem ? {} : { isSystem: false }) },
    include: {
      stock: { include: { item: true, event: true } },
      eventLocations: { include: { event: true } },
    },
    orderBy: { name: 'asc' },
  });
  res.json(locations);
});

router.get('/:id', async (req, res) => {
  const location = await prisma.location.findUnique({
    where: { id: req.params.id },
    include: {
      stock: { include: { item: true, event: true } },
      eventLocations: { include: { event: true } },
    },
  });
  if (!location) return res.status(404).json({ error: 'Not found' });
  res.json(location);
});

router.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const { name, type, address, latitude, longitude } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
    const location = await prisma.location.create({ data: { name, type, address, latitude, longitude } });
    res.status(201).json(location);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { name, address, latitude, longitude, isActive } = req.body;
    const location = await prisma.location.update({ where: { id: req.params.id }, data: { name, address, latitude, longitude, isActive } });
    res.json(location);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const stock = await prisma.stock.findMany({ where: { locationId: req.params.id, quantity: { gt: 0 } } });
    if (stock.length > 0) {
      return res.status(400).json({ error: `Δεν μπορείς να διαγράψεις αυτή την τοποθεσία - περιέχει ακόμα ${stock.length} είδη.` });
    }
    await prisma.location.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
