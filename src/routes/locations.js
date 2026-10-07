const express = require('express');
const prisma = require('../prismaClient');
const { requireAuth, requireRole } = require('../middleware/auth');
const { HttpError, sendError } = require('../utils/httpError');

const router = express.Router();
router.use(requireAuth);

const LOCATION_TYPES = ['STORAGE', 'VEHICLE', 'OTHER'];

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
    const { type, address, latitude, longitude } = req.body;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || !type) throw new HttpError(400, 'Χρειάζονται όνομα και τύπος.');
    if (!LOCATION_TYPES.includes(type)) throw new HttpError(400, 'Μη έγκυρος τύπος τοποθεσίας.');

    // Two locations with the same name make every picker ambiguous.
    const clash = await prisma.location.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    if (clash) throw new HttpError(409, 'Υπάρχει ήδη τοποθεσία με αυτό το όνομα.');

    const location = await prisma.location.create({ data: { name, type, address, latitude, longitude } });
    res.status(201).json(location);
  } catch (err) {
    sendError(res, err);
  }
});

router.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { name, address, latitude, longitude, isActive } = req.body;
    const location = await prisma.location.update({
      where: { id: req.params.id },
      data: { name, address, latitude, longitude, isActive },
    });
    res.json(location);
  } catch (err) {
    sendError(res, err);
  }
});

// Real delete, only when nothing is left there (usable, damaged OR
// temporary). Log entries keep the location's name.
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const id = req.params.id;
    await prisma.$transaction(async (tx) => {
      const loc = await tx.location.findUnique({ where: { id } });
      if (!loc) throw new HttpError(404, 'Η τοποθεσία δεν βρέθηκε.');
      if (loc.isSystem) throw new HttpError(400, 'Αυτή είναι τοποθεσία του συστήματος και δεν διαγράφεται.');

      const occupied = await tx.stock.count({
        where: {
          locationId: id,
          OR: [{ quantity: { gt: 0 } }, { damagedQuantity: { gt: 0 } }, { temporaryQuantity: { gt: 0 } }],
        },
      });
      if (occupied > 0) {
        throw new HttpError(400, 'Δεν μπορείς να διαγράψεις αυτή την τοποθεσία - περιέχει ακόμα απόθεμα. Μετέφερε πρώτα τα πάντα αλλού.');
      }

      // What's left is empty bookkeeping (zero-quantity rows) and event links.
      await tx.stock.deleteMany({ where: { locationId: id } });
      await tx.eventLocation.deleteMany({ where: { locationId: id } });
      await tx.location.delete({ where: { id } });
    });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
