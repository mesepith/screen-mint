'use strict';

async function ensureAudioContextReady() {
    if (!editorAudioCtx) {
        editorAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (editorAudioCtx.state === 'suspended') {
        await editorAudioCtx.resume();
    }
    audioCtxReady = true;
}

async function loadAudioBuffer(id, url) {
    await ensureAudioContextReady();
    if (overlayAudioBuffers[id]) return overlayAudioBuffers[id];

    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await editorAudioCtx.decodeAudioData(arrayBuffer);
        overlayAudioBuffers[id] = audioBuffer;
        return audioBuffer;
    } catch (e) {
        console.error('Failed to load audio buffer', e);
        return null;
    }
}

function syncOverlayAudio(currentTime) {
    const shouldBeActive = new Set();
    const shouldPlay = isAppPlaying;

    if (shouldPlay && !audioCtxReady) ensureAudioContextReady();

    if (!editorAudioCtx || editorAudioCtx.state !== 'running') return;

    for (const track of overlayTracks) {
        for (const item of track.items) {
            if (item.type !== 'audio') continue;

            if (!overlayAudioBuffers[item.id]) loadAudioBuffer(item.id, item.audioSrc);

            const audioStartTime = item.start;
            const audioEndTime = item.start + item.duration;
            const inRange = currentTime >= audioStartTime && currentTime < audioEndTime;

            if (inRange && shouldPlay && overlayAudioBuffers[item.id]) {
                shouldBeActive.add(item.id);
                const playbackOffset = currentTime - item.start;
                const expectedTime = (item.audioOffset || 0) + playbackOffset;
                const volume = (item.volume != null ? item.volume : 100) / 100;

                if (!activeAudioOverlays.has(item.id)) {
                    const source = editorAudioCtx.createBufferSource();
                    source.buffer = overlayAudioBuffers[item.id];

                    const gain = editorAudioCtx.createGain();
                    gain.gain.value = volume;

                    source.connect(gain);
                    gain.connect(editorAudioCtx.destination);

                    const startWhen = editorAudioCtx.currentTime + 0.005;
                    source.start(startWhen, expectedTime);

                    activeAudioNodes.set(item.id, { sourceNode: source, gainNode: gain, lastExpectedTime: expectedTime, systemTimeStart: startWhen });
                    activeAudioOverlays.add(item.id);
                } else {
                    const nodeInfo = activeAudioNodes.get(item.id);
                    if (nodeInfo) {
                        nodeInfo.gainNode.gain.value = volume;
                        const actualNodePlayTime = (editorAudioCtx.currentTime - nodeInfo.systemTimeStart) + nodeInfo.lastExpectedTime;
                        if (Math.abs(actualNodePlayTime - expectedTime) > 0.3) {
                            nodeInfo.sourceNode.stop();
                            const source = editorAudioCtx.createBufferSource();
                            source.buffer = overlayAudioBuffers[item.id];
                            source.connect(nodeInfo.gainNode);
                            const startWhen = editorAudioCtx.currentTime + 0.005;
                            source.start(startWhen, expectedTime);

                            nodeInfo.sourceNode = source;
                            nodeInfo.systemTimeStart = startWhen;
                            nodeInfo.lastExpectedTime = expectedTime;
                        }
                    }
                }
            }
        }
    }

    for (const id of activeAudioOverlays) {
        if (!shouldBeActive.has(id)) {
            const nodeInfo = activeAudioNodes.get(id);
            if (nodeInfo && nodeInfo.sourceNode) {
                try { nodeInfo.sourceNode.stop(); } catch (e) { }
                try { nodeInfo.sourceNode.disconnect(); } catch (e) { }
                try { nodeInfo.gainNode.disconnect(); } catch (e) { }
            }
            activeAudioNodes.delete(id);
            activeAudioOverlays.delete(id);
        }
    }
}

function stopAllOverlayAudio() {
    for (const id of activeAudioOverlays) {
        const nodeInfo = activeAudioNodes.get(id);
        if (nodeInfo && nodeInfo.sourceNode) {
            try { nodeInfo.sourceNode.stop(); } catch (e) { }
            try { nodeInfo.sourceNode.disconnect(); } catch (e) { }
            try { nodeInfo.gainNode.disconnect(); } catch (e) { }
        }
        activeAudioNodes.delete(id);
    }
    activeAudioOverlays.clear();
}