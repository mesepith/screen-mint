let isRecording = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getState') {
        sendResponse({ isRecording: isRecording });
        return true;
    }

    if (message.action === 'startRecording') {
        startRecording();
    }

    if (message.action === 'stopRecording') {
        stopRecording();
    }
});

async function startRecording() {
    if (isRecording) return;

    // 1. Get the stream ID using desktopCapture
    try {
        const streamId = await new Promise((resolve, reject) => {
            chrome.desktopCapture.chooseDesktopMedia(
                ['screen', 'window', 'tab'],
                (streamId) => {
                    if (!streamId) {
                        reject(new Error('User canceled stream selection or an error occurred.'));
                    } else {
                        resolve(streamId);
                    }
                }
            );
        });

        // 2. We have the stream ID, now create the offscreen document
        await setupOffscreenDocument('offscreen.html');

        // 3. Send the stream ID to the offscreen document to start recording
        chrome.runtime.sendMessage({
            type: 'start-recording',
            target: 'offscreen',
            streamId: streamId
        });

        isRecording = true;

    } catch (error) {
        console.error('Failed to start recording:', error);
        isRecording = false;
    }
}

async function stopRecording() {
    if (!isRecording) return;

    // Send message to offscreen document to stop recording
    chrome.runtime.sendMessage({
        type: 'stop-recording',
        target: 'offscreen'
    });

    isRecording = false;
}

// Ensure the offscreen document exists
async function setupOffscreenDocument(path) {
    // Check if it already exists
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(path)]
    });

    if (existingContexts.length > 0) {
        return;
    }

    // Create document
    try {
        await chrome.offscreen.createDocument({
            url: path,
            reasons: ['USER_MEDIA'],
            justification: 'Recording from chrome.desktopCapture'
        });
    } catch (err) {
        if (!err.message.startsWith('Only a single offscreen document may be created.')) {
            throw err;
        }
    }
}

// Listen for messages from the offscreen document indicating recording ended
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'recording-stopped-from-offscreen') {
        isRecording = false;
        // Optionally, close the offscreen document when done to free resources
        // chrome.offscreen.closeDocument();
    }
});
