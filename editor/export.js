// ========== ./editor/export.js ==========
'use strict';

downloadBtn.addEventListener('click', async () => {
    if (!videoBlob) return;

    const hasAnyRemoved = removedFlags.some(f => f);
    const hasAnyOverlays = overlayTracks.some(t => t.items.length > 0);

    if (!hasAnyRemoved && !hasAnyOverlays) {
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

        let currentSegIndex = 0;
        let recorder = null;
        let chunks = [];

        let canvas, ctx, canvasStream, recOptions;
        let mainVideoGain;
        let animFrameId = null;
        let virtualRecordingTime = 0;
        let isRenderingExtended = false;
        let extendedStartTime = 0;
        let lastDrawTime = 0;

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

        function seekToSegment(idx) {
            if (finished) return;
            // Prevent processing any segments extending past our actual export timeline limitation
            if (idx >= segments.length || segments[idx].start >= exportDuration) {
                checkAndStartExtendedRendering();
                return;
            }

            seeking = true;
            onProgress(`Encoding segment ${idx + 1} of ${segments.length}…`);

            const targetTime = segments[idx].start;

            if (Math.abs(tempVideo.currentTime - targetTime) < 0.05) {
                seeking = false;

                if (recorder && recorder.state === 'inactive') {
                    recorder.start(100);
                } else if (recorder && recorder.state === 'paused') {
                    recorder.resume();
                }

                tempVideo.play().catch(() => advanceToNextSegment());
                lastDrawTime = performance.now();
                drawFrame();
                return;
            }

            tempVideo.currentTime = targetTime;
            tempVideo.addEventListener('seeked', function onSeeked() {
                tempVideo.removeEventListener('seeked', onSeeked);
                if (finished) return;
                seeking = false;

                if (recorder && recorder.state === 'inactive') {
                    recorder.start(100);
                } else if (recorder && recorder.state === 'paused') {
                    recorder.resume();
                }

                tempVideo.play().catch(() => advanceToNextSegment());
                lastDrawTime = performance.now();
                drawFrame();
            }, { once: true });
        }

        function checkAndStartExtendedRendering() {
            let writtenContentTime = videoDuration;
            if (exportDuration > writtenContentTime) {
                onProgress(`Encoding extended timeline…`);
                isRenderingExtended = true;
                extendedStartTime = performance.now();
                lastDrawTime = extendedStartTime;

                if (recorder && recorder.state === 'inactive') {
                    recorder.start(100);
                } else if (recorder && recorder.state === 'paused') {
                    recorder.resume();
                }
                tempVideo.pause();
                drawExtendedFrame();
            } else {
                finishRecording();
            }
        }

        function advanceToNextSegment() {
            if (finished || seeking || isRenderingExtended) return;
            tempVideo.pause();

            if (recorder && recorder.state === 'recording') {
                recorder.pause();
            }

            currentSegIndex++;
            // Force end loop early to avoid drawing black frames for completely cropped end segments
            if (currentSegIndex < segments.length && segments[currentSegIndex].start >= exportDuration) {
                currentSegIndex = segments.length;
            }

            if (currentSegIndex >= segments.length) {
                checkAndStartExtendedRendering();
            } else {
                seekToSegment(currentSegIndex);
            }
        }

        function drawExtendedFrame() {
            if (finished) return;
            const now = performance.now();
            const deltaSec = (now - lastDrawTime) / 1000;
            lastDrawTime = now;

            virtualRecordingTime += deltaSec;
            let totalVideoWritten = videoDuration;
            const currentExtAppTime = totalVideoWritten + (virtualRecordingTime - totalVideoWritten);

            if (currentExtAppTime >= exportDuration) {
                finishRecording();
                return;
            }

            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            try {
                syncOverlayVideosForExport(currentExtAppTime);
                drawOverlaysOnCanvas(ctx, canvas.width, canvas.height, currentExtAppTime);
            } catch (e) { console.warn('Overlay draw error:', e); }

            if (canvasStream && canvasStream._syncExportAudio) {
                canvasStream._syncExportAudio(currentExtAppTime);
            }
            animFrameId = requestAnimationFrame(drawExtendedFrame);
        }

        function drawFrame() {
            if (finished || seeking || currentSegIndex >= segments.length || isRenderingExtended) return;
            const seg = segments[currentSegIndex];
            if (!seg) { checkAndStartExtendedRendering(); return; }

            // Instantly break render sequence if reaching the clipped limit
            if (tempVideo.paused || tempVideo.ended || tempVideo.currentTime >= seg.end - 0.03 || tempVideo.currentTime >= exportDuration) {
                advanceToNextSegment();
                return;
            }

            const now = performance.now();
            const deltaSec = (now - lastDrawTime) / 1000;
            lastDrawTime = now;
            virtualRecordingTime += deltaSec;

            if (seg.removed) {
                // Render an empty black void for removed chunks
                ctx.fillStyle = "#000";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                if (mainVideoGain) mainVideoGain.gain.value = 0;
            } else {
                ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
                if (mainVideoGain) mainVideoGain.gain.value = 1;
            }

            try {
                syncOverlayVideosForExport(tempVideo.currentTime);
                drawOverlaysOnCanvas(ctx, canvas.width, canvas.height, tempVideo.currentTime);
            } catch (e) { console.warn('Overlay draw error:', e); }

            if (canvasStream && canvasStream._syncExportAudio) {
                canvasStream._syncExportAudio(tempVideo.currentTime);
            }
            animFrameId = requestAnimationFrame(drawFrame);
        }

        tempVideo.addEventListener('timeupdate', () => {
            if (finished || seeking || currentSegIndex >= segments.length || isRenderingExtended) return;

            // Abort progressing further if past the crop threshold during timeupdate
            if (tempVideo.currentTime >= exportDuration) {
                advanceToNextSegment();
                return;
            }

            const seg = segments[currentSegIndex];
            if (!seg) return;
            if (tempVideo.currentTime >= seg.end) {
                advanceToNextSegment();
            }
        });

        tempVideo.addEventListener('ended', () => {
            if (!finished && !isRenderingExtended) {
                advanceToNextSegment();
            }
        });

        encodingTimeout = setTimeout(() => {
            if (!finished) {
                console.warn('Encoding timed out, finishing with available data');
                finishRecording();
            }
        }, 5 * 60 * 1000);

    });
}