// ── CONSTANTS ─────────────────────────────────────────────────
const TWO_MINUTES = 2 * 60 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;

// ── STATE ─────────────────────────────────────────────────────
let pollTimer = null;
let generalPollTimer = null;
let countdownTimer = null;
let lastStatus = null;
let currentToken = null;
let qValidityInterval = null;
let selectedTheme = localStorage.getItem("q_theme") || null;
let pendingToken = null;  // URL token received before theme was chosen

// ── SCANNER ───────────────────────────────────────────────────
let html5QrCode = null;
let isScannerStarting = false;

async function startScanner(successCallback, elementId) {
    if (isScannerStarting || (html5QrCode && html5QrCode.isScanning)) {
        if (html5QrCode && html5QrCode.isScanning) {
            document.getElementById('queue-camera-loading')?.classList.add('hidden');
            document.getElementById('queue-camera-loading')?.classList.remove('flex');
        }
        return;
    }

    const loadingEl = document.getElementById('queue-camera-loading');
    loadingEl?.classList.remove('hidden');
    loadingEl?.classList.add('flex');
    isScannerStarting = true;

    try {
        if (!html5QrCode) html5QrCode = new Html5Qrcode(elementId);
        await html5QrCode.start(
            { facingMode: "environment" },
            { fps: 20, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
            (text) => successCallback(text)
        );
        loadingEl?.classList.add('hidden');
        loadingEl?.classList.remove('flex');
    } catch (err) {
        console.error("Scanner error:", err);
        loadingEl?.classList.add('hidden');
        loadingEl?.classList.remove('flex');
        const errEl = document.getElementById('queue-scan-error');
        if (errEl) errEl.textContent = "Camera error. Please ensure permissions are granted.";
    } finally {
        isScannerStarting = false;
    }
}

async function stopScanner() {
    if (html5QrCode && html5QrCode.isScanning) {
        try { await html5QrCode.stop(); } catch (e) { console.error("Stop error", e); }
    }
    const loadingEl = document.getElementById('queue-camera-loading');
    loadingEl?.classList.add('hidden');
    loadingEl?.classList.remove('flex');
}

// ── UI ────────────────────────────────────────────────────────
const UI = {
    get title() { return document.getElementById('queue-modal-title'); },
    get subtitle() { return document.getElementById('queue-modal-subtitle'); },
    screens: {
        get theme()        { return document.getElementById('queue-screen-theme'); },
        get instructions() { return document.getElementById('queue-screen-instructions'); },
        get scanner()      { return document.getElementById('queue-screen-scanner'); },
        get join()         { return document.getElementById('queue-screen-join'); },
        get wait()         { return document.getElementById('queue-screen-wait'); },
        get notified()     { return document.getElementById('queue-screen-notified'); },
        get expired()      { return document.getElementById('queue-screen-expired'); },
        get served()       { return document.getElementById('queue-screen-served'); }
    }
};

async function showScreen(name) {
    if (name !== 'scanner') await stopScanner();
    Object.entries(UI.screens).forEach(([k, el]) => {
        if (el) {
            el.classList.toggle('hidden', k !== name);
            el.classList.toggle('flex', k === name);
        }
    });

    // Update subtitle and theme badge on instructions screen
    if (name === 'theme') {
        if (UI.subtitle) UI.subtitle.textContent = 'Choose your room to get started';
    } else {
        updateThemeIndicator();
    }

    if (name === 'instructions') {
        startGeneralPolling();
    } else {
        stopGeneralPolling();
    }

    if (name === 'notified') {
        const id = localStorage.getItem("q_id");
        const el = document.getElementById('queue-notified-ticket');
        if (el) el.textContent = id ? `#${id}` : '--';
    }
}

function updateThemeIndicator() {
    const indicator = document.getElementById('queue-theme-indicator');
    const badge = document.getElementById('queue-theme-badge');
    if (!indicator || !badge) return;

    if (selectedTheme) {
        const label = selectedTheme.charAt(0).toUpperCase() + selectedTheme.slice(1);
        const icon  = selectedTheme === 'helios' ? 'rocket_launch' : 'festival';
        badge.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:4px;">${icon}</span>${label}`;
        badge.className = `theme-badge theme-badge-${selectedTheme}`;
        indicator.classList.remove('hidden');
        if (UI.subtitle) UI.subtitle.textContent = `${label} — Check status or join the line`;
    } else {
        indicator.classList.add('hidden');
        if (UI.subtitle) UI.subtitle.textContent = 'Choose your room to get started';
    }
}

// ── THEME SELECTION ───────────────────────────────────────────
function selectTheme(theme) {
    selectedTheme = theme;
    localStorage.setItem('q_theme', theme);

    // If there's a pending URL token, validate it now that theme is known
    if (pendingToken) {
        const t = pendingToken;
        pendingToken = null;
        validateToken(t);
        return;
    }

    showScreen('instructions');
}

document.getElementById('theme-helios-btn').addEventListener('click', () => selectTheme('helios'));
document.getElementById('theme-circus-btn').addEventListener('click', () => selectTheme('circus'));
document.getElementById('queue-change-theme-btn').addEventListener('click', () => showScreen('theme'));

// ── NOTIFICATIONS ─────────────────────────────────────────────
function requestNotifPermission() {
    if ("Notification" in window && Notification.permission === "default") {
        try { Notification.requestPermission(); } catch (e) {}
    }
}

function fireNotification(title, body) {
    if ("Notification" in window && Notification.permission === "granted") {
        try { new Notification(title, { body }); } catch (e) {}
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

// ── GENERAL POLLING (instructions screen only) ────────────────
// Fetches combined queue count — unchanged per user preference
async function pollGeneral() {
    try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE}/info?t=${Date.now()}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        document.getElementById('queue-info-people').textContent = data.total;
        document.getElementById('queue-info-wait').textContent = data.total === 0 ? 'None' : `~${data.total * 15}m`;
        document.getElementById('queue-info-stats')?.classList.add('flex');
        document.getElementById('queue-info-stats')?.classList.remove('hidden');
        document.getElementById('queue-info-unavailable')?.classList.add('hidden');
    } catch {
        document.getElementById('queue-info-stats')?.classList.remove('flex')
        document.getElementById('queue-info-stats')?.classList.add('hidden');
        document.getElementById('queue-info-unavailable')?.classList.remove('hidden');
    }
}

function startGeneralPolling() {
    if (generalPollTimer) clearInterval(generalPollTimer);
    generalPollTimer = setInterval(pollGeneral, 30000);
    pollGeneral();
}

function stopGeneralPolling() { clearInterval(generalPollTimer); }

// ── PERSONAL POLLING (waiting status only) ────────────────────
function intervalForPosition(position) {
    if (position <= 2)  return 2000;
    if (position <= 5)  return 5000;
    if (position <= 10) return 10000;
    return 20000;
}

function stopPolling() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

async function poll(id) {
    if (!id) return;
    try {
        const res = await fetch(
            `${import.meta.env.VITE_API_BASE}/queue?id=${id}&t=${Date.now()}`,
            { cache: "no-store" }
        );

        if (res.status === 404) {
            stopPolling();
            localStorage.removeItem("q_id");
            localStorage.removeItem("q_notified_at");
            showToast("Your session has expired or been removed.");
            showScreen('instructions');
            return;
        }

        if (!res.ok) {
            scheduleNextPoll(id, 3000);
            return;
        }

        const data = await res.json();
        const prevStatus = lastStatus;
        lastStatus = data.status;

        if (data.status === 'served' || data.status === 'noshow') {
            stopPolling();
            cleanupSession();
            fireNotification("Hurry now!", "We are waiting for you at the Escape Room booth.");
            showScreen('served');
            return;
        }

        if (data.status === 'notified') {
            stopPolling();
            localStorage.setItem("q_notified_at", data.notifiedAt);

            if (prevStatus !== 'notified') {
                fireNotification("It's your turn!", "Head to the escape room booth. You have 5 minutes.");
            }

            const notifiedMs = new Date(data.notifiedAt).getTime();
            if (Date.now() - notifiedMs >= FIVE_MINUTES) {
                handleExpired();
            } else {
                showScreen('notified');
                startCountdown(data.notifiedAt);
            }
        } else {
            const queueNumber = data.queueNumber ?? data.id;
            const peopleAhead = (data.position - 1);
            document.getElementById('queue-people-ahead').textContent = peopleAhead;
            document.getElementById('queue-ticket-number').textContent = `#${queueNumber}`;
            document.getElementById('queue-wait-time').textContent =
                peopleAhead === 0 ? 'Next up!' : `~${data.position * 15} mins`;
            showScreen('wait');
            scheduleNextPoll(id, intervalForPosition(data.position));
        }
    } catch {
        scheduleNextPoll(id, 5000);
    }
}

function scheduleNextPoll(id, ms) {
    stopPolling();
    pollTimer = setTimeout(() => poll(id), ms);
}

function startPolling(id) {
    lastStatus = null;
    stopPolling();
    poll(id);
}

// ── COUNTDOWN ─────────────────────────────────────────────────
function startCountdown(notifiedAt) {
    if (countdownTimer) clearInterval(countdownTimer);

    const notifiedMs = typeof notifiedAt === 'string'
        ? new Date(notifiedAt).getTime()
        : notifiedAt;

    const tick = () => {
        const remaining = Math.max(0, FIVE_MINUTES - (Date.now() - notifiedMs));
        const m = String(Math.floor(remaining / 60000)).padStart(2, "0");
        const s = String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");
        document.getElementById('queue-countdown').textContent = `${m}:${s}`;
        if (remaining === 0) {
            clearInterval(countdownTimer);
            handleExpired();
        }
    };
    countdownTimer = setInterval(tick, 1000);
    tick();
}

function handleExpired() {
    stopPolling();
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    localStorage.removeItem("q_id");
    localStorage.removeItem("q_notified_at");
    showScreen('expired');
}

// ── TOKEN VALIDATION ──────────────────────────────────────────
function handleScannedQR(decodedText) {
    try {
        const url = new URL(decodedText);
        const token = url.searchParams.get("t");
        if (!token) throw new Error("no token param");
        validateToken(token);
    } catch {
        const errEl = document.getElementById('queue-scan-error');
        if (errEl) errEl.textContent = "Invalid QR code. Please try again.";
    }
}

function validateToken(token) {
    try {
        const time = parseInt(atob(token), 10);
        if (isNaN(time)) throw new Error("bad token");
        const age = Date.now() - time;
        if (age > TWO_MINUTES) {
            showToast("QR code expired. Ask the booth to regenerate it.");
            return;
        }
        currentToken = token;
        document.getElementById('queue-name-input').value = '';
        document.getElementById('queue-join-error').textContent = '';
        document.getElementById('queue-submit-btn').disabled = false;
        startValidityTimer(Math.floor((TWO_MINUTES - age) / 1000));
        window.history.replaceState({}, '', window.location.pathname);
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
            if (el) el.textContent = "Token expired — please scan again";
            document.getElementById('queue-submit-btn').disabled = true;
        } else {
            if (el) el.textContent = `Valid for ${left}s`;
            left--;
        }
    };
    tick();
    qValidityInterval = setInterval(tick, 1000);
}

// ── LEAVE ─────────────────────────────────────────────────────
function cleanupSession() {
    stopPolling();
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (qValidityInterval) { clearInterval(qValidityInterval); qValidityInterval = null; }
    localStorage.removeItem("q_id");
    localStorage.removeItem("q_notified_at");
    // NOTE: q_theme is intentionally NOT cleared — user stays in same room
    lastStatus = null;
    currentToken = null;
}

const leaveHandler = async () => {
    if (!confirm("Leave the queue?")) return;
    const id = localStorage.getItem("q_id");
    if (id) {
        await fetch(`${import.meta.env.VITE_API_BASE}/queue`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "leave", id: parseInt(id, 10) }),
        }).catch(() => {});
    }
    cleanupSession();
    showScreen('instructions');
};

// ── VISIBILITY API ────────────────────────────────────────────
document.addEventListener("visibilitychange", () => {
    const id = localStorage.getItem("q_id");
    const notifiedAt = localStorage.getItem("q_notified_at");
    if (!id || notifiedAt) return;

    if (document.hidden) {
        stopPolling();
    } else {
        poll(id);
    }
});

// ── EVENT LISTENERS ───────────────────────────────────────────
document.getElementById('queue-scan-btn').addEventListener('click', async () => {
    await showScreen('scanner');
    await startScanner((text) => handleScannedQR(text), 'queue_qrcode_scanner');
});

document.getElementById('queue-back-to-instructions-btn').addEventListener('click', async () => {
    await stopScanner();
    showScreen('instructions');
});

// Back button on join screen → back to scanner
document.getElementById('queue-back-to-scanner-btn')?.addEventListener('click', async () => {
    if (qValidityInterval) clearInterval(qValidityInterval);
    currentToken = null;
    const usedEl = document.getElementById('queue-qr-used-error');
    if (usedEl) usedEl.classList.add('hidden');
    await showScreen('scanner');
    await startScanner((text) => handleScannedQR(text), 'queue_qrcode_scanner');
});

document.getElementById('queue-submit-btn').addEventListener('click', async () => {
    const name = document.getElementById('queue-name-input').value.trim();
    if (!name) {
        document.getElementById('queue-join-error').textContent = "Please enter your name.";
        return;
    }
    if (!selectedTheme) {
        document.getElementById('queue-join-error').textContent = "No theme selected. Please go back and choose a room.";
        return;
    }

    const btn = document.getElementById('queue-submit-btn');
    btn.disabled = true;
    document.getElementById('queue-join-error').textContent = '';

    try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE}/queue`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: currentToken, name, theme: selectedTheme }),
        });
        const data = await res.json();
        if (!res.ok) {
            // Special case: QR already used — show above input, hide timer
            if (data.error && data.error.includes("already been used")) {
                clearInterval(qValidityInterval);
                const timerEl = document.getElementById('queue-token-timer');
                if (timerEl) timerEl.textContent = '';
                const usedEl = document.getElementById('queue-qr-used-error');
                if (usedEl) usedEl.classList.remove('hidden');
            }
            throw new Error(data.error || "Could not join queue.");
        }

        localStorage.setItem("q_id", data.id);
        requestNotifPermission();

        if (data.status === 'notified') {
            localStorage.setItem("q_notified_at", data.notifiedAt);
            showScreen('notified');
            startCountdown(data.notifiedAt);
        } else {
            showScreen('wait');
            startPolling(data.id);
        }
    } catch (e) {
        document.getElementById('queue-join-error').textContent = e.message;
        btn.disabled = false;
    }
});

document.getElementById('queue-leave-btn').addEventListener('click', leaveHandler);
document.getElementById('queue-served-done-btn')?.addEventListener('click', () => {
    cleanupSession();
    showScreen('instructions');
});
document.getElementById('queue-leave-notified-btn').addEventListener('click', leaveHandler);

document.getElementById('queue-back-to-start-btn').addEventListener('click', () => {
    cleanupSession();
    // Go to instructions if theme already chosen, otherwise theme picker
    if (selectedTheme) showScreen('instructions');
    else showScreen('theme');
});

// ── INIT ──────────────────────────────────────────────────────
(function init() {
    const savedNotifiedAt = localStorage.getItem("q_notified_at");
    const savedId = localStorage.getItem("q_id");

    if (savedNotifiedAt) {
        const notifiedMs = new Date(savedNotifiedAt).getTime();
        if (Date.now() - notifiedMs >= FIVE_MINUTES) {
            handleExpired();
        } else {
            showScreen('notified');
            startCountdown(savedNotifiedAt);
        }
        return;
    }

    if (savedId) {
        showScreen('wait');
        startPolling(savedId);
        return;
    }

    // Check for token in URL (came from QR scan)
    const params = new URLSearchParams(window.location.search);
    const token = params.get("t");
    if (token) {
        window.history.replaceState({}, '', window.location.pathname);
        if (selectedTheme) {
            validateToken(token);
        } else {
            // Must pick theme first — store token for after selection
            pendingToken = token;
            showScreen('theme');
        }
        return;
    }

    // Fresh visit — show theme picker, or go straight to instructions if theme saved
    if (selectedTheme) {
        showScreen('instructions');
    } else {
        showScreen('theme');
    }
})();
