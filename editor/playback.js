'use strict';

function togglePlay() {
    if (isAppPlaying) {
        isAppPlaying = false;
        stopVirtualPlayback(); // Virtual loop manages the native node
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        playOverlay.classList.remove('hidden');
        videoToolbar.classList.remove('hidden');
    } else {
        isAppPlaying = true;
        const contentEnd = getContentEnd();

        if (currentAppTime >= contentEnd) {
            currentAppTime = 0;
        }

        ensureAudioContextReady().then(() => {
            syncOverlayAudio(currentAppTime);
        });

        startVirtualPlayback(); // Use strictly centralized virtual loop
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
        playOverlay.classList.add('hidden');
        videoToolbar.classList.add('hidden');
    }
}

function seekTo(targetTime) {
    currentAppTime = targetTime;
    updateVirtualPlayhead();
}

function startVirtualPlayback() {
    if (isVirtualPlaying) return;
    isVirtualPlaying = true;
    lastRenderTime = performance.now();
    virtualPlayInterval = requestAnimationFrame(virtualPlayLoop);
}

function stopVirtualPlayback() {
    isVirtualPlaying = false;
    if (virtualPlayInterval) cancelAnimationFrame(virtualPlayInterval);

    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
    if (!videoPlayer.paused) {
        videoPlayer.pause();
    }

    playOverlay.classList.remove('hidden');
    stopAllOverlayAudio();

    for (const key in overlayVideoCache) {
        if (!overlayVideoCache[key].paused) overlayVideoCache[key].pause();
    }
}

function virtualPlayLoop(time) {
    if (!isVirtualPlaying) return;
    const deltaSec = (time - lastRenderTime) / 1000;
    lastRenderTime = time;
    currentAppTime += deltaSec;

    const contentEnd = getContentEnd();

    if (currentAppTime >= contentEnd) {
        currentAppTime = contentEnd;
        isAppPlaying = false;
        stopVirtualPlayback();
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        playOverlay.classList.remove('hidden');
    }

    updateVirtualPlayhead();
    if (isVirtualPlaying) {
        virtualPlayInterval = requestAnimationFrame(virtualPlayLoop);
    }
}

function syncOverlayVideos(currentTime, isPlaying) {
    for (const track of overlayTracks) {
        for (const item of track.items) {
            if (item.type === 'video') {
                const vid = overlayVideoCache[item.id];
                if (!vid) continue;
                const inRange = currentTime >= item.start && currentTime < item.start + item.duration;
                if (inRange) {
                    const expectedTime = (item.videoOffset || 0) + (currentTime - item.start);
                    vid.volume = (item.volume != null ? item.volume : 100) / 100;
                    if (isPlaying) {
                        if (vid.paused) vid.play().catch(() => { });
                        if (Math.abs(vid.currentTime - expectedTime) > 0.3) {
                            vid.currentTime = expectedTime;
                        }
                    } else {
                        if (!vid.paused) vid.pause();
                        if (Math.abs(vid.currentTime - expectedTime) > 0.1) {
                            vid.currentTime = expectedTime;
                        }
                    }
                } else {
                    if (!vid.paused) vid.pause();
                }
            }
        }
    }
}

function updateVirtualPlayhead() {
    if (timelineDuration > 0) {
        const pct = (currentAppTime / timelineDuration) * 100;
        progressFilled.style.width = pct + '%';
        timelinePlayhead.style.left = pct + '%';

        let isRemoved = true;
        let targetVideoTime = currentAppTime;

        const segments = getSegments();
        for (const seg of segments) {
            if (!seg.removed && currentAppTime >= seg.start && currentAppTime <= seg.end) {
                isRemoved = false;
                targetVideoTime = seg.videoStart + (currentAppTime - seg.start);
                break;
            }
        }

        if (isRemoved || currentAppTime > timelineDuration) {
            videoPlayer.style.opacity = '0';
            videoPlayer.volume = 0;
            if (!videoPlayer.paused) videoPlayer.pause();
        } else {
            videoPlayer.style.opacity = '1';
            videoPlayer.volume = parseFloat(volumeSlider.value);

            if (isVirtualPlaying) {
                if (Math.abs(videoPlayer.currentTime - targetVideoTime) > 0.2) {
                    videoPlayer.currentTime = targetVideoTime;
                }
                if (videoPlayer.paused) videoPlayer.play().catch(() => { });
            } else {
                if (Math.abs(videoPlayer.currentTime - targetVideoTime) > 0.05) {
                    videoPlayer.currentTime = targetVideoTime;
                }
                if (!videoPlayer.paused) videoPlayer.pause();
            }
        }

        renderOverlayPreview(currentAppTime);
        updateLanePlayheads(pct);
        syncOverlayAudio(currentAppTime);
        syncOverlayVideos(currentAppTime, isVirtualPlaying);
    }
    updateTimeDisplay();
}

function getTimeFromPointer(e) {
    const rect = timeline.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return pct * timelineDuration;
}

// Muting native playback loops completely - we rely entirely on the precise virtual play loop
videoPlayer.addEventListener('timeupdate', () => { });
videoPlayer.addEventListener('play', () => { });
videoPlayer.addEventListener('pause', () => { });
videoPlayer.addEventListener('ended', () => { });

// ── UI Playback Interactions ──
playOverlay.addEventListener('click', togglePlay);
playPauseBtn.addEventListener('click', togglePlay);

stopBtn.addEventListener('click', () => {
    isAppPlaying = false;
    stopVirtualPlayback();
    currentAppTime = 0;
    updateVirtualPlayhead();
});

progressContainer.addEventListener('click', (e) => {
    const rect = progressContainer.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    seekTo(pct * timelineDuration);
});

timelinePlayhead.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingPlayhead = true;
    wasPlayingBeforeDrag = isAppPlaying;
    isAppPlaying = false;
    stopVirtualPlayback();
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
});

timelinePlayhead.addEventListener('touchstart', (e) => {
    e.stopPropagation();
    isDraggingPlayhead = true;
    wasPlayingBeforeDrag = isAppPlaying;
    isAppPlaying = false;
    stopVirtualPlayback();
}, { passive: true });

document.addEventListener('mousemove', (e) => {
    if (!isDraggingPlayhead) return;
    seekTo(getTimeFromPointer(e));
});

document.addEventListener('touchmove', (e) => {
    if (!isDraggingPlayhead) return;
    seekTo(getTimeFromPointer(e));
}, { passive: true });

document.addEventListener('mouseup', () => {
    if (!isDraggingPlayhead) return;
    isDraggingPlayhead = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    videoToolbar.classList.remove('hidden');
    if (wasPlayingBeforeDrag) togglePlay();
});

document.addEventListener('touchend', () => {
    if (!isDraggingPlayhead) return;
    isDraggingPlayhead = false;
    videoToolbar.classList.remove('hidden');
    if (wasPlayingBeforeDrag) togglePlay();
});

timeline.addEventListener('click', (e) => {
    if (isDraggingPlayhead) return;
    const rect = timeline.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(pct * timelineDuration);
    videoToolbar.classList.remove('hidden');
});

// ── Volume & Sizing ──
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

videoSizeSlider.addEventListener('input', () => {
    videoWrapper.style.width = videoSizeSlider.value + '%';
});

videoSizeSlider.addEventListener('change', () => {
    resizeOverlayCanvas();
    renderOverlayPreview(currentAppTime);
});