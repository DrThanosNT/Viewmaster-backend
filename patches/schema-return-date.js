// Run from the backend folder (safe to run twice).
const fs = require('fs');
const file = 'prisma/schema.prisma';
const src = fs.readFileSync(file, 'utf8');
if (/expectedReturnAt/.test(src)) { console.log('skipped  ' + file + ' (already has expectedReturnAt)'); process.exit(0); }
const block = (src.match(/model Stock \{[\s\S]*?\n\}/) || [])[0];
if (!block) { console.log('ERROR: model Stock not found in ' + file + ' - tell me'); process.exit(1); }
const lines = block.split('\n');
const at = lines.findIndex((l) => /^\s*temporaryQuantity\b/.test(l));
if (at === -1) { console.log('ERROR: temporaryQuantity not found in model Stock - tell me'); process.exit(1); }
lines.splice(at + 1, 0, '  expectedReturnAt  DateTime?');
fs.writeFileSync(file, src.replace(block, lines.join('\n')));
console.log('patched  ' + file);
