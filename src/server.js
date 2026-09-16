require('./loadEnv')();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const locationRoutes = require('./routes/locations');
const itemRoutes = require('./routes/items');
const movementRoutes = require('./routes/movements');
const consumableRoutes = require('./routes/consumables');
const eventRoutes = require('./routes/events');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/auth', authRoutes);
app.use('/locations', locationRoutes);
app.use('/items', itemRoutes);
app.use('/movements', movementRoutes);
app.use('/consumables', consumableRoutes);
app.use('/events', eventRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Viewmaster API listening on port ${PORT}`));
