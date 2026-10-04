const express = require('express');
const prisma = require('../prismaClient');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const events = await prisma.event.findMany({
    include: { eventLocations: { include: { location: true } } },
    orderBy: { startDate: 'desc' },
  });
  res.json(events);
});

router.get('/:id', async (req, res) => {
  const event = await prisma.event.findUnique({
    where: { id: req.params.id },
    include: { eventLocations: { include: { location: true } } },
  });
  if (!event) return res.status(404).json({ error: 'Not found' });
  res.json(event);
});

// POST /events - admin picks a name, a time period, and 1+ EXISTING
// non-storage locations. No new Location rows are created here - this
// solves the "typing a fresh location name each time" problem by only
// ever linking to the canonical, already-admin-maintained location list.
router.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const { name, startDate, endDate, locationIds } = req.body;
    if (!name || !startDate || !endDate || !Array.isArray(locationIds) || locationIds.length === 0) {
      return res.status(400).json({ error: 'name, startDate, endDate and at least one locationId are required' });
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      return res.status(400).json({ error: 'Μη έγκυρο χρονικό διάστημα.' });
    }

    const locations = await prisma.location.findMany({ where: { id: { in: locationIds } } });
    if (locations.length !== locationIds.length) {
      return res.status(400).json({ error: 'Μία ή περισσότερες τοποθεσίες δεν βρέθηκαν.' });
    }
    if (locations.some((l) => l.type === 'STORAGE')) {
      return res.status(400).json({ error: 'Δεν μπορείς να προσθέσεις αποθήκες σε εκδήλωση.' });
    }

    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.event.create({ data: { name, startDate: start, endDate: end } });
      for (const locationId of locationIds) {
        await tx.eventLocation.create({ data: { eventId: created.id, locationId } });
      }
      return tx.event.findUnique({
        where: { id: created.id },
        include: { eventLocations: { include: { location: true } } },
      });
    });

    res.status(201).json(event);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const { name, startDate, endDate } = req.body;
    const event = await prisma.event.update({
      where: { id: req.params.id },
      data: {
        name,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
      },
    });
    res.json(event);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /events/:id - only allowed once every stock bucket tagged with
// this event is fully empty (usable, damaged and temporary all zero),
// across every location it's linked to.
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const stock = await prisma.stock.findMany({
      where: {
        eventId: req.params.id,
        OR: [{ quantity: { gt: 0 } }, { damagedQuantity: { gt: 0 } }, { temporaryQuantity: { gt: 0 } }],
      },
    });
    if (stock.length > 0) {
      return res.status(400).json({
        error: 'Δεν μπορείς να διαγράψεις αυτή την εκδήλωση - υπάρχει ακόμα απόθεμα σε αυτή.',
      });
    }
    await prisma.event.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
