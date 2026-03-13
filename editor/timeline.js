// ========== ./editor/timeline.js ==========
'use strict';

function getSegments() {
    const pts = [0, ...splitPoints, videoDuration];
    return pts.slice(0, -1).map((start, i) => {
        const offset = segmentOffsets[i] || 0;
        return {
            index: i,
            videoStart: start,
            videoEnd: pts[i + 1],
            start: start + offset,
            end: pts[i + 1] + offset,
            removed: removedFlags[i] || false
        };
    });
}

function videoToTimelineTime(vTime) {
    const segments = getSegments();
    for (const seg of segments) {
        if (vTime >= seg.videoStart && vTime <= seg.videoEnd) {
            return seg.start + (vTime - seg.videoStart);
        }
    }
    return vTime || 0;
}

function timelineToVideoTime(tTime) {
    const segments = getSegments();

    // 1. Prioritize active segments
    for (const seg of segments) {
        if (!seg.removed && tTime >= seg.start && tTime <= seg.end) {
            return seg.videoStart + (tTime - seg.start);
        }
    }

    // 2. Fallback for empty gaps: Lock to the closest valid active frame
    let lastVTime = 0;
    for (const seg of segments) {
        if (!seg.removed) {
            if (tTime < seg.start) return seg.videoStart;
            lastVTime = seg.videoEnd;
        }
    }
    return lastVTime;
}

function getCompressedVideoDuration() {
    let maxEnd = 0;
    for (const seg of getSegments()) {
        if (!seg.removed && seg.end > maxEnd) {
            maxEnd = seg.end;
        }
    }
    return maxEnd;
}

function getEffectiveVideoEnd() {
    return getCompressedVideoDuration();
}

function getContentEnd() {
    let maxOverlayEnd = 0;
    for (const track of overlayTracks) {
        for (const item of track.items) {
            const end = item.start + item.duration;
            if (end > maxOverlayEnd) maxOverlayEnd = end;
        }
    }
    return Math.max(getEffectiveVideoEnd(), maxOverlayEnd);
}

function updateTimelineDuration() {
    let maxOverlayEnd = 0;
    for (const track of overlayTracks) {
        for (const item of track.items) {
            const end = item.start + item.duration;
            if (end > maxOverlayEnd) maxOverlayEnd = end;
        }
    }

    // FIX: Anchor baseDuration to the original videoDuration so the timeline scale doesn't violently shrink when deleting/dragging
    let baseDuration = videoDuration;
    for (const seg of getSegments()) {
        if (seg.end > baseDuration) baseDuration = seg.end;
    }

    const targetDuration = Math.max(baseDuration, maxOverlayEnd);
    let finalTarget = targetDuration;

    if (typeof draggingOverlayItem !== 'undefined' && (draggingOverlayItem || resizingOverlayItem)) {
        finalTarget = Math.max(timelineDuration, targetDuration);
    }
    if (typeof isDraggingSegment !== 'undefined' && isDraggingSegment) {
        finalTarget = Math.max(timelineDuration, targetDuration);
    }

    if (Math.abs(timelineDuration - finalTarget) > 0.001) {
        timelineDuration = finalTarget;
        const scrollContent = document.getElementById('timelineScrollContent');
        if (scrollContent) {
            const widthPct = videoDuration > 0 ? (timelineDuration / videoDuration) * 100 : 100;
            scrollContent.style.width = Math.max(100, widthPct) + '%';
        }

        updateTimelineLabels();
        drawWaveform();
        renderTimeline();
        renderOverlayTracks();
    }
}

function addSplit(time) {
    if (videoDuration <= 0) return;
    if (time < 0.3 || time > videoDuration - 0.3) {
        showToast('⚠️', 'Cannot split too close to the start or end');
        return;
    }

    for (const sp of splitPoints) {
        if (Math.abs(sp - time) < 0.3) {
            showToast('⚠️', 'A split already exists near this point');
            return;
        }
    }

    const segments = getSegments();
    let segIdx = segments.length - 1;
    for (let i = 0; i < segments.length; i++) {
        if (time >= segments[i].videoStart && time < segments[i].videoEnd) {
            segIdx = i;
            break;
        }
    }

    const seg = segments[segIdx];
    if (time - seg.videoStart < 0.3 || seg.videoEnd - time < 0.3) {
        showToast('⚠️', 'Cannot split too close to an existing split');
        return;
    }

    const wasRemoved = removedFlags[segIdx] || false;
    const currentOffset = segmentOffsets[segIdx] || 0;

    saveUndoState();

    splitPoints.push(time);
    splitPoints.sort((a, b) => a - b);
    removedFlags.splice(segIdx, 1, wasRemoved, wasRemoved);
    segmentOffsets.splice(segIdx, 1, currentOffset, currentOffset);

    selectedSegIdx = null;
    renderTimeline();
    updateControls();
    showToast('✂️', `Split at ${formatTimePrecise(time)}`);
}

function selectSegment(index) {
    selectedSegIdx = index;
    renderTimeline();
    updateControls();
}

function renderTimeline() {
    renderSegments();
    renderSplitMarkers();
}

function renderSegments() {
    timelineSegmentsLayer.innerHTML = '';
    const segments = getSegments();

    segments.forEach((seg, idx) => {
        if (seg.removed) return;

        const tStart = seg.start;
        const renderEnd = seg.end;

        const leftPct = timelineDuration > 0 ? (tStart / timelineDuration) * 100 : 0;
        const widthPct = timelineDuration > 0 ? ((renderEnd - tStart) / timelineDuration) * 100 : 0;

        const el = document.createElement('div');
        el.className = 'segment-overlay';
        if (idx === selectedSegIdx) el.classList.add('selected');
        el.style.left = leftPct + '%';
        el.style.width = widthPct + '%';

        const tooltip = document.createElement('span');
        tooltip.className = 'segment-tooltip';
        tooltip.textContent = `${formatTimePrecise(seg.start)} → ${formatTimePrecise(seg.end)} (${formatDuration(seg.end - seg.start)})`;
        el.appendChild(tooltip);

        el.addEventListener('mousedown', (e) => {
            if (isDraggingPlayhead) return;

            isDraggingSegment = {
                index: idx,
                startX: e.clientX,
                origOffset: segmentOffsets[idx] || 0,
                rect: timeline.getBoundingClientRect(),
                hasMoved: false
            };
        });

        el.addEventListener('click', (e) => {
            if (isDraggingSegment && isDraggingSegment.hasMoved) {
                e.stopPropagation();
                return;
            }
            if (isDraggingPlayhead) return;
            e.stopPropagation();

            const rect = timeline.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const clickTime = pct * timelineDuration;
            const clickTimeVideo = timelineToVideoTime(clickTime);

            seekTo(clickTime);
            videoToolbar.classList.remove('hidden');

            showInlineCutMenu(e.clientX, rect, {
                type: 'timeline',
                time: clickTimeVideo
            });

            if (splitPoints.length > 0) {
                selectSegment(idx);
            }
        });

        timelineSegmentsLayer.appendChild(el);
    });
}

// Global Handlers for Dragging Main Segments
document.addEventListener('mousemove', (e) => {
    if (isDraggingSegment) {
        const dx = e.clientX - isDraggingSegment.startX;
        if (Math.abs(dx) > 3) isDraggingSegment.hasMoved = true;

        let deltaSec = (dx / isDraggingSegment.rect.width) * timelineDuration;

        const seg = getSegments()[isDraggingSegment.index];
        const newStart = seg.videoStart + isDraggingSegment.origOffset + deltaSec;

        // Block dragging before time 0
        if (newStart < 0) {
            deltaSec = -seg.videoStart - isDraggingSegment.origOffset;
        }

        segmentOffsets[isDraggingSegment.index] = isDraggingSegment.origOffset + deltaSec;

        renderSegments();
        drawWaveform();
        updateTimelineDuration();
    }
});

document.addEventListener('mouseup', () => {
    if (isDraggingSegment) {
        isDraggingSegment = null;
        updateTimelineDuration();
    }
});

function renderSplitMarkers() {
    timelineSplitsLayer.innerHTML = '';
    splitPoints.forEach((time) => {
        const isRemovedTime = getSegments().some(s => s.removed && time > s.videoStart && time < s.videoEnd);
        if (isRemovedTime) return;

        const tTime = videoToTimelineTime(time);
        const pct = (tTime / timelineDuration) * 100;
        const marker = document.createElement('div');
        marker.className = 'split-marker';
        marker.style.left = pct + '%';
        timelineSplitsLayer.appendChild(marker);
    });
}

function updateControls() {
    const segments = getSegments();
    const hasAnySplit = splitPoints.length > 0;
    const hasAnyRemoved = removedFlags.some(f => f);
    const hasSelection = selectedSegIdx !== null;

    removeSectionBtn.style.display = hasSelection ? '' : 'none';
    deselectBtn.style.display = hasSelection ? '' : 'none';
    resetAllBtn.style.display = (hasAnySplit || hasAnyRemoved) ? '' : 'none';

    if (hasSelection) {
        const seg = segments[selectedSegIdx];
        const dur = formatDuration(seg.end - seg.start);
        editorInfo.textContent = `Selected section (${dur}) — click "Remove" to cut it out`;
    } else if (hasAnyRemoved) {
        const totalRemoved = segments.filter(s => s.removed).reduce((sum, s) => sum + (s.videoEnd - s.videoStart), 0);
        const remaining = videoDuration - totalRemoved;
        editorInfo.textContent = `${formatDuration(totalRemoved)} removed · ${formatDuration(remaining)} remaining`;
    } else if (hasAnySplit) {
        editorInfo.textContent = `${segments.length} sections — click any section to select it`;
    } else {
        editorInfo.textContent = 'Split the timeline, then click any part to remove it';
    }
}

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
    ctx.clearRect(0, 0, w, h);

    const segments = getSegments();

    if (videoThumbnails && videoThumbnails.length > 0 && w > 0) {
        const firstThumb = videoThumbnails[0];
        const aspect = firstThumb.bitmap.width / firstThumb.bitmap.height;
        const thumbHeight = h;
        const thumbWidth = thumbHeight * aspect;

        ctx.save();
        ctx.beginPath();

        // Clipping map strictly to existing active bounds
        for (const seg of segments) {
            if (!seg.removed) {
                const segStartX = timelineDuration > 0 ? (seg.start / timelineDuration) * w : 0;
                const segEndX = timelineDuration > 0 ? (seg.end / timelineDuration) * w : 0;
                ctx.rect(segStartX, 0, segEndX - segStartX, h);
            }
        }
        ctx.clip();

        for (const seg of segments) {
            if (seg.removed) continue;

            const segStartX = timelineDuration > 0 ? (seg.start / timelineDuration) * w : 0;
            const segEndX = timelineDuration > 0 ? (seg.end / timelineDuration) * w : 0;

            for (let x = segStartX; x < segEndX; x += thumbWidth) {
                const barTime = timelineDuration > 0 ? (x / w) * timelineDuration : 0;
                const vTime = timelineToVideoTime(barTime);

                let drawWidth = thumbWidth;
                if (x + thumbWidth > segEndX) drawWidth = segEndX - x;

                let closestThumb = videoThumbnails[0];
                let minDiff = Infinity;
                for (const thumb of videoThumbnails) {
                    const diff = Math.abs(thumb.time - vTime);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestThumb = thumb;
                    }
                }

                if (drawWidth > 0 && closestThumb) {
                    ctx.drawImage(closestThumb.bitmap, x, 0, drawWidth, thumbHeight);
                }
            }
        }

        // Dim slightly
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

    } else {
        const barCount = Math.floor(w / 4);
        const barWidth = 2;
        const gap = barCount > 1 ? (w - barCount * barWidth) / (barCount - 1) : 0;

        for (let i = 0; i < barCount; i++) {
            const x = i * (barWidth + gap);
            if (x + barWidth > w) break;

            const barTime = timelineDuration > 0 ? (x / w) * timelineDuration : 0;

            let isRemoved = true;
            for (const seg of segments) {
                if (!seg.removed && barTime >= seg.start && barTime <= seg.end) {
                    isRemoved = false;
                    break;
                }
            }

            if (isRemoved) continue;

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
}

function updateTimelineLabels() {
    timelineLabelStart.textContent = formatTimePrecise(0);
    timelineLabelEnd.textContent = formatTimePrecise(timelineDuration);
}

// ── Segment Button Event Listeners ──
splitBtn.addEventListener('click', () => {
    addSplit(videoPlayer.currentTime);
    videoToolbar.classList.add('hidden');
});

removeSectionBtn.addEventListener('click', () => {
    if (selectedSegIdx === null) return;
    saveUndoState();
    removedFlags[selectedSegIdx] = true;

    const seg = getSegments()[selectedSegIdx];
    showToast('🗑️', `Removed ${formatTimePrecise(seg.videoStart)} → ${formatTimePrecise(seg.videoEnd)}`);

    selectedSegIdx = null;
    updateTimelineDuration();
    drawWaveform();
    renderTimeline();
    updateControls();
    updateVirtualPlayhead();
});

deselectBtn.addEventListener('click', () => {
    selectedSegIdx = null;
    renderTimeline();
    updateControls();
});

resetAllBtn.addEventListener('click', () => {
    if (!confirm('Reset all splits and removed sections? You can still undo with Ctrl+Z.')) return;
    saveUndoState();
    splitPoints = [];
    removedFlags = [false];
    segmentOffsets = [0];
    selectedSegIdx = null;

    updateTimelineDuration();
    renderTimeline();
    updateControls();
    showToast('🔄', 'All changes cleared — press Ctrl+Z to undo');
});