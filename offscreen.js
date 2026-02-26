let mediaRecorder;
let recordedChunks = [];

chrome.runtime.onMessage.addListener(async (message) => {
    if (message.target !== 'offscreen') return;

    if (message.type === 'start-recording') {
        startRecording(message.streamId);
    } else if (message.type === 'stop-recording') {
        stopRecording();
    }
});

async function startRecording(streamId) {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        console.log('Already recording');
        return;
    }

    try {
        // navigator.mediaDevices.getUserMedia requires a streamId mapped via desktopCapture
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: streamId
                }
            },
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: streamId
                }
            }
        });

        recordedChunks = [];

        // Choose appropriate mimeType based on browser support
        const options = { mimeType: 'video/webm; codecs=vp9' };
        mediaRecorder = new MediaRecorder(stream, options);

        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            // Create a Blob from the recorded chunks
            const blob = new Blob(recordedChunks, { type: 'video/webm' });

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

        mediaRecorder.start();
        console.log('Recording started');

    } catch (error) {
        console.error('Error starting recording:', error);
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        console.log('Recording stopped');
    }
}
