'use strict';

function saveUndoState() {
    undoStack.push({
        splitPoints: [...splitPoints],
        removedFlags: [...removedFlags],
        overlayTracks: JSON.parse(JSON.stringify(overlayTracks))
    });
    if (undoStack.length > 20) undoStack.shift();
}

function undo() {
    if (undoStack.length === 0) {
        showToast('⚠️', 'Nothing to undo');
        return;
    }
    const state = undoStack.pop();
    splitPoints = state.splitPoints;
    removedFlags = state.removedFlags;

    if (state.overlayTracks) {
        stopAllOverlayAudio();
        overlayTracks = state.overlayTracks;
        for (const track of overlayTracks) {
            for (const item of track.items) {
                if (item.type === 'audio' && item.audioSrc && !overlayAudioBuffers[item.id]) {
                    loadAudioBuffer(item.id, item.audioSrc);
                }
            }
        }
    }
    selectedSegIdx = null;
    renderTimeline();
    updateControls();
    renderOverlayTracks();
    renderOverlayPreview(currentAppTime);
    updateTimelineDuration();
    drawWaveform();
    showToast('↩️', 'Undone');
}

function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

function formatTimePrecise(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${m}:${String(s).padStart(2, '0')}.${ms}`;
}

function formatDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function updateTimeDisplay() {
    timeDisplay.textContent = `${formatTime(currentAppTime)} / ${formatTime(timelineDuration)}`;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
}

function generateFileName() {
    const now = new Date();
    return `Screen_Recording_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}.webm`;
}

function showToast(icon, message) {
    const toastIcon = toast.querySelector('.toast-icon');
    const toastText = toast.querySelector('.toast-text');
    toastIcon.textContent = icon;
    toastText.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
}

function loadFromIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('ScreenMintDB', 1);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('recordings')) {
                db.createObjectStore('recordings', { keyPath: 'id' });
            }
        };
        request.onsuccess = (event) => {
            const db = event.target.result;
            const tx = db.transaction('recordings', 'readonly');
            const store = tx.objectStore('recordings');
            const getReq = store.get('latest');
            getReq.onsuccess = () => { db.close(); resolve(getReq.result || null); };
            getReq.onerror = () => { db.close(); reject(new Error('Failed to read from IndexedDB')); };
        };
        request.onerror = () => reject(new Error('Failed to open IndexedDB'));
    });
}

function deleteFromIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('ScreenMintDB', 1);
        request.onsuccess = (event) => {
            const db = event.target.result;
            const tx = db.transaction('recordings', 'readwrite');
            const store = tx.objectStore('recordings');
            store.delete('latest');
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(new Error('Failed to delete from IndexedDB')); };
        };
        request.onerror = () => reject(new Error('Failed to open IndexedDB'));
    });
}