document.addEventListener('DOMContentLoaded', () => {

  const CONFIG = {
    API_BASE_URL: 'https://api-production-6812.up.railway.app',
    POLLING_INTERVAL: 1500, // ms
    MAX_POLLING_ATTEMPTS: 240,
  };

  const DOM = {
    dropdown: document.querySelector('.dropdown'),
    dropdownBtn: document.getElementById('dropdownBtn'),
    dropdownMenu: document.getElementById('dropdownMenu'),
    urlInput: document.getElementById('url'),
    transcribeBtn: document.getElementById('transcribeBtn'),
    resultEl: document.getElementById('result'),
    statusEl: document.getElementById('status'), // This is now outside the progress bar
    timerEl: document.getElementById('timer'),
    barEl: document.getElementById('progress-bar'),
    copyBtn: document.getElementById('copyBtn'),
    cursor: document.getElementById('customCursor'),
    bgVideo: document.getElementById('bg-video'),
  };

  const STATE = {
    selectedFormat: 'plain',
    isTranscribing: false,
    timerInterval: null,
    startTime: 0,
  };

  /* ===== INITIALIZATION ===== */
  function init() {
    setupEventListeners();
    toggleTranscribeButton(); // This will also initialize dropdown button state correctly
    setupCursor();
    setupBackgroundVideo();
  }

  /* ===== EVENT LISTENERS ===== */
  function setupEventListeners() {
    DOM.dropdownBtn.addEventListener('click', handleDropdownToggle);
    DOM.dropdownMenu.addEventListener('click', handleFormatSelect);
    window.addEventListener('click', closeDropdown);
    DOM.urlInput.addEventListener('input', toggleTranscribeButton);
    DOM.transcribeBtn.addEventListener('click', transcribe);
    DOM.copyBtn.addEventListener('click', copyTextToClipboard);
  }

  /* ===== DROPDOWN LOGIC ===== */
  function handleDropdownToggle(e) {
    e.preventDefault();
    // ✅ MODIFICATION: Only toggle the dropdown if the button is NOT disabled
    if (!DOM.dropdownBtn.disabled) {
      DOM.dropdown.classList.toggle('show');
    }
  }

  function handleFormatSelect(e) {
    e.preventDefault();
    const target = e.target.closest('a');
    if (target) {
      STATE.selectedFormat = target.dataset.value;
      DOM.dropdownBtn.textContent = target.textContent + ' ▼';
      DOM.dropdown.classList.remove('show');
    }
  }

  function closeDropdown(e) {
    if (!DOM.dropdown.contains(e.target)) {
      DOM.dropdown.classList.remove('show');
    }
  }

  /* ===== UI STATE MANAGEMENT ===== */
  function toggleTranscribeButton() {
    DOM.transcribeBtn.disabled = !DOM.urlInput.value.trim() || STATE.isTranscribing;
    // ✅ NEW: Disable the dropdown button if transcription is in progress
    DOM.dropdownBtn.disabled = STATE.isTranscribing;
  }

  function setUIState(isTranscribing) {
    STATE.isTranscribing = isTranscribing;
    DOM.transcribeBtn.textContent = isTranscribing ? 'Transcribing…' : 'Transcribe';
    toggleTranscribeButton(); // This function now correctly updates both buttons
  }

  function resetUI() {
    DOM.resultEl.value = '';
    DOM.barEl.style.width = '0%';
    // ✅ MODIFICATION: More user-friendly initial status message
    DOM.statusEl.innerText = 'Warming up the servers…';
    DOM.timerEl.innerHTML = '00<span id="colon">:</span>00';
  }

  /* ===== TIMER LOGIC ===== */
  function startTimer() {
    STATE.startTime = performance.now();
    STATE.timerInterval = requestAnimationFrame(updateTimer);
  }
  
  function stopTimer() {
    if (STATE.timerInterval) {
      cancelAnimationFrame(STATE.timerInterval);
      STATE.timerInterval = null;
    }
    const colon = DOM.timerEl.querySelector('#colon');
    if (colon) colon.style.opacity = '1';
  }

  function updateTimer() {
    const elapsed = performance.now() - STATE.startTime;
    const totalSeconds = Math.floor(elapsed / 1000);
    const ss = String(totalSeconds % 60).padStart(2, '0');
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    
    const colon = DOM.timerEl.querySelector('#colon');
    if (colon) {
      colon.style.opacity = Math.floor(elapsed / 500) % 2 === 0 ? '1' : '0';
    }
    
    DOM.timerEl.innerHTML = `${mm}<span id="colon" style="opacity:${colon.style.opacity};">:</span>${ss}`;
    STATE.timerInterval = requestAnimationFrame(updateTimer);
  }
  

  /* ===== CORE TRANSCRIPTION LOGIC ===== */
  async function transcribe() {
    const url = DOM.urlInput.value.trim();
    if (!url) {
      alert('Please paste a valid link first!');
      return;
    }

    setUIState(true); // This will now disable both transcribe and dropdown buttons
    resetUI();
    startTimer();

    try {
      const taskId = await startTranscription(url);
      const transcript = await pollForResult(taskId);

      if (transcript !== null) {
        DOM.resultEl.value = transcript;
        DOM.statusEl.innerText = '✅ Transcription complete!';
        DOM.barEl.style.width = '100%';
      } else {
        throw new Error('Timed out waiting for the result.');
      }
    } catch (err) {
      console.error(err);
      // ✅ MODIFICATION: More user-friendly error message
      DOM.statusEl.innerText = `❌ Oops! Something went wrong. Please try again.`;
    } finally {
      stopTimer();
      setUIState(false); // This will re-enable both transcribe and dropdown buttons
    }
  }

  async function startTranscription(url) {
    const response = await fetch(`${CONFIG.API_BASE_URL}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format: STATE.selectedFormat }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server error: ${response.status} ${errorText}`);
    }
    const data = await response.json();
    return data.task_id;
  }

  async function pollForResult(taskId) {
    for (let i = 0; i < CONFIG.MAX_POLLING_ATTEMPTS; i++) {
      const res = await fetch(`${CONFIG.API_BASE_URL}/result/${taskId}`);
      if (!res.ok) throw new Error(`Failed to fetch result: ${res.statusText}`);
      
      const data = await res.json();

      if (data.status === 'completed') {
        return data.transcript;
      }
      if (data.status === 'error') {
        throw new Error(data.error || 'Transcription failed on the backend.');
      }
      
      updateProgress(data);
      
      await new Promise(resolve => setTimeout(resolve, CONFIG.POLLING_INTERVAL));
    }
    return null;
  }

  function updateProgress(data) {
    switch(data.status) {
      case 'processing':
        const pct = data.progress || 0;
        DOM.barEl.style.width = `${pct}%`;
        // ✅ MODIFICATION: More descriptive and user-friendly processing messages
        if (pct < 30) {
          DOM.statusEl.innerText = `Analyzing audio… (${pct.toFixed(0)}%)`;
        } else if (pct < 70) {
          DOM.statusEl.innerText = `Generating text… (${pct.toFixed(0)}%)`;
        } else if (pct < 100) {
          DOM.statusEl.innerText = `Polishing results… (${pct.toFixed(0)}%)`;
        } else {
          DOM.statusEl.innerText = 'Finalising…';
        }
        break;
      case 'pending':
        // ✅ MODIFICATION: Clearer queued status message
        DOM.statusEl.innerText = 'In line, preparing for transcription…';
        break;
      // Added a 'started' status for clarity if the backend sends it
      case 'started':
        DOM.statusEl.innerText = 'Transcription started…';
        break;
      default:
        DOM.statusEl.innerText = 'Working on it…';
        break;
    }
  }

  /* ===== UTILITY FUNCTIONS ===== */
  function copyTextToClipboard() {
    if (!DOM.resultEl.value) return;

    navigator.clipboard.writeText(DOM.resultEl.value).then(() => {
      const originalText = DOM.copyBtn.textContent;
      DOM.copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        DOM.copyBtn.textContent = originalText;
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  }

  /* ===== CURSOR LOGIC ===== */
  function setupCursor() {
    // ✅ NEW: Check if the device is touch-capable. If so, do nothing.
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouchDevice) {
      return; // Exit the function, don't set up the cursor
    }

    // Fade the cursor in now that we know we're on a desktop
    DOM.cursor.style.opacity = '1';

    let lastMove = 0;
    document.addEventListener('mousemove', e => {
      const now = performance.now();
      if (now - lastMove >= 16) { // ~60 FPS throttle
        // ✅ FIX: Remove -50% offset from cursor position to align to top-left
        DOM.cursor.style.left = `${e.clientX}px`;
        DOM.cursor.style.top = `${e.clientY}px`;
        lastMove = now;
      }
    });
  }
  
  function setupBackgroundVideo() {
    if (!DOM.bgVideo) return;
    DOM.bgVideo.muted = true;
    const playVideo = () => DOM.bgVideo.play().catch(() => {});
    window.addEventListener('load', playVideo);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') playVideo();
    });
  }

  init();

});
