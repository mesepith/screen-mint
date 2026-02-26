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
    
    // Tell the background script to start recording
    chrome.runtime.sendMessage({ action: 'startRecording' });
  });

  stopBtn.addEventListener('click', () => {
    startBtn.disabled = false;
    stopBtn.disabled = true;

    // Tell the background script to stop recording
    chrome.runtime.sendMessage({ action: 'stopRecording' });
  });
});
