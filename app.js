/*  Shorts2Text – complete rewrite with red-transcribing indicator  */
document.addEventListener('DOMContentLoaded', () => {
  const CONFIG = {
    API_BASE_URL: 'https://api-production-6812.up.railway.app',
    POLLING_INTERVAL: 1500,
    MAX_POLLING_ATTEMPTS: 240,
  };

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
  };

  const STATE = {
    selectedFormat: 'plain',
    isTranscribing: false,
    timerInterval: null,
    startTime: 0,
  };

  /* ----------  init  ---------- */
  function init() {
    setupEventListeners();
    updateInputAndButtonStates();
    setupCursor();
    setupBackgroundVideo();
  }

  /* ----------  ui helpers  ---------- */
  function setUIState(transcribing) {
    STATE.isTranscribing = transcribing;
    DOM.transcribeBtn.textContent = transcribing ? 'Transcribing' : 'Transcribe';
    DOM.transcribeBtn.classList.toggle('is-pending', transcribing); // red switch
    updateInputAndButtonStates();
  }

  function updateInputAndButtonStates() {
    const ok = DOM.urlInput.value.trim().length > 0;
    DOM.transcribeBtn.disabled = !ok || STATE.isTranscribing;
    DOM.dropdownBtn.disabled = STATE.isTranscribing;
    DOM.urlInput.disabled = STATE.isTranscribing;
  }

  function resetUI() {
    DOM.resultEl.value = '';
    DOM.barEl.style.width = '0%';
    DOM.statusEl.innerText = 'Warming up the servers…';
    DOM.timerEl.innerHTML = '00<span id="colon">:</span>00';
  }

  /* ----------  timer  ---------- */
  function startTimer() {
    STATE.startTime = performance.now();
    STATE.timerInterval = requestAnimationFrame(updateTimer);
  }

  function stopTimer() {
    if (STATE.timerInterval) cancelAnimationFrame(STATE.timerInterval);
    STATE.timerInterval = null;
    const colon = DOM.timerEl.querySelector('#colon');
    if (colon) colon.style.opacity = '1';
  }

  function updateTimer() {
    const elapsed = performance.now() - STATE.startTime;
    const totalSec = Math.floor(elapsed / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    const colon = DOM.timerEl.querySelector('#colon');
    const blink = Math.floor(elapsed / 500) % 2 ? '1' : '0';
    if (colon) colon.style.opacity = blink;
    DOM.timerEl.innerHTML = `${mm}<span id="colon" style="opacity:${blink};">:</span>${ss}`;
    STATE.timerInterval = requestAnimationFrame(updateTimer);
  }

  /* ----------  dropdown  ---------- */
  function handleDropdownToggle(e) {
    e.preventDefault();
    if (!STATE.isTranscribing) DOM.dropdown.classList.toggle('show');
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
    if (!DOM.dropdown.contains(e.target)) DOM.dropdown.classList.remove('show');
  }

  /* ----------  transcription flow  ---------- */
  async function transcribe() {
    const url = DOM.urlInput.value.trim();
    if (!url) { alert('Please paste a valid link first!'); return; }
    setUIState(true);
    resetUI();
    startTimer();
    try {
      const taskId = await startTranscription(url);
      const transcript = await pollForResult(taskId);
      if (transcript !== null) {
        DOM.resultEl.value = transcript;
        DOM.statusEl.innerText = 'Transcription complete!';
        DOM.barEl.style.width = '100%';
      } else throw new Error('Timed out waiting for the result.');
    } catch (err) {
      console.error(err);
      DOM.statusEl.innerText = 'Oops! Something went wrong. Please try again.';
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
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Server error: ${res.status} ${txt}`);
    }
    const data = await res.json();
    return data.task_id;
  }

  async function pollForResult(taskId) {
    for (let i = 0; i < CONFIG.MAX_POLLING_ATTEMPTS; i++) {
      const res = await fetch(`${CONFIG.API_BASE_URL}/result/${taskId}`);
      if (!res.ok) throw new Error(`Failed to fetch result: ${res.statusText}`);
      const data = await res.json();
      if (data.status === 'completed') return data.transcript;
      if (data.status === 'error') throw new Error(data.error || 'Transcription failed on the backend.');
      updateProgress(data);
      await new Promise(r => setTimeout(r, CONFIG.POLLING_INTERVAL));
    }
    return null;
  }

  function updateProgress(data) {
    switch (data.status) {
      case 'processing':
        const pct = data.progress || 0;
        DOM.barEl.style.width = `${pct}%`;
        if (pct < 30) DOM.statusEl.innerText = `Analyzing audio… (${pct.toFixed(0)}%)`;
        else if (pct < 70) DOM.statusEl.innerText = `Generating text… (${pct.toFixed(0)}%)`;
        else if (pct < 100) DOM.statusEl.innerText = `Polishing results… (${pct.toFixed(0)}%)`;
        else DOM.statusEl.innerText = 'Finalising…';
        break;
      case 'pending': DOM.statusEl.innerText = 'In line, preparing for transcription…'; break;
      case 'started': DOM.statusEl.innerText = 'Transcription started…'; break;
      default: DOM.statusEl.innerText = 'Working on it…';
    }
  }

  /* ----------  clipboard  ---------- */
  function copyTextToClipboard() {
    if (!DOM.resultEl.value) return;
    navigator.clipboard.writeText(DOM.resultEl.value).then(() => {
      const orig = DOM.copyBtn.textContent;
      DOM.copyBtn.textContent = 'Copied!';
      setTimeout(() => { DOM.copyBtn.textContent = orig; }, 2000);
    }).catch(console.error);
  }

  /* ----------  cursor & background  ---------- */
  function setupCursor() {
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    if (isTouch || !DOM.cursor) {
      document.body.style.cursor = 'auto';
      if (DOM.cursor) DOM.cursor.style.display = 'none';
      return;
    }
    DOM.cursor.style.opacity = '1';
    ['muted', 'loop', 'playsInline', 'preload'].forEach(p => DOM.cursor[p] = true);
    const play = () => DOM.cursor.play().catch(() => {
      DOM.cursor.style.display = 'none'; document.body.style.cursor = 'auto';
    });
    DOM.cursor.readyState >= 4 ? play() : DOM.cursor.addEventListener('canplaythrough', play, { once: true });
    DOM.cursor.addEventListener('error', () => { DOM.cursor.style.display = 'none'; document.body.style.cursor = 'auto'; });
    let last = 0;
    document.addEventListener('mousemove', e => {
      const now = performance.now();
      if (now - last >= 16) {
        DOM.cursor.style.transform = `translate3d(${e.clientX - 10}px, ${e.clientY - 10}px, 0)`;
        last = now;
      }
    });
    document.querySelectorAll('button, a, input, textarea').forEach(el => {
      el.addEventListener('mouseenter', () => DOM.cursor.classList.add('paused'));
      el.addEventListener('mouseleave', () => DOM.cursor.classList.remove('paused'));
    });
  }

  function setupBackgroundVideo() {
    if (!DOM.bgVideo) return;
    DOM.bgVideo.muted = true;
    const play = () => DOM.bgVideo.play().catch(() => {});
    window.addEventListener('load', play);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') play();
    });
  }

  /* ----------  boot  ---------- */
  init();
});
