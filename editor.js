/* ═══════════════════════════════════════════════════════════════
   Screen Mint — Video Editor Logic
   Handles: playback, trim, download original/trimmed, waveform
   ═══════════════════════════════════════════════════════════════ */

(() => {
    'use strict';

    // ── DOM Elements ───────────────────────────────────────────────
    const loadingScreen = document.getElementById('loadingScreen');
    const videoPlayer = document.getElementById('videoPlayer');
    const playOverlay = document.getElementById('playOverlay');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const playIcon = document.getElementById('playIcon');
    const pauseIcon = document.getElementById('pauseIcon');
    const stopBtn = document.getElementById('stopBtn');
    const timeDisplay = document.getElementById('timeDisplay');
    const progressContainer = document.getElementById('progressContainer');
    const progressFilled = document.getElementById('progressFilled');
    const muteBtn = document.getElementById('muteBtn');
    const volumeOnIcon = document.getElementById('volumeOnIcon');
    const volumeOffIcon = document.getElementById('volumeOffIcon');
    const volumeSlider = document.getElementById('volumeSlider');
    const recordingInfo = document.getElementById('recordingInfo');

    // Trim elements
    const trimTimeline = document.getElementById('trimTimeline');
    const trimWaveform = document.getElementById('trimWaveform');
    const trimRegion = document.getElementById('trimRegion');
    const trimHandleLeft = document.getElementById('trimHandleLeft');
    const trimHandleRight = document.getElementById('trimHandleRight');
    const trimPlayhead = document.getElementById('trimPlayhead');
    const trimStartInput = document.getElementById('trimStartInput');
    const trimEndInput = document.getElementById('trimEndInput');
    const trimDurationValue = document.getElementById('trimDurationValue');
    const trimResetBtn = document.getElementById('trimResetBtn');
    const trimInfo = document.getElementById('trimInfo');

    // Action buttons
    const downloadOriginalBtn = document.getElementById('downloadOriginalBtn');
    const downloadTrimmedBtn = document.getElementById('downloadTrimmedBtn');
    const discardBtn = document.getElementById('discardBtn');

    const processingOverlay = document.getElementById('processingOverlay');
    const toast = document.getElementById('toast');

    // ── State ──────────────────────────────────────────────────────
    let videoBlob = null;
    let videoDuration = 0;
    let trimStart = 0;
    let trimEnd = 0;
    let isDragging = null; // 'left' | 'right' | null
    let videoFileName = '';

    // ── Init: Load video from IndexedDB ─────────────────────────────
    init();

    async function init() {
        try {
            // Retrieve the recording data from IndexedDB
            const result = await loadFromIndexedDB();

            if (!result) {
                showToast('⚠️', 'No recording found. Please record a video first.');
                loadingScreen.classList.add('hidden');
                return;
            }

            videoFileName = result.fileName || generateFileName();
            videoBlob = result.blob;

            // Create object URL for playback
            const objectUrl = URL.createObjectURL(videoBlob);
            videoPlayer.src = objectUrl;

            videoPlayer.addEventListener('loadedmetadata', () => {
                // Handle Infinity duration (common with webm)
                if (!isFinite(videoPlayer.duration)) {
                    // Seek to a very large value to force duration calculation
                    videoPlayer.currentTime = 1e10;
                    videoPlayer.addEventListener('seeked', function onSeek() {
                        videoPlayer.removeEventListener('seeked', onSeek);
                        videoPlayer.currentTime = 0;
                        finishInit();
                    }, { once: true });
                } else {
                    finishInit();
                }
            });

            videoPlayer.addEventListener('error', () => {
                showToast('❌', 'Failed to load the recording.');
                loadingScreen.classList.add('hidden');
            });

        } catch (err) {
            console.error('Error loading recording:', err);
            showToast('❌', 'Error loading recording: ' + err.message);
            loadingScreen.classList.add('hidden');
        }
    }

    function finishInit() {
        videoDuration = videoPlayer.duration;
        if (!isFinite(videoDuration) || videoDuration <= 0) {
            videoDuration = 0;
        }
        trimStart = 0;
        trimEnd = videoDuration;

        updateTimeDisplay();
        updateTrimUI();
        drawWaveform();

        recordingInfo.textContent = formatDuration(videoDuration) + ' recorded';

        // Hide loading
        loadingScreen.classList.add('hidden');

        showToast('✅', 'Recording loaded successfully!');
    }

    // ── Playback Controls ─────────────────────────────────────────
    playOverlay.addEventListener('click', togglePlay);
    playPauseBtn.addEventListener('click', togglePlay);

    function togglePlay() {
        if (videoPlayer.paused || videoPlayer.ended) {
            // If current time is outside the trim range, jump to trimStart
            if (videoPlayer.currentTime < trimStart || videoPlayer.currentTime >= trimEnd - 0.05) {
                videoPlayer.currentTime = trimStart;
            }
            videoPlayer.play();
        } else {
            videoPlayer.pause();
        }
    }

    videoPlayer.addEventListener('play', () => {
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
        playOverlay.classList.add('hidden');
    });

    videoPlayer.addEventListener('pause', () => {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        playOverlay.classList.remove('hidden');
    });

    videoPlayer.addEventListener('ended', () => {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        playOverlay.classList.remove('hidden');
    });

    stopBtn.addEventListener('click', () => {
        videoPlayer.pause();
        videoPlayer.currentTime = trimStart;
    });

    // ── Progress Bar ───────────────────────────────────────────────
    videoPlayer.addEventListener('timeupdate', () => {
        if (videoDuration > 0) {
            const pct = (videoPlayer.currentTime / videoDuration) * 100;
            progressFilled.style.width = pct + '%';

            // Update trim playhead
            trimPlayhead.style.left = pct + '%';

            // Enforce trim boundary: pause when reaching trimEnd
            if (!videoPlayer.paused && videoPlayer.currentTime >= trimEnd - 0.05) {
                videoPlayer.pause();
                videoPlayer.currentTime = trimEnd;
            }
        }
        updateTimeDisplay();
    });

    progressContainer.addEventListener('click', (e) => {
        const rect = progressContainer.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        videoPlayer.currentTime = pct * videoDuration;
    });

    // ── Volume ─────────────────────────────────────────────────────
    muteBtn.addEventListener('click', () => {
        videoPlayer.muted = !videoPlayer.muted;
        volumeOnIcon.style.display = videoPlayer.muted ? 'none' : 'block';
        volumeOffIcon.style.display = videoPlayer.muted ? 'block' : 'none';
    });

    volumeSlider.addEventListener('input', () => {
        videoPlayer.volume = parseFloat(volumeSlider.value);
        if (videoPlayer.volume === 0) {
            videoPlayer.muted = true;
            volumeOnIcon.style.display = 'none';
            volumeOffIcon.style.display = 'block';
        } else {
            videoPlayer.muted = false;
            volumeOnIcon.style.display = 'block';
            volumeOffIcon.style.display = 'none';
        }
    });

    // ── Trim Handles ───────────────────────────────────────────────
    trimHandleLeft.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragging = 'left';
        document.addEventListener('mousemove', onTrimDrag);
        document.addEventListener('mouseup', onTrimDragEnd);
    });

    trimHandleRight.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragging = 'right';
        document.addEventListener('mousemove', onTrimDrag);
        document.addEventListener('mouseup', onTrimDragEnd);
    });

    // Touch support
    trimHandleLeft.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isDragging = 'left';
        document.addEventListener('touchmove', onTrimDragTouch);
        document.addEventListener('touchend', onTrimDragEndTouch);
    });

    trimHandleRight.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isDragging = 'right';
        document.addEventListener('touchmove', onTrimDragTouch);
        document.addEventListener('touchend', onTrimDragEndTouch);
    });

    function onTrimDrag(e) {
        if (!isDragging) return;
        const rect = trimTimeline.getBoundingClientRect();
        let pct = (e.clientX - rect.left) / rect.width;
        pct = Math.max(0, Math.min(1, pct));
        applyTrimDrag(pct);
    }

    function onTrimDragTouch(e) {
        if (!isDragging || !e.touches[0]) return;
        const rect = trimTimeline.getBoundingClientRect();
        let pct = (e.touches[0].clientX - rect.left) / rect.width;
        pct = Math.max(0, Math.min(1, pct));
        applyTrimDrag(pct);
    }

    function applyTrimDrag(pct) {
        const time = pct * videoDuration;
        const minDuration = 0.5; // Minimum 0.5s trim

        if (isDragging === 'left') {
            trimStart = Math.min(time, trimEnd - minDuration);
            trimStart = Math.max(0, trimStart);
        } else if (isDragging === 'right') {
            trimEnd = Math.max(time, trimStart + minDuration);
            trimEnd = Math.min(videoDuration, trimEnd);
        }

        updateTrimUI();
    }

    function onTrimDragEnd() {
        isDragging = null;
        document.removeEventListener('mousemove', onTrimDrag);
        document.removeEventListener('mouseup', onTrimDragEnd);
    }

    function onTrimDragEndTouch() {
        isDragging = null;
        document.removeEventListener('touchmove', onTrimDragTouch);
        document.removeEventListener('touchend', onTrimDragEndTouch);
    }

    // Click on timeline to seek
    trimTimeline.addEventListener('click', (e) => {
        if (isDragging) return;
        const rect = trimTimeline.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        videoPlayer.currentTime = pct * videoDuration;
    });

    // Reset trim
    trimResetBtn.addEventListener('click', () => {
        trimStart = 0;
        trimEnd = videoDuration;
        updateTrimUI();
        showToast('🔄', 'Trim range reset');
    });

    function updateTrimUI() {
        if (videoDuration <= 0) return;

        const leftPct = (trimStart / videoDuration) * 100;
        const rightPct = (trimEnd / videoDuration) * 100;
        const widthPct = rightPct - leftPct;

        trimRegion.style.left = leftPct + '%';
        trimRegion.style.width = widthPct + '%';

        trimStartInput.value = formatTimePrecise(trimStart);
        trimEndInput.value = formatTimePrecise(trimEnd);

        const trimDur = trimEnd - trimStart;
        trimDurationValue.textContent = formatDuration(trimDur);

        // Show/hide trimmed download based on whether trim differs from full
        const isTrimmed = trimStart > 0.1 || (videoDuration - trimEnd) > 0.1;
        downloadTrimmedBtn.disabled = !isTrimmed;

        if (isTrimmed) {
            trimInfo.textContent = `Trimming ${formatDuration(trimDur)} of ${formatDuration(videoDuration)}`;
        } else {
            trimInfo.textContent = 'Drag handles to set trim range';
        }
    }

    // ── Waveform Drawing ──────────────────────────────────────────
    function drawWaveform() {
        const canvas = trimWaveform;
        const ctx = canvas.getContext('2d');
        const rect = trimTimeline.getBoundingClientRect();

        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

        const w = rect.width;
        const h = rect.height;
        const barCount = Math.floor(w / 4);
        const barWidth = 2;
        const gap = (w - barCount * barWidth) / (barCount - 1);

        ctx.clearRect(0, 0, w, h);

        // Draw a decorative pseudo-waveform
        for (let i = 0; i < barCount; i++) {
            const x = i * (barWidth + gap);
            // Generate a visually pleasing waveform pattern
            const noise1 = Math.sin(i * 0.15) * 0.3;
            const noise2 = Math.sin(i * 0.4 + 1.5) * 0.2;
            const noise3 = Math.cos(i * 0.08) * 0.25;
            const amplitude = 0.15 + Math.abs(noise1 + noise2 + noise3);
            const barHeight = amplitude * h * 0.8;

            const gradient = ctx.createLinearGradient(0, (h - barHeight) / 2, 0, (h + barHeight) / 2);
            gradient.addColorStop(0, 'rgba(99, 102, 241, 0.6)');
            gradient.addColorStop(0.5, 'rgba(139, 92, 246, 0.4)');
            gradient.addColorStop(1, 'rgba(99, 102, 241, 0.6)');

            ctx.fillStyle = gradient;
            ctx.fillRect(x, (h - barHeight) / 2, barWidth, barHeight);
        }
    }

    // Redraw on resize
    window.addEventListener('resize', () => {
        if (videoDuration > 0) drawWaveform();
    });

    // ── Download Original ─────────────────────────────────────────
    downloadOriginalBtn.addEventListener('click', () => {
        if (!videoBlob) return;
        downloadBlob(videoBlob, videoFileName);
        showToast('⬇️', 'Downloading original recording…');
    });

    // ── Download Trimmed ──────────────────────────────────────────
    downloadTrimmedBtn.addEventListener('click', async () => {
        if (!videoBlob || downloadTrimmedBtn.disabled) return;

        processingOverlay.classList.add('active');

        try {
            const trimmedBlob = await trimVideo(videoBlob, trimStart, trimEnd);

            // Generate trimmed filename
            const ext = videoFileName.split('.').pop();
            const baseName = videoFileName.replace('.' + ext, '');
            const trimmedFileName = `${baseName}_trimmed.${ext}`;

            downloadBlob(trimmedBlob, trimmedFileName);
            showToast('✂️', 'Trimmed video downloaded!');
        } catch (err) {
            console.error('Trim error:', err);
            showToast('❌', 'Failed to trim video: ' + err.message);
        } finally {
            processingOverlay.classList.remove('active');
        }
    });

    // ── Trim Video using MediaRecorder re-encoding ────────────────
    function trimVideo(blob, startTime, endTime) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const tempVideo = document.createElement('video');
            tempVideo.muted = true;
            tempVideo.src = url;

            tempVideo.addEventListener('loadedmetadata', () => {
                // Handle non-finite durations
                if (!isFinite(tempVideo.duration)) {
                    tempVideo.currentTime = 1e10;
                    tempVideo.addEventListener('seeked', function seekOnce() {
                        tempVideo.removeEventListener('seeked', seekOnce);
                        tempVideo.currentTime = startTime;
                        tempVideo.addEventListener('seeked', startCapture, { once: true });
                    }, { once: true });
                } else {
                    tempVideo.currentTime = startTime;
                    tempVideo.addEventListener('seeked', startCapture, { once: true });
                }
            });

            tempVideo.addEventListener('error', () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load video for trimming'));
            });

            function startCapture() {
                // Use canvas + MediaRecorder to re-encode the trimmed segment
                const canvas = document.createElement('canvas');
                canvas.width = tempVideo.videoWidth || 1920;
                canvas.height = tempVideo.videoHeight || 1080;
                const ctx = canvas.getContext('2d');

                const canvasStream = canvas.captureStream(30);

                // Try to capture audio too
                try {
                    const audioCtx = new AudioContext();
                    const source = audioCtx.createMediaElementSource(tempVideo);
                    const dest = audioCtx.createMediaStreamDestination();
                    source.connect(dest);
                    source.connect(audioCtx.destination);
                    dest.stream.getAudioTracks().forEach(track => {
                        canvasStream.addTrack(track);
                    });
                } catch (_e) {
                    // No audio — that's okay
                }

                let recOptions;
                if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) {
                    recOptions = { mimeType: 'video/webm; codecs=vp9' };
                } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp8')) {
                    recOptions = { mimeType: 'video/webm; codecs=vp8' };
                } else {
                    recOptions = { mimeType: 'video/webm' };
                }

                const recorder = new MediaRecorder(canvasStream, recOptions);
                const chunks = [];

                recorder.ondataavailable = (e) => {
                    if (e.data && e.data.size > 0) chunks.push(e.data);
                };

                recorder.onstop = () => {
                    URL.revokeObjectURL(url);
                    const trimmedBlob = new Blob(chunks, { type: recOptions.mimeType });
                    resolve(trimmedBlob);
                };

                recorder.onerror = (event) => {
                    URL.revokeObjectURL(url);
                    reject(new Error('MediaRecorder error during trim'));
                };

                // Draw frames
                tempVideo.muted = false;
                tempVideo.volume = 1;
                recorder.start(100);
                tempVideo.play();

                function drawFrame() {
                    if (tempVideo.paused || tempVideo.ended || tempVideo.currentTime >= endTime) {
                        tempVideo.pause();
                        recorder.stop();
                        return;
                    }
                    ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
                    requestAnimationFrame(drawFrame);
                }

                requestAnimationFrame(drawFrame);

                // Stop when we reach the end time
                tempVideo.addEventListener('timeupdate', () => {
                    if (tempVideo.currentTime >= endTime) {
                        tempVideo.pause();
                        if (recorder.state === 'recording') {
                            recorder.stop();
                        }
                    }
                });
            }
        });
    }

    // ── Discard ────────────────────────────────────────────────────
    discardBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to discard this recording? This cannot be undone.')) {
            // Clean up IndexedDB
            try {
                await deleteFromIndexedDB();
            } catch (_e) { /* ignore */ }
            showToast('🗑️', 'Recording discarded.');
            setTimeout(() => window.close(), 1200);
        }
    });

    // ── Utility Functions ─────────────────────────────────────────
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
        const current = videoPlayer.currentTime || 0;
        timeDisplay.textContent = `${formatTime(current)} / ${formatTime(videoDuration)}`;
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 200);
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

    // ── Keyboard Shortcuts ────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;

        switch (e.key) {
            case ' ':
            case 'k':
                e.preventDefault();
                togglePlay();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 5);
                break;
            case 'ArrowRight':
                e.preventDefault();
                videoPlayer.currentTime = Math.min(videoDuration, videoPlayer.currentTime + 5);
                break;
            case 'm':
                videoPlayer.muted = !videoPlayer.muted;
                volumeOnIcon.style.display = videoPlayer.muted ? 'none' : 'block';
                volumeOffIcon.style.display = videoPlayer.muted ? 'block' : 'none';
                break;
            case 'f':
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                } else {
                    videoPlayer.requestFullscreen();
                }
                break;
        }
    });

    // ── IndexedDB Helpers ─────────────────────────────────────────────
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

                getReq.onsuccess = () => {
                    db.close();
                    resolve(getReq.result || null);
                };

                getReq.onerror = () => {
                    db.close();
                    reject(new Error('Failed to read from IndexedDB'));
                };
            };

            request.onerror = () => {
                reject(new Error('Failed to open IndexedDB'));
            };
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

                tx.oncomplete = () => {
                    db.close();
                    resolve();
                };

                tx.onerror = () => {
                    db.close();
                    reject(new Error('Failed to delete from IndexedDB'));
                };
            };

            request.onerror = () => {
                reject(new Error('Failed to open IndexedDB'));
            };
        });
    }

})();
