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

    try {
        // 1. Create the offscreen document with DISPLAY_MEDIA reason
        //    This allows the offscreen doc to call getDisplayMedia()
        await setupOffscreenDocument('offscreen.html');

        // 2. Tell the offscreen document to start recording
        //    It will call getDisplayMedia() which shows Chrome's screen picker
        chrome.runtime.sendMessage({
            type: 'start-recording',
            target: 'offscreen'
        });

    } catch (error) {
        console.error('Failed to start recording:', error);
        isRecording = false;

        chrome.runtime.sendMessage({ action: 'recordingFailed' }).catch(() => { });
    }
}

async function stopRecording() {
    if (!isRecording) return;

    chrome.runtime.sendMessage({
        type: 'stop-recording',
        target: 'offscreen'
    });
}

// Ensure the offscreen document exists
async function setupOffscreenDocument(path) {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(path)]
    });

    if (existingContexts.length > 0) {
        return;
    }

    try {
        await chrome.offscreen.createDocument({
            url: path,
            reasons: ['DISPLAY_MEDIA'],
            justification: 'Screen recording via getDisplayMedia'
        });
    } catch (err) {
        if (!err.message.startsWith('Only a single offscreen document may be created.')) {
            throw err;
        }
    }
}

// Listen for messages from the offscreen document
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'recording-started') {
        console.log('Recording started confirmation from offscreen');
        isRecording = true;
    }

    if (message.type === 'recording-stopped-from-offscreen') {
        console.log('Recording stopped confirmation from offscreen');
        isRecording = false;

        // Open the editor page if the recording data is ready
        if (message.openEditor) {
            chrome.tabs.create({
                url: chrome.runtime.getURL('editor.html')
            });
        }

        chrome.runtime.sendMessage({ action: 'recordingStopped' }).catch(() => { });
    }

    if (message.type === 'recording-failed') {
        console.error('Recording failed in offscreen:', message.error);
        isRecording = false;

        chrome.runtime.sendMessage({ action: 'recordingFailed' }).catch(() => { });
    }
});
