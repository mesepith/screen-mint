// ========== ./editor/playback.js ==========
'use strict';

function togglePlay() {
    if (isAppPlaying) {
        isAppPlaying = false;
        videoPlayer.pause();
        stopVirtualPlayback();
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        playOverlay.classList.remove('hidden');
    } else {
        isAppPlaying = true;
        if (currentAppTime >= timelineDuration) {
            currentAppTime = 0;
            videoPlayer.currentTime = 0;
        }

        ensureAudioContextReady().then(() => {
            syncOverlayAudio(currentAppTime);
        });

        const effectiveVideoEnd = getEffectiveVideoEnd();
        if (currentAppTime < effectiveVideoEnd) {
            stopVirtualPlayback();
            videoPlayer.play();
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'block';
            playOverlay.classList.add('hidden');
            videoToolbar.classList.add('hidden');
        } else {
            videoPlayer.pause();
            startVirtualPlayback();
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'block';
            playOverlay.classList.add('hidden');
            videoToolbar.classList.add('hidden');
        }
    }
}

function seekTo(targetTime) {
    currentAppTime = targetTime;
    const effectiveVideoEnd = getEffectiveVideoEnd();

    if (currentAppTime < effectiveVideoEnd) {
        videoPlayer.currentTime = timelineToVideoTime(currentAppTime);
        if (isAppPlaying) {
            videoPlayer.play();
            stopVirtualPlayback();
        } else {
            videoPlayer.pause();
            stopVirtualPlayback();
        }
    } else {
        videoPlayer.currentTime = timelineToVideoTime(effectiveVideoEnd);
        videoPlayer.pause();
        if (isAppPlaying) {
            startVirtualPlayback();
        } else {
            stopVirtualPlayback();
        }
    }
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
    if (videoPlayer.paused) {
        playOverlay.classList.remove('hidden');
    }
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
    if (currentAppTime >= timelineDuration) {
        currentAppTime = timelineDuration;
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

        let isRemoved = false;
        const segments = getSegments();
        for (const seg of segments) {
            if (seg.removed && currentAppTime >= seg.start && currentAppTime < seg.end) {
                isRemoved = true;
                break;
            }
        }

        // Hide video visually & mute original audio when inside a removed section
        if (isRemoved || currentAppTime > videoDuration) {
            videoPlayer.style.opacity = '0';
            videoPlayer.volume = 0;
        } else {
            videoPlayer.style.opacity = '1';
            videoPlayer.volume = parseFloat(volumeSlider.value);
        }

        renderOverlayPreview(currentAppTime);
        updateLanePlayheads(pct);
        syncOverlayAudio(currentAppTime);
        syncOverlayVideos(currentAppTime, isAppPlaying || isVirtualPlaying);
    }
    updateTimeDisplay();
}

function startVideoSyncLoop() {
    if (!isAppPlaying || isVirtualPlaying) return;
    if (videoDuration > 0 && !videoPlayer.paused) {
        syncOverlayAudio(videoPlayer.currentTime);
        syncOverlayVideos(videoPlayer.currentTime, true);
    }
    videoSyncRAF = requestAnimationFrame(startVideoSyncLoop);
}

function stopVideoSyncLoop() {
    if (videoSyncRAF) {
        cancelAnimationFrame(videoSyncRAF);
        videoSyncRAF = null;
    }
}

function getTimeFromPointer(e) {
    const rect = timeline.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return pct * timelineDuration;
}

// ── Native Video Events ──
videoPlayer.addEventListener('play', () => {
    playIcon.style.display = 'none';
    pauseIcon.style.display = 'block';
    playOverlay.classList.add('hidden');
    videoToolbar.classList.add('hidden');
    startVideoSyncLoop();
});

videoPlayer.addEventListener('pause', () => {
    stopVideoSyncLoop();
    if (!isVirtualPlaying && !isAppPlaying) {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        playOverlay.classList.remove('hidden');
    }
});

videoPlayer.addEventListener('ended', () => {
    const effectiveVideoEnd = getEffectiveVideoEnd();
    if (timelineDuration > effectiveVideoEnd) {
        if (isAppPlaying) {
            startVirtualPlayback();
        }
    } else {
        isAppPlaying = false;
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        playOverlay.classList.remove('hidden');

        stopAllOverlayAudio();
    }
});

videoPlayer.addEventListener('timeupdate', () => {
    if (isVirtualPlaying || isDraggingPlayhead) return;
    if (!isAppPlaying && currentAppTime >= videoDuration) return;

    if (videoDuration > 0 && !videoPlayer.paused) {
        currentAppTime = videoToTimelineTime(videoPlayer.currentTime);

        // Ensure playback stops securely if it hits the cut end limit
        if (currentAppTime >= timelineDuration) {
            currentAppTime = timelineDuration;
            isAppPlaying = false;
            videoPlayer.pause();
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
            playOverlay.classList.remove('hidden');
            stopAllOverlayAudio();
        }

        const pct = timelineDuration > 0 ? (currentAppTime / timelineDuration) * 100 : 0;
        progressFilled.style.width = pct + '%';
        timelinePlayhead.style.left = pct + '%';

        let isRemoved = false;

        const segments = getSegments();
        for (const seg of segments) {
            if (seg.removed && currentAppTime >= seg.start && currentAppTime < seg.end) {
                isRemoved = true;
                break;
            }
        }

        if (isRemoved || currentAppTime > videoDuration) {
            videoPlayer.style.opacity = '0';
            videoPlayer.volume = 0;
        } else {
            videoPlayer.style.opacity = '1';
            videoPlayer.volume = parseFloat(volumeSlider.value);
        }

        renderOverlayPreview(currentAppTime);
        updateLanePlayheads(pct);
    }
    updateTimeDisplay();
});

// ── UI Playback Interactions ──
playOverlay.addEventListener('click', togglePlay);
playPauseBtn.addEventListener('click', togglePlay);

stopBtn.addEventListener('click', () => {
    isAppPlaying = false;
    videoPlayer.pause();
    stopVirtualPlayback();
    currentAppTime = 0;
    videoPlayer.currentTime = 0;
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
    videoPlayer.pause();
    stopVirtualPlayback();
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
});

timelinePlayhead.addEventListener('touchstart', (e) => {
    e.stopPropagation();
    isDraggingPlayhead = true;
    wasPlayingBeforeDrag = isAppPlaying;
    isAppPlaying = false;
    videoPlayer.pause();
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
    seekTo(timelineToVideoTime(pct * timelineDuration));
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
    renderOverlayPreview(videoPlayer.currentTime);
});