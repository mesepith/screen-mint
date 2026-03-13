let mediaRecorder;
let recordedChunks = [];

chrome.runtime.onMessage.addListener(async (message) => {
    if (message.target !== 'offscreen') return;

    if (message.type === 'start-recording') {
        startRecording();
    } else if (message.type === 'stop-recording') {
        stopRecording();
    }
});

async function startRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        console.log('Already recording');
        return;
    }

    try {
        // Use getDisplayMedia() — the standard Web API for screen capture.
        // In an offscreen document created with DISPLAY_MEDIA reason,
        // Chrome shows its built-in screen/window/tab picker automatically.
        // No need for chrome.desktopCapture or chromeMediaSource constraints.
        // Detect macOS. macOS does not support system audio capture via getDisplayMedia
        // and requesting it often causes Chrome bugs (AbortError, NotReadableError) or long delays.
        const isMac = navigator.userAgent.includes('Mac OS X');

        // Only request audio on Windows/ChromeOS
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: 'monitor' },
            audio: !isMac
        });

        console.log('Got display media stream, tracks:', stream.getTracks().map(t => t.kind));

        recordedChunks = [];

        // Choose appropriate mimeType based on browser support
        let options;
        if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) {
            options = { mimeType: 'video/webm; codecs=vp9' };
        } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp8')) {
            options = { mimeType: 'video/webm; codecs=vp8' };
        } else {
            options = { mimeType: 'video/webm' };
        }

        mediaRecorder = new MediaRecorder(stream, options);

        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            // Create a Blob from the recorded chunks
            const blob = new Blob(recordedChunks, { type: options.mimeType });

            // Format current timestamp for filename
            const now = new Date();
            const filename = `Screen_Recording_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}.webm`;

            try {
                // Store the blob in IndexedDB (available in offscreen documents,
                // shared across all extension pages via same origin)
                await saveToIndexedDB(blob, options.mimeType, filename);

                // Stop all tracks in the stream
                stream.getTracks().forEach(track => track.stop());

                // Notify background that recording has stopped and data is ready
                chrome.runtime.sendMessage({
                    type: 'recording-stopped-from-offscreen',
                    target: 'background',
                    openEditor: true
                });
            } catch (err) {
                console.error('Error storing recording:', err);
                // Fallback: direct download if storage fails
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 100);

                stream.getTracks().forEach(track => track.stop());

                chrome.runtime.sendMessage({
                    type: 'recording-stopped-from-offscreen',
                    target: 'background'
                });
            }
        };

        // If user stops sharing via Chrome's built-in "Stop sharing" button,
        // handle it gracefully
        stream.getVideoTracks()[0].onended = () => {
            console.log('User stopped sharing via Chrome UI');
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
        };

        mediaRecorder.onerror = (event) => {
            console.error('MediaRecorder error:', event.error);
            chrome.runtime.sendMessage({
                type: 'recording-failed',
                target: 'background',
                error: `MediaRecorder error: ${event.error.name}`
            });
        };

        mediaRecorder.start(1000); // Collect data every 1 second
        console.log('Recording started successfully');

        // Notify background that recording has started successfully
        chrome.runtime.sendMessage({
            type: 'recording-started',
            target: 'background'
        });

    } catch (error) {

        // NotAllowedError = user denied/cancelled the picker
        const userCancelled = error.name === 'NotAllowedError';

        // Only log an actual error if it wasn't a standard user cancellation
        if (userCancelled) {
            console.log('User cancelled the screen share picker.');
        } else {
            console.error('Error starting recording:', error.name, error.message);
        }

        let errorMessage = `${error.name}: ${error.message}`;

        if (error.name === 'NotReadableError') {
            errorMessage = 'Could not start video. If you are on macOS, please go to System Settings > Privacy & Security > Screen Recording, enable Chrome, and restart your browser.';
        } else if (userCancelled) {
            errorMessage = 'User cancelled screen selection';
        }

        chrome.runtime.sendMessage({
            type: 'recording-failed',
            target: 'background',
            error: errorMessage
        });

    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        console.log('Recording stopped');
    } else {
        console.warn('stopRecording called but no active recorder found');
        chrome.runtime.sendMessage({
            type: 'recording-stopped-from-offscreen',
            target: 'background'
        });
    }
}

// ── IndexedDB Helper ─────────────────────────────────────────────
// Stores the recording blob in IndexedDB so the editor page can access it.
// IndexedDB is a web API available in offscreen documents and shared across
// all extension pages (same origin: chrome-extension://<id>).
function saveToIndexedDB(blob, mimeType, fileName) {
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
            const tx = db.transaction('recordings', 'readwrite');
            const store = tx.objectStore('recordings');

            store.put({
                id: 'latest',
                blob: blob,
                mimeType: mimeType,
                fileName: fileName,
                timestamp: Date.now()
            });

            tx.oncomplete = () => {
                db.close();
                resolve();
            };

            tx.onerror = () => {
                db.close();
                reject(new Error('IndexedDB transaction failed'));
            };
        };

        request.onerror = () => {
            reject(new Error('Failed to open IndexedDB'));
        };
    });
}
