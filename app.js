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
    cursor: document.getElementById('customCursor'), // Make sure this ID matches HTML
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
    updateInputAndButtonStates(); 
    setupCursor();
    setupBackgroundVideo();
  }

  /* ===== EVENT LISTENERS ===== */
  function setupEventListeners() {
    DOM.dropdownBtn.addEventListener('click', handleDropdownToggle);
    DOM.dropdownMenu.addEventListener('click', handleFormatSelect);
    window.addEventListener('click', closeDropdown);
    DOM.urlInput.addEventListener('input', updateInputAndButtonStates); 
    DOM.transcribeBtn.addEventListener('click', transcribe);
    DOM.copyBtn.addEventListener('click', copyTextToClipboard);
  }

  /* ===== DROPDOWN LOGIC ===== */
  function handleDropdownToggle(e) {
    e.preventDefault();
    if (!STATE.isTranscribing) { 
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
  function updateInputAndButtonStates() {
    const urlIsValid = DOM.urlInput.value.trim().length > 0;
    DOM.transcribeBtn.disabled = !urlIsValid || STATE.isTranscribing;
    DOM.dropdownBtn.disabled = STATE.isTranscribing;
    DOM.urlInput.disabled = STATE.isTranscribing;
  }

  function setUIState(isTranscribing) {
    STATE.isTranscribing = isTranscribing;
    DOM.transcribeBtn.textContent = isTranscribing ? 'Transcribing…' : 'Transcribe';
    updateInputAndButtonStates(); 
  }

  function resetUI() {
    DOM.resultEl.value = '';
    DOM.barEl.style.width = '0%';
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
    
    DOM.timerEl.innerHTML = `${mm}<span id="colon" style="opacity:${colon ? colon.style.opacity : '1'};">:</span>${ss}`;
    STATE.timerInterval = requestAnimationFrame(updateTimer);
  }
  

  /* ===== CORE TRANSCRIPTION LOGIC ===== */
  async function transcribe() {
    const url = DOM.urlInput.value.trim();
    if (!url) {
      alert('Please paste a valid link first!');
      return;
    }

    setUIState(true); 
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
      DOM.statusEl.innerText = `❌ Oops! Something went wrong. Please try again.`;
    } finally {
      stopTimer();
      setUIState(false); 
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
        DOM.statusEl.innerText = 'In line, preparing for transcription…';
        break;
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
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouchDevice) {
      if (DOM.cursor) DOM.cursor.style.display = 'none';
      document.body.style.cursor = 'auto'; // Ensure default cursor for touch devices
      console.log('Touch device detected, custom cursor hidden.');
      return;
    }

    if (DOM.cursor) {
      console.log('Custom cursor element found.');
      DOM.cursor.style.opacity = '1';
      DOM.cursor.muted = true;
      DOM.cursor.loop = true; // Ensure it loops if the video is short
      DOM.cursor.playsInline = true; // Essential for autoplay on some mobile browsers (though we hide on touch)
      DOM.cursor.preload = 'auto'; // Ensure it tries to load quickly

      const playCursorVideo = () => {
        DOM.cursor.play().then(() => {
          console.log('Custom cursor video started playing.');
        }).catch(e => {
          console.warn('Custom cursor video failed to play:', e);
          DOM.cursor.style.display = 'none';
          document.body.style.cursor = 'auto';
        });
      };

      // Try to play immediately if ready
      if (DOM.cursor.readyState >= 4) { // HAVE_ENOUGH_DATA
        console.log('Custom cursor video already ready, attempting to play.');
        playCursorVideo();
      } else {
        // Otherwise, wait for enough data to play
        DOM.cursor.addEventListener('canplaythrough', playCursorVideo, { once: true });
        console.log('Waiting for custom cursor video to be ready (canplaythrough).');
      }

      // Add an error listener specifically for the video element
      DOM.cursor.addEventListener('error', (event) => {
          console.error('Error loading custom cursor video:', event);
          console.error('Video src:', DOM.cursor.currentSrc);
          console.error('Video network state:', DOM.cursor.networkState);
          // Hide custom cursor and show default in case of error
          DOM.cursor.style.display = 'none';
          document.body.style.cursor = 'auto';
      });
      
    } else {
      console.warn('Custom cursor element (id="customCursor") not found in DOM.');
      document.body.style.cursor = 'auto'; // Fallback to default if element is missing
    }

    let lastMove = 0;
    document.addEventListener('mousemove', e => {
      const now = performance.now();
      if (now - lastMove >= 16) { // Cap updates at ~60fps
        if (DOM.cursor) {
          // Use CSS transform: translate3d for smoother, GPU-accelerated animation
          // e.clientX and e.clientY are relative to the viewport
          DOM.cursor.style.transform =`translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
        }
        lastMove = now;
      }
    });

    const interactiveElements = document.querySelectorAll('button, a, input, textarea');
    interactiveElements.forEach(el => {
      el.addEventListener('mouseenter', () => {
        if (DOM.cursor) DOM.cursor.pause();
      });
      el.addEventListener('mouseleave', () => {
        if (DOM.cursor) DOM.cursor.play().catch(() => {});
      });
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


