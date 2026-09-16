const express = require('express');
const prisma = require('../prismaClient');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { status, from, to } = req.query;
  const events = await prisma.event.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(from || to
        ? {
            startDate: from ? { gte: new Date(from) } : undefined,
            endDate: to ? { lte: new Date(to) } : undefined,
          }
        : {}),
    },
    orderBy: { startDate: 'asc' },
    include: {
      crew: { include: { user: true } },
      items: { include: { item: true } },
    },
  });
  res.json(events);
});

router.get('/:id', async (req, res) => {
  const event = await prisma.event.findUnique({
    where: { id: req.params.id },
    include: {
      crew: { include: { user: true } },
      items: { include: { item: true } },
      notes: { orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }] },
      location: { include: { stock: { include: { item: true } } } },
    },
  });
  if (!event) return res.status(404).json({ error: 'Not found' });
  res.json(event);
});

router.post('/', async (req, res) => {
  try {
    const { name, description, startDate, endDate, address, latitude, longitude } = req.body;
    if (!name || !startDate || !endDate) {
      return res.status(400).json({ error: 'name, startDate and endDate are required' });
    }

    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          name,
          description,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          address,
          latitude,
          longitude,
        },
      });
      await tx.location.create({
        data: {
          name: `Event: ${name}`,
          type: 'EVENT',
          address,
          latitude,
          longitude,
          eventId: created.id,
        },
      });
      return created;
    });

    res.status(201).json(event);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { name, description, startDate, endDate, address, latitude, longitude, status } = req.body;
    const event = await prisma.event.update({
      where: { id: req.params.id },
      data: {
        name,
        description,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        address,
        latitude,
        longitude,
        status,
      },
    });
    res.json(event);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/crew', async (req, res) => {
  try {
    const { userId, roleOnEvent } = req.body;
    const crew = await prisma.eventCrew.create({
      data: { eventId: req.params.id, userId, roleOnEvent },
      include: { user: true },
    });
    res.status(201).json(crew);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/items', async (req, res) => {
  try {
    const { itemId, quantity = 1 } = req.body;
    const eventItem = await prisma.eventItem.upsert({
      where: { eventId_itemId: { eventId: req.params.id, itemId } },
      update: { quantity },
      create: { eventId: req.params.id, itemId, quantity },
      include: { item: true },
    });
    res.status(201).json(eventItem);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/notes', async (req, res) => {
  try {
    const { body, pinned } = req.body;
    const note = await prisma.eventNote.create({
      data: { eventId: req.params.id, authorName: req.user.name, body, pinned: !!pinned },
    });
    res.status(201).json(note);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id/overdue-check', async (req, res) => {
  const event = await prisma.event.findUnique({
    where: { id: req.params.id },
    include: { location: { include: { stock: { include: { item: true } } } } },
  });
  if (!event) return res.status(404).json({ error: 'Not found' });

  const isPastEnd = new Date() > new Date(event.endDate);
  const stillOut = (event.location?.stock || []).filter((s) => s.quantity > 0);
  res.json({ isPastEnd, stillOut });
});

module.exports = router;
