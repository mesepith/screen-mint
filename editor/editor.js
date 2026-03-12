'use strict';

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

    timelineDuration = videoDuration;
    currentAppTime = 0;
    removedFlags = [false];

    const wrapper = videoPlayer.parentElement;
    if (wrapper && videoPlayer.videoWidth && videoPlayer.videoHeight) {
        wrapper.style.aspectRatio = `${videoPlayer.videoWidth} / ${videoPlayer.videoHeight}`;
        resizeOverlayCanvas();
    }

    updateTimelineDuration();
    updateTimeDisplay();
    drawWaveform();
    updateTimelineLabels();
    renderTimeline();
    renderOverlayTracks();

    recordingInfo.textContent = formatDuration(videoDuration) + ' recorded';
    loadingScreen.classList.add('hidden');
    showToast('✅', 'Recording loaded successfully!');

    setTimeout(() => {
        generateThumbnails(videoBlob);
    }, 500);
}

async function generateThumbnails(blob) {
    if (!blob) return;
    const tempVideo = document.createElement('video');
    tempVideo.src = URL.createObjectURL(blob);
    tempVideo.muted = true;
    tempVideo.playsInline = true;

    await new Promise(resolve => {
        tempVideo.onloadedmetadata = () => resolve();
    });

    if (!isFinite(tempVideo.duration)) {
        tempVideo.currentTime = 1e10;
        await new Promise(resolve => {
            tempVideo.onseeked = () => {
                tempVideo.currentTime = 0;
                resolve();
            };
        });
        await new Promise(resolve => {
            tempVideo.onseeked = () => resolve();
        });
    }

    const duration = tempVideo.duration;
    if (!isFinite(duration) || duration <= 0) {
        URL.revokeObjectURL(tempVideo.src);
        return;
    }

    const totalThumbnails = Math.min(60, Math.ceil(duration));
    const interval = duration / totalThumbnails;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const targetHeight = 60;
    const aspect = tempVideo.videoWidth / tempVideo.videoHeight || 16 / 9;
    canvas.height = targetHeight;
    canvas.width = targetHeight * aspect;

    videoThumbnails = [];

    for (let i = 0; i < totalThumbnails; i++) {
        const time = i * interval;
        if (isFinite(time)) {
            tempVideo.currentTime = time;
            await new Promise(resolve => {
                tempVideo.onseeked = () => resolve();
            });
            ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
            try {
                const bitmap = await createImageBitmap(canvas);
                videoThumbnails.push({ time, bitmap });
            } catch (e) {
                console.error("Failed to create thumbnail bitmap", e);
            }
        }
    }

    drawWaveform();
    URL.revokeObjectURL(tempVideo.src);
}

// ── Global Event Listeners ──

window.addEventListener('resize', () => {
    if (videoDuration > 0) {
        drawWaveform();
        renderTimeline();
        renderOverlayTracks();
        resizeOverlayCanvas();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

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
        case 's':
            addSplit(videoPlayer.currentTime);
            break;
        case 'Delete':
        case 'Backspace':
            if (selectedSegIdx !== null && !removedFlags[selectedSegIdx]) {
                removeSectionBtn.click();
            }
            break;
        case 'Escape':
            const menu = document.getElementById('inlineTrackMenu');
            if (menu && menu.style.display !== 'none') {
                menu.style.display = 'none';
            }
            if (selectedSegIdx !== null) {
                deselectBtn.click();
            }
            break;
    }
});

document.addEventListener('click', (e) => {
    if (isAppPlaying) {
        if (!e.target.closest('.controls-bar') && !e.target.closest('.video-toolbar')) {
            isAppPlaying = false;
            videoPlayer.pause();
            stopVirtualPlayback();
        }
    }

    const menu = document.getElementById('inlineTrackMenu');
    if (menu && menu.style.display !== 'none') {
        if (menu.contains(e.target)) return;
        const clickedLane = e.target.closest('.overlay-track-lane');
        if (clickedLane) return;
        menu.style.display = 'none';
    }

    const cutMenu = document.getElementById('inlineCutMenu');
    if (cutMenu && cutMenu.style.display !== 'none') {
        if (cutMenu.contains(e.target)) return;
        if (e.target.closest('.overlay-item') || e.target.closest('.segment-overlay')) return;
        cutMenu.style.display = 'none';
        pendingCutAction = null;
    }
});

videoPlayer.addEventListener('loadeddata', resizeOverlayCanvas);

// Jumpstart the App!
init();