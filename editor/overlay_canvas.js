'use strict';

function resizeOverlayCanvas() {
    const wrapper = videoPlayer.parentElement;
    if (!wrapper) return;
    if (videoPlayer.videoWidth && videoPlayer.videoHeight) {
        wrapper.style.aspectRatio = `${videoPlayer.videoWidth} / ${videoPlayer.videoHeight}`;
    }

    overlayCanvas.width = wrapper.clientWidth * window.devicePixelRatio;
    overlayCanvas.height = wrapper.clientHeight * window.devicePixelRatio;
    overlayCanvas.style.width = wrapper.clientWidth + 'px';
    overlayCanvas.style.height = wrapper.clientHeight + 'px';
    overlayCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

function renderOverlayPreview(currentTime) {
    if (!overlayCanvas.width || !overlayCanvas.height) resizeOverlayCanvas();
    const w = overlayCanvas.width / window.devicePixelRatio;
    const h = overlayCanvas.height / window.devicePixelRatio;

    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    const activeInteractiveItems = [];

    for (let t = overlayTracks.length - 1; t >= 0; t--) {
        const track = overlayTracks[t];
        for (const item of track.items) {
            if (currentTime >= item.start && currentTime < item.start + item.duration) {
                drawSingleOverlay(overlayCtx, w, h, item);

                if (item.type === 'image' || item.type === 'video') {
                    activeInteractiveItems.push({ trackId: track.id, item });
                } else if (item.type === 'text') {
                    const scaledFontSize = (item.fontSize / 1080) * h;
                    overlayCtx.save();
                    overlayCtx.font = `bold ${scaledFontSize}px Inter, Arial, sans-serif`;
                    const metrics = overlayCtx.measureText(item.content);
                    const textWidth = metrics.width;
                    overlayCtx.restore();
                    activeInteractiveItems.push({
                        trackId: track.id,
                        item,
                        measuredWidth: textWidth,
                        measuredHeight: scaledFontSize * 1.2
                    });
                }
            }
        }
    }

    if (typeof renderInteractionBoxes === 'function') {
        renderInteractionBoxes(activeInteractiveItems, w, h);
    }
}

function drawSingleOverlay(ctx, canvasW, canvasH, item) {
    const alpha = (item.opacity != null ? item.opacity : 100) / 100;
    if (item.type === 'text') {
        const x = (item.x / 100) * canvasW;
        const y = (item.y / 100) * canvasH;
        const scaledFontSize = (item.fontSize / 1080) * canvasH;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = `bold ${scaledFontSize}px Inter, Arial, sans-serif`;
        ctx.fillStyle = item.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = scaledFontSize * 0.15;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = scaledFontSize * 0.05;
        ctx.fillText(item.content, x, y);
        ctx.restore();
    } else if (item.type === 'image') {
        let img = overlayImageCache[item.id];
        if (!img) {
            img = new Image();
            img.src = item.imageSrc;
            overlayImageCache[item.id] = img;
        }
        if (img.complete && img.naturalWidth > 0) {
            const imgW = (item.imageWidth / 100) * canvasW;
            const imgH = (item.imageHeight / 100) * canvasH;
            const x = (item.x / 100) * canvasW - imgW / 2;
            const y = (item.y / 100) * canvasH - imgH / 2;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.drawImage(img, x, y, imgW, imgH);
            ctx.restore();
        }
    } else if (item.type === 'video') {
        let vid = overlayVideoCache[item.id];
        if (vid && vid.readyState >= 2) {
            const vidW = (item.imageWidth / 100) * canvasW;
            const vidH = (item.imageHeight / 100) * canvasH;
            const x = (item.x / 100) * canvasW - vidW / 2;
            const y = (item.y / 100) * canvasH - vidH / 2;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.drawImage(vid, x, y, vidW, vidH);
            ctx.restore();
        }
    }
}

function drawOverlaysOnCanvas(ctx, canvasW, canvasH, currentTime) {
    for (let t = overlayTracks.length - 1; t >= 0; t--) {
        const track = overlayTracks[t];
        for (const item of track.items) {
            if (currentTime >= item.start && currentTime < item.start + item.duration) {
                drawSingleOverlay(ctx, canvasW, canvasH, item);
            }
        }
    }
}