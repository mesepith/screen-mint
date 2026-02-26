let mediaRecorder;
let recordedChunks = [];

chrome.runtime.onMessage.addListener(async (message) => {
    if (message.target !== 'offscreen') return;

    if (message.type === 'start-recording') {
        startRecording();
    } else if (message.type === 'stop-recording') {
        stopRecording();
    }
});

async function startRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        console.log('Already recording');
        return;
    }

    try {
        // Use getDisplayMedia() — the standard Web API for screen capture.
        // In an offscreen document created with DISPLAY_MEDIA reason,
        // Chrome shows its built-in screen/window/tab picker automatically.
        // No need for chrome.desktopCapture or chromeMediaSource constraints.
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false
        });

        console.log('Got display media stream, tracks:', stream.getTracks().map(t => t.kind));

        recordedChunks = [];

        // Choose appropriate mimeType based on browser support
        let options;
        if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) {
            options = { mimeType: 'video/webm; codecs=vp9' };
        } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp8')) {
            options = { mimeType: 'video/webm; codecs=vp8' };
        } else {
            options = { mimeType: 'video/webm' };
        }

        mediaRecorder = new MediaRecorder(stream, options);

        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            // Create a Blob from the recorded chunks
            const blob = new Blob(recordedChunks, { type: options.mimeType });

            // Create an object URL from the Blob
            const url = URL.createObjectURL(blob);

            // Trigger download
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;

            // Format current timestamp for filename
            const now = new Date();
            const filename = `Screen_Recording_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}.webm`;

            a.download = filename;
            document.body.appendChild(a);
            a.click();

            // Cleanup
            setTimeout(() => {
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            }, 100);

            // Stop all tracks in the stream
            stream.getTracks().forEach(track => track.stop());

            // Notify background that recording has stopped
            chrome.runtime.sendMessage({
                type: 'recording-stopped-from-offscreen',
                target: 'background'
            });
        };

        // If user stops sharing via Chrome's built-in "Stop sharing" button,
        // handle it gracefully
        stream.getVideoTracks()[0].onended = () => {
            console.log('User stopped sharing via Chrome UI');
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
        };

        mediaRecorder.onerror = (event) => {
            console.error('MediaRecorder error:', event.error);
            chrome.runtime.sendMessage({
                type: 'recording-failed',
                target: 'background',
                error: `MediaRecorder error: ${event.error.name}`
            });
        };

        mediaRecorder.start(1000); // Collect data every 1 second
        console.log('Recording started successfully');

        // Notify background that recording has started successfully
        chrome.runtime.sendMessage({
            type: 'recording-started',
            target: 'background'
        });

    } catch (error) {
        console.error('Error starting recording:', error.name, error.message);

        // NotAllowedError = user denied/cancelled the picker
        const userCancelled = error.name === 'NotAllowedError';

        chrome.runtime.sendMessage({
            type: 'recording-failed',
            target: 'background',
            error: userCancelled
                ? 'User cancelled screen selection'
                : `${error.name}: ${error.message}`
        });
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        console.log('Recording stopped');
    } else {
        console.warn('stopRecording called but no active recorder found');
        chrome.runtime.sendMessage({
            type: 'recording-stopped-from-offscreen',
            target: 'background'
        });
    }
}
