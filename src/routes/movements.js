const express = require('express');
const crypto = require('crypto');
const prisma = require('../prismaClient');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const EXPORT_LOCATION_NAME = 'Κατανάλωση';
const RETURN_LOCATION_NAME = 'Επιστροφή Δανεικών';
const MOVER_SELECT = { id: true, name: true, role: true, photoUrl: true };

async function ensureSystemLocation(name) {
  let loc = await prisma.location.findFirst({ where: { name } });
  if (!loc) loc = await prisma.location.create({ data: { name, type: 'OTHER', isSystem: true } });
  return loc;
}

async function resolveDestinationEventId(tx, locationId, requestedEventId) {
  const links = await tx.eventLocation.findMany({ where: { locationId } });
  if (links.length === 0) return null;
  if (links.length === 1) return links[0].eventId;
  if (!requestedEventId) throw new Error('Αυτή η τοποθεσία ανήκει σε πολλές εκδηλώσεις - επίλεξε για ποια εκδήλωση είναι.');
  if (!links.some((l) => l.eventId === requestedEventId)) throw new Error('Μη έγκυρη εκδήλωση για αυτή την τοποθεσία.');
  return requestedEventId;
}

router.get('/', async (req, res) => {
  const { itemId, locationId, take = 50, skip = 0 } = req.query;
  const where = {
    ...(itemId ? { itemId } : {}),
    ...(locationId ? { OR: [{ fromLocationId: locationId }, { toLocationId: locationId }] } : {}),
  };
  const movements = await prisma.movement.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Number(take),
    skip: Number(skip),
    include: { item: true, fromLocation: true, toLocation: true, event: true, movedBy: { select: MOVER_SELECT } },
  });
  res.json(movements);
});

router.post('/', async (req, res) => {
  const { itemId, quantity = 1, fromLocationId, toLocationId, note, photoUrl, batchId } = req.body;
  if (!itemId || !toLocationId) return res.status(400).json({ error: 'itemId and toLocationId are required' });
  if (fromLocationId === toLocationId) return res.status(400).json({ error: 'fromLocationId and toLocationId must differ' });
  try {
    const result = fromLocationId
      ? await moveOne(req, { itemId, quantity, fromLocationId, toLocationId, note, photoUrl, batchId })
      : await importOne(req, { itemId, toLocationId, quantity, note, batchId, temporary: false });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/batch', async (req, res) => {
  const { lines, note } = req.body;
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: 'A non-empty lines array is required' });
  for (const line of lines) {
    if (!line.itemId || !line.toLocationId) return res.status(400).json({ error: 'Each line needs itemId and toLocationId' });
    if (line.locationId && line.locationId === line.toLocationId) return res.status(400).json({ error: 'A line cannot have the same source and destination' });
  }
  const batchId = crypto.randomUUID();
  try {
    const results = [];
    for (const line of lines) {
      const movement = line.locationId
        ? await moveOne(req, { itemId: line.itemId, quantity: line.quantity, fromLocationId: line.locationId, fromEventId: line.fromEventId ?? null, toLocationId: line.toLocationId, toEventId: line.toEventId ?? null, note, batchId })
        : await importOne(req, { itemId: line.itemId, toLocationId: line.toLocationId, toEventId: line.toEventId ?? null, quantity: line.quantity, note, batchId, temporary: !!line.temporary });
      results.push(movement);
    }
    res.status(201).json({ batchId, movements: results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// EXPORT (Κατανάλωση) - a line can come from the normal usable pool
// (default) or, if fromDamaged is true, from the damaged pool. Either way
// it lands in the same system "Κατανάλωση" location and reads identically
// in the logs - there's no separate category for it.
router.post('/export-batch', async (req, res) => {
  const { lines, note } = req.body;
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: 'A non-empty lines array is required' });
  for (const line of lines) if (!line.itemId || !line.locationId) return res.status(400).json({ error: 'Each line needs itemId and locationId' });
  try {
    const exportLocation = await ensureSystemLocation(EXPORT_LOCATION_NAME);
    const batchId = crypto.randomUUID();
    const results = [];
    for (const line of lines) {
      const movement = line.fromDamaged
        ? await consumeDamagedOne(req, { itemId: line.itemId, locationId: line.locationId, eventId: line.eventId ?? null, toLocationId: exportLocation.id, quantity: line.quantity, note, batchId })
        : await moveOne(req, { itemId: line.itemId, quantity: line.quantity, fromLocationId: line.locationId, fromEventId: line.eventId ?? null, toLocationId: exportLocation.id, toEventId: null, note, batchId });
      results.push(movement);
    }
    res.status(201).json({ batchId, movements: results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/return-batch', async (req, res) => {
  const { lines, note } = req.body;
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: 'A non-empty lines array is required' });
  for (const line of lines) if (!line.itemId || !line.locationId) return res.status(400).json({ error: 'Each line needs itemId and locationId' });
  try {
    const returnLocation = await ensureSystemLocation(RETURN_LOCATION_NAME);
    const batchId = crypto.randomUUID();
    const results = [];
    for (const line of lines) {
      results.push(await returnOne(req, { itemId: line.itemId, locationId: line.locationId, eventId: line.eventId ?? null, toLocationId: returnLocation.id, quantity: line.quantity, note, batchId }));
    }
    res.status(201).json({ batchId, movements: results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/damage-batch', async (req, res) => {
  const { lines, note } = req.body;
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: 'A non-empty lines array is required' });
  for (const line of lines) if (!line.itemId || !line.locationId) return res.status(400).json({ error: 'Each line needs itemId and locationId' });
  const batchId = crypto.randomUUID();
  try {
    const results = [];
    for (const line of lines) {
      results.push(await markDamagedOne(req, { itemId: line.itemId, locationId: line.locationId, eventId: line.eventId ?? null, quantity: line.quantity, note, batchId }));
    }
    res.status(201).json({ batchId, movements: results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/repair-batch', async (req, res) => {
  const { lines, note } = req.body;
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: 'A non-empty lines array is required' });
  for (const line of lines) if (!line.itemId || !line.locationId) return res.status(400).json({ error: 'Each line needs itemId and locationId' });
  const batchId = crypto.randomUUID();
  try {
    const results = [];
    for (const line of lines) {
      results.push(await repairOne(req, { itemId: line.itemId, locationId: line.locationId, eventId: line.eventId ?? null, quantity: line.quantity, note, batchId }));
    }
    res.status(201).json({ batchId, movements: results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

async function moveOne(req, { itemId, quantity = 1, fromLocationId, fromEventId = null, toLocationId, toEventId = null, note, photoUrl, batchId }) {
  return prisma.$transaction(async (tx) => {
    if (fromLocationId) {
      const sourceStock = await tx.stock.findUnique({ where: { itemId_locationId_eventId: { itemId, locationId: fromLocationId, eventId: fromEventId } } });
      if (!sourceStock || sourceStock.quantity < quantity) throw new Error('Not enough stock at the source for this move');
      await tx.stock.update({ where: { itemId_locationId_eventId: { itemId, locationId: fromLocationId, eventId: fromEventId } }, data: { quantity: { decrement: quantity } } });
    }
    const resolvedToEventId = await resolveDestinationEventId(tx, toLocationId, toEventId);
    await tx.stock.upsert({
      where: { itemId_locationId_eventId: { itemId, locationId: toLocationId, eventId: resolvedToEventId } },
      update: { quantity: { increment: quantity } },
      create: { itemId, locationId: toLocationId, eventId: resolvedToEventId, quantity },
    });
    return tx.movement.create({
      data: { itemId, quantity, fromLocationId: fromLocationId || null, toLocationId, eventId: resolvedToEventId, movedById: req.user.id, note, photoUrl, batchId },
      include: { item: true, fromLocation: true, toLocation: true, event: true, movedBy: { select: MOVER_SELECT } },
    });
  });
}

async function importOne(req, { itemId, toLocationId, toEventId = null, quantity, note, batchId, temporary }) {
  return prisma.$transaction(async (tx) => {
    const resolvedToEventId = await resolveDestinationEventId(tx, toLocationId, toEventId);
    if (temporary) {
      await tx.stock.upsert({
        where: { itemId_locationId_eventId: { itemId, locationId: toLocationId, eventId: resolvedToEventId } },
        update: { temporaryQuantity: { increment: quantity } },
        create: { itemId, locationId: toLocationId, eventId: resolvedToEventId, quantity: 0, temporaryQuantity: quantity },
      });
    } else {
      await tx.stock.upsert({
        where: { itemId_locationId_eventId: { itemId, locationId: toLocationId, eventId: resolvedToEventId } },
        update: { quantity: { increment: quantity }, runningLow: false },
        create: { itemId, locationId: toLocationId, eventId: resolvedToEventId, quantity },
      });
    }
    return tx.movement.create({
      data: { itemId, quantity, fromLocationId: null, toLocationId, eventId: resolvedToEventId, movedById: req.user.id, note, batchId, isTemporary: !!temporary },
      include: { item: true, fromLocation: true, toLocation: true, event: true, movedBy: { select: MOVER_SELECT } },
    });
  });
}

async function returnOne(req, { itemId, locationId, eventId = null, toLocationId, quantity, note, batchId }) {
  return prisma.$transaction(async (tx) => {
    const stock = await tx.stock.findUnique({ where: { itemId_locationId_eventId: { itemId, locationId, eventId } } });
    if (!stock || stock.temporaryQuantity < quantity) throw new Error('Δεν υπάρχει αρκετό δανεικό απόθεμα εκεί για επιστροφή.');
    await tx.stock.update({ where: { itemId_locationId_eventId: { itemId, locationId, eventId } }, data: { temporaryQuantity: { decrement: quantity } } });
    return tx.movement.create({
      data: { itemId, quantity, fromLocationId: locationId, toLocationId, eventId, movedById: req.user.id, note, batchId, isTemporary: true },
      include: { item: true, fromLocation: true, toLocation: true, event: true, movedBy: { select: MOVER_SELECT } },
    });
  });
}

async function markDamagedOne(req, { itemId, locationId, eventId = null, quantity, note, batchId }) {
  return prisma.$transaction(async (tx) => {
    const stock = await tx.stock.findUnique({ where: { itemId_locationId_eventId: { itemId, locationId, eventId } } });
    if (!stock || stock.quantity < quantity) throw new Error('Δεν υπάρχει αρκετό διαθέσιμο απόθεμα εκεί για να σημειωθεί ως κατεστραμμένο.');
    await tx.stock.update({ where: { itemId_locationId_eventId: { itemId, locationId, eventId } }, data: { quantity: { decrement: quantity }, damagedQuantity: { increment: quantity } } });
    return tx.movement.create({
      data: { itemId, quantity, fromLocationId: locationId, toLocationId: locationId, eventId, movedById: req.user.id, note, batchId, isDamage: true },
      include: { item: true, fromLocation: true, toLocation: true, event: true, movedBy: { select: MOVER_SELECT } },
    });
  });
}

async function repairOne(req, { itemId, locationId, eventId = null, quantity, note, batchId }) {
  return prisma.$transaction(async (tx) => {
    const stock = await tx.stock.findUnique({ where: { itemId_locationId_eventId: { itemId, locationId, eventId } } });
    if (!stock || stock.damagedQuantity < quantity) throw new Error('Δεν υπάρχει αρκετό κατεστραμμένο απόθεμα εκεί για επισκευή.');
    await tx.stock.update({ where: { itemId_locationId_eventId: { itemId, locationId, eventId } }, data: { damagedQuantity: { decrement: quantity }, quantity: { increment: quantity } } });
    return tx.movement.create({
      data: { itemId, quantity, fromLocationId: locationId, toLocationId: locationId, eventId, movedById: req.user.id, note, batchId, isRepair: true },
      include: { item: true, fromLocation: true, toLocation: true, event: true, movedBy: { select: MOVER_SELECT } },
    });
  });
}

// Consuming FROM the damaged pool - identical shape to moveOne's destination
// handling, just decrements damagedQuantity at the source instead of
// quantity. No special flag is set on the resulting Movement, so it shows
// up in logs exactly like any other consumption entry.
async function consumeDamagedOne(req, { itemId, locationId, eventId = null, toLocationId, quantity, note, batchId }) {
  return prisma.$transaction(async (tx) => {
    const stock = await tx.stock.findUnique({ where: { itemId_locationId_eventId: { itemId, locationId, eventId } } });
    if (!stock || stock.damagedQuantity < quantity) throw new Error('Δεν υπάρχει αρκετό κατεστραμμένο απόθεμα εκεί για κατανάλωση.');
    await tx.stock.update({ where: { itemId_locationId_eventId: { itemId, locationId, eventId } }, data: { damagedQuantity: { decrement: quantity } } });
    await tx.stock.upsert({
      where: { itemId_locationId_eventId: { itemId, locationId: toLocationId, eventId: null } },
      update: { quantity: { increment: quantity } },
      create: { itemId, locationId: toLocationId, eventId: null, quantity },
    });
    return tx.movement.create({
      data: { itemId, quantity, fromLocationId: locationId, toLocationId, eventId, movedById: req.user.id, note, batchId },
      include: { item: true, fromLocation: true, toLocation: true, event: true, movedBy: { select: MOVER_SELECT } },
    });
  });
}

router.get('/logs', async (req, res) => {
  const { take = 50 } = req.query;
  const movements = await prisma.movement.findMany({
    orderBy: { createdAt: 'desc' },
    take: 800,
    include: { item: true, fromLocation: true, toLocation: true, event: true, movedBy: { select: MOVER_SELECT } },
  });

  const batches = new Map();
  for (const m of movements) {
    const batchKey = m.batchId || m.id;
    if (!batches.has(batchKey)) batches.set(batchKey, { id: batchKey, movedBy: m.movedBy, createdAt: m.createdAt, note: m.note, groups: new Map() });
    const batch = batches.get(batchKey);
    if (m.createdAt < batch.createdAt) batch.createdAt = m.createdAt;

    const kind = m.isDamage ? 'damage' : m.isRepair ? 'repair' : 'normal';
    const groupKey = `${kind}-${m.toLocationId}-${m.eventId || 'none'}`;
    if (!batch.groups.has(groupKey)) {
      batch.groups.set(groupKey, { location: m.toLocation, event: m.event, isDamage: m.isDamage, isRepair: m.isRepair, isTemporary: m.isTemporary, items: [], totalQuantity: 0 });
    }
    const group = batch.groups.get(groupKey);
    group.items.push({ name: m.item.name, quantity: m.quantity, fromLocation: m.fromLocation });
    group.totalQuantity += m.quantity;
  }

  const logs = [...batches.values()]
    .map((b) => ({ id: b.id, movedBy: b.movedBy, createdAt: b.createdAt, note: b.note, destinations: [...b.groups.values()] }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, Number(take));

  res.json(logs);
});

module.exports = router;
