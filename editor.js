/* ═══════════════════════════════════════════════════════════════
   Screen Mint — Video Editor Logic
   Split & delete model: split timeline, click any part to remove
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

    // Timeline
    const timeline = document.getElementById('timeline');
    const timelineWaveform = document.getElementById('timelineWaveform');
    const timelineSegmentsLayer = document.getElementById('timelineSegmentsLayer');
    const timelineSplitsLayer = document.getElementById('timelineSplitsLayer');
    const timelinePlayhead = document.getElementById('timelinePlayhead');
    const timelineLabelStart = document.getElementById('timelineLabelStart');
    const timelineLabelEnd = document.getElementById('timelineLabelEnd');

    // Controls
    const splitBtn = document.getElementById('splitBtn');
    const removeSectionBtn = document.getElementById('removeSectionBtn');
    const restoreSectionBtn = document.getElementById('restoreSectionBtn');
    const deselectBtn = document.getElementById('deselectBtn');
    const resetAllBtn = document.getElementById('resetAllBtn');
    const editorInfo = document.getElementById('editorInfo');

    // Actions
    const downloadBtn = document.getElementById('downloadBtn');
    const discardBtn = document.getElementById('discardBtn');

    const processingOverlay = document.getElementById('processingOverlay');
    const toast = document.getElementById('toast');

    // Overlay Tracks DOM
    const overlayCanvas = document.getElementById('overlayCanvas');
    const overlayCtx = overlayCanvas.getContext('2d');
    const overlayInteractionLayer = document.getElementById('overlayInteractionLayer');
    const overlayTracksContainer = document.getElementById('overlayTracksContainer');
    const addTrackBtn = document.getElementById('addTrackBtn');
    const overlayEditPopover = document.getElementById('overlayEditPopover');
    const popoverClose = document.getElementById('popoverClose');
    const popoverText = document.getElementById('popoverText');
    const popoverFontSize = document.getElementById('popoverFontSize');
    const popoverColor = document.getElementById('popoverColor');
    const popoverDuration = document.getElementById('popoverDuration');
    const popoverX = document.getElementById('popoverX');
    const popoverY = document.getElementById('popoverY');
    const popoverSave = document.getElementById('popoverSave');

    // ── State ──────────────────────────────────────────────────────
    let videoBlob = null;
    let videoDuration = 0;
    let videoFileName = '';

    // Split & delete state
    let splitPoints = [];       // sorted array of split times
    let removedFlags = [];      // removedFlags[i] = true if segment i is removed
    let selectedSegIdx = null;  // index of currently selected segment, or null
    let isDraggingPlayhead = false; // true when user is dragging the playhead
    let undoStack = [];         // undo history [{splitPoints, removedFlags}]

    // ── Overlay Tracks State ──────────────────────────────────────
    let overlayTracks = [];       // [{id, name, items: [{id, type, start, duration, content, fontSize, color, x, y, imageSrc, imageEl}]}]
    let overlayIdCounter = 0;
    let editingOverlay = null;    // {trackId, itemId} or null
    let draggingOverlayItem = null; // drag state for overlay items
    let overlayImageCache = {};   // id -> HTMLImageElement

    function saveUndoState() {
        undoStack.push({
            splitPoints: [...splitPoints],
            removedFlags: [...removedFlags]
        });
        if (undoStack.length > 20) undoStack.shift(); // limit
    }

    function undo() {
        if (undoStack.length === 0) {
            showToast('⚠️', 'Nothing to undo');
            return;
        }
        const state = undoStack.pop();
        splitPoints = state.splitPoints;
        removedFlags = state.removedFlags;
        selectedSegIdx = null;
        renderTimeline();
        updateControls();
        showToast('↩️', 'Undone');
    }

    // ── Init ──────────────────────────────────────────────────────
    init();

    async function init() {
        try {
            const result = await loadFromIndexedDB();
            if (!result) {
                showToast('⚠️', 'No recording found. Please record a video first.');
                loadingScreen.classList.add('hidden');
                return;
            }

            videoFileName = result.fileName || generateFileName();
            videoBlob = result.blob;

            const objectUrl = URL.createObjectURL(videoBlob);
            videoPlayer.src = objectUrl;

            videoPlayer.addEventListener('loadedmetadata', () => {
                if (!isFinite(videoPlayer.duration)) {
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
        if (!isFinite(videoDuration) || videoDuration <= 0) videoDuration = 0;

        removedFlags = [false]; // one segment initially (the whole video)

        updateTimeDisplay();
        drawWaveform();
        updateTimelineLabels();
        renderTimeline();

        recordingInfo.textContent = formatDuration(videoDuration) + ' recorded';
        loadingScreen.classList.add('hidden');
        showToast('✅', 'Recording loaded successfully!');
    }

    // ── Playback ──────────────────────────────────────────────────
    playOverlay.addEventListener('click', togglePlay);
    playPauseBtn.addEventListener('click', togglePlay);

    function togglePlay() {
        if (videoPlayer.paused || videoPlayer.ended) {
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
        videoPlayer.currentTime = 0;
    });

    // ── Progress & Playhead ───────────────────────────────────────
    videoPlayer.addEventListener('timeupdate', () => {
        if (videoDuration > 0) {
            const ct = videoPlayer.currentTime;
            const pct = (ct / videoDuration) * 100;
            progressFilled.style.width = pct + '%';
            timelinePlayhead.style.left = pct + '%';

            // Skip removed segments during playback
            if (!videoPlayer.paused) {
                const segments = getSegments();
                for (const seg of segments) {
                    if (seg.removed && ct >= seg.start && ct < seg.end - 0.05) {
                        videoPlayer.currentTime = seg.end;
                        return;
                    }
                }
            }

            // Render overlay preview & update lane playheads
            renderOverlayPreview(ct);
            updateLanePlayheads(pct);
        }
        updateTimeDisplay();
    });

    // Snap seek to skip removed segments
    function snapToKept(time) {
        const segments = getSegments();
        for (const seg of segments) {
            if (seg.removed && time >= seg.start && time < seg.end) {
                return seg.end;
            }
        }
        return time;
    }

    progressContainer.addEventListener('click', (e) => {
        const rect = progressContainer.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        videoPlayer.currentTime = snapToKept(pct * videoDuration);
    });

    // ── Playhead Drag (scrub on timeline) ─────────────────────────
    function getTimeFromPointer(e) {
        const rect = timeline.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return pct * videoDuration;
    }

    timelinePlayhead.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        isDraggingPlayhead = true;
        videoPlayer.pause();
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
    });

    timelinePlayhead.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        isDraggingPlayhead = true;
        videoPlayer.pause();
    }, { passive: true });

    document.addEventListener('mousemove', (e) => {
        if (!isDraggingPlayhead) return;
        const time = getTimeFromPointer(e);
        videoPlayer.currentTime = time;
        const pct = (time / videoDuration) * 100;
        timelinePlayhead.style.left = pct + '%';
        progressFilled.style.width = pct + '%';
        updateTimeDisplay();
    });

    document.addEventListener('touchmove', (e) => {
        if (!isDraggingPlayhead) return;
        const time = getTimeFromPointer(e);
        videoPlayer.currentTime = time;
        const pct = (time / videoDuration) * 100;
        timelinePlayhead.style.left = pct + '%';
        progressFilled.style.width = pct + '%';
        updateTimeDisplay();
    }, { passive: true });

    document.addEventListener('mouseup', () => {
        if (!isDraggingPlayhead) return;
        isDraggingPlayhead = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });

    document.addEventListener('touchend', () => {
        if (!isDraggingPlayhead) return;
        isDraggingPlayhead = false;
    });

    // ── Click anywhere on timeline to move playhead ───────────────
    timeline.addEventListener('click', (e) => {
        if (isDraggingPlayhead) return;
        const rect = timeline.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const time = snapToKept(pct * videoDuration);
        videoPlayer.currentTime = time;
        const displayPct = (time / videoDuration) * 100;
        timelinePlayhead.style.left = displayPct + '%';
        progressFilled.style.width = displayPct + '%';
        updateTimeDisplay();
    });

    // ── Volume ────────────────────────────────────────────────────
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

    // ── Waveform ──────────────────────────────────────────────────
    function drawWaveform() {
        const canvas = timelineWaveform;
        const ctx = canvas.getContext('2d');
        const rect = timeline.getBoundingClientRect();

        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

        const w = rect.width, h = rect.height;
        const barCount = Math.floor(w / 4);
        const barWidth = 2;
        const gap = (w - barCount * barWidth) / (barCount - 1);

        ctx.clearRect(0, 0, w, h);

        for (let i = 0; i < barCount; i++) {
            const x = i * (barWidth + gap);
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

    window.addEventListener('resize', () => {
        if (videoDuration > 0) {
            drawWaveform();
            renderTimeline();
            renderOverlayTracks();
            resizeOverlayCanvas();
        }
    });

    function updateTimelineLabels() {
        timelineLabelStart.textContent = formatTimePrecise(0);
        timelineLabelEnd.textContent = formatTimePrecise(videoDuration);
    }

    // ══════════════════════════════════════════════════════════════
    // ── SEGMENTS MODEL ───────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════

    function getSegments() {
        const pts = [0, ...splitPoints, videoDuration];
        return pts.slice(0, -1).map((start, i) => ({
            index: i,
            start: start,
            end: pts[i + 1],
            removed: removedFlags[i] || false
        }));
    }

    // ══════════════════════════════════════════════════════════════
    // ── SPLIT & DELETE ACTIONS ────────────────────────────────────
    // ══════════════════════════════════════════════════════════════

    // ── Split at playhead ─────────────────────────────────────────
    splitBtn.addEventListener('click', () => {
        addSplit(videoPlayer.currentTime);
    });

    function addSplit(time) {
        if (videoDuration <= 0) return;
        if (time < 0.3 || time > videoDuration - 0.3) {
            showToast('⚠️', 'Cannot split too close to the start or end');
            return;
        }

        // Don't split too close to existing split
        for (const sp of splitPoints) {
            if (Math.abs(sp - time) < 0.3) {
                showToast('⚠️', 'A split already exists near this point');
                return;
            }
        }

        // Find which segment the split falls in
        const segments = getSegments();
        let segIdx = segments.length - 1;
        for (let i = 0; i < segments.length; i++) {
            if (time >= segments[i].start && time < segments[i].end) {
                segIdx = i;
                break;
            }
        }

        // Don't split too close to segment boundaries
        const seg = segments[segIdx];
        if (time - seg.start < 0.3 || seg.end - time < 0.3) {
            showToast('⚠️', 'Cannot split too close to an existing split');
            return;
        }

        // Get current removed state for this segment
        const wasRemoved = removedFlags[segIdx] || false;

        saveUndoState();

        // Insert split point in sorted order
        splitPoints.push(time);
        splitPoints.sort((a, b) => a - b);

        // Split the removed flag: the segment at segIdx becomes two segments
        // Both halves inherit the removed state
        removedFlags.splice(segIdx, 1, wasRemoved, wasRemoved);

        // Deselect
        selectedSegIdx = null;

        renderTimeline();
        updateControls();
        showToast('✂️', `Split at ${formatTimePrecise(time)}`);
    }

    // ── Remove selected segment ───────────────────────────────────
    removeSectionBtn.addEventListener('click', () => {
        if (selectedSegIdx === null) return;
        saveUndoState();
        removedFlags[selectedSegIdx] = true;

        const seg = getSegments()[selectedSegIdx];
        showToast('🗑️', `Removed ${formatTimePrecise(seg.start)} → ${formatTimePrecise(seg.end)}`);

        selectedSegIdx = null;
        renderTimeline();
        updateControls();
    });

    // ── Restore selected segment ──────────────────────────────────
    restoreSectionBtn.addEventListener('click', () => {
        if (selectedSegIdx === null) return;
        saveUndoState();
        removedFlags[selectedSegIdx] = false;

        const seg = getSegments()[selectedSegIdx];
        showToast('↩️', `Restored ${formatTimePrecise(seg.start)} → ${formatTimePrecise(seg.end)}`);

        selectedSegIdx = null;
        renderTimeline();
        updateControls();
    });

    // ── Deselect ──────────────────────────────────────────────────
    deselectBtn.addEventListener('click', () => {
        selectedSegIdx = null;
        renderTimeline();
        updateControls();
    });

    // ── Reset All ─────────────────────────────────────────────────
    resetAllBtn.addEventListener('click', () => {
        if (!confirm('Reset all splits and removed sections? You can still undo with Ctrl+Z.')) return;
        saveUndoState();
        splitPoints = [];
        removedFlags = [false];
        selectedSegIdx = null;
        renderTimeline();
        updateControls();
        showToast('🔄', 'All changes cleared — press Ctrl+Z to undo');
    });

    // ── Select a segment ──────────────────────────────────────────
    function selectSegment(index) {
        selectedSegIdx = index;
        renderTimeline();
        updateControls();
    }

    // ══════════════════════════════════════════════════════════════
    // ── RENDERING ────────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════

    function renderTimeline() {
        renderSegments();
        renderSplitMarkers();
    }

    function renderSegments() {
        timelineSegmentsLayer.innerHTML = '';
        const segments = getSegments();

        segments.forEach((seg, idx) => {
            const leftPct = (seg.start / videoDuration) * 100;
            const widthPct = ((seg.end - seg.start) / videoDuration) * 100;

            const el = document.createElement('div');
            el.className = 'segment-overlay';
            if (seg.removed) el.classList.add('removed');
            if (idx === selectedSegIdx) el.classList.add('selected');
            el.style.left = leftPct + '%';
            el.style.width = widthPct + '%';

            // "REMOVED" label for removed segments
            if (seg.removed) {
                const label = document.createElement('span');
                label.className = 'segment-removed-label';
                label.textContent = 'REMOVED';
                el.appendChild(label);
            }

            // Tooltip with time range
            const tooltip = document.createElement('span');
            tooltip.className = 'segment-tooltip';
            tooltip.textContent = `${formatTimePrecise(seg.start)} → ${formatTimePrecise(seg.end)} (${formatDuration(seg.end - seg.start)})`;
            el.appendChild(tooltip);

            // Click to select this segment (but not during playhead drag)
            el.addEventListener('click', (e) => {
                if (isDraggingPlayhead) return;
                e.stopPropagation();

                // Always move playhead to clicked position
                const rect = timeline.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const time = snapToKept(pct * videoDuration);
                videoPlayer.currentTime = time;
                const displayPct = (time / videoDuration) * 100;
                timelinePlayhead.style.left = displayPct + '%';
                progressFilled.style.width = displayPct + '%';
                updateTimeDisplay();

                // Only allow segment selection when there are actual splits
                if (splitPoints.length > 0) {
                    selectSegment(idx);
                }
            });

            timelineSegmentsLayer.appendChild(el);
        });
    }

    function renderSplitMarkers() {
        timelineSplitsLayer.innerHTML = '';

        splitPoints.forEach((time) => {
            const pct = (time / videoDuration) * 100;
            const marker = document.createElement('div');
            marker.className = 'split-marker';
            marker.style.left = pct + '%';
            timelineSplitsLayer.appendChild(marker);
        });
    }

    // ── Update control buttons visibility ─────────────────────────
    function updateControls() {
        const segments = getSegments();
        const hasAnySplit = splitPoints.length > 0;
        const hasAnyRemoved = removedFlags.some(f => f);

        // Selected segment info
        const hasSelection = selectedSegIdx !== null;
        const isSelectedRemoved = hasSelection && (removedFlags[selectedSegIdx] || false);

        // Buttons
        removeSectionBtn.style.display = (hasSelection && !isSelectedRemoved) ? '' : 'none';
        restoreSectionBtn.style.display = (hasSelection && isSelectedRemoved) ? '' : 'none';
        deselectBtn.style.display = hasSelection ? '' : 'none';
        resetAllBtn.style.display = (hasAnySplit || hasAnyRemoved) ? '' : 'none';

        // Info text
        if (hasSelection) {
            const seg = segments[selectedSegIdx];
            const dur = formatDuration(seg.end - seg.start);
            if (isSelectedRemoved) {
                editorInfo.textContent = `Selected removed section (${dur}) — click "Restore" to bring it back`;
            } else {
                editorInfo.textContent = `Selected section (${dur}) — click "Remove" to cut it out`;
            }
        } else if (hasAnyRemoved) {
            const totalRemoved = segments.filter(s => s.removed).reduce((sum, s) => sum + (s.end - s.start), 0);
            const remaining = videoDuration - totalRemoved;
            editorInfo.textContent = `${formatDuration(totalRemoved)} removed · ${formatDuration(remaining)} remaining`;
        } else if (hasAnySplit) {
            editorInfo.textContent = `${segments.length} sections — click any section to select it`;
        } else {
            editorInfo.textContent = 'Split the timeline, then click any part to remove it';
        }
    }

    downloadBtn.addEventListener('click', async () => {
        if (!videoBlob) return;

        const hasAnyRemoved = removedFlags.some(f => f);
        const hasAnyOverlays = overlayTracks.some(t => t.items.length > 0);

        if (!hasAnyRemoved && !hasAnyOverlays) {
            // No cuts and no overlays — download original
            downloadBlob(videoBlob, videoFileName);
            showToast('⬇️', 'Downloading original recording…');
            return;
        }

        // Get kept segments
        const keptSegments = getSegments().filter(s => !s.removed);

        if (keptSegments.length === 0) {
            showToast('⚠️', 'Nothing left to download — all sections are removed.');
            return;
        }

        processingOverlay.classList.add('active');
        const processingSubtext = processingOverlay.querySelector('.processing-subtext');
        processingSubtext.textContent = 'Preparing…';

        try {
            const editedBlob = await encodeKeptSegments(videoBlob, keptSegments, (progress) => {
                processingSubtext.textContent = progress;
            });

            const ext = videoFileName.split('.').pop();
            const baseName = videoFileName.replace('.' + ext, '');
            const newFileName = `${baseName}_edited.${ext}`;

            downloadBlob(editedBlob, newFileName);
            showToast('✅', 'Edited video downloaded!');
        } catch (err) {
            console.error('Download error:', err);
            showToast('❌', 'Failed to process video: ' + err.message);
        } finally {
            processingOverlay.classList.remove('active');
        }
    });

    // ── Encode all kept segments in a single MediaRecorder session ──
    function encodeKeptSegments(blob, segments, onProgress) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const tempVideo = document.createElement('video');
            tempVideo.muted = true;
            tempVideo.preload = 'auto';
            tempVideo.src = url;

            let currentSegIndex = 0;
            let recorder = null;
            let chunks = [];
            let canvas, ctx, canvasStream, recOptions;
            let animFrameId = null;

            // No need to fix Infinity duration — encoder uses segment times from the main player
            tempVideo.addEventListener('loadedmetadata', () => {
                setupRecorder();
            });

            tempVideo.addEventListener('error', () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load video for encoding'));
            });

            function setupRecorder() {
                // Create canvas for the whole session
                canvas = document.createElement('canvas');
                canvas.width = tempVideo.videoWidth || 1920;
                canvas.height = tempVideo.videoHeight || 1080;
                ctx = canvas.getContext('2d');
                canvasStream = canvas.captureStream(30);

                // Try to capture audio
                try {
                    const audioCtx = new AudioContext();
                    const source = audioCtx.createMediaElementSource(tempVideo);
                    const dest = audioCtx.createMediaStreamDestination();
                    source.connect(dest);
                    source.connect(audioCtx.destination);
                    dest.stream.getAudioTracks().forEach(track => canvasStream.addTrack(track));
                } catch (_e) { /* no audio */ }

                // Choose codec
                if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) {
                    recOptions = { mimeType: 'video/webm; codecs=vp9' };
                } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp8')) {
                    recOptions = { mimeType: 'video/webm; codecs=vp8' };
                } else {
                    recOptions = { mimeType: 'video/webm' };
                }

                // Create ONE recorder for the entire output
                recorder = new MediaRecorder(canvasStream, recOptions);
                chunks = [];

                recorder.ondataavailable = (e) => {
                    if (e.data && e.data.size > 0) chunks.push(e.data);
                };

                recorder.onstop = () => {
                    if (animFrameId) cancelAnimationFrame(animFrameId);
                    URL.revokeObjectURL(url);
                    const finalBlob = new Blob(chunks, { type: recOptions.mimeType });
                    resolve(finalBlob);
                };

                recorder.onerror = () => {
                    if (animFrameId) cancelAnimationFrame(animFrameId);
                    URL.revokeObjectURL(url);
                    reject(new Error('MediaRecorder error'));
                };

                // Start the single recording session
                recorder.start(100);

                // Begin with first segment
                currentSegIndex = 0;
                seekToSegment(currentSegIndex);
            }

            let finished = false;
            let seeking = false;
            let encodingTimeout = null;

            function finishRecording() {
                if (finished) return;
                finished = true;
                if (encodingTimeout) clearTimeout(encodingTimeout);
                tempVideo.pause();
                if (animFrameId) cancelAnimationFrame(animFrameId);
                // Force stop regardless of state
                try {
                    if (recorder && recorder.state !== 'inactive') {
                        recorder.stop();
                    }
                } catch (_e) {
                    // If stop fails, resolve with whatever we have
                    URL.revokeObjectURL(url);
                    const finalBlob = new Blob(chunks, { type: recOptions.mimeType });
                    resolve(finalBlob);
                }
            }

            function seekToSegment(idx) {
                if (finished) return;
                if (idx >= segments.length) {
                    finishRecording();
                    return;
                }

                seeking = true;
                onProgress(`Encoding segment ${idx + 1} of ${segments.length}…`);

                const targetTime = segments[idx].start;

                // If already at the target (e.g., seeking to 0 when already at 0),
                // start immediately — seeked event won't fire for no-op seeks
                if (Math.abs(tempVideo.currentTime - targetTime) < 0.05) {
                    seeking = false;
                    tempVideo.play().catch(() => {
                        advanceToNextSegment();
                    });
                    drawFrame();
                    return;
                }

                tempVideo.currentTime = targetTime;

                tempVideo.addEventListener('seeked', function onSeeked() {
                    tempVideo.removeEventListener('seeked', onSeeked);
                    if (finished) return;
                    seeking = false;
                    tempVideo.play().catch(() => {
                        // play() failed — advance anyway
                        advanceToNextSegment();
                    });
                    drawFrame();
                }, { once: true });
            }

            // Single function to advance — prevents double-increment
            function advanceToNextSegment() {
                if (finished || seeking) return;
                tempVideo.pause();
                currentSegIndex++;
                if (currentSegIndex >= segments.length) {
                    finishRecording();
                } else {
                    seekToSegment(currentSegIndex);
                }
            }

            function drawFrame() {
                if (finished || seeking || currentSegIndex >= segments.length) return;

                const seg = segments[currentSegIndex];
                if (!seg) { finishRecording(); return; }

                if (tempVideo.paused || tempVideo.ended || tempVideo.currentTime >= seg.end - 0.03) {
                    advanceToNextSegment();
                    return;
                }

                ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
                // Composite overlay items — wrapped in try-catch to prevent rAF loop from breaking
                try {
                    drawOverlaysOnCanvas(ctx, canvas.width, canvas.height, tempVideo.currentTime);
                } catch (e) {
                    console.warn('Overlay draw error:', e);
                }
                animFrameId = requestAnimationFrame(drawFrame);
            }

            // Safety net: timeupdate for segment boundary
            tempVideo.addEventListener('timeupdate', () => {
                if (finished || seeking || currentSegIndex >= segments.length) return;
                const seg = segments[currentSegIndex];
                if (!seg) return;
                if (tempVideo.currentTime >= seg.end) {
                    advanceToNextSegment();
                }
            });

            // Safety net: video ended event
            tempVideo.addEventListener('ended', () => {
                if (!finished) {
                    advanceToNextSegment();
                }
            });

            // Ultimate timeout safety net (5 min max for any video)
            encodingTimeout = setTimeout(() => {
                if (!finished) {
                    console.warn('Encoding timed out, finishing with available data');
                    finishRecording();
                }
            }, 5 * 60 * 1000);
        });
    }

    // ── Discard ────────────────────────────────────────────────────
    discardBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to discard this recording? This cannot be undone.')) {
            try { await deleteFromIndexedDB(); } catch (_e) { }
            showToast('🗑️', 'Recording discarded.');
            setTimeout(() => window.close(), 1200);
        }
    });

    // ── Utilities ─────────────────────────────────────────────────
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

    // ══════════════════════════════════════════════════════════════
    // ── OVERLAY TRACKS ───────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════

    function resizeOverlayCanvas() {
        const wrapper = videoPlayer.parentElement;
        if (!wrapper) return;
        overlayCanvas.width = wrapper.clientWidth * window.devicePixelRatio;
        overlayCanvas.height = wrapper.clientHeight * window.devicePixelRatio;
        overlayCanvas.style.width = wrapper.clientWidth + 'px';
        overlayCanvas.style.height = wrapper.clientHeight + 'px';
        overlayCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    videoPlayer.addEventListener('loadeddata', resizeOverlayCanvas);
    window.addEventListener('resize', resizeOverlayCanvas);

    // ── Track CRUD ────────────────────────────────────────────────
    function generateOverlayId() {
        return ++overlayIdCounter;
    }

    function addTrack() {
        const id = generateOverlayId();
        overlayTracks.push({
            id,
            name: `Track ${overlayTracks.length + 1}`,
            items: []
        });
        renderOverlayTracks();
        showToast('🎞️', `Added overlay track`);
    }

    function removeTrack(trackId) {
        overlayTracks = overlayTracks.filter(t => t.id !== trackId);
        renderOverlayTracks();
        renderOverlayPreview(videoPlayer.currentTime);
        showToast('🗑️', 'Track removed');
    }

    function getTrack(trackId) {
        return overlayTracks.find(t => t.id === trackId);
    }

    function getOverlayItem(trackId, itemId) {
        const track = getTrack(trackId);
        if (!track) return null;
        return track.items.find(i => i.id === itemId);
    }

    addTrackBtn.addEventListener('click', addTrack);

    // ── Add Text Overlay ──────────────────────────────────────────
    function addTextOverlay(trackId) {
        const track = getTrack(trackId);
        if (!track) return;
        const start = videoPlayer.currentTime || 0;
        const item = {
            id: generateOverlayId(),
            type: 'text',
            start: start,
            duration: 3,
            content: 'Text',
            fontSize: 32,
            color: '#ffffff',
            x: 50,  // percentage
            y: 50,
            opacity: 100
        };
        track.items.push(item);
        renderOverlayTracks();
        renderOverlayPreview(videoPlayer.currentTime);
        // Open editor immediately
        openOverlayEditor(trackId, item.id);
    }

    // ── Add Image Overlay ─────────────────────────────────────────
    function addImageOverlay(trackId) {
        const track = getTrack(trackId);
        if (!track) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    const id = generateOverlayId();
                    const item = {
                        id,
                        type: 'image',
                        start: videoPlayer.currentTime || 0,
                        duration: 5,
                        imageSrc: ev.target.result,
                        imageWidth: 20,  // percentage of video width
                        imageHeight: 0,  // auto-calculated
                        x: 50,
                        y: 50,
                        opacity: 100
                    };
                    // Calculate aspect ratio
                    item.imageHeight = (img.naturalHeight / img.naturalWidth) * item.imageWidth;
                    track.items.push(item);
                    // Cache image element
                    overlayImageCache[id] = img;
                    renderOverlayTracks();
                    renderOverlayPreview(videoPlayer.currentTime);
                    showToast('🖼️', 'Image overlay added');
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        };
        input.click();
    }

    // ── Remove Overlay Item ───────────────────────────────────────
    function removeOverlayItem(trackId, itemId) {
        const track = getTrack(trackId);
        if (!track) return;
        track.items = track.items.filter(i => i.id !== itemId);
        delete overlayImageCache[itemId];
        renderOverlayTracks();
        renderOverlayPreview(videoPlayer.currentTime);
    }

    // ── Overlay Editor Popover ────────────────────────────────────
    let popoverBackdrop = null;

    function openOverlayEditor(trackId, itemId) {
        const item = getOverlayItem(trackId, itemId);
        if (!item || item.type !== 'text') return;

        editingOverlay = { trackId, itemId };
        popoverText.value = item.content;
        popoverFontSize.value = item.fontSize;
        popoverColor.value = item.color;
        popoverDuration.value = item.duration;
        popoverX.value = item.x;
        popoverY.value = item.y;

        // Show backdrop
        popoverBackdrop = document.createElement('div');
        popoverBackdrop.className = 'overlay-edit-backdrop';
        popoverBackdrop.addEventListener('click', closeOverlayEditor);
        document.body.appendChild(popoverBackdrop);

        // Move popover to body so it's a sibling of the backdrop (same stacking context)
        document.body.appendChild(overlayEditPopover);
        overlayEditPopover.style.display = 'block';
        popoverText.focus();
    }

    function closeOverlayEditor() {
        overlayEditPopover.style.display = 'none';
        editingOverlay = null;
        if (popoverBackdrop) {
            popoverBackdrop.remove();
            popoverBackdrop = null;
        }
    }

    function saveOverlayEditor() {
        if (!editingOverlay) return;
        const item = getOverlayItem(editingOverlay.trackId, editingOverlay.itemId);
        if (!item) { closeOverlayEditor(); return; }

        item.content = popoverText.value || 'Text';
        item.fontSize = parseInt(popoverFontSize.value) || 32;
        item.color = popoverColor.value || '#ffffff';
        item.duration = parseFloat(popoverDuration.value) || 3;
        item.x = parseFloat(popoverX.value) || 50;
        item.y = parseFloat(popoverY.value) || 50;

        closeOverlayEditor();
        renderOverlayTracks();
        renderOverlayPreview(videoPlayer.currentTime);
        showToast('✅', 'Overlay updated');
    }

    popoverClose.addEventListener('click', closeOverlayEditor);
    popoverSave.addEventListener('click', saveOverlayEditor);

    // ── Render Overlay Tracks in DOM ──────────────────────────────
    function renderOverlayTracks() {
        overlayTracksContainer.innerHTML = '';

        if (overlayTracks.length === 0) {
            return;
        }

        overlayTracks.forEach((track, trackIdx) => {
            const row = document.createElement('div');
            row.className = 'overlay-track-row';
            row.dataset.trackId = track.id;

            // Sidebar
            const sidebar = document.createElement('div');
            sidebar.className = 'overlay-track-sidebar';

            const label = document.createElement('div');
            label.className = 'overlay-track-label';
            label.textContent = track.name;
            sidebar.appendChild(label);

            const btns = document.createElement('div');
            btns.className = 'overlay-track-btns';

            // + Text button
            const textBtn = document.createElement('button');
            textBtn.className = 'overlay-track-btn';
            textBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 4v3h5.5v12h3V7H19V4H5z"/></svg> Text';
            textBtn.addEventListener('click', () => addTextOverlay(track.id));
            btns.appendChild(textBtn);

            // + Image button
            const imgBtn = document.createElement('button');
            imgBtn.className = 'overlay-track-btn';
            imgBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg> Image';
            imgBtn.addEventListener('click', () => addImageOverlay(track.id));
            btns.appendChild(imgBtn);

            // Delete track button
            const delBtn = document.createElement('button');
            delBtn.className = 'overlay-track-btn btn-delete-track';
            delBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
            delBtn.title = 'Delete track';
            delBtn.addEventListener('click', () => {
                if (confirm(`Delete "${track.name}" and all its overlays?`)) {
                    removeTrack(track.id);
                }
            });
            btns.appendChild(delBtn);

            sidebar.appendChild(btns);
            row.appendChild(sidebar);

            // Lane
            const lane = document.createElement('div');
            lane.className = 'overlay-track-lane';
            lane.dataset.trackId = track.id;

            // Playhead indicator in lane
            const lanePH = document.createElement('div');
            lanePH.className = 'lane-playhead';
            if (videoDuration > 0) {
                lanePH.style.left = ((videoPlayer.currentTime / videoDuration) * 100) + '%';
            }
            lane.appendChild(lanePH);

            // Render items
            track.items.forEach(item => {
                const el = document.createElement('div');
                el.className = 'overlay-item ' + (item.type === 'text' ? 'overlay-item-text' : 'overlay-item-image');
                el.dataset.itemId = item.id;
                el.dataset.trackId = track.id;

                if (videoDuration > 0) {
                    const leftPct = (item.start / videoDuration) * 100;
                    const widthPct = (item.duration / videoDuration) * 100;
                    el.style.left = leftPct + '%';
                    el.style.width = Math.max(widthPct, 0.5) + '%';
                }

                // Content preview
                if (item.type === 'text') {
                    const preview = document.createElement('span');
                    preview.textContent = item.content;
                    preview.style.pointerEvents = 'none';
                    el.appendChild(preview);
                } else if (item.type === 'image' && item.imageSrc) {
                    const thumb = document.createElement('img');
                    thumb.src = item.imageSrc;
                    thumb.draggable = false;
                    el.appendChild(thumb);
                }

                // Delete button
                const delBtn = document.createElement('button');
                delBtn.className = 'overlay-item-delete';
                delBtn.textContent = '×';
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    removeOverlayItem(track.id, item.id);
                });
                el.appendChild(delBtn);

                // Resize handle — left edge
                const resizeL = document.createElement('div');
                resizeL.className = 'overlay-resize-handle overlay-resize-handle-left';
                resizeL.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startOverlayResize(e, track.id, item.id, lane, 'left');
                });
                el.appendChild(resizeL);

                // Resize handle — right edge
                const resizeR = document.createElement('div');
                resizeR.className = 'overlay-resize-handle overlay-resize-handle-right';
                resizeR.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startOverlayResize(e, track.id, item.id, lane, 'right');
                });
                el.appendChild(resizeR);

                // Double-click to edit (text only)
                if (item.type === 'text') {
                    el.addEventListener('dblclick', (e) => {
                        e.stopPropagation();
                        openOverlayEditor(track.id, item.id);
                    });
                }

                // Drag to reposition in time (skip if clicking on resize handles or delete)
                el.addEventListener('mousedown', (e) => {
                    if (e.target.classList.contains('overlay-item-delete') || e.target.classList.contains('overlay-resize-handle')) return;
                    e.preventDefault();
                    e.stopPropagation();
                    startOverlayDrag(e, track.id, item.id, lane);
                });

                el.addEventListener('touchstart', (e) => {
                    if (e.target.classList.contains('overlay-item-delete') || e.target.classList.contains('overlay-resize-handle')) return;
                    e.stopPropagation();
                    startOverlayDrag(e, track.id, item.id, lane);
                }, { passive: false });

                lane.appendChild(el);
            });

            row.appendChild(lane);
            overlayTracksContainer.appendChild(row);
        });
    }

    // ── Overlay Item Drag ─────────────────────────────────────────
    function startOverlayDrag(e, trackId, itemId, laneEl) {
        const item = getOverlayItem(trackId, itemId);
        if (!item || videoDuration <= 0) return;

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const rect = laneEl.getBoundingClientRect();
        const startPct = (clientX - rect.left) / rect.width;
        const startTime = item.start;

        draggingOverlayItem = { trackId, itemId, startPct, startTime, rect };
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
    }

    document.addEventListener('mousemove', (e) => {
        if (!draggingOverlayItem) return;
        const item = getOverlayItem(draggingOverlayItem.trackId, draggingOverlayItem.itemId);
        if (!item) { draggingOverlayItem = null; return; }

        const rect = draggingOverlayItem.rect;
        const currentPct = (e.clientX - rect.left) / rect.width;
        const deltaPct = currentPct - draggingOverlayItem.startPct;
        let newStart = draggingOverlayItem.startTime + deltaPct * videoDuration;
        newStart = Math.max(0, Math.min(videoDuration - item.duration, newStart));
        item.start = newStart;
        renderOverlayTracks();
        renderOverlayPreview(videoPlayer.currentTime);
    });

    document.addEventListener('touchmove', (e) => {
        if (!draggingOverlayItem) return;
        const item = getOverlayItem(draggingOverlayItem.trackId, draggingOverlayItem.itemId);
        if (!item) { draggingOverlayItem = null; return; }

        const rect = draggingOverlayItem.rect;
        const clientX = e.touches[0].clientX;
        const currentPct = (clientX - rect.left) / rect.width;
        const deltaPct = currentPct - draggingOverlayItem.startPct;
        let newStart = draggingOverlayItem.startTime + deltaPct * videoDuration;
        newStart = Math.max(0, Math.min(videoDuration - item.duration, newStart));
        item.start = newStart;
        renderOverlayTracks();
        renderOverlayPreview(videoPlayer.currentTime);
    }, { passive: true });

    document.addEventListener('mouseup', () => {
        if (draggingOverlayItem) {
            draggingOverlayItem = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
        if (resizingOverlayItem) {
            resizingOverlayItem = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });

    document.addEventListener('touchend', () => {
        if (draggingOverlayItem) {
            draggingOverlayItem = null;
        }
        if (resizingOverlayItem) {
            resizingOverlayItem = null;
        }
    });

    // ── Overlay Item Resize ───────────────────────────────────────
    let resizingOverlayItem = null; // {trackId, itemId, edge, startX, origStart, origDuration, rect}

    function startOverlayResize(e, trackId, itemId, laneEl, edge) {
        const item = getOverlayItem(trackId, itemId);
        if (!item || videoDuration <= 0) return;

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const rect = laneEl.getBoundingClientRect();

        resizingOverlayItem = {
            trackId, itemId, edge,
            startX: clientX,
            origStart: item.start,
            origDuration: item.duration,
            laneWidth: rect.width
        };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }

    document.addEventListener('mousemove', (e) => {
        if (!resizingOverlayItem) return;
        const item = getOverlayItem(resizingOverlayItem.trackId, resizingOverlayItem.itemId);
        if (!item) { resizingOverlayItem = null; return; }

        const deltaX = e.clientX - resizingOverlayItem.startX;
        const deltaTime = (deltaX / resizingOverlayItem.laneWidth) * videoDuration;
        const minDuration = 0.2;

        if (resizingOverlayItem.edge === 'right') {
            // Dragging right edge: change duration, keep start fixed
            let newDuration = resizingOverlayItem.origDuration + deltaTime;
            newDuration = Math.max(minDuration, Math.min(videoDuration - item.start, newDuration));
            item.duration = newDuration;
        } else {
            // Dragging left edge: change start, keep end fixed
            const origEnd = resizingOverlayItem.origStart + resizingOverlayItem.origDuration;
            let newStart = resizingOverlayItem.origStart + deltaTime;
            newStart = Math.max(0, Math.min(origEnd - minDuration, newStart));
            item.start = newStart;
            item.duration = origEnd - newStart;
        }

        renderOverlayTracks();
        renderOverlayPreview(videoPlayer.currentTime);
    });

    document.addEventListener('touchmove', (e) => {
        if (!resizingOverlayItem) return;
        const item = getOverlayItem(resizingOverlayItem.trackId, resizingOverlayItem.itemId);
        if (!item) { resizingOverlayItem = null; return; }

        const clientX = e.touches[0].clientX;
        const deltaX = clientX - resizingOverlayItem.startX;
        const deltaTime = (deltaX / resizingOverlayItem.laneWidth) * videoDuration;
        const minDuration = 0.2;

        if (resizingOverlayItem.edge === 'right') {
            let newDuration = resizingOverlayItem.origDuration + deltaTime;
            newDuration = Math.max(minDuration, Math.min(videoDuration - item.start, newDuration));
            item.duration = newDuration;
        } else {
            const origEnd = resizingOverlayItem.origStart + resizingOverlayItem.origDuration;
            let newStart = resizingOverlayItem.origStart + deltaTime;
            newStart = Math.max(0, Math.min(origEnd - minDuration, newStart));
            item.start = newStart;
            item.duration = origEnd - newStart;
        }

        renderOverlayTracks();
        renderOverlayPreview(videoPlayer.currentTime);
    }, { passive: true });

    // ── Update Lane Playheads ─────────────────────────────────────
    function updateLanePlayheads(pct) {
        const playheads = overlayTracksContainer.querySelectorAll('.lane-playhead');
        playheads.forEach(ph => {
            ph.style.left = pct + '%';
        });
    }

    // ── Render Overlay Preview on Canvas ──────────────────────────
    function renderOverlayPreview(currentTime) {
        if (!overlayCanvas.width || !overlayCanvas.height) resizeOverlayCanvas();
        const w = overlayCanvas.width / window.devicePixelRatio;
        const h = overlayCanvas.height / window.devicePixelRatio;

        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

        // Collect active items for interaction boxes
        const activeInteractiveItems = [];

        // Draw overlays in track order (index 0 = top priority = drawn LAST)
        // So iterate in reverse: bottom tracks first, top tracks last (on top)
        for (let t = overlayTracks.length - 1; t >= 0; t--) {
            const track = overlayTracks[t];
            for (const item of track.items) {
                if (currentTime >= item.start && currentTime < item.start + item.duration) {
                    drawSingleOverlay(overlayCtx, w, h, item);

                    if (item.type === 'image') {
                        activeInteractiveItems.push({ trackId: track.id, item });
                    } else if (item.type === 'text') {
                        // Measure text to create bounding box
                        const scaledFontSize = (item.fontSize / 1080) * h;
                        overlayCtx.save();
                        overlayCtx.font = `bold ${scaledFontSize}px Inter, Arial, sans-serif`;
                        const metrics = overlayCtx.measureText(item.content);
                        const textWidth = metrics.width;
                        overlayCtx.restore();

                        activeInteractiveItems.push({
                            trackId: track.id,
                            item,
                            measuredWidth: textWidth,
                            measuredHeight: scaledFontSize * 1.2 // Approx line height
                        });
                    }
                }
            }
        }

        // Render interactive bounding boxes for active overlays
        renderInteractionBoxes(activeInteractiveItems, w, h);
    }

    function drawSingleOverlay(ctx, canvasW, canvasH, item) {
        const alpha = (item.opacity != null ? item.opacity : 100) / 100;

        if (item.type === 'text') {
            const x = (item.x / 100) * canvasW;
            const y = (item.y / 100) * canvasH;
            // Scale font size relative to canvas height
            const scaledFontSize = (item.fontSize / 1080) * canvasH;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.font = `bold ${scaledFontSize}px Inter, Arial, sans-serif`;
            ctx.fillStyle = item.color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            // Text shadow for readability
            ctx.shadowColor = 'rgba(0,0,0,0.7)';
            ctx.shadowBlur = scaledFontSize * 0.15;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = scaledFontSize * 0.05;
            ctx.fillText(item.content, x, y);
            ctx.restore();
        } else if (item.type === 'image') {
            let img = overlayImageCache[item.id];
            if (!img) {
                img = new Image();
                img.src = item.imageSrc;
                overlayImageCache[item.id] = img;
            }
            if (img.complete && img.naturalWidth > 0) {
                const imgW = (item.imageWidth / 100) * canvasW;
                const imgH = (item.imageHeight / 100) * canvasH;
                const x = (item.x / 100) * canvasW - imgW / 2;
                const y = (item.y / 100) * canvasH - imgH / 2;
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.drawImage(img, x, y, imgW, imgH);
                ctx.restore();
            }
        }
    }

    // ── Draw Overlays On Encoder Canvas (for export) ──────────────
    function drawOverlaysOnCanvas(ctx, canvasW, canvasH, currentTime) {
        for (let t = overlayTracks.length - 1; t >= 0; t--) {
            const track = overlayTracks[t];
            for (const item of track.items) {
                if (currentTime >= item.start && currentTime < item.start + item.duration) {
                    drawSingleOverlay(ctx, canvasW, canvasH, item);
                }
            }
        }
    }

    // Initial render
    renderOverlayTracks();

    // ── Interaction Boxes on Preview ──────────────────────────────
    let interactionDrag = null; // {trackId, itemId, type:'corner'|'move', corner, startX, startY, origW, origH, origFontSize, origX, origY, layerW, layerH, aspectRatio}
    let selectedOverlayItem = null; // {trackId, itemId}
    let toolbarInteracting = false; // Prevent DOM rebuild while using slider

    function renderInteractionBoxes(activeItems, layerW, layerH) {
        const isDragging = !!interactionDrag;
        const skipRebuild = isDragging || toolbarInteracting;

        if (!skipRebuild) {
            overlayInteractionLayer.innerHTML = '';
            if (activeItems.length === 0) {
                // Restore play overlay visibility if video is paused
                if (videoPlayer.paused) playOverlay.classList.remove('hidden');
                return;
            }
            // Hide play overlay so it doesn't obstruct the item being edited
            playOverlay.classList.add('hidden');
        } else if (activeItems.length === 0) {
            return;
        }

        for (const { trackId, item, measuredWidth, measuredHeight } of activeItems) {
            let itemW, itemH;

            if (item.type === 'image') {
                itemW = (item.imageWidth / 100) * layerW;
                itemH = (item.imageHeight / 100) * layerH;
            } else {
                itemW = measuredWidth + 20; // Add padding
                itemH = measuredHeight + 10;
            }

            const x = (item.x / 100) * layerW - itemW / 2;
            const y = (item.y / 100) * layerH - itemH / 2;

            const boxId = `interaction-box-${trackId}-${item.id}`;
            let box = document.getElementById(boxId);

            if (!box && !skipRebuild) {
                box = document.createElement('div');
                box.id = boxId;
                box.className = 'overlay-img-box';

                // Drag to move
                box.addEventListener('click', (e) => e.stopPropagation());
                box.addEventListener('mousedown', (e) => {
                    // Select this item and re-render to show handles
                    if (!selectedOverlayItem || selectedOverlayItem.trackId !== trackId || selectedOverlayItem.itemId !== item.id) {
                        selectedOverlayItem = { trackId, itemId: item.id };
                        renderOverlayPreview(videoPlayer.currentTime);
                    }

                    if (e.target.classList.contains('overlay-corner-handle')) return;
                    e.preventDefault();
                    e.stopPropagation();
                    interactionDrag = {
                        trackId, itemId: item.id, type: 'move',
                        startX: e.clientX, startY: e.clientY,
                        origX: item.x, origY: item.y,
                        layerW, layerH
                    };
                    document.body.style.cursor = 'move';
                    document.body.style.userSelect = 'none';
                });

                // Corner handles
                ['tl', 'tr', 'bl', 'br'].forEach(corner => {
                    const handle = document.createElement('div');
                    handle.className = `overlay-corner-handle ${corner}`;
                    handle.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        interactionDrag = {
                            trackId, itemId: item.id, type: 'corner', corner,
                            startX: e.clientX, startY: e.clientY,
                            origW: itemW, // Raw pixels on screen
                            origH: itemH, // Raw pixels on screen
                            origImageW: item.imageWidth, // Original pct for image scaling
                            origFontSize: item.fontSize, // Original font size for text scaling
                            origX: item.x, origY: item.y,
                            layerW, layerH,
                            aspectRatio: item.type === 'image' ? (item.imageHeight / item.imageWidth) : (itemH / itemW)
                        };
                        document.body.style.cursor = handle.style.cursor || 'nwse-resize';
                        document.body.style.userSelect = 'none';
                    });
                    box.appendChild(handle);
                });

                // Toolbar (appears below the box when selected)
                const toolbar = document.createElement('div');
                toolbar.className = 'overlay-toolbar';
                toolbar.addEventListener('mousedown', (e) => e.stopPropagation());
                toolbar.addEventListener('click', (e) => e.stopPropagation());

                // Transparency button
                const transparencyBtn = document.createElement('button');
                transparencyBtn.className = 'overlay-toolbar-btn';
                transparencyBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31A7.903 7.903 0 0 1 12 20z"/></svg> Opacity`;
                transparencyBtn.title = 'Adjust transparency';

                // Transparency slider panel
                const transparencyPanel = document.createElement('div');
                transparencyPanel.className = 'overlay-transparency-panel';

                const slider = document.createElement('input');
                slider.type = 'range';
                slider.min = '0';
                slider.max = '100';
                slider.value = item.opacity != null ? item.opacity : 100;

                const valueLabel = document.createElement('span');
                valueLabel.className = 'transparency-value';
                valueLabel.textContent = slider.value + '%';

                slider.addEventListener('input', (e) => {
                    const val = parseInt(e.target.value);
                    const currentItem = getOverlayItem(trackId, item.id);
                    if (currentItem) {
                        currentItem.opacity = val;
                        valueLabel.textContent = val + '%';
                        renderOverlayPreview(videoPlayer.currentTime);
                    }
                });

                slider.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    toolbarInteracting = true;
                });
                document.addEventListener('mouseup', () => {
                    if (toolbarInteracting) {
                        toolbarInteracting = false;
                    }
                });

                transparencyPanel.appendChild(slider);
                transparencyPanel.appendChild(valueLabel);

                transparencyBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    transparencyBtn.classList.toggle('active');
                    transparencyPanel.classList.toggle('open');
                });

                toolbar.appendChild(transparencyBtn);
                toolbar.appendChild(transparencyPanel);
                box.appendChild(toolbar);

                overlayInteractionLayer.appendChild(box);
            }

            if (box) {
                // Update properties in real-time (even during drag)
                box.style.left = x + 'px';
                box.style.top = y + 'px';
                box.style.width = itemW + 'px';
                box.style.height = itemH + 'px';

                if (selectedOverlayItem && selectedOverlayItem.trackId === trackId && selectedOverlayItem.itemId === item.id) {
                    box.classList.add('active');
                } else {
                    box.classList.remove('active');
                }
            }
        }
    }

    document.addEventListener('mousemove', (e) => {
        if (!interactionDrag) return;
        const item = getOverlayItem(interactionDrag.trackId, interactionDrag.itemId);
        if (!item) { interactionDrag = null; return; }

        const dx = e.clientX - interactionDrag.startX;
        const dy = e.clientY - interactionDrag.startY;

        if (interactionDrag.type === 'move') {
            // Convert pixel delta to percentage
            const dxPct = (dx / interactionDrag.layerW) * 100;
            const dyPct = (dy / interactionDrag.layerH) * 100;
            item.x = Math.max(0, Math.min(100, interactionDrag.origX + dxPct));
            item.y = Math.max(0, Math.min(100, interactionDrag.origY + dyPct));
        } else {
            // Corner resize — physical distance scaling
            const corner = interactionDrag.corner;

            let newWidthPx = interactionDrag.origW;
            if (corner === 'tr' || corner === 'br') {
                newWidthPx += dx;
            } else if (corner === 'tl' || corner === 'bl') {
                newWidthPx -= dx;
            }

            // Uniform scale factor
            const scale = Math.max(0.05, newWidthPx / interactionDrag.origW);

            if (item.type === 'image') {
                item.imageWidth = interactionDrag.origImageW * scale;
                item.imageHeight = interactionDrag.origImageW * scale * interactionDrag.aspectRatio;
            } else if (item.type === 'text') {
                item.fontSize = interactionDrag.origFontSize * scale;
            }
        }

        renderOverlayPreview(videoPlayer.currentTime);
    });

    document.addEventListener('mouseup', () => {
        if (interactionDrag) {
            const item = getOverlayItem(interactionDrag.trackId, interactionDrag.itemId);

            // If the text edit popover is open for this item, update its fields
            if (item && item.type === 'text' && editingOverlay && editingOverlay.trackId === interactionDrag.trackId && editingOverlay.itemId === interactionDrag.itemId) {
                popoverFontSize.value = Math.round(item.fontSize);
                popoverX.value = Math.round(item.x);
                popoverY.value = Math.round(item.y);
            }


            interactionDrag = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            renderOverlayPreview(videoPlayer.currentTime);
        }
    });

    // Clear selection on click outside
    document.addEventListener('mousedown', (e) => {
        if (!e.target.closest('.overlay-img-box') && !e.target.closest('.overlay-corner-handle') && selectedOverlayItem) {
            selectedOverlayItem = null;
            renderOverlayPreview(videoPlayer.currentTime);
        }
    });

    // ── Keyboard Shortcuts ────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        // Undo with Ctrl+Z / Cmd+Z
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            undo();
            return;
        }

        switch (e.key) {
            case ' ':
            case 'k':
                e.preventDefault();
                togglePlay();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                videoPlayer.currentTime = snapToKept(Math.max(0, videoPlayer.currentTime - 5));
                break;
            case 'ArrowRight':
                e.preventDefault();
                videoPlayer.currentTime = snapToKept(Math.min(videoDuration, videoPlayer.currentTime + 5));
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
            case 's':
                // Split at playhead
                addSplit(videoPlayer.currentTime);
                break;
            case 'Delete':
            case 'Backspace':
                // Remove selected segment
                if (selectedSegIdx !== null && !removedFlags[selectedSegIdx]) {
                    removeSectionBtn.click();
                }
                break;
            case 'Escape':
                // Deselect
                if (selectedSegIdx !== null) {
                    deselectBtn.click();
                }
                break;
        }
    });

    // ── IndexedDB ─────────────────────────────────────────────────
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

})();
