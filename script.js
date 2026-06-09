const songs = [
  {
    title: "First Love (SlowVerb)",
    artist: "Jurrivh",
    src: "assets/music/song1.mp3",
    cover: "assets/images/default-cover.svg"
  },
  {
    title: "Ascensus Christi: A Piano Rhapsody",
    artist: "Paul Cardall",
    src: "assets/music/song2.mp3",
    cover: "assets/images/default-cover.svg"
  },
  {
    title: "See You Again",
    artist: "Sad & Emotional Piano Instrumental",
    src: "assets/music/song3.mp3",
    cover: "assets/images/default-cover.svg"
  }
];

const STORAGE_KEYS = {
  selectedSong: "musicPlayer:selectedSong",
  volume: "musicPlayer:volume"
};

const DEFAULT_COVER = "assets/images/default-cover.svg";
const ASSET_VERSION = "audio-cache-v5";
const MEDIA_COMMAND_COOLDOWN_MS = 900;
const LOW_VOLUME_PERCENT = 20;
const HIGH_VOLUME_PERCENT = 100;
const DEFAULT_PC_PORT = "COM12";
const DEFAULT_PC_BAUD_RATE = 115200;
const PC_CONTROL_FALLBACK_BASE = "http://127.0.0.1:8765/api/pc-control";

const PC_COMMAND_LABELS = {
  VOLUME_DOWN: "Ses %20",
  VOLUME_UP: "Ses %100",
  MUTE: "Sessiz",
  NEXT: "Sonraki",
  PREVIOUS: "Önceki"
};

const audioPlayer = document.getElementById("audioPlayer");
const coverImage = document.getElementById("coverImage");
const songTitle = document.getElementById("songTitle");
const artistName = document.getElementById("artistName");
const playStatus = document.getElementById("playStatus");
const currentTimeLabel = document.getElementById("currentTime");
const durationTimeLabel = document.getElementById("durationTime");
const progressBar = document.getElementById("progressBar");
const progressFill = document.getElementById("progressFill");
const previousButton = document.getElementById("previousButton");
const playButton = document.getElementById("playButton");
const playIcon = document.getElementById("playIcon");
const nextButton = document.getElementById("nextButton");
const volumeDownButton = document.getElementById("volumeDownButton");
const volumeUpButton = document.getElementById("volumeUpButton");
const volumeSlider = document.getElementById("volumeSlider");
const volumeValue = document.getElementById("volumeValue");
const songList = document.getElementById("songList");
const notificationArea = document.getElementById("notificationArea");
const pcStatusBadge = document.getElementById("pcStatusBadge");
const pcPortInput = document.getElementById("pcPortInput");
const pcConnectButton = document.getElementById("pcConnectButton");
const pcCommandButtons = document.querySelectorAll("[data-pc-command]");
const pcLastCommand = document.getElementById("pcLastCommand");
const pcLastPrediction = document.getElementById("pcLastPrediction");
const pcVolumeState = document.getElementById("pcVolumeState");
const pcServiceMessage = document.getElementById("pcServiceMessage");
const pcLog = document.getElementById("pcLog");

let currentSongIndex = getStoredSongIndex();
let isPlaying = false;
let notificationTimer = null;
let lastMediaCommand = "";
let lastMediaCommandTime = 0;
let pcBridgeOnline = false;
let pcSerialConnected = false;
let pcApiBase = null;
let pcEvents = null;
let pcStatusTimer = null;
let pcLocalLog = [];
let hasReceivedPcStatus = false;
let lastProcessedPcCommandEvent = 0;
let pcBridgeVolumeLabel = "";

function getStoredSongIndex() {
  const storedIndex = Number.parseInt(localStorage.getItem(STORAGE_KEYS.selectedSong), 10);
  return Number.isInteger(storedIndex) && storedIndex >= 0 && storedIndex < songs.length ? storedIndex : 0;
}

function getStoredVolume() {
  const storedVolume = Number.parseInt(localStorage.getItem(STORAGE_KEYS.volume), 10);
  return Number.isInteger(storedVolume) && storedVolume >= 0 && storedVolume <= 100 ? storedVolume : 70;
}

function loadSong(index) {
  currentSongIndex = (index + songs.length) % songs.length;
  const song = songs[currentSongIndex];

  audioPlayer.src = withAssetVersion(song.src);
  audioPlayer.load();
  coverImage.src = song.cover || DEFAULT_COVER;
  coverImage.alt = `${song.title} albüm kapağı`;
  songTitle.textContent = song.title;
  artistName.textContent = song.artist;
  currentTimeLabel.textContent = "0:00";
  durationTimeLabel.textContent = "0:00";
  progressFill.style.width = "0%";

  localStorage.setItem(STORAGE_KEYS.selectedSong, String(currentSongIndex));
  renderSongList();
  updateMediaSessionMetadata();
}

function playSong() {
  const playPromise = audioPlayer.play();

  if (playPromise !== undefined) {
    playPromise
      .then(() => {
        setPlayingState(true);
        showNotification(`${songs[currentSongIndex].title} oynatılıyor`);
      })
      .catch(() => {
        setPlayingState(false);
        showNotification("Müzik başlatılamadı. Dosyayı ve tarayıcı iznini kontrol edin.", true);
      });
  }
}

function pauseSong() {
  audioPlayer.pause();
  setPlayingState(false);
  showNotification("Müzik duraklatıldı");
}

function togglePlay() {
  if (isPlaying) {
    pauseSong();
  } else {
    playSong();
  }
}

function nextSong() {
  const shouldContinuePlaying = isPlaying;
  loadSong(currentSongIndex + 1);

  if (shouldContinuePlaying) {
    playSong();
  } else {
    showNotification(`${songs[currentSongIndex].title} seçildi`);
  }
}

function handleSongEnded() {
  loadSong(currentSongIndex + 1);
  playSong();
}

function previousSong() {
  const shouldContinuePlaying = isPlaying;
  loadSong(currentSongIndex - 1);

  if (shouldContinuePlaying) {
    playSong();
  } else {
    showNotification(`${songs[currentSongIndex].title} seçildi`);
  }
}

function updateProgress() {
  const { currentTime, duration } = audioPlayer;
  const progressPercent = duration ? (currentTime / duration) * 100 : 0;

  progressFill.style.width = `${progressPercent}%`;
  currentTimeLabel.textContent = formatTime(currentTime);
  durationTimeLabel.textContent = formatTime(duration);
}

function setProgress(event) {
  const duration = audioPlayer.duration;
  if (!duration) {
    return;
  }

  const rect = progressBar.getBoundingClientRect();
  const clickPosition = event.clientX - rect.left;
  const percent = Math.min(Math.max(clickPosition / rect.width, 0), 1);
  audioPlayer.currentTime = percent * duration;
  updateProgress();
}

function changeVolume(value, options = {}) {
  const normalizedValue = Math.min(Math.max(Number(value), 0), 100);

  if (options.unmute) {
    setAudioMuted(false, { notify: false });
  }

  audioPlayer.volume = normalizedValue / 100;
  volumeSlider.value = String(normalizedValue);
  localStorage.setItem(STORAGE_KEYS.volume, String(normalizedValue));
  updateVolumeDisplay();
}

function setAudioMuted(muted, options = {}) {
  audioPlayer.muted = muted;
  updateVolumeDisplay();

  if (options.notify !== false) {
    showNotification(muted ? "Ses kapatıldı" : "Ses açıldı");
  }
}

function updateVolumeDisplay() {
  const percent = Math.round(audioPlayer.volume * 100);
  volumeValue.textContent = String(percent);
  document.body.classList.toggle("is-muted", audioPlayer.muted);

  if (!pcBridgeOnline || !pcBridgeVolumeLabel) {
    pcVolumeState.textContent = audioPlayer.muted ? "Sessiz" : `%${percent}`;
  }
}

function showNotification(message, isError = false) {
  window.clearTimeout(notificationTimer);
  notificationArea.textContent = message;
  notificationArea.classList.toggle("is-error", isError);

  notificationTimer = window.setTimeout(() => {
    notificationArea.textContent = "Hazır";
    notificationArea.classList.remove("is-error");
  }, 3200);
}

function setPlayingState(playing) {
  isPlaying = playing;
  document.body.classList.toggle("is-playing", playing);
  playStatus.textContent = playing ? "Oynatılıyor" : "Duraklatıldı";
  playIcon.textContent = playing ? "⏸" : "▶";
  playButton.setAttribute("aria-label", playing ? "Duraklat" : "Oynat");

  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }
}

function runTrackCommand(direction, message, useCooldown = false) {
  const now = Date.now();

  if (useCooldown && direction === lastMediaCommand && now - lastMediaCommandTime < MEDIA_COMMAND_COOLDOWN_MS) {
    return;
  }

  lastMediaCommand = direction;
  lastMediaCommandTime = now;

  if (direction === "next") {
    nextSong();
  } else {
    previousSong();
  }

  showNotification(message);
}

function handleExternalTrackCommand(direction) {
  const label = direction === "next" ? "sonraki şarkı" : "önceki şarkı";
  runTrackCommand(direction, `Bilgisayar komutu: ${label}`, true);
}

function setupMediaSessionControls() {
  if (!("mediaSession" in navigator)) {
    return;
  }

  const actions = {
    play: playSong,
    pause: pauseSong,
    nexttrack: () => handleExternalTrackCommand("next"),
    previoustrack: () => handleExternalTrackCommand("previous")
  };

  Object.entries(actions).forEach(([action, handler]) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (error) {
      // Some browsers expose Media Session but do not support every action.
    }
  });
}

function updateMediaSessionMetadata() {
  if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) {
    return;
  }

  const song = songs[currentSongIndex];
  const cover = song.cover || DEFAULT_COVER;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist,
    artwork: [
      { src: cover, sizes: "512x512", type: "image/svg+xml" }
    ]
  });
}

function executeLocalPcCommand(command, source = "panel") {
  const sourceLabel = source === "serial" ? "ESP32" : "Panel";
  const commandLabel = PC_COMMAND_LABELS[command] || command;

  pcLastCommand.textContent = `${sourceLabel}: ${commandLabel}`;

  if (!pcBridgeOnline) {
    addPcLog(`${sourceLabel}: ${commandLabel}`);
  }

  if (command === "VOLUME_DOWN") {
    changeVolume(LOW_VOLUME_PERCENT, { unmute: true });
    setPcServiceMessage("Ses %20 seviyesine alındı");
    showNotification(`${sourceLabel}: ses %20`);
    return;
  }

  if (command === "VOLUME_UP") {
    changeVolume(HIGH_VOLUME_PERCENT, { unmute: true });
    setPcServiceMessage("Ses %100 seviyesine alındı");
    showNotification(`${sourceLabel}: ses %100`);
    return;
  }

  if (command === "MUTE") {
    setAudioMuted(!audioPlayer.muted, { notify: false });
    setPcServiceMessage(audioPlayer.muted ? "Ses kapatıldı" : "Ses açıldı");
    showNotification(`${sourceLabel}: ${audioPlayer.muted ? "ses kapatıldı" : "ses açıldı"}`);
    return;
  }

  if (command === "NEXT") {
    runTrackCommand("next", `${sourceLabel}: sonraki şarkı`, source === "serial");
    setPcServiceMessage("Sonraki şarkıya geçildi");
    return;
  }

  if (command === "PREVIOUS") {
    runTrackCommand("previous", `${sourceLabel}: önceki şarkı`, source === "serial");
    setPcServiceMessage("Önceki şarkıya geçildi");
  }
}

function setPcServiceMessage(message, isError = false) {
  pcServiceMessage.textContent = message;
  pcServiceMessage.classList.toggle("is-error", isError);
}

function getPcApiCandidates() {
  const originBase = `${window.location.origin}/api/pc-control`;
  return originBase === PC_CONTROL_FALLBACK_BASE ? [originBase] : [originBase, PC_CONTROL_FALLBACK_BASE];
}

async function requestPcApi(path, options = {}) {
  const candidates = pcApiBase
    ? [pcApiBase, ...getPcApiCandidates().filter((base) => base !== pcApiBase)]
    : getPcApiCandidates();
  const errors = [];

  for (const base of candidates) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), options.timeout ?? 1800);

    try {
      const response = await fetch(`${base}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      pcApiBase = base;
      return response.json();
    } catch (error) {
      errors.push(error);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  throw errors[0] || new Error("PC kontrol servisine ulaşılamadı");
}

async function refreshPcBridgeStatus() {
  try {
    const status = await requestPcApi("/status", { method: "GET", timeout: 1300 });
    renderPcStatus(status);
    setupPcEvents();
  } catch (error) {
    setPcOffline();
  }
}

function setupPcEvents() {
  if (!pcApiBase || pcEvents || !("EventSource" in window)) {
    return;
  }

  pcEvents = new EventSource(`${pcApiBase}/events`);
  pcEvents.onmessage = (event) => {
    try {
      renderPcStatus(JSON.parse(event.data));
    } catch (error) {
      setPcServiceMessage("Durum verisi okunamadı", true);
    }
  };
  pcEvents.onerror = () => {
    pcEvents.close();
    pcEvents = null;
  };
}

function renderPcStatus(status) {
  pcBridgeOnline = true;
  pcSerialConnected = Boolean(status.serial_connected);
  pcStatusBadge.textContent = pcSerialConnected ? "ESP32 bağlı" : "Servis açık";
  pcStatusBadge.classList.toggle("is-connected", pcSerialConnected);
  pcStatusBadge.classList.toggle("is-error", false);
  pcConnectButton.disabled = false;
  pcConnectButton.textContent = pcSerialConnected ? "Kes" : "Bağlan";

  if (status.serial_port) {
    pcPortInput.value = status.serial_port;
  }

  if (status.last_command) {
    pcLastCommand.textContent = `${status.last_command_source === "serial" ? "ESP32" : "Panel"}: ${PC_COMMAND_LABELS[status.last_command] || status.last_command}`;
  }

  pcLastPrediction.textContent = formatPrediction(status.last_prediction);
  pcBridgeVolumeLabel = formatPcVolume(status);
  pcVolumeState.textContent = pcBridgeVolumeLabel;
  setPcServiceMessage(status.last_message || "Servis hazır", Boolean(status.error));
  renderPcLog(status.log || []);
  syncSerialCommandToPlayer(status);
}

function setPcOffline() {
  pcBridgeOnline = false;
  pcSerialConnected = false;
  pcBridgeVolumeLabel = "";
  pcStatusBadge.textContent = "Servis kapalı";
  pcStatusBadge.classList.remove("is-connected");
  pcStatusBadge.classList.add("is-error");
  pcConnectButton.disabled = false;
  pcConnectButton.textContent = "Bağlan";
  setPcServiceMessage("Yerel servis kapalı", true);
  updateVolumeDisplay();
}

function formatPrediction(prediction) {
  if (!prediction || !prediction.label) {
    return "Bekleniyor";
  }

  return `${prediction.label} %${Number(prediction.score || 0).toFixed(1)}`;
}

function formatPcVolume(status) {
  if (typeof status.volume_percent !== "number") {
    return audioPlayer.muted ? "Sessiz" : `%${Math.round(audioPlayer.volume * 100)}`;
  }

  return status.muted ? "PC sessiz" : `PC %${status.volume_percent}`;
}

function syncSerialCommandToPlayer(status) {
  const eventId = Number(status.command_event_id || 0);

  if (!hasReceivedPcStatus) {
    hasReceivedPcStatus = true;
    lastProcessedPcCommandEvent = eventId;
    return;
  }

  if (!eventId || eventId === lastProcessedPcCommandEvent || status.last_command_source !== "serial") {
    return;
  }

  lastProcessedPcCommandEvent = eventId;
  executeLocalPcCommand(status.last_command, "serial");
}

async function handlePcConnectClick() {
  if (!pcBridgeOnline) {
    setPcServiceMessage("Önce pc_control_server.py çalıştırılmalı", true);
    refreshPcBridgeStatus();
    return;
  }

  try {
    const path = pcSerialConnected ? "/disconnect" : "/connect";
    const body = pcSerialConnected
      ? {}
      : {
          port: pcPortInput.value.trim() || DEFAULT_PC_PORT,
          baud_rate: DEFAULT_PC_BAUD_RATE
        };
    const status = await requestPcApi(path, {
      method: "POST",
      body: JSON.stringify(body),
      timeout: 3500
    });
    renderPcStatus(status);
  } catch (error) {
    setPcServiceMessage("Bağlantı işlemi başarısız", true);
  }
}

async function sendPcCommand(command) {
  if (!pcBridgeOnline) {
    executeLocalPcCommand(command, "panel");
    return;
  }

  try {
    const status = await requestPcApi("/command", {
      method: "POST",
      body: JSON.stringify({ command }),
      timeout: 2500
    });
    executeLocalPcCommand(command, "panel");
    renderPcStatus(status);
  } catch (error) {
    setPcServiceMessage("PC servisine komut gönderilemedi", true);
    executeLocalPcCommand(command, "panel");
  }
}

function addPcLog(message) {
  pcLocalLog = [message, ...pcLocalLog].slice(0, 6);
  renderPcLog(pcLocalLog);
}

function renderPcLog(lines) {
  pcLog.innerHTML = "";

  if (!lines.length) {
    const empty = document.createElement("span");
    empty.className = "pc-log-line";
    empty.textContent = "Kayıt yok";
    pcLog.appendChild(empty);
    return;
  }

  lines.slice(0, 6).forEach((line) => {
    const item = document.createElement("span");
    item.className = "pc-log-line";
    item.textContent = line;
    pcLog.appendChild(item);
  });
}

function formatTime(value) {
  if (!Number.isFinite(value)) {
    return "0:00";
  }

  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function withAssetVersion(path) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}v=${ASSET_VERSION}`;
}

function renderSongList() {
  songList.innerHTML = "";

  songs.forEach((song, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = index === currentSongIndex ? "is-active" : "";
    button.setAttribute("aria-label", `${song.title} şarkısını seç`);
    button.setAttribute("aria-current", index === currentSongIndex ? "true" : "false");

    const number = document.createElement("span");
    number.className = "track-number";
    number.textContent = String(index + 1);

    const meta = document.createElement("span");
    const title = document.createElement("span");
    const artist = document.createElement("span");
    title.className = "list-title";
    artist.className = "list-artist";
    title.textContent = song.title;
    artist.textContent = song.artist;
    meta.append(title, artist);

    button.append(number, meta);
    button.addEventListener("click", () => {
      const shouldContinuePlaying = isPlaying;
      loadSong(index);
      if (shouldContinuePlaying) {
        playSong();
      } else {
        showNotification(`${song.title} seçildi`);
      }
    });

    item.appendChild(button);
    songList.appendChild(item);
  });
}

function seekBy(seconds) {
  if (!audioPlayer.duration) {
    return;
  }

  audioPlayer.currentTime = Math.min(Math.max(audioPlayer.currentTime + seconds, 0), audioPlayer.duration);
  updateProgress();
}

function handleKeyboardControls(event) {
  if (event.key === "MediaTrackNext") {
    event.preventDefault();
    handleExternalTrackCommand("next");
    return;
  }

  if (event.key === "MediaTrackPrevious") {
    event.preventDefault();
    handleExternalTrackCommand("previous");
    return;
  }

  const interactiveTags = ["BUTTON", "INPUT", "TEXTAREA", "SELECT"];
  if (interactiveTags.includes(event.target.tagName)) {
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    togglePlay();
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    seekBy(5);
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    seekBy(-5);
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    changeVolume(Number(volumeSlider.value) + 10, { unmute: true });
    showNotification("Ses artırıldı");
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    changeVolume(Number(volumeSlider.value) - 10, { unmute: true });
    showNotification("Ses azaltıldı");
  }
}

previousButton.addEventListener("click", previousSong);
playButton.addEventListener("click", togglePlay);
nextButton.addEventListener("click", nextSong);
volumeDownButton.addEventListener("click", () => {
  changeVolume(Number(volumeSlider.value) - 10, { unmute: true });
  showNotification("Ses azaltıldı");
});
volumeUpButton.addEventListener("click", () => {
  changeVolume(Number(volumeSlider.value) + 10, { unmute: true });
  showNotification("Ses artırıldı");
});
volumeSlider.addEventListener("input", (event) => changeVolume(event.target.value));
progressBar.addEventListener("click", setProgress);
pcConnectButton.addEventListener("click", handlePcConnectClick);
pcCommandButtons.forEach((button) => {
  button.addEventListener("click", () => sendPcCommand(button.dataset.pcCommand));
});

audioPlayer.addEventListener("timeupdate", updateProgress);
audioPlayer.addEventListener("loadedmetadata", updateProgress);
audioPlayer.addEventListener("ended", handleSongEnded);
audioPlayer.addEventListener("pause", () => setPlayingState(false));
audioPlayer.addEventListener("play", () => setPlayingState(true));
audioPlayer.addEventListener("volumechange", updateVolumeDisplay);
audioPlayer.addEventListener("error", () => {
  setPlayingState(false);
  showNotification(`${songs[currentSongIndex].src} yüklenemedi. MP3 dosyasını kontrol edin.`, true);
});

coverImage.addEventListener("error", () => {
  if (!coverImage.src.endsWith(DEFAULT_COVER)) {
    coverImage.src = DEFAULT_COVER;
  }
});

document.addEventListener("keydown", handleKeyboardControls);

window.musicHubControl = {
  next: () => handleExternalTrackCommand("next"),
  previous: () => handleExternalTrackCommand("previous")
};

setupMediaSessionControls();
changeVolume(getStoredVolume());
loadSong(currentSongIndex);
renderPcLog([]);
refreshPcBridgeStatus();
pcStatusTimer = window.setInterval(refreshPcBridgeStatus, 3500);
