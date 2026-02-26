document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');

  // Request the background script to check the current recording state
  chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
    if (response && response.isRecording) {
      startBtn.disabled = true;
      stopBtn.disabled = false;
    } else {
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  });

  startBtn.addEventListener('click', () => {
    startBtn.disabled = true;
    stopBtn.disabled = false;

    // Call chooseDesktopMedia directly from the popup
    chrome.desktopCapture.chooseDesktopMedia(
      ['screen', 'window', 'tab', 'audio'],
      (streamId) => {
        if (!streamId || chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError?.message || 'User canceled stream selection');
          // Reset UI state if canceled
          startBtn.disabled = false;
          stopBtn.disabled = true;
          return;
        }

        // Tell the background script to start recording with this streamId
        chrome.runtime.sendMessage({
          action: 'startRecording',
          streamId: streamId
        });
      }
    );
  });

  stopBtn.addEventListener('click', () => {
    startBtn.disabled = false;
    stopBtn.disabled = true;

    // Tell the background script to stop recording
    chrome.runtime.sendMessage({ action: 'stopRecording' });
  });
});
