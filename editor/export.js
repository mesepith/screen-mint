// ========== ./editor/export.js ==========
'use strict';

downloadBtn.addEventListener('click', async () => {
    if (!videoBlob) return;

    const hasAnyRemoved = removedFlags.some(f => f);
    const hasAnyOverlays = overlayTracks.some(t => t.items.length > 0);
    const hasOffsets = segmentOffsets.some(o => o !== 0);

    if (!hasAnyRemoved && !hasAnyOverlays && !hasOffsets) {
        downloadBlob(videoBlob, videoFileName);
        showToast('⬇️', 'Downloading original recording…');
        return;
    }

    let maxOverlayEnd = 0;
    for (const track of overlayTracks) {
        for (const item of track.items) {
            const end = item.start + item.duration;
            if (end > maxOverlayEnd) maxOverlayEnd = end;
        }
    }
    const exportTimelineEnd = Math.max(getEffectiveVideoEnd(), maxOverlayEnd);

    const allSegments = getSegments();
    if (allSegments.every(s => s.removed) && maxOverlayEnd === 0) {
        showToast('⚠️', 'Nothing left to download — all sections are removed.');
        return;
    }

    processingOverlay.classList.add('active');
    const processingSubtext = processingOverlay.querySelector('.processing-subtext');
    processingSubtext.textContent = 'Preparing…';

    try {
        const editedBlob = await encodeSegments(videoBlob, allSegments, exportTimelineEnd, (progress) => {
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

discardBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to discard this recording? This cannot be undone.')) {
        try { await deleteFromIndexedDB(); } catch (_e) { }
        showToast('🗑️', 'Recording discarded.');
        setTimeout(() => window.close(), 1200);
    }
});

function syncOverlayVideosForExport(currentTime) {
    for (const track of overlayTracks) {
        for (const item of track.items) {
            if (item.type === 'video') {
                const vid = overlayVideoCache[item.id];
                if (!vid) continue;
                const inRange = currentTime >= item.start && currentTime < item.start + item.duration;
                if (inRange) {
                    if (vid.paused) vid.play().catch(() => { });
                    const expectedTime = (item.videoOffset || 0) + (currentTime - item.start);
                    if (Math.abs(vid.currentTime - expectedTime) > 0.2) {
                        vid.currentTime = expectedTime;
                    }
                } else {
                    if (!vid.paused) vid.pause();
                }
            }
        }
    }
}

function encodeSegments(blob, segments, exportDuration, onProgress) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const tempVideo = document.createElement('video');
        tempVideo.muted = true;
        tempVideo.preload = 'auto';
        tempVideo.src = url;

        let recorder = null;
        let chunks = [];

        let canvas, ctx, canvasStream, recOptions;
        let mainVideoGain;
        let animFrameId = null;
        let virtualRecordingTime = 0;
        let finished = false;
        let encodingTimeout = null;

        tempVideo.addEventListener('loadedmetadata', () => {
            setupRecorder();
        });

        tempVideo.addEventListener('error', () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load video for encoding'));
        });

        function setupRecorder() {
            canvas = document.createElement('canvas');
            canvas.width = tempVideo.videoWidth || 1920;
            canvas.height = tempVideo.videoHeight || 1080;
            ctx = canvas.getContext('2d');
            canvasStream = canvas.captureStream(30);

            try {
                const audioCtx = new AudioContext();
                const dest = audioCtx.createMediaStreamDestination();
                const source = audioCtx.createMediaElementSource(tempVideo);

                mainVideoGain = audioCtx.createGain();
                source.connect(mainVideoGain);
                mainVideoGain.connect(dest);

                const exportAudioItems = [];
                for (const track of overlayTracks) {
                    for (const item of track.items) {
                        if ((item.type !== 'audio' && item.type !== 'video') || (!item.audioSrc && !item.videoSrc) || !overlayAudioBuffers[item.id]) continue;
                        exportAudioItems.push({
                            id: item.id,
                            start: item.start,
                            duration: item.duration,
                            audioOffset: (item.type === 'video' ? item.videoOffset : item.audioOffset) || 0,
                            volume: (item.volume != null ? item.volume : 100) / 100,
                            buffer: overlayAudioBuffers[item.id]
                        });
                    }
                }

                dest.stream.getAudioTracks().forEach(track => canvasStream.addTrack(track));
                const activeExportAudioNodes = new Map();
                const activeExportAudioIds = new Set();

                canvasStream._syncExportAudio = (appTime) => {
                    const shouldBeActive = new Set();
                    for (const ea of exportAudioItems) {
                        const inRange = appTime >= ea.start && appTime < ea.start + ea.duration;
                        if (inRange) {
                            shouldBeActive.add(ea.id);
                            const playbackOffset = appTime - ea.start;
                            const expectedTime = ea.audioOffset + playbackOffset;

                            if (!activeExportAudioIds.has(ea.id)) {
                                const source = audioCtx.createBufferSource();
                                source.buffer = ea.buffer;
                                const gain = audioCtx.createGain();
                                gain.gain.value = ea.volume;
                                source.connect(gain);
                                gain.connect(dest);

                                const startWhen = audioCtx.currentTime + 0.005;
                                source.start(startWhen, expectedTime);
                                activeExportAudioNodes.set(ea.id, {
                                    sourceNode: source, gainNode: gain, lastExpectedTime: expectedTime, systemTimeStart: startWhen
                                });
                                activeExportAudioIds.add(ea.id);
                            } else {
                                const nodeInfo = activeExportAudioNodes.get(ea.id);
                                if (nodeInfo) {
                                    nodeInfo.gainNode.gain.value = ea.volume;
                                    const actualNodePlayTime = (audioCtx.currentTime - nodeInfo.systemTimeStart) + nodeInfo.lastExpectedTime;

                                    if (Math.abs(actualNodePlayTime - expectedTime) > 0.15) {
                                        try { nodeInfo.sourceNode.stop(); } catch (e) { }

                                        const source = audioCtx.createBufferSource();
                                        source.buffer = ea.buffer;
                                        source.connect(nodeInfo.gainNode);
                                        const startWhen = audioCtx.currentTime + 0.005;
                                        source.start(startWhen, expectedTime);

                                        nodeInfo.sourceNode = source;
                                        nodeInfo.systemTimeStart = startWhen;
                                        nodeInfo.lastExpectedTime = expectedTime;
                                    }
                                }
                            }
                        }
                    }

                    for (const id of activeExportAudioIds) {
                        if (!shouldBeActive.has(id)) {
                            const nodeInfo = activeExportAudioNodes.get(id);
                            if (nodeInfo && nodeInfo.sourceNode) {
                                try { nodeInfo.sourceNode.stop(); } catch (e) { }
                                try { nodeInfo.sourceNode.disconnect(); } catch (e) { }
                                try { nodeInfo.gainNode.disconnect(); } catch (e) { }
                            }
                            activeExportAudioNodes.delete(id);
                            activeExportAudioIds.delete(id);
                        }
                    }
                };

                canvasStream._exportAudioCleanup = () => {
                    for (const id of activeExportAudioIds) {
                        const nodeInfo = activeExportAudioNodes.get(id);
                        if (nodeInfo && nodeInfo.sourceNode) {
                            try { nodeInfo.sourceNode.stop(); } catch (e) { }
                            try { nodeInfo.sourceNode.disconnect(); } catch (e) { }
                            try { nodeInfo.gainNode.disconnect(); } catch (e) { }
                        }
                    }
                    activeExportAudioNodes.clear();
                    activeExportAudioIds.clear();
                };
            } catch (_e) { }

            if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) {
                recOptions = { mimeType: 'video/webm; codecs=vp9' };
            } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp8')) {
                recOptions = { mimeType: 'video/webm; codecs=vp8' };
            } else {
                recOptions = { mimeType: 'video/webm' };
            }

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

            // Start overarching recording once
            virtualRecordingTime = 0;
            recorder.start(100);

            // Build the export action plan based on user segments
            buildAndExecuteExportPlan();
        }

        function finishRecording() {
            if (finished) return;
            finished = true;
            if (encodingTimeout) clearTimeout(encodingTimeout);
            tempVideo.pause();
            if (animFrameId) cancelAnimationFrame(animFrameId);
            if (canvasStream && canvasStream._exportAudioCleanup) {
                canvasStream._exportAudioCleanup();
            }
            try {
                if (recorder && recorder.state !== 'inactive') {
                    recorder.stop();
                }
            } catch (_e) {
                URL.revokeObjectURL(url);
                const finalBlob = new Blob(chunks, { type: recOptions.mimeType });
                resolve(finalBlob);
            }
        }

        function buildAndExecuteExportPlan() {
            const plan = [];
            let currentTimelineTime = 0;

            const activeSegs = segments.filter(s => !s.removed).sort((a, b) => a.start - b.start);

            for (const seg of activeSegs) {
                if (seg.start > currentTimelineTime) {
                    plan.push({ type: 'gap', duration: seg.start - currentTimelineTime });
                    currentTimelineTime = seg.start;
                }
                const clipDuration = seg.end - seg.start;
                plan.push({
                    type: 'clip',
                    videoStart: seg.videoStart,
                    videoEnd: seg.videoStart + clipDuration,
                    duration: clipDuration
                });
                currentTimelineTime += clipDuration;
            }

            if (exportDuration > currentTimelineTime) {
                plan.push({ type: 'gap', duration: exportDuration - currentTimelineTime });
            }

            let planIndex = 0;

            function executeNextPlanStep() {
                if (planIndex >= plan.length || finished) {
                    finishRecording();
                    return;
                }

                const step = plan[planIndex];
                const progressPct = Math.min(99, Math.floor((virtualRecordingTime / exportDuration) * 100));

                if (step.type === 'gap') {
                    onProgress(`Encoding: ${progressPct}%`);
                    let gapStartAppTime = virtualRecordingTime;

                    tempVideo.pause();
                    if (mainVideoGain) mainVideoGain.gain.value = 0;

                    let gapLastDraw = performance.now();
                    function drawGap() {
                        if (finished) return;
                        const now = performance.now();
                        const delta = (now - gapLastDraw) / 1000;
                        gapLastDraw = now;

                        virtualRecordingTime += delta;

                        if (virtualRecordingTime >= gapStartAppTime + step.duration) {
                            virtualRecordingTime = gapStartAppTime + step.duration;
                            planIndex++;
                            executeNextPlanStep();
                            return;
                        }

                        ctx.fillStyle = "#000";
                        ctx.fillRect(0, 0, canvas.width, canvas.height);

                        syncOverlayVideosForExport(virtualRecordingTime);
                        drawOverlaysOnCanvas(ctx, canvas.width, canvas.height, virtualRecordingTime);
                        if (canvasStream && canvasStream._syncExportAudio) canvasStream._syncExportAudio(virtualRecordingTime);

                        animFrameId = requestAnimationFrame(drawGap);
                    }
                    drawGap();
                }
                else if (step.type === 'clip') {
                    onProgress(`Encoding: ${progressPct}%`);
                    let clipStartAppTime = virtualRecordingTime;

                    if (Math.abs(tempVideo.currentTime - step.videoStart) > 0.1) {
                        tempVideo.currentTime = step.videoStart;
                        tempVideo.addEventListener('seeked', function onSeek() {
                            tempVideo.removeEventListener('seeked', onSeek);
                            startClipRender();
                        }, { once: true });
                    } else {
                        startClipRender();
                    }

                    function startClipRender() {
                        if (finished) return;
                        if (mainVideoGain) mainVideoGain.gain.value = 1;
                        tempVideo.play().catch(() => { });

                        let clipLastDraw = performance.now();

                        function drawClip() {
                            if (finished) return;

                            if (tempVideo.paused || tempVideo.currentTime >= step.videoEnd) {
                                tempVideo.pause();
                                virtualRecordingTime = clipStartAppTime + step.duration;
                                planIndex++;
                                executeNextPlanStep();
                                return;
                            }

                            const now = performance.now();
                            const delta = (now - clipLastDraw) / 1000;
                            clipLastDraw = now;
                            virtualRecordingTime += delta;

                            ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);

                            syncOverlayVideosForExport(virtualRecordingTime);
                            drawOverlaysOnCanvas(ctx, canvas.width, canvas.height, virtualRecordingTime);
                            if (canvasStream && canvasStream._syncExportAudio) canvasStream._syncExportAudio(virtualRecordingTime);

                            animFrameId = requestAnimationFrame(drawClip);
                        }
                        drawClip();
                    }
                }
            }

            // Fire off the first step
            executeNextPlanStep();
        }

        encodingTimeout = setTimeout(() => {
            if (!finished) {
                console.warn('Encoding timed out, finishing with available data');
                finishRecording();
            }
        }, 5 * 60 * 1000);
    });
}