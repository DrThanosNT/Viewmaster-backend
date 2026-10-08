// Run from the backend folder:  node patches/backend-role-refresh.js   (safe to run twice)
const fs = require('fs');

function patch(file, change) {
  if (!fs.existsSync(file)) { console.log('MISSING  ' + file); return; }
  const before = fs.readFileSync(file, 'utf8');
  const after = change(before);
  if (after === null) { console.log('skipped  ' + file + ' (already done)'); return; }
  if (after === false) { console.log('ERROR    ' + file + ' (could not find the spot to patch - tell me)'); process.exitCode = 1; return; }
  fs.writeFileSync(file, after);
  console.log('patched  ' + file);
}

// 1. GET /auth/me - the app asks this to learn the member's CURRENT role.
patch('src/routes/auth.js', (src) => {
  if (src.includes("router.get('/me'")) return null;
  const marker = "router.patch('/me/photo'";
  if (!src.includes(marker)) return false;
  const route = `// The app polls this to pick up role changes made by an admin. It leaves out
// the photo on purpose, so the check stays tiny.
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, role: true },
    });
    if (!user) throw new HttpError(401, 'User no longer exists');
    res.json(user);
  } catch (err) {
    sendError(res, err);
  }
});

`;
  return src.replace(marker, route + marker);
});

// 2. The "no permission" message in Greek, for someone who was just demoted.
patch('src/middleware/auth.js', (src) => {
  if (!src.includes("'Insufficient permissions'")) return src.includes('Δεν έχεις δικαίωμα') ? null : false;
  return src.replace("'Insufficient permissions'", "'Δεν έχεις δικαίωμα για αυτή την ενέργεια.'");
});
