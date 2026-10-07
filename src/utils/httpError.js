// An error with an HTTP status, for failures we raise on purpose.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const PRISMA_MESSAGES = {
  P2002: [409, 'Υπάρχει ήδη εγγραφή με αυτά τα στοιχεία.'],
  P2003: [409, 'Η ενέργεια δεν είναι δυνατή γιατί το στοιχείο χρησιμοποιείται αλλού.'],
  P2025: [404, 'Η εγγραφή δεν βρέθηκε.'],
};

const isDev = () => process.env.NODE_ENV !== 'production';

// Prisma messages start with a code frame that includes file paths and
// source. The useful part is always the last line.
function lastLine(err) {
  const lines = String(err?.message || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] || '';
}

function isPrismaError(err) {
  return (
    (typeof err?.code === 'string' && /^P\d{4}$/.test(err.code)) ||
    (typeof err?.name === 'string' && err.name.startsWith('PrismaClient'))
  );
}

// Errors we raise ourselves pass through unchanged. Prisma errors are
// always logged in full on the server. In development the short technical
// line is appended so the problem is visible on screen; in production only
// the friendly message goes out.
function sendError(res, err, fallbackStatus = 400) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }

  if (isPrismaError(err)) {
    console.error(err);
    const mapped = PRISMA_MESSAGES[err.code];
    const status = mapped ? mapped[0] : 500;
    const friendly = mapped ? mapped[1] : 'Κάτι πήγε στραβά. Δοκίμασε ξανά.';
    return res.status(status).json({ error: isDev() ? `${friendly}\n\n(${lastLine(err)})` : friendly });
  }

  if (fallbackStatus >= 500) {
    console.error(err);
    if (!isDev()) return res.status(500).json({ error: 'Κάτι πήγε στραβά. Δοκίμασε ξανά.' });
  }
  return res.status(fallbackStatus).json({ error: err?.message || 'Σφάλμα.' });
}

module.exports = { HttpError, sendError };
