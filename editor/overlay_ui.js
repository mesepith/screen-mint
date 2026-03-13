'use strict';

function showInlineCutMenu(clientX, anchorRect, cutAction) {
    const cutMenu = document.getElementById('inlineCutMenu');
    if (!cutMenu) return;

    pendingCutAction = cutAction;
    cutMenu.style.display = 'flex';
    cutMenu.style.left = clientX + 'px';
    cutMenu.style.top = (anchorRect.top + window.scrollY - cutMenu.offsetHeight - 8) + 'px';

    const cutBtn = document.getElementById('inlineCutBtn');
    const newCutBtn = cutBtn.cloneNode(true);
    cutBtn.parentNode.replaceChild(newCutBtn, cutBtn);

    newCutBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cutMenu.style.display = 'none';
        if (!pendingCutAction) return;

        if (pendingCutAction.type === 'overlay') {
            saveUndoState();
            splitOverlayItem(pendingCutAction.trackId, pendingCutAction.itemId, pendingCutAction.time);
        } else if (pendingCutAction.type === 'timeline') {
            addSplit(pendingCutAction.time);
        }
        pendingCutAction = null;
    });

    const delBtn = document.getElementById('inlineDeleteBtn');
    const newDelBtn = delBtn.cloneNode(true);
    delBtn.parentNode.replaceChild(newDelBtn, delBtn);

    newDelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cutMenu.style.display = 'none';
        if (!pendingCutAction) return;

        if (pendingCutAction.type === 'overlay') {
            saveUndoState();
            removeOverlayItem(pendingCutAction.trackId, pendingCutAction.itemId);
        } else if (pendingCutAction.type === 'timeline') {
            const segments = getSegments();
            let segIdx = segments.length - 1;
            for (let i = 0; i < segments.length; i++) {
                if (pendingCutAction.time >= segments[i].start && pendingCutAction.time <= segments[i].end) {
                    segIdx = i;
                    break;
                }
            }
            saveUndoState();
            removedFlags[segIdx] = true;
            const seg = segments[segIdx];
            showToast('🗑️', `Removed ${formatTimePrecise(seg.start)} → ${formatTimePrecise(seg.end)}`);

            if (currentAppTime >= seg.start && currentAppTime < seg.end) {
                currentAppTime = seg.end;
                updateVirtualPlayhead();
            }
            selectedSegIdx = null;
            updateTimelineDuration();
            drawWaveform();
            renderTimeline();
            updateControls();
        }
        pendingCutAction = null;
    });
}

function hideInlineCutMenu() {
    const cutMenu = document.getElementById('inlineCutMenu');
    if (cutMenu) cutMenu.style.display = 'none';
    pendingCutAction = null;
}

function openOverlayEditor(trackId, itemId, isNew = false) {
    const item = getOverlayItem(trackId, itemId);
    if (!item || item.type !== 'text') return;

    editingOverlay = { trackId, itemId, isNew };
    popoverText.value = item.content;
    popoverFontSize.value = item.fontSize;
    popoverColor.value = item.color;
    popoverDuration.value = item.duration;
    popoverX.value = item.x;
    popoverY.value = item.y;

    popoverBackdrop = document.createElement('div');
    popoverBackdrop.className = 'overlay-edit-backdrop';
    popoverBackdrop.addEventListener('click', closeOverlayEditor);
    document.body.appendChild(popoverBackdrop);
    document.body.appendChild(overlayEditPopover);

    overlayEditPopover.style.display = 'block';
    popoverText.focus();
}

function closeOverlayEditor(eOrCancel) {
    const isCancel = (eOrCancel instanceof Event) || (eOrCancel === true) || (eOrCancel === undefined);
    if (isCancel && editingOverlay && editingOverlay.isNew) {
        removeOverlayItem(editingOverlay.trackId, editingOverlay.itemId);
    }
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
    if (!item) { closeOverlayEditor(true); return; }

    item.content = popoverText.value || 'Text';
    item.fontSize = parseInt(popoverFontSize.value) || 32;
    item.color = popoverColor.value || '#ffffff';
    item.duration = parseFloat(popoverDuration.value) || 3;
    item.x = parseFloat(popoverX.value) || 50;
    item.y = parseFloat(popoverY.value) || 50;

    closeOverlayEditor(false);
    updateTimelineDuration();
    renderOverlayTracks();
    renderOverlayPreview(currentAppTime);
    showToast('✅', 'Overlay updated');
}

popoverClose.addEventListener('click', closeOverlayEditor);
popoverSave.addEventListener('click', saveOverlayEditor);