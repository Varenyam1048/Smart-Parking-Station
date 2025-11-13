const API_URL = 'http://localhost:3000/api';

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    
    // Update active tab
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    // Update active content
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');
    
    // Load data for the tab
    if (tabName === 'parking') {
      loadParkingLots();
    } else if (tabName === 'reservations') {
      loadReservations();
    } else if (tabName === 'history') {
      loadHistory();
    }
  });
});

// Load parking lots
async function loadParkingLots() {
  try {
    const response = await fetch(`${API_URL}/lots`);
    const lots = await response.json();
    
    const container = document.getElementById('parking-lots');
    
    if (lots.length === 0) {
      container.innerHTML = '<div class="empty-state"><h3>No parking lots available</h3></div>';
      return;
    }
    
    container.innerHTML = lots.map(lot => {
      const availabilityPercent = (lot.availableSpots / lot.totalSpots) * 100;
      let availabilityClass = 'high';
      if (availabilityPercent < 20) availabilityClass = 'low';
      else if (availabilityPercent < 50) availabilityClass = 'medium';
      
      return `
        <div class=\"parking-card\" onclick=\"openReserveModal(${lot.id}, '${lot.name}', ${lot.pricePerHour})\">
          <div class="lot-header">
            <div class="lot-icon">${lot.icon || '🅿️'}</div>
            <h3>${lot.name}</h3>
          </div>
          <div class=\"parking-info\">
            <div class="info-row">
              <span class="info-label">Available Spots:</span>
              <span class="info-value">${lot.availableSpots} / ${lot.totalSpots}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Occupied:</span>
              <span class="info-value">${lot.occupiedSpots}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Price per Hour:</span>
              <span class="info-value">₹${lot.pricePerHour}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Availability:</span>
              <span class="availability ${availabilityClass}">
                ${availabilityPercent.toFixed(0)}%
              </span>
            </div>
            <div class="progress">
              <div class="progress-bar ${availabilityClass}" style="width: ${availabilityPercent.toFixed(0)}%"></div>
            </div>
          </div>
          <button class="btn btn-primary" ${lot.availableSpots === 0 ? 'disabled' : ''}>
            ${lot.availableSpots === 0 ? 'Full' : 'Reserve Spot'}
          </button>
          <button class="btn btn-secondary" onclick="openSpotsModal(event, ${lot.id}, '${lot.name}')">
            View Live Spots
          </button>
        </div>
      `;
    }).join('');

  } catch (error) {
    console.error('Error loading parking lots:', error);
    showError('Failed to load parking lots');
  }
}

// Open reserve modal
function openReserveModal(lotId, lotName, pricePerHour) {
  document.getElementById('lot-id').value = lotId;
  document.getElementById('lot-name').value = lotName;
  document.getElementById('vehicle-number').value = '';
  const pph = document.getElementById('price-per-hour');
  if (pph) pph.value = pricePerHour;
  const hoursEl = document.getElementById('reserve-hours');
  if (hoursEl) hoursEl.value = 1;
  updateTotalAmount();
  document.getElementById('reserve-modal').style.display = 'block';
}

// Close reserve modal
function closeReserveModal() {
  document.getElementById('reserve-modal').style.display = 'none';
}

function updateTotalAmount() {
  const price = parseFloat(document.getElementById('price-per-hour')?.value || '0');
  const hours = parseInt(document.getElementById('reserve-hours')?.value || '0');
  const total = isFinite(price) && isFinite(hours) ? price * Math.max(1, hours) : 0;
  const totalEl = document.getElementById('total-amount');
  if (totalEl) totalEl.value = `₹${total}`;
}

// Handle reservation form submission
const hoursInput = document.getElementById('reserve-hours');
if (hoursInput) hoursInput.addEventListener('input', updateTotalAmount);

document.getElementById('reserve-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const lotId = parseInt(document.getElementById('lot-id').value);
  const vehicleNumber = document.getElementById('vehicle-number').value;
  const reservedHours = parseInt(document.getElementById('reserve-hours')?.value || '1');
  const paymentMethod = document.getElementById('payment-method')?.value || 'upi';
  
  try {
    if (paymentMethod === 'upi') {
      // Create payment intent first
      const intentRes = await fetch(`${API_URL}/pay/upi-intent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lotId, vehicleNumber, reservedHours })
      });
      const intent = await intentRes.json();
      if (!intentRes.ok) { alert(`❌ ${intent.error || 'Failed to create UPI intent'}`); return; }
      const upiQrImg = document.getElementById('upi-qr');
      const upiQrSection = document.getElementById('upi-qr-section');
      const upiStatus = document.getElementById('upi-status');
      if (upiQrSection) upiQrSection.classList.remove('hidden');
      if (upiQrImg) upiQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(intent.upiUri)}`;
      if (upiStatus) upiStatus.textContent = 'Waiting for payment…';
      // Poll for payment status
      let paid = false;
      for (let i = 0; i < 12; i++) { // ~24s
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await fetch(`${API_URL}/pay/intent/${intent.intentId}`);
        const status = await statusRes.json();
        if (status.status === 'paid') { paid = true; break; }
      }
      if (!paid) { alert('❌ Payment not completed. Please try again.'); return; }
      // Finalize reservation with intentId
      const response = await fetch(`${API_URL}/reserve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lotId, vehicleNumber, reservedHours, paymentMethod: 'upi', intentId: intent.intentId })
      });
      const data = await response.json();
      if (response.ok) {
        const prepaid = data.reservation.prepaidAmount || 0;
        alert(`✅ Paid & Reserved!\nSpot: #${data.reservation.spotNumber}\nVehicle: ${vehicleNumber}\nHours: ${data.reservation.reservedHours}\nPrepaid: ₹${prepaid}`);
        closeReserveModal();
        loadParkingLots();
      } else {
        alert(`❌ ${data.error}`);
      }
    } else {
      const response = await fetch(`${API_URL}/reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lotId, vehicleNumber, reservedHours, paymentMethod })
      });
      const data = await response.json();
      
      if (response.ok) {
        const prepaid = data.reservation.prepaidAmount || 0;
        alert(`✅ Paid & Reserved!\nSpot: #${data.reservation.spotNumber}\nVehicle: ${vehicleNumber}\nHours: ${data.reservation.reservedHours}\nPrepaid: ₹${prepaid}`);
        closeReserveModal();
        loadParkingLots();
      } else {
        alert(`❌ ${data.error}`);
      }
    }
  } catch (error) {
    console.error('Error making reservation:', error);
    alert('Failed to make reservation');
  }
});

// Load active reservations
async function loadReservations() {
  try {
    const response = await fetch(`${API_URL}/reservations`);
    const reservations = await response.json();
    
    const container = document.getElementById('active-reservations');
    
    if (reservations.length === 0) {
      container.innerHTML = '<div class="empty-state"><h3>No active reservations</h3><p>Reserve a parking spot to get started</p></div>';
      return;
    }
    
    container.innerHTML = reservations.map(res => {
      const checkInTime = new Date(res.checkInTime);
      const duration = Math.floor((Date.now() - checkInTime) / (1000 * 60));
      
      return `
        <div class="reservation-card">
          <div class="reservation-header">
            <h3>${res.lotName}</h3>
            <span class="status-badge status-active">Active</span>
          </div>
          <div class="reservation-details">
            <div class="detail-item">
              <span class="detail-label">Vehicle Number</span>
              <span class="detail-value">${res.vehicleNumber}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Spot Number</span>
              <span class="detail-value">#${res.spotNumber}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Check-in Time</span>
              <span class="detail-value">${checkInTime.toLocaleTimeString()}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Duration</span>
              <span class="detail-value">${duration} min</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Rate</span>
              <span class="detail-value">₹${res.pricePerHour}/hr</span>
            </div>
            ${res.prepaidAmount ? `<div class="detail-item"><span class="detail-label">Prepaid</span><span class="detail-value">₹${res.prepaidAmount}</span></div>` : ''}
          </div>
          <button class="btn btn-danger" onclick="releaseSpot(${res.id})">
            Check Out & Release Spot
          </button>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading reservations:', error);
    showError('Failed to load reservations');
  }
}

// Release a spot
async function releaseSpot(reservationId) {
  if (!confirm('Are you sure you want to check out?')) {
    return;
  }
  
  try {
    const response = await fetch(`${API_URL}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservationId })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      const hours = Math.ceil((new Date(data.reservation.checkOutTime) - new Date(data.reservation.checkInTime)) / (1000 * 60 * 60));
      const extra = data.reservation.extraDue || 0;
      const refund = data.reservation.refundDue || 0;
      alert(`✅ Check out successful!\n\nDuration: ${hours} hour(s)\nFinal Fee: ₹${data.reservation.fee}\n${extra > 0 ? `Extra Due: ₹${extra}` : ''}${refund > 0 ? `Refund: ₹${refund}` : ''}`);
      loadReservations();
      loadParkingLots();
    } else {
      alert(`❌ ${data.error}`);
    }
  } catch (error) {
    console.error('Error releasing spot:', error);
    alert('Failed to release spot');
  }
}

// Load history
async function loadHistory() {
  try {
    const response = await fetch(`${API_URL}/history`);
    const history = await response.json();
    
    const container = document.getElementById('history-list');
    
    if (history.length === 0) {
      container.innerHTML = '<div class="empty-state"><h3>No history yet</h3><p>Your completed reservations will appear here</p></div>';
      return;
    }
    
    container.innerHTML = history.map(res => {
      const checkInTime = new Date(res.checkInTime);
      const checkOutTime = new Date(res.checkOutTime);
      const duration = Math.ceil((checkOutTime - checkInTime) / (1000 * 60 * 60));
      
      return `
        <div class="reservation-card">
          <div class="reservation-header">
            <h3>${res.lotName}</h3>
            <span class="status-badge status-completed">Completed</span>
          </div>
          <div class="reservation-details">
            <div class="detail-item">
              <span class="detail-label">Vehicle Number</span>
              <span class="detail-value">${res.vehicleNumber}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Spot Number</span>
              <span class="detail-value">#${res.spotNumber}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Check-in</span>
              <span class="detail-value">${checkInTime.toLocaleString()}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Check-out</span>
              <span class="detail-value">${checkOutTime.toLocaleString()}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Duration</span>
              <span class="detail-value">${duration} hour(s)</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Total Fee</span>
              <span class="detail-value" style="color: #667eea; font-size: 1.2rem;">₹${res.fee}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading history:', error);
    showError('Failed to load history');
  }
}

function showError(message) {
  alert(`❌ ${message}`);
}

// Close modal when clicking outside
window.onclick = function(event) {
  const reserveModal = document.getElementById('reserve-modal');
  if (event.target === reserveModal) {
    closeReserveModal();
  }
  const spotsModal = document.getElementById('spots-modal');
  if (event.target === spotsModal) {
    closeSpotsModal();
  }
};

// Initial load
loadParkingLots();

// --- Live IoT updates ---
const STATUS_API = `${API_URL}/status`;
const lastUpdatedEl = document.getElementById('last-updated');
const avgBatteryEl = document.getElementById('avg-battery');
const faultyCountEl = document.getElementById('faulty-count');

async function updateStatus() {
  try {
    const res = await fetch(STATUS_API);
    if (!res.ok) return;
    const data = await res.json();
    if (lastUpdatedEl) {
      const dt = new Date(data.lastUpdateAt);
      lastUpdatedEl.textContent = isNaN(dt.getTime()) ? '--' : dt.toLocaleTimeString();
    }
    if (avgBatteryEl) avgBatteryEl.textContent = Math.round(data.avgBattery ?? 0);
    if (faultyCountEl) faultyCountEl.textContent = data.unhealthySensors ?? 0;
  } catch (_) {
    // ignore
  }
}

setInterval(() => {
  loadParkingLots();
  updateStatus();
}, 5000);

updateStatus();

// IoT SSE feed
(function setupIotStream(){
  try {
    const feedEl = document.getElementById('iot-feed');
    const statusEl = document.getElementById('feed-status');
    if (!feedEl) return;
    const es = new EventSource(`${API_URL}/stream`);
    es.addEventListener('open', () => { if (statusEl) statusEl.textContent = 'Live'; });
    es.addEventListener('error', () => { if (statusEl) statusEl.textContent = 'Reconnecting...'; });
    es.addEventListener('iot', (evt) => {
      try {
        const payload = JSON.parse(evt.data);
        if (Array.isArray(payload.events) && payload.events.length) {
          payload.events.forEach(ev => appendFeedItem(ev));
          // keep only last 100 items
          const items = feedEl.querySelectorAll('.feed-item');
          for (let i = 0; i < items.length - 100; i++) items[i].remove();
          feedEl.scrollTop = feedEl.scrollHeight;
        }
      } catch (_) {}
    });
  } catch (_) {}
})();

function appendFeedItem(ev) {
  const feedEl = document.getElementById('iot-feed');
  if (!feedEl) return;
  const time = new Date(ev.ts).toLocaleTimeString();
  let label = '';
  let badgeCls = 'badge-occupancy';
  if (ev.type === 'battery_low') { label = `Battery low at Lot ${ev.lotId} • #${ev.spotNumber} (${ev.battery}%)`; badgeCls = 'badge-battery'; }
  else if (ev.type === 'sensor') { label = `Sensor ${ev.healthy ? 'OK' : 'Issue'} at Lot ${ev.lotId} • #${ev.spotNumber}`; badgeCls = 'badge-sensor'; }
  else if (ev.type === 'occupancy') { label = `Spot ${ev.isOccupied ? 'occupied' : 'vacant'} at Lot ${ev.lotId} • #${ev.spotNumber}`; badgeCls = 'badge-occupancy'; }
  else { label = `${ev.type} event`; }
  const div = document.createElement('div');
  div.className = 'feed-item';
  div.innerHTML = `<div class="feed-left"><span class="badge ${badgeCls}">${ev.type}</span><span>${label}</span></div><div class="feed-time">${time}</div>`;
  feedEl.appendChild(div);
}

// Live spots modal logic
let spotsPollTimer = null;
let currentSpotsLotId = null;

function openSpotsModal(e, lotId, lotName) {
  if (e && e.stopPropagation) e.stopPropagation();
  currentSpotsLotId = lotId;
  document.getElementById('spots-modal-title').textContent = `Live Spots • ${lotName}`;
  document.getElementById('spots-modal').style.display = 'block';
  fetchAndRenderSpots();
  if (!spotsPollTimer) {
    spotsPollTimer = setInterval(fetchAndRenderSpots, 3000);
  }
}

function closeSpotsModal() {
  const modal = document.getElementById('spots-modal');
  modal.style.display = 'none';
  if (spotsPollTimer) {
    clearInterval(spotsPollTimer);
    spotsPollTimer = null;
  }
}

async function fetchAndRenderSpots() {
  if (!currentSpotsLotId) return;
  try {
    const res = await fetch(`${API_URL}/lots/${currentSpotsLotId}/spots`);
    const list = await res.json();
    const grid = document.getElementById('spots-grid');
    grid.innerHTML = list.map(s => {
      const cls = `${s.isOccupied ? 'occupied' : 'vacant'} ${s.sensorHealthy === false ? 'sensor-bad' : ''}`;
      const title = `Spot #${s.spotNumber} • ${s.isOccupied ? 'Occupied' : 'Vacant'}\nBattery: ${Math.round(s.battery)}%  Signal: ${Math.round(s.signal)}%\nDistance: ${s.distanceCm} cm  Temp: ${s.tempC}°C`;
      return `
        <div class="spot-tile ${cls}" title="${title}">
          <div class="spot-label">#${s.spotNumber}</div>
        </div>
      `;
    }).join('');
  } catch (e) {
    // ignore render errors
  }
}
