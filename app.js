document.addEventListener('DOMContentLoaded', () => {

  /* ================= CONFIG ================= */

  const CONFIG = {
    API_BASE_URL: 'https://api-production-6812.up.railway.app',
    POLLING_INTERVAL: 1500,
    MAX_POLLING_ATTEMPTS: 240,
  };

  /* ================= DOM ================= */

  const DOM = {
    dropdown: document.querySelector('.dropdown'),
    dropdownBtn: document.getElementById('dropdownBtn'),
    dropdownMenu: document.getElementById('dropdownMenu'),
    urlInput: document.getElementById('url'),
    transcribeBtn: document.getElementById('transcribeBtn'),
    resultEl: document.getElementById('result'),
    statusEl: document.getElementById('status'),
    timerEl: document.getElementById('timer'),
    barEl: document.getElementById('progress-bar'),
    copyBtn: document.getElementById('copyBtn'),
    cursor: document.getElementById('customCursor'),
    bgVideo: document.getElementById('bg-video'),
    logoVideo: document.querySelector('.title-video video'),
  };

  /* ================= STATE ================= */

  const STATE = {
    selectedFormat: 'plain',
    isTranscribing: false,
    startTime: 0,
    timerRAF: null,
  };

  /* ================= INIT ================= */

  init();

  function init() {
    setupEventListeners();
    setupCursor();
    setupBackgroundVideo();
    updateInputAndButtonStates();
  }

  /* ================= EVENTS ================= */

  function setupEventListeners() {
    DOM.dropdownBtn.addEventListener('click', toggleDropdown);
    DOM.dropdownMenu.addEventListener('click', selectFormat);
    window.addEventListener('click', closeDropdown);
    DOM.urlInput.addEventListener('input', updateInputAndButtonStates);
    DOM.transcribeBtn.addEventListener('click', transcribe);
    DOM.copyBtn.addEventListener('click', copyToClipboard);
  }

  /* ================= UI HELPERS ================= */

  function updateInputAndButtonStates() {
    const hasUrl = DOM.urlInput.value.trim().length > 0;
    DOM.transcribeBtn.disabled = !hasUrl || STATE.isTranscribing;
    DOM.dropdownBtn.disabled = STATE.isTranscribing;
    DOM.urlInput.disabled = STATE.isTranscribing;
    DOM.transcribeBtn.classList.toggle('is-pending', STATE.isTranscribing);
    DOM.copyBtn.disabled = STATE.isTranscribing;
  }

  function setUIState(isTranscribing) {
    STATE.isTranscribing = isTranscribing;
    DOM.transcribeBtn.textContent = isTranscribing ? 'Transcribing' : 'Transcribe';
    updateInputAndButtonStates();
  }

  function resetUI() {
    DOM.resultEl.value = '';
    DOM.barEl.style.width = '0%';
    DOM.statusEl.textContent = 'Warming up the servers…';
    DOM.timerEl.innerHTML = '00<span id="colon">:</span>00';
  }

  /* ================= DROPDOWN ================= */

  function toggleDropdown(e) {
    e.preventDefault();
    if (!STATE.isTranscribing) DOM.dropdown.classList.toggle('show');
  }

  function selectFormat(e) {
    e.preventDefault();
    const item = e.target.closest('a');
    if (!item) return;
    STATE.selectedFormat = item.dataset.value;
    DOM.dropdownBtn.textContent = `${item.textContent} ▼`;
    DOM.dropdown.classList.remove('show');
  }

  function closeDropdown(e) {
    if (!DOM.dropdown.contains(e.target)) {
      DOM.dropdown.classList.remove('show');
    }
  }

  /* ================= TIMER ================= */

  function startTimer() {
    STATE.startTime = performance.now();
    tickTimer();
  }

  function stopTimer() {
    cancelAnimationFrame(STATE.timerRAF);
    STATE.timerRAF = null;
  }

  function tickTimer() {
    const elapsed = performance.now() - STATE.startTime;
    const total = Math.floor(elapsed / 1000);
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    const blink = Math.floor(elapsed / 500) % 2;

    DOM.timerEl.innerHTML =
      `${mm}<span id="colon" style="opacity:${blink};">:</span>${ss}`;

    STATE.timerRAF = requestAnimationFrame(tickTimer);
  }

  /* ================= TRANSCRIPTION ================= */

  async function transcribe() {
    const url = DOM.urlInput.value.trim();
    if (!url) return alert('Please paste a valid link first.');

    setUIState(true);
    resetUI();
    startTimer();

    try {
      const taskId = await startTranscription(url);
      const transcript = await pollForResult(taskId);

      // 1. Set the value
      DOM.resultEl.value = transcript;
      DOM.statusEl.textContent = 'Transcription complete!';
      DOM.barEl.style.width = '100%';

      // 2. Apply the Fade-in Effect
      DOM.resultEl.style.opacity = '0';
      setTimeout(() => {
        DOM.resultEl.style.transition = 'opacity 1s ease';
        DOM.resultEl.style.opacity = '1';
      }, 100);

    } catch (err) {
      console.error(err);
      DOM.statusEl.textContent = 'Connection failed. Please try again.';
    } finally {
      stopTimer();
      setUIState(false);
    }
  }

  async function startTranscription(url) {
    const res = await fetch(`${CONFIG.API_BASE_URL}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format: STATE.selectedFormat }),
    });

    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    return data.task_id;
  }

  async function pollForResult(taskId) {
    for (let i = 0; i < CONFIG.MAX_POLLING_ATTEMPTS; i++) {
      const res = await fetch(`${CONFIG.API_BASE_URL}/result/${taskId}`);
      if (!res.ok) throw new Error('Polling failed');

      const data = await res.json();
      if (data.status === 'completed') return data.transcript;
      if (data.status === 'error') throw new Error(data.error);

      updateProgress(data);
      await new Promise(r => setTimeout(r, CONFIG.POLLING_INTERVAL));
    }
    throw new Error('Timed out');
  }

  function updateProgress(data) {
    const pct = data.progress || 0;
    DOM.barEl.style.width = `${pct}%`;

    if (pct < 30) DOM.statusEl.textContent = `Analyzing audio… (${pct}%)`;
    else if (pct < 70) DOM.statusEl.textContent = `Generating text… (${pct}%)`;
    else DOM.statusEl.textContent = `Finalizing… (${pct}%)`;
  }

  /* ================= CLIPBOARD ================= */

  function copyToClipboard() {
    if (!DOM.resultEl.value) return;
    navigator.clipboard.writeText(DOM.resultEl.value).then(() => {
      const txt = DOM.copyBtn.textContent;
      DOM.copyBtn.textContent = 'Copied!';
      setTimeout(() => DOM.copyBtn.textContent = txt, 1500);
    });
  }

  /* ================= CURSOR ================= */
  
  function setupCursor() {
    if (!DOM.cursor || window.matchMedia('(pointer: coarse)').matches) return;

    let last = 0;
    document.addEventListener('mousemove', e => {
      const now = performance.now();
      if (now - last > 16) {
        DOM.cursor.style.transform =
          `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
        last = now;
      }
    });

    document.querySelectorAll('button,a,input,textarea').forEach(el => {
      el.addEventListener('mouseenter', () => DOM.cursor.classList.add('paused'));
      el.addEventListener('mouseleave', () => DOM.cursor.classList.remove('paused'));
    });
  }

  /* ================= BG VIDEO ================= */

  function setupBackgroundVideo() {
    const videos = [DOM.bgVideo, DOM.logoVideo].filter(Boolean);
    if (!videos.length) return;
  
    videos.forEach(video => {
      video.muted = true;
      video.playsInline = true;
    });
  
    const safePlayAll = () => {
      videos.forEach(v => v.play().catch(() => {}));
    };
  
    // Initial play + fade-in
    window.addEventListener('load', () => {
      safePlayAll();
  
      // Let the first frame render, then fade in
      requestAnimationFrame(() => {
        document.body.classList.remove('is-loading');
      });
    });
  
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        document.body.classList.add('is-returning');
  
        requestAnimationFrame(() => {
          videos.forEach(v => {
            v.currentTime = 0;
            v.play().catch(() => {});
          });
  
          requestAnimationFrame(() => {
            document.body.classList.remove('is-returning');
          });
        });
      }
    });
  }
});








