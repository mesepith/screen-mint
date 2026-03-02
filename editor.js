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

    // ── State ──────────────────────────────────────────────────────
    let videoBlob = null;
    let videoDuration = 0;
    let videoFileName = '';

    // Split & delete state
    let splitPoints = [];       // sorted array of split times
    let removedFlags = [];      // removedFlags[i] = true if segment i is removed
    let selectedSegIdx = null;  // index of currently selected segment, or null
    let isDraggingPlayhead = false; // true when user is dragging the playhead

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
        splitPoints = [];
        removedFlags = [false];
        selectedSegIdx = null;
        renderTimeline();
        updateControls();
        showToast('🔄', 'All changes cleared');
    });

    // ── Select a segment ──────────────────────────────────────────
    function selectSegment(index) {
        selectedSegIdx = (selectedSegIdx === index) ? null : index;
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
                selectSegment(idx);
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

        if (!hasAnyRemoved) {
            // No cuts — download original
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
            tempVideo.src = url;

            let currentSegIndex = 0;
            let recorder = null;
            let chunks = [];
            let canvas, ctx, canvasStream, recOptions;
            let animFrameId = null;

            tempVideo.addEventListener('loadedmetadata', () => {
                if (!isFinite(tempVideo.duration)) {
                    tempVideo.currentTime = 1e10;
                    tempVideo.addEventListener('seeked', function seekOnce() {
                        tempVideo.removeEventListener('seeked', seekOnce);
                        setupRecorder();
                    }, { once: true });
                } else {
                    setupRecorder();
                }
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

            function finishRecording() {
                if (finished) return;
                finished = true;
                tempVideo.pause();
                if (animFrameId) cancelAnimationFrame(animFrameId);
                if (recorder && recorder.state === 'recording') {
                    recorder.stop();
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
                tempVideo.currentTime = segments[idx].start;

                tempVideo.addEventListener('seeked', function onSeeked() {
                    tempVideo.removeEventListener('seeked', onSeeked);
                    if (finished) return;
                    seeking = false;
                    tempVideo.muted = false;
                    tempVideo.volume = 1;
                    tempVideo.play();
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
                animFrameId = requestAnimationFrame(drawFrame);
            }

            // Safety net for segment boundary
            tempVideo.addEventListener('timeupdate', () => {
                if (finished || seeking || currentSegIndex >= segments.length) return;
                const seg = segments[currentSegIndex];
                if (!seg) return;
                if (tempVideo.currentTime >= seg.end) {
                    advanceToNextSegment();
                }
            });
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
