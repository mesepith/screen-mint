'use strict';

function updateLanePlayheads(pct) {
    const playheads = overlayTracksContainer.querySelectorAll('.lane-playhead');
    playheads.forEach(ph => {
        ph.style.left = pct + '%';
    });
}

function startOverlayDrag(e, trackId, itemId, laneEl) {
    const item = getOverlayItem(trackId, itemId);
    if (!item || timelineDuration <= 0) return;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const rect = laneEl.getBoundingClientRect();
    const startPct = (clientX - rect.left) / rect.width;
    const startTime = item.start;
    draggingOverlayItem = { trackId, itemId, startPct, startTime, rect };
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
}

function startOverlayResize(e, trackId, itemId, laneEl, edge) {
    const item = getOverlayItem(trackId, itemId);
    if (!item || timelineDuration <= 0) return;

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

function renderInteractionBoxes(activeItems, layerW, layerH) {
    const isDragging = !!interactionDrag;
    const skipRebuild = isDragging || toolbarInteracting;

    if (!skipRebuild) {
        overlayInteractionLayer.innerHTML = '';
        if (activeItems.length === 0) {
            if (videoPlayer.paused) playOverlay.classList.remove('hidden');
            return;
        }
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
            itemW = measuredWidth + 20;
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

            box.addEventListener('click', (e) => e.stopPropagation());
            box.addEventListener('mousedown', (e) => {
                if (!selectedOverlayItem || selectedOverlayItem.trackId !== trackId || selectedOverlayItem.itemId !== item.id) {
                    selectedOverlayItem = { trackId, itemId: item.id };
                    renderOverlayPreview(videoPlayer.currentTime);
                }

                if (e.target.classList.contains('overlay-corner-handle')) return;
                e.preventDefault(); e.stopPropagation();

                interactionDrag = {
                    trackId, itemId: item.id, type: 'move',
                    startX: e.clientX, startY: e.clientY,
                    origX: item.x, origY: item.y,
                    layerW, layerH
                };
                document.body.style.cursor = 'move';
                document.body.style.userSelect = 'none';
            });

            ['tl', 'tr', 'bl', 'br'].forEach(corner => {
                const handle = document.createElement('div');
                handle.className = `overlay-corner-handle ${corner}`;
                handle.addEventListener('mousedown', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    interactionDrag = {
                        trackId, itemId: item.id, type: 'corner', corner,
                        startX: e.clientX, startY: e.clientY,
                        origW: itemW, origH: itemH,
                        origImageW: item.imageWidth, origFontSize: item.fontSize,
                        origX: item.x, origY: item.y, layerW, layerH,
                        aspectRatio: item.type === 'image' ? (item.imageHeight / item.imageWidth) : (itemH / itemW)
                    };
                    document.body.style.cursor = handle.style.cursor || 'nwse-resize';
                    document.body.style.userSelect = 'none';
                });
                box.appendChild(handle);
            });

            const toolbar = document.createElement('div');
            toolbar.className = 'overlay-toolbar';
            toolbar.addEventListener('mousedown', (e) => e.stopPropagation());
            toolbar.addEventListener('click', (e) => e.stopPropagation());

            const transparencyBtn = document.createElement('button');
            transparencyBtn.className = 'overlay-toolbar-btn';
            transparencyBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31A7.903 7.903 0 0 1 12 20z"/></svg> Opacity`;
            transparencyBtn.title = 'Adjust transparency';

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

// ── Global Mouse Handlers for Interacting ──

document.addEventListener('mousemove', (e) => {
    // Handling Drag Items on Timeline
    if (draggingOverlayItem) {
        const item = getOverlayItem(draggingOverlayItem.trackId, draggingOverlayItem.itemId);
        if (!item) { draggingOverlayItem = null; return; }

        const rect = draggingOverlayItem.rect;
        const currentPct = (e.clientX - rect.left) / rect.width;
        const deltaPct = currentPct - draggingOverlayItem.startPct;
        let newStart = draggingOverlayItem.startTime + deltaPct * timelineDuration;

        newStart = Math.max(0, newStart);
        item.start = newStart;

        const oldDuration = timelineDuration;
        updateTimelineDuration();

        if (oldDuration !== timelineDuration) {
            renderOverlayTracks();
        } else {
            const lane = document.querySelector(`.overlay-track-lane[data-track-id="${draggingOverlayItem.trackId}"]`);
            if (lane) {
                const el = lane.querySelector(`[data-item-id="${draggingOverlayItem.itemId}"]`);
                if (el) el.style.left = ((item.start / timelineDuration) * 100) + '%';
            }
        }
        renderOverlayPreview(currentAppTime);
    }

    // Handling Resize Handles on Timeline
    if (resizingOverlayItem) {
        const item = getOverlayItem(resizingOverlayItem.trackId, resizingOverlayItem.itemId);
        if (!item) { resizingOverlayItem = null; return; }

        const deltaX = e.clientX - resizingOverlayItem.startX;
        const deltaTime = (deltaX / resizingOverlayItem.laneWidth) * timelineDuration;
        const minDuration = 0.2;

        if (resizingOverlayItem.edge === 'right') {
            let newDuration = resizingOverlayItem.origDuration + deltaTime;
            newDuration = Math.max(minDuration, newDuration);
            item.duration = newDuration;
        } else {
            const origEnd = resizingOverlayItem.origStart + resizingOverlayItem.origDuration;
            let newStart = resizingOverlayItem.origStart + deltaTime;
            newStart = Math.max(0, Math.min(origEnd - minDuration, newStart));
            item.start = newStart;
            item.duration = origEnd - newStart;
        }

        const oldDuration = timelineDuration;
        updateTimelineDuration();

        if (oldDuration !== timelineDuration) {
            renderOverlayTracks();
        } else {
            const lane = document.querySelector(`.overlay-track-lane[data-track-id="${resizingOverlayItem.trackId}"]`);
            if (lane) {
                const el = lane.querySelector(`[data-item-id="${resizingOverlayItem.itemId}"]`);
                if (el) {
                    el.style.left = ((item.start / timelineDuration) * 100) + '%';
                    el.style.width = Math.max(((item.duration / timelineDuration) * 100), 0.5) + '%';
                }
            }
        }
        renderOverlayPreview(currentAppTime);
    }

    // Handling Canvas Interaction Drag (Video Player Area)
    if (interactionDrag) {
        const item = getOverlayItem(interactionDrag.trackId, interactionDrag.itemId);
        if (!item) { interactionDrag = null; return; }

        const dx = e.clientX - interactionDrag.startX;
        const dy = e.clientY - interactionDrag.startY;

        if (interactionDrag.type === 'move') {
            const dxPct = (dx / interactionDrag.layerW) * 100;
            const dyPct = (dy / interactionDrag.layerH) * 100;
            item.x = Math.max(0, Math.min(100, interactionDrag.origX + dxPct));
            item.y = Math.max(0, Math.min(100, interactionDrag.origY + dyPct));
        } else {
            const corner = interactionDrag.corner;
            let newWidthPx = interactionDrag.origW;

            if (corner === 'tr' || corner === 'br') {
                newWidthPx += dx;
            } else if (corner === 'tl' || corner === 'bl') {
                newWidthPx -= dx;
            }

            const scale = Math.max(0.05, newWidthPx / interactionDrag.origW);
            if (item.type === 'image') {
                item.imageWidth = interactionDrag.origImageW * scale;
                item.imageHeight = interactionDrag.origImageW * scale * interactionDrag.aspectRatio;
            } else if (item.type === 'text') {
                item.fontSize = interactionDrag.origFontSize * scale;
            }
        }
        renderOverlayPreview(videoPlayer.currentTime);
    }
});

document.addEventListener('mouseup', () => {
    let rebuild = false;
    if (draggingOverlayItem) { draggingOverlayItem = null; rebuild = true; }
    if (resizingOverlayItem) { resizingOverlayItem = null; rebuild = true; }

    if (rebuild) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        updateTimelineDuration();
        renderOverlayTracks();
    }

    if (toolbarInteracting) toolbarInteracting = false;

    if (interactionDrag) {
        const item = getOverlayItem(interactionDrag.trackId, interactionDrag.itemId);
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

document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.overlay-img-box') && !e.target.closest('.overlay-corner-handle') && selectedOverlayItem) {
        selectedOverlayItem = null;
        renderOverlayPreview(videoPlayer.currentTime);
    }
});