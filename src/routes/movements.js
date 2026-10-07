const express = require('express');
const crypto = require('crypto');
const prisma = require('../prismaClient');
const { requireAuth } = require('../middleware/auth');
const { HttpError, sendError } = require('../utils/httpError');

const router = express.Router();
router.use(requireAuth);

const EXPORT_LOCATION_NAME = 'Κατανάλωση';
const RETURN_LOCATION_NAME = 'Επιστροφή Δανεικών';
const MOVER_SELECT = { id: true, name: true, role: true, photoUrl: true };

// Stock rows are identified by (item, location, eventKey). eventKey is the
// event's id, or 'none' for ordinary stock. It is never null.
const keyOf = (eventId) => eventId || 'none';
const stockWhere = (itemId, locationId, eventId) => ({
  itemId_locationId_eventKey: { itemId, locationId, eventKey: keyOf(eventId) },
});

async function ensureSystemLocation(name) {
  let loc = await prisma.location.findFirst({ where: { name, isSystem: true } });
  if (!loc) loc = await prisma.location.create({ data: { name, type: 'OTHER', isSystem: true } });
  return loc;
}

async function resolveDestinationEventId(tx, locationId, requestedEventId) {
  const links = await tx.eventLocation.findMany({ where: { locationId } });
  if (links.length === 0) return null;
  if (links.length === 1) return links[0].eventId;
  if (!requestedEventId) throw new HttpError(400, 'Αυτή η τοποθεσία ανήκει σε πολλές εκδηλώσεις - επίλεξε για ποια εκδήλωση είναι.');
  if (!links.some((l) => l.eventId === requestedEventId)) throw new HttpError(400, 'Μη έγκυρη εκδήλωση για αυτή την τοποθεσία.');
  return requestedEventId;
}

// The names copied into every log entry. Because the log keeps its own
// copy, the item/location/event/member can be deleted later without
// touching history.
async function snapshotNames(tx, req, { itemId, fromLocationId, toLocationId, eventId }) {
  const item = await tx.item.findUnique({ where: { id: itemId }, select: { name: true } });
  if (!item) throw new HttpError(404, 'Το αντικείμενο δεν βρέθηκε.');
  const to = await tx.location.findUnique({ where: { id: toLocationId }, select: { name: true } });
  if (!to) throw new HttpError(404, 'Η τοποθεσία δεν βρέθηκε.');
  const from = fromLocationId ? await tx.location.findUnique({ where: { id: fromLocationId }, select: { name: true } }) : null;
  const event = eventId ? await tx.event.findUnique({ where: { id: eventId }, select: { name: true } }) : null;
  return {
    itemName: item.name,
    toLocationName: to.name,
    fromLocationName: from ? from.name : null,
    eventName: event ? event.name : null,
    moverName: req.user.name,
  };
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
    include: { movedBy: { select: MOVER_SELECT } },
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
    sendError(res, err);
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
    sendError(res, err);
  }
});

// EXPORT (Κατανάλωση) - from the normal pool, or from the damaged pool when
// fromDamaged is true. Either way it reads the same in the logs.
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
    sendError(res, err);
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
    sendError(res, err);
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
    sendError(res, err);
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
    sendError(res, err);
  }
});

async function moveOne(req, { itemId, quantity = 1, fromLocationId, fromEventId = null, toLocationId, toEventId = null, note, photoUrl, batchId }) {
  return prisma.$transaction(async (tx) => {
    if (fromLocationId) {
      const sourceStock = await tx.stock.findUnique({ where: stockWhere(itemId, fromLocationId, fromEventId) });
      if (!sourceStock || sourceStock.quantity < quantity) throw new HttpError(400, 'Δεν υπάρχει αρκετό απόθεμα στην τοποθεσία προέλευσης.');
      await tx.stock.update({ where: stockWhere(itemId, fromLocationId, fromEventId), data: { quantity: { decrement: quantity } } });
    }
    const resolvedToEventId = await resolveDestinationEventId(tx, toLocationId, toEventId);
    await tx.stock.upsert({
      where: stockWhere(itemId, toLocationId, resolvedToEventId),
      update: { quantity: { increment: quantity } },
      create: { itemId, locationId: toLocationId, eventId: resolvedToEventId, eventKey: keyOf(resolvedToEventId), quantity },
    });
    const names = await snapshotNames(tx, req, { itemId, fromLocationId, toLocationId, eventId: resolvedToEventId });
    return tx.movement.create({
      data: { itemId, quantity, fromLocationId: fromLocationId || null, toLocationId, eventId: resolvedToEventId, movedById: req.user.id, note, photoUrl, batchId, ...names },
    });
  });
}

async function importOne(req, { itemId, toLocationId, toEventId = null, quantity, note, batchId, temporary }) {
  return prisma.$transaction(async (tx) => {
    const resolvedToEventId = await resolveDestinationEventId(tx, toLocationId, toEventId);
    if (temporary) {
      await tx.stock.upsert({
        where: stockWhere(itemId, toLocationId, resolvedToEventId),
        update: { temporaryQuantity: { increment: quantity } },
        create: { itemId, locationId: toLocationId, eventId: resolvedToEventId, eventKey: keyOf(resolvedToEventId), quantity: 0, temporaryQuantity: quantity },
      });
    } else {
      await tx.stock.upsert({
        where: stockWhere(itemId, toLocationId, resolvedToEventId),
        update: { quantity: { increment: quantity }, runningLow: false },
        create: { itemId, locationId: toLocationId, eventId: resolvedToEventId, eventKey: keyOf(resolvedToEventId), quantity },
      });
    }
    const names = await snapshotNames(tx, req, { itemId, fromLocationId: null, toLocationId, eventId: resolvedToEventId });
    return tx.movement.create({
      data: { itemId, quantity, fromLocationId: null, toLocationId, eventId: resolvedToEventId, movedById: req.user.id, note, batchId, isTemporary: !!temporary, ...names },
    });
  });
}

async function returnOne(req, { itemId, locationId, eventId = null, toLocationId, quantity, note, batchId }) {
  return prisma.$transaction(async (tx) => {
    const stock = await tx.stock.findUnique({ where: stockWhere(itemId, locationId, eventId) });
    if (!stock || stock.temporaryQuantity < quantity) throw new HttpError(400, 'Δεν υπάρχει αρκετό δανεικό απόθεμα εκεί για επιστροφή.');
    await tx.stock.update({ where: stockWhere(itemId, locationId, eventId), data: { temporaryQuantity: { decrement: quantity } } });
    const names = await snapshotNames(tx, req, { itemId, fromLocationId: locationId, toLocationId, eventId });
    return tx.movement.create({
      data: { itemId, quantity, fromLocationId: locationId, toLocationId, eventId, movedById: req.user.id, note, batchId, isTemporary: true, ...names },
    });
  });
}

async function markDamagedOne(req, { itemId, locationId, eventId = null, quantity, note, batchId }) {
  return prisma.$transaction(async (tx) => {
    const stock = await tx.stock.findUnique({ where: stockWhere(itemId, locationId, eventId) });
    if (!stock || stock.quantity < quantity) throw new HttpError(400, 'Δεν υπάρχει αρκετό διαθέσιμο απόθεμα εκεί για να σημειωθεί ως κατεστραμμένο.');
    await tx.stock.update({ where: stockWhere(itemId, locationId, eventId), data: { quantity: { decrement: quantity }, damagedQuantity: { increment: quantity } } });
    const names = await snapshotNames(tx, req, { itemId, fromLocationId: locationId, toLocationId: locationId, eventId });
    return tx.movement.create({
      data: { itemId, quantity, fromLocationId: locationId, toLocationId: locationId, eventId, movedById: req.user.id, note, batchId, isDamage: true, ...names },
    });
  });
}

async function repairOne(req, { itemId, locationId, eventId = null, quantity, note, batchId }) {
  return prisma.$transaction(async (tx) => {
    const stock = await tx.stock.findUnique({ where: stockWhere(itemId, locationId, eventId) });
    if (!stock || stock.damagedQuantity < quantity) throw new HttpError(400, 'Δεν υπάρχει αρκετό κατεστραμμένο απόθεμα εκεί για επισκευή.');
    await tx.stock.update({ where: stockWhere(itemId, locationId, eventId), data: { damagedQuantity: { decrement: quantity }, quantity: { increment: quantity } } });
    const names = await snapshotNames(tx, req, { itemId, fromLocationId: locationId, toLocationId: locationId, eventId });
    return tx.movement.create({
      data: { itemId, quantity, fromLocationId: locationId, toLocationId: locationId, eventId, movedById: req.user.id, note, batchId, isRepair: true, ...names },
    });
  });
}

// Consuming FROM the damaged pool. No special flag, so it reads exactly
// like any other consumption entry in the logs.
async function consumeDamagedOne(req, { itemId, locationId, eventId = null, toLocationId, quantity, note, batchId }) {
  return prisma.$transaction(async (tx) => {
    const stock = await tx.stock.findUnique({ where: stockWhere(itemId, locationId, eventId) });
    if (!stock || stock.damagedQuantity < quantity) throw new HttpError(400, 'Δεν υπάρχει αρκετό κατεστραμμένο απόθεμα εκεί για κατανάλωση.');
    await tx.stock.update({ where: stockWhere(itemId, locationId, eventId), data: { damagedQuantity: { decrement: quantity } } });
    await tx.stock.upsert({
      where: stockWhere(itemId, toLocationId, null),
      update: { quantity: { increment: quantity } },
      create: { itemId, locationId: toLocationId, eventId: null, eventKey: 'none', quantity },
    });
    const names = await snapshotNames(tx, req, { itemId, fromLocationId: locationId, toLocationId, eventId });
    return tx.movement.create({
      data: { itemId, quantity, fromLocationId: locationId, toLocationId, eventId, movedById: req.user.id, note, batchId, ...names },
    });
  });
}

function moverOf(m) {
  if (m.movedBy) return m.movedBy;
  return m.moverName ? { id: 'deleted', name: m.moverName, role: null, photoUrl: null } : null;
}

// The logs read ONLY the copied names, so deleting an item, location, event
// or member never changes how history looks. (The live link to the member
// is used just to show their current photo while they still exist.)
router.get('/logs', async (req, res) => {
  const { take = 50 } = req.query;
  const movements = await prisma.movement.findMany({
    orderBy: { createdAt: 'desc' },
    take: 800,
    include: { movedBy: { select: MOVER_SELECT } },
  });

  const batches = new Map();
  for (const m of movements) {
    const batchKey = m.batchId || m.id;
    if (!batches.has(batchKey)) batches.set(batchKey, { id: batchKey, movedBy: moverOf(m), createdAt: m.createdAt, note: m.note, groups: new Map() });
    const batch = batches.get(batchKey);
    if (m.createdAt < batch.createdAt) batch.createdAt = m.createdAt;

    const kind = m.isDamage ? 'damage' : m.isRepair ? 'repair' : 'normal';
    const groupKey = `${kind}-${m.toLocationId ?? m.toLocationName}-${m.eventId ?? m.eventName ?? 'none'}`;
    if (!batch.groups.has(groupKey)) {
      batch.groups.set(groupKey, {
        location: { id: m.toLocationId ?? `gone-${m.toLocationName}`, name: m.toLocationName },
        event: m.eventName ? { name: m.eventName } : null,
        isDamage: m.isDamage, isRepair: m.isRepair, isTemporary: m.isTemporary,
        items: [], totalQuantity: 0,
      });
    }
    const group = batch.groups.get(groupKey);
    group.items.push({ name: m.itemName, quantity: m.quantity, fromLocation: m.fromLocationName ? { name: m.fromLocationName } : null });
    group.totalQuantity += m.quantity;
  }

  const logs = [...batches.values()]
    .map((b) => ({ id: b.id, movedBy: b.movedBy, createdAt: b.createdAt, note: b.note, destinations: [...b.groups.values()] }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, Number(take));

  res.json(logs);
});

module.exports = router;
