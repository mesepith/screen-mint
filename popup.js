document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');

  // Check the current recording state
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
    chrome.runtime.sendMessage({ action: 'startRecording' });
  });

  stopBtn.addEventListener('click', () => {
    startBtn.disabled = false;
    stopBtn.disabled = true;
    chrome.runtime.sendMessage({ action: 'stopRecording' });
  });

  // Listen for messages from background to update UI
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'recordingFailed' || message.action === 'recordingStopped') {
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  });
});
