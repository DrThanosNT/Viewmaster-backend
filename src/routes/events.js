const express = require('express');
const prisma = require('../prismaClient');
const { requireAuth, requireRole } = require('../middleware/auth');
const { HttpError, sendError } = require('../utils/httpError');

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

// An event is a name, a time period, and 1+ EXISTING non-storage locations.
router.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const { startDate, endDate, locationIds } = req.body;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || !startDate || !endDate || !Array.isArray(locationIds) || locationIds.length === 0) {
      throw new HttpError(400, 'Χρειάζονται όνομα, χρονικό διάστημα και τουλάχιστον μία τοποθεσία.');
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      throw new HttpError(400, 'Μη έγκυρο χρονικό διάστημα.');
    }

    const locations = await prisma.location.findMany({ where: { id: { in: locationIds } } });
    if (locations.length !== locationIds.length) throw new HttpError(400, 'Μία ή περισσότερες τοποθεσίες δεν βρέθηκαν.');
    if (locations.some((l) => l.type === 'STORAGE')) throw new HttpError(400, 'Δεν μπορείς να προσθέσεις αποθήκες σε εκδήλωση.');

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
    sendError(res, err);
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
    sendError(res, err);
  }
});

// Real delete, refused while any stock is still tagged to the event. Log
// entries keep the event's name; its locations stay.
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    const id = req.params.id;
    await prisma.$transaction(async (tx) => {
      const event = await tx.event.findUnique({ where: { id } });
      if (!event) throw new HttpError(404, 'Η εκδήλωση δεν βρέθηκε.');

      const occupied = await tx.stock.count({
        where: {
          eventId: id,
          OR: [{ quantity: { gt: 0 } }, { damagedQuantity: { gt: 0 } }, { temporaryQuantity: { gt: 0 } }],
        },
      });
      if (occupied > 0) throw new HttpError(400, 'Δεν μπορείς να διαγράψεις αυτή την εκδήλωση - υπάρχει ακόμα απόθεμα σε αυτή.');

      await tx.stock.deleteMany({ where: { eventId: id } });
      await tx.eventLocation.deleteMany({ where: { eventId: id } });
      await tx.event.delete({ where: { id } });
    });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
