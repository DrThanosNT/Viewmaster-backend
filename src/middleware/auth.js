const jwt = require('jsonwebtoken');
const prisma = require('../prismaClient');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = header.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Re-check the user still exists (and hasn't been deleted) on every
    // request - this is what makes deleting a user instantly revoke access,
    // rather than waiting for the token to naturally expire.
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) {
      return res.status(401).json({ error: 'User no longer exists' });
    }

    // Use fresh role/name from the DB, not the (possibly stale) token payload
    req.user = { id: user.id, name: user.name, role: user.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
