const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-memory data store
const parkingLots = [
  { id: 1, name: 'Gwalior Fort Parking', totalSpots: 60, pricePerHour: 50, icon: '🏰' },
  { id: 2, name: 'DD Mall Parking', totalSpots: 80, pricePerHour: 40, icon: '🛍️' },
  { id: 3, name: 'Railway Station Parking', totalSpots: 70, pricePerHour: 35, icon: '🏛️' }
];

const spots = [];
const reservations = [];
let reservationIdCounter = 1;

// In-memory payment intents (for UPI QR demo)
const paymentIntents = [];
let nextIntentId = 1;
function createUpiIntent({ lotId, vehicleNumber, reservedHours, amount, note }) {
  const intent = {
    id: nextIntentId++,
    method: 'upi',
    status: 'pending',
    lotId,
    vehicleNumber,
    reservedHours,
    amount,
    upiUri: `upi://pay?pa=smartparking@upi&pn=Smart%20Parking&am=${encodeURIComponent(amount)}&cu=INR&tn=${encodeURIComponent(note || 'Parking advance')}`,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
  paymentIntents.push(intent);
  // Auto-complete payment after a few seconds (demo)
  setTimeout(() => {
    if (intent.status === 'pending') intent.status = 'paid';
  }, 8000);
  return intent;
}

// IoT event feed (in-memory)
const events = [];
let nextEventId = 1;
function pushEvent(type, payload) {
  events.push({ id: nextEventId++, type, ts: new Date().toISOString(), ...payload });
  if (events.length > 500) events.splice(0, events.length - 500);
}

// Initialize spots randomly with simulated telemetry (no ML)
(function initSpots() {
  spots.length = 0;
  parkingLots.forEach(lot => {
    for (let i = 1; i <= lot.totalSpots; i++) {
      const occupied = Math.random() > 0.7;
      spots.push({
        id: `${lot.id}-${i}`,
        lotId: lot.id,
        spotNumber: i,
        isOccupied: occupied,
        battery: Math.floor(70 + Math.random() * 30), // %
        signal: Math.floor(60 + Math.random() * 40), // %
        tempC: +(28 + Math.random() * 6).toFixed(1), // °C
        distanceCm: occupied ? +(20 + Math.random() * 80).toFixed(1) : +(150 + Math.random() * 150).toFixed(1),
        sensorHealthy: true,
        lastSeen: new Date().toISOString(),
      });
    }
  });
})();

// IoT simulation: periodically update occupancy and telemetry
let lastUpdateAt = new Date().toISOString();
setInterval(() => {
  const flips = Math.max(1, Math.floor(spots.length * 0.08)); // ~8%
  for (let i = 0; i < flips; i++) {
    const s = spots[Math.floor(Math.random() * spots.length)];

    // occupancy change
    const wasOccupied = s.isOccupied;
    if (Math.random() < 0.3) {
      s.isOccupied = !s.isOccupied;
      if (s.isOccupied !== wasOccupied) {
        pushEvent('occupancy', { lotId: s.lotId, spotNumber: s.spotNumber, isOccupied: s.isOccupied });
      }
    }

    // update telemetry
    const prevBattery = s.battery;
    s.battery = Math.max(5, Math.min(100, s.battery - (Math.random() * 0.5)));
    s.signal = Math.max(5, Math.min(100, s.signal + (Math.random() * 10 - 5)));
    s.distanceCm = s.isOccupied ? +(20 + Math.random() * 80).toFixed(1) : +(150 + Math.random() * 150).toFixed(1);
    s.tempC = +(s.tempC + (Math.random() * 2 - 1)).toFixed(1);

    // low battery alert (debounced)
    if (s.battery < 15 && (!s._lowWarned || prevBattery >= 15)) {
      pushEvent('battery_low', { lotId: s.lotId, spotNumber: s.spotNumber, battery: Math.round(s.battery) });
      s._lowWarned = true;
    }
    if (s.battery > 25 && s._lowWarned) {
      s._lowWarned = false;
    }

    // sensor glitch or recovery
    const prevHealthy = s.sensorHealthy;
    let newHealthy = s.sensorHealthy;
    if (Math.random() < 0.03) newHealthy = false; else if (Math.random() < 0.2) newHealthy = true;
    if (newHealthy !== s.sensorHealthy) {
      s.sensorHealthy = newHealthy;
      pushEvent('sensor', { lotId: s.lotId, spotNumber: s.spotNumber, healthy: s.sensorHealthy });
    }

    s.lastSeen = new Date().toISOString();
  }
  lastUpdateAt = new Date().toISOString();
}, 5000);

// API Routes

// Get all parking lots with availability
app.get('/api/lots', (req, res) => {
  const lotsWithAvailability = parkingLots.map(lot => {
    const lotSpots = spots.filter(s => s.lotId === lot.id);
    const available = lotSpots.filter(s => !s.isOccupied).length;
    return {
      ...lot,
      availableSpots: available,
      occupiedSpots: lot.totalSpots - available
    };
  });
  res.json(lotsWithAvailability);
});

// Payments: create UPI intent
app.post('/api/pay/upi-intent', (req, res) => {
  const { lotId, vehicleNumber, reservedHours } = req.body || {};
  const lot = parkingLots.find(l => l.id === lotId);
  const hours = parseInt(reservedHours);
  if (!lot || !hours || hours < 1) return res.status(400).json({ error: 'Invalid lot or hours' });
  const amount = hours * lot.pricePerHour;
  const intent = createUpiIntent({ lotId, vehicleNumber, reservedHours: hours, amount, note: `${lot.name} • ${vehicleNumber}` });
  res.status(201).json({ intentId: intent.id, upiUri: intent.upiUri, amount: intent.amount, expiresAt: intent.expiresAt });
});

// Payments: get intent status
app.get('/api/pay/intent/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const intent = paymentIntents.find(i => i.id === id);
  if (!intent) return res.status(404).json({ error: 'Not found' });
  res.json({ id: intent.id, status: intent.status, method: intent.method, amount: intent.amount });
});

// Get spots for a specific lot
app.get('/api/lots/:lotId/spots', (req, res) => {
  const lotId = parseInt(req.params.lotId);
  const lotSpots = spots.filter(s => s.lotId === lotId);
  res.json(lotSpots);
});

// Reserve a spot with advance payment
app.post('/api/reserve', (req, res) => {
  const { lotId, vehicleNumber, reservedHours, paymentMethod, intentId } = req.body;
  
  if (!lotId || !vehicleNumber) {
    return res.status(400).json({ error: 'Lot ID and vehicle number required' });
  }
  const hours = parseInt(reservedHours);
  if (!hours || hours < 1) {
    return res.status(400).json({ error: 'Reserved hours must be >= 1' });
  }

  const lot = parkingLots.find(l => l.id === lotId);
  if (!lot) {
    return res.status(404).json({ error: 'Lot not found' });
  }

  const availableSpot = spots.find(s => s.lotId === lotId && !s.isOccupied);
  
  if (!availableSpot) {
    return res.status(404).json({ error: 'No available spots in this lot' });
  }

  let prepaidAmount = hours * lot.pricePerHour;
  let payment;

  if ((paymentMethod || 'upi') === 'upi') {
    const intent = paymentIntents.find(i => i.id === parseInt(intentId));
    if (!intent || intent.method !== 'upi') {
      return res.status(400).json({ error: 'Invalid payment intent' });
    }
    if (intent.status !== 'paid') {
      return res.status(400).json({ error: 'Payment not completed yet' });
    }
    prepaidAmount = intent.amount;
    payment = { method: 'upi', status: 'paid', amount: intent.amount, paidAt: new Date().toISOString(), intentId: intent.id };
  } else {
    // Simulate immediate payment for non-UPI
    payment = { method: paymentMethod, status: 'paid', amount: prepaidAmount, paidAt: new Date().toISOString() };
  }

  availableSpot.isOccupied = true;
  
  const reservation = {
    id: reservationIdCounter++,
    spotId: availableSpot.id,
    lotId,
    spotNumber: availableSpot.spotNumber,
    vehicleNumber,
    checkInTime: new Date(),
    checkOutTime: null,
    fee: prepaidAmount,
    status: 'active',
    prepaidAmount,
    reservedHours: hours,
    payment
  };
  
  reservations.push(reservation);
  
  res.json({
    message: 'Spot paid & reserved successfully',
    reservation
  });
});

// Release a spot (checkout)
app.post('/api/release', (req, res) => {
  const { reservationId } = req.body;
  
  const reservation = reservations.find(r => r.id === reservationId && r.status === 'active');
  
  if (!reservation) {
    return res.status(404).json({ error: 'Active reservation not found' });
  }

  const spot = spots.find(s => s.id === reservation.spotId);
  if (spot) {
    spot.isOccupied = false;
  }

  reservation.checkOutTime = new Date();
  reservation.status = 'completed';
  
  // Calculate final fee and balance
  const lot = parkingLots.find(l => l.id === reservation.lotId);
  const hours = Math.ceil((reservation.checkOutTime - reservation.checkInTime) / (1000 * 60 * 60));
  const finalFee = hours * lot.pricePerHour;
  reservation.extraDue = 0;
  reservation.refundDue = 0;
  if (reservation.prepaidAmount != null) {
    if (finalFee > reservation.prepaidAmount) {
      reservation.extraDue = finalFee - reservation.prepaidAmount;
    } else if (finalFee < reservation.prepaidAmount) {
      reservation.refundDue = reservation.prepaidAmount - finalFee;
    }
  }
  reservation.fee = finalFee;
  
  res.json({
    message: 'Spot released successfully',
    reservation
  });
});

// Get all active reservations
app.get('/api/reservations', (req, res) => {
  const activeReservations = reservations.filter(r => r.status === 'active').map(r => {
    const lot = parkingLots.find(l => l.id === r.lotId);
    return {
      ...r,
      lotName: lot.name,
      pricePerHour: lot.pricePerHour
    };
  });
  res.json(activeReservations);
});

// Get reservation history
app.get('/api/history', (req, res) => {
  const completedReservations = reservations.filter(r => r.status === 'completed').map(r => {
    const lot = parkingLots.find(l => l.id === r.lotId);
    return {
      ...r,
      lotName: lot.name
    };
  });
  res.json(completedReservations);
});

// IoT status
app.get('/api/status', (req, res) => {
  const totalSpots = spots.length;
  const occupiedSpots = spots.filter(s => s.isOccupied).length;
  const avgBattery = totalSpots ? spots.reduce((a, s) => a + s.battery, 0) / totalSpots : 0;
  const unhealthySensors = spots.filter(s => !s.sensorHealthy).length;
  res.json({ lastUpdateAt, totalSpots, occupiedSpots, avgBattery: +avgBattery.toFixed(1), unhealthySensors });
});

// Lot metrics
app.get('/api/lots/:lotId/metrics', (req, res) => {
  const lotId = parseInt(req.params.lotId);
  const lotSpots = spots.filter(s => s.lotId === lotId);
  if (!lotSpots.length) return res.status(404).json({ error: 'Lot not found' });
  const total = lotSpots.length;
  const occupied = lotSpots.filter(s => s.isOccupied).length;
  const unhealthy = lotSpots.filter(s => !s.sensorHealthy).length;
  const avgBattery = +(lotSpots.reduce((a, s) => a + s.battery, 0) / total).toFixed(1);
  const avgSignal = +(lotSpots.reduce((a, s) => a + s.signal, 0) / total).toFixed(1);
  const avgTemp = +(lotSpots.reduce((a, s) => a + s.tempC, 0) / total).toFixed(1);
  res.json({ total, occupied, unhealthy, avgBattery, avgSignal, avgTemp });
});

// SSE stream of IoT updates
app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  if (res.flushHeaders) res.flushHeaders();

  let lastId = parseInt(req.headers['last-event-id'] || '0', 10);
  const interval = setInterval(() => {
    // per-lot summary
    const lots = parkingLots.map(lot => {
      const ls = spots.filter(s => s.lotId === lot.id);
      const total = ls.length;
      const occupied = ls.filter(s => s.isOccupied).length;
      const unhealthy = ls.filter(s => !s.sensorHealthy).length;
      const avgBattery = total ? +(ls.reduce((a, s) => a + s.battery, 0) / total).toFixed(1) : 0;
      const avgSignal = total ? +(ls.reduce((a, s) => a + s.signal, 0) / total).toFixed(1) : 0;
      const avgTemp = total ? +(ls.reduce((a, s) => a + s.tempC, 0) / total).toFixed(1) : 0;
      return { id: lot.id, name: lot.name, total, occupied, unhealthy, avgBattery, avgSignal, avgTemp };
    });

    const newEvents = events.filter(e => e.id > lastId).slice(-50);
    if (newEvents.length) {
      lastId = newEvents[newEvents.length - 1].id;
      const payload = { lastUpdateAt, lots, events: newEvents };
      res.write(`id: ${lastId}\n`);
      res.write(`event: iot\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } else {
      res.write(`event: ping\n`);
      res.write(`data: ${Date.now()}\n\n`);
    }
  }, 2000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

app.listen(PORT, () => {
  console.log(`🚗 Smart Parking Station server running on http://localhost:${PORT}`);
});
