const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const prisma = new PrismaClient();

async function main() {
  console.log('Καθαρισμός παλιών δεδομένων...');
  await prisma.movement.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.eventLocation.deleteMany();
  await prisma.event.deleteMany();
  await prisma.item.deleteMany();
  await prisma.location.deleteMany();
  await prisma.user.deleteMany();

  console.log('Δημιουργία χρηστών...');
  const passwordHash = await bcrypt.hash('password123', 10);
  const thanos = await prisma.user.create({ data: { name: 'Θάνος', phone: '6900000000', passwordHash, role: 'ADMIN' } });
  const maria = await prisma.user.create({ data: { name: 'Μαρία', phone: '6900000001', passwordHash, role: 'WORKER' } });
  const kostas = await prisma.user.create({ data: { name: 'Κώστας', phone: '6900000002', passwordHash, role: 'WORKER' } });
  const eleni = await prisma.user.create({ data: { name: 'Ελένη', phone: '6900000003', passwordHash, role: 'MANAGER' } });

  console.log('Δημιουργία τοποθεσιών...');
  const storage1 = await prisma.location.create({ data: { name: 'Αποθήκη 1', type: 'STORAGE' } });
  const storage2 = await prisma.location.create({ data: { name: 'Αποθήκη 2', type: 'STORAGE' } });
  const storage3 = await prisma.location.create({ data: { name: 'Αποθήκη 3', type: 'STORAGE' } });
  const van1 = await prisma.location.create({ data: { name: 'Βαν 1', type: 'VEHICLE' } });
  const park = await prisma.location.create({ data: { name: 'Πάρκο Νιάρχος', type: 'OTHER' } });
  // These two names must match the constants in src/routes/movements.js.
  const exportLoc = await prisma.location.create({ data: { name: 'Κατανάλωση', type: 'OTHER', isSystem: true } });
  await prisma.location.create({ data: { name: 'Επιστροφή Δανεικών', type: 'OTHER', isSystem: true } });

  console.log('Δημιουργία αντικειμένων...');
  const items = {};
  const itemDefs = [
    ['Καλώδια XLR 10m', 'DISCRETE'],
    ['Καλώδια XLR 5m', 'DISCRETE'],
    ['Κόφτες', 'DISCRETE'],
    ['Κατσαβίδια σετ', 'DISCRETE'],
    ['Μπουλόνια Μ8', 'CONSUMABLE'],
    ['Μπουλόνια Μ10', 'CONSUMABLE'],
    ['Φωτιστικό PAR', 'DISCRETE'],
    ['Κονσόλα ήχου', 'DISCRETE'],
    ['Καρέκλες πτυσσόμενες', 'DISCRETE'],
    ['Τραπέζια catering', 'DISCRETE'],
    ['Μονωτική ταινία', 'CONSUMABLE'],
    ['Δεματικά', 'CONSUMABLE'],
  ];
  for (const [name, kind] of itemDefs) {
    items[name] = await prisma.item.create({ data: { name, kind } });
  }

  console.log('Δημιουργία αποθέματος...');
  // [item, location, quantity, damagedQuantity, temporaryQuantity]
  const stockData = [
    [items['Καλώδια XLR 10m'], storage1, 20, 0, 0],
    [items['Καλώδια XLR 5m'], storage2, 15, 0, 0],
    [items['Κόφτες'], storage1, 6, 0, 0],
    [items['Κόφτες'], storage3, 3, 0, 0],
    [items['Κατσαβίδια σετ'], storage1, 4, 0, 0],
    [items['Μπουλόνια Μ8'], storage2, 180, 0, 0],
    [items['Μπουλόνια Μ10'], storage2, 12, 0, 0],
    [items['Φωτιστικό PAR'], storage3, 12, 0, 0],
    [items['Κονσόλα ήχου'], storage1, 1, 0, 0],
    [items['Κονσόλα ήχου'], storage2, 0, 0, 1],
    [items['Καρέκλες πτυσσόμενες'], storage3, 46, 4, 0],
    [items['Τραπέζια catering'], van1, 8, 0, 0],
    [items['Μονωτική ταινία'], storage1, 3, 0, 0],
    [items['Δεματικά'], storage1, 500, 0, 0],
  ];
  for (const [item, location, quantity, damagedQuantity, temporaryQuantity] of stockData) {
    // eventId stays null and eventKey defaults to 'none': ordinary stock.
    await prisma.stock.create({
      data: { itemId: item.id, locationId: location.id, quantity, damagedQuantity, temporaryQuantity },
    });
  }

  // Flag the low Μ10 bolts as "τελειώνει"
  await prisma.stock.update({
    where: { itemId_locationId_eventKey: { itemId: items['Μπουλόνια Μ10'].id, locationId: storage2.id, eventKey: 'none' } },
    data: { runningLow: true },
  });

  console.log('Δημιουργία ιστορικού καταγραφών...');

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  }

  // Seed-only helper: lets history carry past timestamps. It also fills in
  // the copied names that every log entry carries.
  async function seedMovement({ item, from, to, quantity, movedBy, note, batchId, isDamage, isTemporary, when }) {
    return prisma.movement.create({
      data: {
        itemId: item.id,
        itemName: item.name,
        fromLocationId: from ? from.id : null,
        fromLocationName: from ? from.name : null,
        toLocationId: to.id,
        toLocationName: to.name,
        quantity,
        movedById: movedBy.id,
        moverName: movedBy.name,
        note,
        batchId,
        isDamage: !!isDamage,
        isTemporary: !!isTemporary,
        createdAt: when,
      },
    });
  }

  // 10 days ago: Maria imported new PAR lights
  await seedMovement({ item: items['Φωτιστικό PAR'], to: storage3, quantity: 12, movedBy: maria, note: 'νέα παραλαβή', when: daysAgo(10) });

  // 8 days ago: Kostas moved cables and cutters from storage 1 to storage 2
  {
    const batchId = crypto.randomUUID();
    await seedMovement({ item: items['Καλώδια XLR 10m'], from: storage1, to: storage2, quantity: 5, movedBy: kostas, note: 'για έλεγχο εξοπλισμού', batchId, when: daysAgo(8) });
    await seedMovement({ item: items['Κόφτες'], from: storage1, to: storage2, quantity: 2, movedBy: kostas, batchId, when: daysAgo(8) });
  }

  // 6 days ago: Thanos took in a borrowed console
  await seedMovement({ item: items['Κονσόλα ήχου'], to: storage2, quantity: 1, movedBy: thanos, note: 'δανείστηκε από εξωτερικό συνεργάτη', isTemporary: true, when: daysAgo(6) });

  // 5 days ago: Eleni marked 4 chairs as damaged at storage 3
  await seedMovement({ item: items['Καρέκλες πτυσσόμενες'], from: storage3, to: storage3, quantity: 4, movedBy: eleni, note: 'έσπασαν κατά τη μεταφορά', isDamage: true, when: daysAgo(5) });

  // 3 days ago: Maria sent a batch to the park
  {
    const batchId = crypto.randomUUID();
    await seedMovement({ item: items['Καλώδια XLR 5m'], from: storage2, to: park, quantity: 4, movedBy: maria, note: 'εκδήλωση στο πάρκο', batchId, when: daysAgo(3) });
    await seedMovement({ item: items['Τραπέζια catering'], from: van1, to: park, quantity: 3, movedBy: maria, batchId, when: daysAgo(3) });
    await seedMovement({ item: items['Φωτιστικό PAR'], from: storage3, to: park, quantity: 6, movedBy: maria, batchId, when: daysAgo(3) });
  }

  // 1 day ago: Kostas consumed some bolts
  await seedMovement({ item: items['Μπουλόνια Μ8'], from: storage2, to: exportLoc, quantity: 20, movedBy: kostas, note: 'χρησιμοποιήθηκαν σε στήσιμο', when: daysAgo(1) });

  console.log('Ολοκληρώθηκε.');
  console.log('');
  console.log('Λογαριασμοί για δοκιμή (κωδικός για όλους: password123):');
  console.log('  Θάνος (ADMIN)   - 6900000000');
  console.log('  Μαρία (WORKER)  - 6900000001');
  console.log('  Κώστας (WORKER) - 6900000002');
  console.log('  Ελένη (MANAGER) - 6900000003');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
