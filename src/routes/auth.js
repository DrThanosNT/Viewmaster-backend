const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../prismaClient');
const { requireAuth, requireRole } = require('../middleware/auth');
const { HttpError, sendError } = require('../utils/httpError');

const router = express.Router();

const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}
function isRateLimited(key) {
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAttempt > WINDOW_MS) { loginAttempts.delete(key); return false; }
  return entry.count >= MAX_ATTEMPTS;
}
function recordFailedAttempt(key) {
  const entry = loginAttempts.get(key);
  if (!entry || Date.now() - entry.firstAttempt > WINDOW_MS) loginAttempts.set(key, { count: 1, firstAttempt: Date.now() });
  else entry.count += 1;
}
function clearAttempts(key) { loginAttempts.delete(key); }

router.post('/register', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { name, phone, email, password, role } = req.body;
    if (!name || !password) throw new HttpError(400, 'Χρειάζονται όνομα και κωδικός.');
    const allowedRoles = ['WORKER', 'MANAGER', 'ADMIN'];
    const finalRole = allowedRoles.includes(role) ? role : 'WORKER';
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { name, phone, email, passwordHash, role: finalRole } });
    res.status(201).json({ id: user.id, name: user.name, role: user.role });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/login', async (req, res) => {
  const { phone, email, password } = req.body;
  if (!password || (!phone && !email)) {
    return res.status(400).json({ error: 'Χρειάζονται τηλέφωνο και κωδικός.' });
  }
  const identifier = phone || email;
  const key = `${identifier}:${getClientIp(req)}`;
  if (isRateLimited(key)) return res.status(429).json({ error: 'Πάρα πολλές προσπάθειες. Δοκίμασε ξανά σε λίγο.' });

  try {
    const user = await prisma.user.findFirst({ where: phone ? { phone } : { email } });
    if (!user) { recordFailedAttempt(key); return res.status(401).json({ error: 'Invalid credentials' }); }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) { recordFailedAttempt(key); return res.status(401).json({ error: 'Invalid credentials' }); }
    clearAttempts(key);
    const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, role: user.role, photoUrl: user.photoUrl } });
  } catch (err) {
    sendError(res, err);
  }
});

// The app polls this to pick up role changes made by an admin. It leaves out
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

router.patch('/me/photo', requireAuth, async (req, res) => {
  try {
    const { photoUrl } = req.body;
    if (typeof photoUrl !== 'string' && photoUrl !== null) throw new HttpError(400, 'photoUrl must be a string or null');
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { photoUrl },
      select: { id: true, name: true, role: true, photoUrl: true },
    });
    res.json(user);
  } catch (err) {
    sendError(res, err);
  }
});

router.patch('/users/:id/role', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    if (req.params.id === req.user.id) throw new HttpError(400, 'Δεν μπορείς να αλλάξεις τον δικό σου ρόλο.');
    const { role } = req.body;
    if (!['WORKER', 'MANAGER', 'ADMIN'].includes(role)) throw new HttpError(400, 'Μη έγκυρος ρόλος.');
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role },
      select: { id: true, name: true, phone: true, email: true, role: true, photoUrl: true, createdAt: true },
    });
    res.json(user);
  } catch (err) {
    sendError(res, err);
  }
});

// Real delete. Log entries keep the member's name (copied into them); only
// the link and the photo are lost.
router.delete('/users/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    if (req.params.id === req.user.id) throw new HttpError(400, 'Δεν μπορείς να διαγράψεις τον εαυτό σου.');
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/users', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, phone: true, email: true, role: true, photoUrl: true, createdAt: true },
    orderBy: { name: 'asc' },
  });
  res.json(users);
});

module.exports = router;
