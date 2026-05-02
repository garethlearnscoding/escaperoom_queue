const TWO_MINUTES = 2 * 60 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;
const POLL_MS = 1500;

let pollTimer = null;
let generalPollTimer = null;
let countdownTimer = null;
let lastStatus = null;
let currentToken = null;
let qValidityInterval = null;

// Standalone Scanner Logic (Embedded to remove imports)
let html5QrCode = null;
let isScannerStarting = false;

async function startScanner(successCallback, elementId) {
    if (isScannerStarting || (html5QrCode && html5QrCode.isScanning)) {
        if (html5QrCode && html5QrCode.isScanning) {
            const loadingEl = document.getElementById('queue-camera-loading');
            if (loadingEl) {
                loadingEl.classList.add('hidden');
                loadingEl.classList.remove('flex');
            }
        }
        return;
    }
    
    const loadingEl = document.getElementById('queue-camera-loading');
    if (loadingEl) {
        loadingEl.classList.remove('hidden');
        loadingEl.classList.add('flex');
    }
    
    isScannerStarting = true;

    try {
        if (!html5QrCode) {
            html5QrCode = new Html5Qrcode(elementId);
        }
        await html5QrCode.start(
            { facingMode: "environment" },
            { fps: 20, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
            (text) => successCallback(text)
        );
        if (loadingEl) {
            loadingEl.classList.add('hidden');
            loadingEl.classList.remove('flex');
        }
    } catch (err) {
        console.error("Scanner error:", err);
        if (loadingEl) {
            loadingEl.classList.add('hidden');
            loadingEl.classList.remove('flex');
        }
        const errEl = document.getElementById('queue-scan-error');
        if (errEl) errEl.textContent = "Camera error. Please ensure permissions are granted.";
    } finally {
        isScannerStarting = false;
    }
}

async function stopScanner() {
    if (html5QrCode && html5QrCode.isScanning) {
        try {
            await html5QrCode.stop();
        } catch (e) { console.error("Stop error", e); }
    }
    const loadingEl = document.getElementById('queue-camera-loading');
    if (loadingEl) {
        loadingEl.classList.add('hidden');
        loadingEl.classList.remove('flex');
    }
}

const UI = {
    get title() { return document.getElementById('queue-modal-title'); },
    get subtitle() { return document.getElementById('queue-modal-subtitle'); },
    screens: {
        get instructions() { return document.getElementById('queue-screen-instructions'); },
        get scanner() { return document.getElementById('queue-screen-scanner'); },
        get join() { return document.getElementById('queue-screen-join'); },
        get wait() { return document.getElementById('queue-screen-wait'); },
        get notified() { return document.getElementById('queue-screen-notified'); },
        get expired() { return document.getElementById('queue-screen-expired'); }
    }
};

function requestNotifPermission() {
    if ("Notification" in window && Notification.permission === "default") {
        try {
            Notification.requestPermission();
        } catch (e) {
            console.warn("Notification permission request failed", e);
        }
    }
}

function fireNotification(title, body) {
    if ("Notification" in window && Notification.permission === "granted") {
        try {
            new Notification(title, { body });
        } catch (e) {
            console.warn("Failed to fire notification", e);
        }
    }
}

function showToast(message) {
    const toast = document.getElementById('toast-popup');
    const msg = document.getElementById('toast-message');
    if (toast && msg) {
        msg.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
}

async function showScreen(name) {
    // If we are moving away from the scanner, make sure it's stopped
    if (name !== 'scanner') await stopScanner();

    Object.entries(UI.screens).forEach(([k, el]) => {
        if (el) {
            el.classList.toggle('hidden', k !== name);
            el.classList.toggle('flex', k === name);
        }
    });
    if (name === 'instructions') startGeneralPolling();
    else stopGeneralPolling();
}

async function pollGeneral() {
    try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE}/queue?t=${Date.now()}`);
        const data = await res.json();
        document.getElementById('queue-info-grid').classList.remove('hidden');
        document.getElementById('queue-info-people').textContent = data.total;
        document.getElementById('queue-info-wait').textContent = `${data.total * 15}m`;
    } catch {
        document.getElementById('queue-info-grid').classList.add('hidden');
    }
}

function startGeneralPolling() {
    if (generalPollTimer) clearInterval(generalPollTimer);
    generalPollTimer = setInterval(pollGeneral, 30000);
    pollGeneral();
}

function stopGeneralPolling() {
    clearInterval(generalPollTimer);
}

async function poll(id) {
    try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE}/status?id=${id}&t=${Date.now()}`);
        if (res.status === 404) {
            stopPolling();
            localStorage.clear();
            showToast("Session expired or removed.");
            showScreen('instructions');
            return;
        }
        const data = await res.json();
        const prevStatus = lastStatus;
        lastStatus = data.status;

        if (data.status === 'notified') {
            stopPolling();
            if (prevStatus !== "notified") {
                fireNotification("It's your turn!", "Head to the escape room booth. You have 5 minutes.");
            }
            if (data.expired) showScreen('expired');
            else {
                if (UI.title) UI.title.textContent = "It's your turn!";
                showScreen('notified');
                startCountdown(data.notifiedAt);
            }
        } else {
            document.getElementById('queue-ticket-number').textContent = `#${data.ticketNumber}`;
            document.getElementById('queue-wait-position').textContent = `#${data.position}`;
            document.getElementById('queue-wait-time').textContent = `${data.position * 15} mins`;
            showScreen('wait');
        }
    } catch {}
}

function startPolling(id) {
    lastStatus = null;
    showScreen('wait'); // Transition to wait screen immediately
    stopPolling();
    pollTimer = setInterval(() => poll(id), POLL_MS);
    poll(id);
}

function stopPolling() { clearInterval(pollTimer); }

function startCountdown(notifiedAt) {
    if (countdownTimer) clearInterval(countdownTimer);
    const tick = () => {
        const remaining = Math.max(0, FIVE_MINUTES - (Date.now() - notifiedAt));
        const m = String(Math.floor(remaining / 60000)).padStart(2, "0");
        const s = String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");
        document.getElementById('queue-countdown').textContent = `${m}:${s}`;
        if (remaining === 0) {
            clearInterval(countdownTimer);
            showScreen('expired');
        }
    };
    countdownTimer = setInterval(tick, 1000);
    tick();
}

function handleScannedQR(decodedText) {
    try {
        const url = new URL(decodedText);
        const token = url.searchParams.get("t");
        if (!token) throw new Error();
        validateToken(token);
    } catch {
        document.getElementById('queue-scan-error').textContent = "Invalid QR code.";
    }
}

function validateToken(token) {
    try {
        const time = parseInt(atob(token), 10);
        const age = Date.now() - time;
        if (age > TWO_MINUTES) {
            showToast("QR code expired. Scan a new one.");
            return;
        }
        currentToken = token;
        document.getElementById('queue-submit-btn').disabled = false;
        startValidityTimer(Math.floor((TWO_MINUTES - age) / 1000));
        showScreen('join');
    } catch {
        showToast("Invalid token format.");
    }
}

function startValidityTimer(secs) {
    clearInterval(qValidityInterval);
    const el = document.getElementById('queue-token-timer');
    let left = secs;
    
    const tick = () => {
        if (left <= 0) {
            clearInterval(qValidityInterval);
            el.textContent = "Token expired";
            document.getElementById('queue-submit-btn').disabled = true;
        } else {
            el.textContent = `Valid for ${left}s`;
            left--;
        }
    };
    tick();
    qValidityInterval = setInterval(tick, 1000);
}

// Event Listeners
document.getElementById('queue-scan-btn').addEventListener('click', async () => {
    await showScreen('scanner');
    await startScanner((text) => handleScannedQR(text), 'queue_qrcode_scanner');
});

document.getElementById('queue-back-to-instructions-btn').addEventListener('click', async () => {
    await stopScanner();
    await showScreen('instructions');
});

document.getElementById('queue-submit-btn').addEventListener('click', async () => {
    const name = document.getElementById('queue-name-input').value.trim();
    if (!name) return;
    
    const btn = document.getElementById('queue-submit-btn');
    btn.disabled = true;
    
    try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE}/join`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: currentToken, name }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        
        localStorage.setItem("q_id", data.id);
        requestNotifPermission();
        startPolling(data.id);
    } catch (e) {
        document.getElementById('queue-join-error').textContent = e.message;
        btn.disabled = false;
    }
});

const leaveHandler = async () => {
    if (confirm("Leave the queue?")) {
        const id = localStorage.getItem("q_id");
        await fetch(`${import.meta.env.VITE_API_BASE}/leave?id=${id}`, { method: "POST" }).catch(() => {});
        localStorage.clear();
        lastStatus = null;
        currentToken = null;
        await showScreen('instructions');
    }
};

document.getElementById('queue-leave-btn').addEventListener('click', leaveHandler);
document.getElementById('queue-leave-notified-btn').addEventListener('click', leaveHandler);
document.getElementById('queue-back-to-start-btn').addEventListener('click', async () => await showScreen('instructions'));

// Init
const savedId = localStorage.getItem("q_id");
if (savedId) {
    showScreen('wait'); // Immediately show wait screen if session exists
    startPolling(savedId);
}
else {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("t");
    if (token) validateToken(token);
    else showScreen('instructions');
}