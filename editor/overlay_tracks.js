'use strict';

function generateOverlayId() {
    return ++overlayIdCounter;
}

function addTrack() {
    const id = generateOverlayId();
    overlayTracks.push({
        id,
        name: `Track ${overlayTracks.length + 1}`,
        items: [],
        isNew: true
    });
    renderOverlayTracks();
    showToast('🎞️', `Added overlay track`);
}

function removeTrack(trackId) {
    overlayTracks = overlayTracks.filter(t => t.id !== trackId);
    renderOverlayTracks();
    renderOverlayPreview(currentAppTime);
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

function addTextOverlay(trackId, startTime = null) {
    const track = getTrack(trackId);
    if (!track) return;
    const start = startTime !== null ? startTime : (currentAppTime || 0);
    const item = {
        id: generateOverlayId(), type: 'text', start: start,
        duration: 3, content: 'Text', fontSize: 32,
        color: '#ffffff', x: 50, y: 50, opacity: 100
    };
    track.items.push(item);

    updateTimelineDuration();
    if (timelineDuration > 0) {
        const targetTime = Math.min(start + 0.001, timelineDuration);
        seekTo(targetTime);
    }
    renderOverlayTracks();
    renderOverlayPreview(currentAppTime);
    openOverlayEditor(trackId, item.id, true);
}

function addImageOverlay(trackId, startTime = null) {
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
                const start = startTime !== null ? startTime : (currentAppTime || 0);
                const item = {
                    id, type: 'image', start: start,
                    duration: 5, imageSrc: ev.target.result,
                    imageWidth: 20, imageHeight: 0,
                    x: 50, y: 50, opacity: 100
                };
                const videoAspect = (videoPlayer.videoWidth && videoPlayer.videoHeight) ?
                    (videoPlayer.videoWidth / videoPlayer.videoHeight) : (16 / 9);
                item.imageHeight = (img.naturalHeight / img.naturalWidth) * item.imageWidth * videoAspect;
                track.items.push(item);
                overlayImageCache[id] = img;

                updateTimelineDuration();
                if (timelineDuration > 0) {
                    const targetTime = Math.min(start + 0.001, timelineDuration);
                    seekTo(targetTime);
                }
                renderOverlayTracks();
                renderOverlayPreview(currentAppTime);
                showToast('🖼️', 'Image overlay added');
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

function addAudioOverlay(trackId, startTime = null) {
    const track = getTrack(trackId);
    if (!track) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/mp3,audio/mpeg,audio/wav,audio/ogg,audio/aac,audio/webm,audio/flac,audio/mp4,audio/x-m4a,audio/*';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const audio = new Audio();
            audio.src = ev.target.result;
            audio.addEventListener('loadedmetadata', () => {
                const id = generateOverlayId();
                const start = startTime !== null ? startTime : (currentAppTime || 0);
                const audioDuration = isFinite(audio.duration) ? audio.duration : 5;
                const item = {
                    id, type: 'audio', start: start,
                    duration: audioDuration, audioSrc: ev.target.result,
                    audioName: file.name.replace(/\.[^/.]+$/, ''),
                    volume: 100, opacity: 100
                };
                track.items.push(item);
                overlayAudioCache[id] = audio;

                ensureAudioContextReady();
                loadAudioBuffer(id, ev.target.result);
                updateTimelineDuration();

                if (timelineDuration > 0) {
                    const targetTime = Math.min(start + 0.001, timelineDuration);
                    seekTo(targetTime);
                }
                renderOverlayTracks();
                renderOverlayPreview(currentAppTime);
                showToast('🎵', 'Audio overlay added');
            });
            audio.addEventListener('error', () => {
                showToast('❌', 'Failed to load audio file');
            });
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

function addVideoOverlay(trackId, startTime = null) {
    const track = getTrack(trackId);
    if (!track) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/mp4,video/webm,video/ogg,video/*';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const fileUrl = URL.createObjectURL(file);
        const vid = document.createElement('video');
        vid.src = fileUrl;
        vid.muted = true;
        vid.playsInline = true;
        vid.onloadedmetadata = () => {
            const id = generateOverlayId();
            const start = startTime !== null ? startTime : (currentAppTime || 0);
            const dur = isFinite(vid.duration) ? vid.duration : 5;
            const item = {
                id, type: 'video', start: start,
                duration: dur, videoSrc: fileUrl,
                videoName: file.name.replace(/\.[^/.]+$/, ''),
                videoWidth: 30, imageHeight: 0,
                imageWidth: 30,
                videoOffset: 0, volume: 100,
                x: 50, y: 50, opacity: 100
            };
            const videoAspect = (videoPlayer.videoWidth && videoPlayer.videoHeight) ?
                (videoPlayer.videoWidth / videoPlayer.videoHeight) : (16 / 9);
            item.imageHeight = (vid.videoHeight / vid.videoWidth) * item.imageWidth * videoAspect;

            track.items.push(item);
            overlayVideoCache[id] = vid;

            ensureAudioContextReady();
            loadAudioBuffer(id, fileUrl);

            updateTimelineDuration();
            if (timelineDuration > 0) {
                const targetTime = Math.min(start + 0.001, timelineDuration);
                seekTo(targetTime);
            }
            renderOverlayTracks();
            renderOverlayPreview(currentAppTime);
            showToast('🎥', 'Video overlay added');
        };
        vid.onerror = () => {
            showToast('❌', 'Failed to load video file');
        };
    };
    input.click();
}

function removeOverlayItem(trackId, itemId) {
    const track = getTrack(trackId);
    if (!track) return;
    track.items = track.items.filter(i => i.id !== itemId);

    delete overlayImageCache[itemId];
    if (overlayAudioCache[itemId]) {
        overlayAudioCache[itemId].pause();
        delete overlayAudioCache[itemId];
        activeAudioOverlays.delete(itemId);
    }
    if (overlayVideoCache[itemId]) {
        overlayVideoCache[itemId].pause();
        delete overlayVideoCache[itemId];
    }

    updateTimelineDuration();
    renderOverlayTracks();
    renderOverlayPreview(currentAppTime);
}

function splitOverlayItem(trackId, itemId, splitTime) {
    const track = getTrack(trackId);
    if (!track) return;
    const item = track.items.find(i => i.id === itemId);
    if (!item) return;

    const relSplit = splitTime - item.start;
    if (relSplit <= 0.1 || relSplit >= item.duration - 0.1) {
        showToast('⚠️', 'Cannot cut too close to the edge');
        return;
    }

    const newId = generateOverlayId();
    const secondHalf = { ...item, id: newId, start: splitTime, duration: item.duration - relSplit };
    if (item.type === 'audio' || item.type === 'video') {
        const existingOffset = item.type === 'video' ?
            (item.videoOffset || 0) : (item.audioOffset || 0);
        if (item.type === 'video') {
            secondHalf.videoOffset = existingOffset + relSplit;
            const vid = document.createElement('video');
            vid.src = item.videoSrc;
            vid.muted = true;
            vid.playsInline = true;
            overlayVideoCache[newId] = vid;
        } else {
            secondHalf.audioOffset = existingOffset + relSplit;
            const audio = new Audio();
            audio.src = item.audioSrc;
            overlayAudioCache[newId] = audio;
        }
        if (overlayAudioBuffers[item.id]) {
            overlayAudioBuffers[newId] = overlayAudioBuffers[item.id];
        } else {
            loadAudioBuffer(newId, item.audioSrc || item.videoSrc);
        }
    }

    if (item.type === 'image' && overlayImageCache[item.id]) {
        const img = new Image();
        img.src = item.imageSrc;
        overlayImageCache[newId] = img;
    }

    item.duration = relSplit;
    const idx = track.items.indexOf(item);
    track.items.splice(idx + 1, 0, secondHalf);

    updateTimelineDuration();
    renderOverlayTracks();
    renderOverlayPreview(currentAppTime);
    showToast('✂️', `Cut overlay at ${formatTimePrecise(splitTime)}`);
}

function renderOverlayTracks() {
    overlayTracksContainer.innerHTML = '';
    if (overlayTracks.length === 0) return;
    overlayTracks.forEach((track, trackIdx) => {
        const row = document.createElement('div');
        row.className = 'overlay-track-row';

        if (track.isNew) {
            row.classList.add('animate-in');
            track.isNew = false;
        }

        row.dataset.trackId = track.id;

        const sidebar = document.createElement('div');
        sidebar.className = 'overlay-track-sidebar';

        const label = document.createElement('div');
        label.className = 'overlay-track-label';
        label.textContent = track.name;
        sidebar.appendChild(label);

        const btns = document.createElement('div');
        btns.className = 'overlay-track-btns';

        const textBtn = document.createElement('button');
        textBtn.className = 'overlay-track-btn';
        textBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 4v3h5.5v12h3V7H19V4H5z"/></svg> Text';
        textBtn.addEventListener('click', () => addTextOverlay(track.id));
        btns.appendChild(textBtn);
        const imgBtn = document.createElement('button');
        imgBtn.className = 'overlay-track-btn';
        imgBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg> Image';
        imgBtn.addEventListener('click', () => addImageOverlay(track.id));
        btns.appendChild(imgBtn);

        const audioBtn = document.createElement('button');
        audioBtn.className = 'overlay-track-btn';
        audioBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg> Audio';
        audioBtn.addEventListener('click', () => addAudioOverlay(track.id));
        btns.appendChild(audioBtn);

        const videoBtn = document.createElement('button');
        videoBtn.className = 'overlay-track-btn';
        videoBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg> Video';
        videoBtn.addEventListener('click', () => addVideoOverlay(track.id));
        btns.appendChild(videoBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'overlay-track-btn btn-delete-track';
        delBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
        delBtn.title = 'Delete track';
        delBtn.addEventListener('click', () => {
            if (track.items.length === 0) {
                removeTrack(track.id);
            } else if (confirm(`Delete "${track.name}" and all its overlays?`)) {
                removeTrack(track.id);
            }
        });
        btns.appendChild(delBtn);

        sidebar.appendChild(btns);
        row.appendChild(sidebar);

        const lane = document.createElement('div');
        lane.className = 'overlay-track-lane';
        lane.dataset.trackId = track.id;

        const lanePH = document.createElement('div');
        lanePH.className = 'lane-playhead';
        if (timelineDuration > 0) {
            lanePH.style.left = ((currentAppTime / timelineDuration) * 100) + '%';
        }
        lane.appendChild(lanePH);

        if (track.items.length === 0) {
            const placeholder = document.createElement('div');
            placeholder.className = 'overlay-track-placeholder';
            placeholder.textContent = 'Add Text, Image, Audio, or Video';
            lane.appendChild(placeholder);
        }

        lane.addEventListener('click', (e) => {
            if (e.target.closest('.overlay-item')) return;

            e.stopPropagation();
            const menu = document.getElementById('inlineTrackMenu');
            if (!menu) return;

            const rect = lane.getBoundingClientRect();
            const clickX = e.clientX;

            const pct = Math.max(0, Math.min(1, (clickX - rect.left) / rect.width));
            const clickTime = pct * timelineDuration;

            if (timelineDuration > 0) {
                seekTo(clickTime);
                const displayPct = (clickTime / timelineDuration) * 100;

                timelinePlayhead.style.left = displayPct + '%';
                progressFilled.style.width = displayPct + '%';
                updateTimeDisplay();
            }

            menu.style.left = clickX + 'px';
            menu.style.top = (rect.top + window.scrollY - menu.offsetHeight - 5) + 'px';

            menu.style.display = 'flex';

            const txtBtn = document.getElementById('inlineTextBtn');
            const imgBtn = document.getElementById('inlineImageBtn');
            const audBtn = document.getElementById('inlineAudioBtn');
            const vidBtn = document.getElementById('inlineVideoBtn');

            const newTextBtn = txtBtn.cloneNode(true);
            const newImgBtn = imgBtn.cloneNode(true);
            const newAudBtn = audBtn.cloneNode(true);
            const newVidBtn = vidBtn.cloneNode(true);

            txtBtn.parentNode.replaceChild(newTextBtn, txtBtn);
            imgBtn.parentNode.replaceChild(newImgBtn, imgBtn);
            audBtn.parentNode.replaceChild(newAudBtn, audBtn);
            vidBtn.parentNode.replaceChild(newVidBtn, vidBtn);
            newTextBtn.addEventListener('click', () => { menu.style.display = 'none'; addTextOverlay(track.id, clickTime); });
            newImgBtn.addEventListener('click', () => { menu.style.display = 'none'; addImageOverlay(track.id, clickTime); });
            newAudBtn.addEventListener('click', () => { menu.style.display = 'none'; addAudioOverlay(track.id, clickTime); });
            newVidBtn.addEventListener('click', () => { menu.style.display = 'none'; addVideoOverlay(track.id, clickTime); });
        });

        track.items.forEach(item => {
            const el = document.createElement('div');
            let itemTypeClass = 'overlay-item-text';
            if (item.type === 'image') itemTypeClass = 'overlay-item-image';
            else if (item.type === 'audio') itemTypeClass = 'overlay-item-audio';
            else if (item.type === 'video') itemTypeClass = 'overlay-item-video';

            el.className = 'overlay-item ' + itemTypeClass;
            el.dataset.itemId = item.id;
            el.dataset.trackId = track.id;

            if (timelineDuration > 0) {
                const leftPct = (item.start / timelineDuration) * 100;
                const widthPct = (item.duration / timelineDuration) * 100;
                el.style.left = leftPct + '%';
                el.style.width = Math.max(widthPct, 0.5) + '%';
            }

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
            } else if (item.type === 'audio') {
                const icon = document.createElement('span');
                icon.className = 'audio-icon';
                icon.textContent = '🎵';
                el.appendChild(icon);
                const nameSpan = document.createElement('span');
                nameSpan.textContent = item.audioName || 'Audio';
                nameSpan.style.pointerEvents = 'none';
                el.appendChild(nameSpan);
            } else if (item.type === 'video') {
                const icon = document.createElement('span');
                icon.className = 'video-icon';
                icon.textContent = '🎥';
                el.appendChild(icon);
                const nameSpan = document.createElement('span');
                nameSpan.textContent = item.videoName || 'Video';
                nameSpan.style.pointerEvents = 'none';
                el.appendChild(nameSpan);
            }

            const delBtn = document.createElement('button');
            delBtn.className = 'overlay-item-delete';
            delBtn.textContent = '×';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                saveUndoState();
                removeOverlayItem(track.id, item.id);
            });
            el.appendChild(delBtn);

            const resizeL = document.createElement('div');
            resizeL.className = 'overlay-resize-handle overlay-resize-handle-left';
            resizeL.addEventListener('mousedown', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (typeof startOverlayResize === 'function') startOverlayResize(e, track.id, item.id, lane, 'left');
            });
            el.appendChild(resizeL);

            const resizeR = document.createElement('div');
            resizeR.className = 'overlay-resize-handle overlay-resize-handle-right';
            resizeR.addEventListener('mousedown', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (typeof startOverlayResize === 'function') startOverlayResize(e, track.id, item.id, lane, 'right');
            });
            el.appendChild(resizeR);

            if (item.type === 'text') {
                el.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    openOverlayEditor(track.id, item.id);
                });
            }

            let overlayMouseDownX = 0;
            let overlayMouseDownY = 0;
            el.addEventListener('mousedown', (e) => {
                if (e.target.classList.contains('overlay-item-delete') || e.target.classList.contains('overlay-resize-handle')) return;
                e.preventDefault(); e.stopPropagation();

                overlayMouseDownX = e.clientX;
                overlayMouseDownY = e.clientY;

                if (timelineDuration > 0) {
                    const rect = lane.getBoundingClientRect();
                    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    seekTo(pct * timelineDuration);
                }

                if (typeof startOverlayDrag === 'function') startOverlayDrag(e, track.id, item.id, lane);
            });
            el.addEventListener('mouseup', (e) => {
                if (e.target.classList.contains('overlay-item-delete') || e.target.classList.contains('overlay-resize-handle')) return;
                const dx = Math.abs(e.clientX - overlayMouseDownX);
                const dy = Math.abs(e.clientY - overlayMouseDownY);

                if (dx < 5 && dy < 5) {
                    e.stopPropagation();

                    if (typeof draggingOverlayItem !== 'undefined' && draggingOverlayItem) {
                        draggingOverlayItem = null;
                        document.body.style.cursor = '';
                        document.body.style.userSelect = '';
                    }

                    const rect = lane.getBoundingClientRect();
                    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    const clickTime = pct * timelineDuration;

                    const addMenu = document.getElementById('inlineTrackMenu');
                    if (addMenu) addMenu.style.display = 'none';
                    showInlineCutMenu(e.clientX, rect, {
                        type: 'overlay',
                        trackId: track.id,
                        itemId: item.id,
                        time: clickTime
                    });
                }
            });
            el.addEventListener('touchstart', (e) => {
                if (e.target.classList.contains('overlay-item-delete') || e.target.classList.contains('overlay-resize-handle')) return;
                e.stopPropagation();
                if (timelineDuration > 0) {
                    const rect = lane.getBoundingClientRect();
                    const clientX = e.touches[0].clientX;
                    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                    seekTo(pct * timelineDuration);
                }
                if (typeof startOverlayDrag === 'function') startOverlayDrag(e, track.id, item.id, lane);
            }, { passive: false });

            lane.appendChild(el);
        });

        row.appendChild(lane);
        overlayTracksContainer.appendChild(row);
    });
}

addTrackBtn.addEventListener('click', addTrack);