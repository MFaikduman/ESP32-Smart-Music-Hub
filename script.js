const songs = [
  {
    title: "First Love (SlowVerb)",
    artist: "Jurrivh",
    src: "assets/music/Jurrivh - First Love (SlowVerb) [Nza2D_Z1Ono].mp3",
    cover: "assets/images/default-cover.svg"
  },
  {
    title: "Ascensus Christi: A Piano Rhapsody",
    artist: "Paul Cardall",
    src: "assets/music/Paul Cardall - Ascensus Christi_ A Piano Rhapsody (Official Video) [LBoQ1W5VWx4].mp3",
    cover: "assets/images/default-cover.svg"
  },
  {
    title: "See You Again",
    artist: "Sad & Emotional Piano Instrumental",
    src: "assets/music/See You Again - Sad & Emotional Piano Song Instrumental [dz5EVMSdN0w].mp3",
    cover: "assets/images/default-cover.svg"
  }
];

const STORAGE_KEYS = {
  selectedSong: "voiceMusicPlayer:selectedSong",
  volume: "voiceMusicPlayer:volume"
};

const COMMAND_COOLDOWN_MS = 1200;
const DEFAULT_COVER = "assets/images/default-cover.svg";

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
const microphoneButton = document.getElementById("microphoneButton");
const microphoneButtonText = document.getElementById("microphoneButtonText");
const microphoneStatus = document.getElementById("microphoneStatus");
const lastCommand = document.getElementById("lastCommand");
const notificationArea = document.getElementById("notificationArea");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let currentSongIndex = getStoredSongIndex();
let isPlaying = false;
let recognition = null;
let isMicrophoneActive = false;
let isRecognitionRunning = false;
let restartTimer = null;
let lastCommandText = "";
let lastCommandTime = 0;
let notificationTimer = null;

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

  audioPlayer.src = song.src;
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

function changeVolume(value) {
  const normalizedValue = Math.min(Math.max(Number(value), 0), 100);
  audioPlayer.volume = normalizedValue / 100;
  volumeSlider.value = String(normalizedValue);
  volumeValue.textContent = String(normalizedValue);
  localStorage.setItem(STORAGE_KEYS.volume, String(normalizedValue));
}

function startVoiceRecognition() {
  if (!SpeechRecognition) {
    setMicrophoneStatus("Desteklenmiyor", "unsupported");
    showNotification("Bu tarayıcı Web Speech API desteği sunmuyor.", true);
    return;
  }

  if (!recognition) {
    setupRecognition();
  }

  isMicrophoneActive = true;
  microphoneButton.setAttribute("aria-pressed", "true");
  microphoneButton.setAttribute("aria-label", "Mikrofonu kapat");
  microphoneButtonText.textContent = "Mikrofonu Kapat";
  setMicrophoneStatus("Dinleniyor", "listening");
  safelyStartRecognition();
}

function stopVoiceRecognition() {
  isMicrophoneActive = false;
  window.clearTimeout(restartTimer);
  microphoneButton.setAttribute("aria-pressed", "false");
  microphoneButton.setAttribute("aria-label", "Mikrofonu aç");
  microphoneButtonText.textContent = "Mikrofonu Aç";
  setMicrophoneStatus(SpeechRecognition ? "Kapalı" : "Desteklenmiyor", SpeechRecognition ? "closed" : "unsupported");

  if (recognition && isRecognitionRunning) {
    recognition.stop();
  }
}

function processVoiceCommand(transcript) {
  const command = normalizeCommand(transcript);
  const now = Date.now();

  lastCommand.textContent = transcript;

  if (command === lastCommandText && now - lastCommandTime < COMMAND_COOLDOWN_MS) {
    return;
  }

  lastCommandText = command;
  lastCommandTime = now;

  if (command.includes("oynat") || command.includes("devam et")) {
    playSong();
    showNotification("Sesli komut: oynat");
    return;
  }

  if (command.includes("duraklat") || command.includes("durdur")) {
    pauseSong();
    showNotification("Sesli komut: duraklat");
    return;
  }

  if (command.includes("sonraki şarkı") || command.includes("sonraki")) {
    nextSong();
    showNotification("Sesli komut: sonraki şarkı");
    return;
  }

  if (command.includes("önceki şarkı") || command.includes("önceki")) {
    previousSong();
    showNotification("Sesli komut: önceki şarkı");
    return;
  }

  if (command.includes("ses aç") || command.includes("sesi aç") || command.includes("ses yükselt") || command.includes("sesi yükselt")) {
    changeVolume(Number(volumeSlider.value) + 10);
    showNotification("Ses yüzde 10 artırıldı");
    return;
  }

  if (command.includes("ses kıs") || command.includes("sesi kıs")) {
    changeVolume(Number(volumeSlider.value) - 10);
    showNotification("Ses yüzde 10 azaltıldı");
    return;
  }

  if (command.includes("sessiz")) {
    changeVolume(0);
    showNotification("Ses sıfırlandı");
    return;
  }

  if (command.includes("başa sar")) {
    audioPlayer.currentTime = 0;
    updateProgress();
    showNotification("Şarkı başa alındı");
    return;
  }

  showNotification("Komut anlaşılamadı", true);
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
}

function setupRecognition() {
  recognition = new SpeechRecognition();
  recognition.lang = "tr-TR";
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onstart = () => {
    isRecognitionRunning = true;
    setMicrophoneStatus("Dinleniyor", "listening");
  };

  recognition.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    if (result && result[0]) {
      processVoiceCommand(result[0].transcript.trim());
    }
  };

  recognition.onerror = (event) => {
    isRecognitionRunning = false;

    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      isMicrophoneActive = false;
      microphoneButton.setAttribute("aria-pressed", "false");
      microphoneButton.setAttribute("aria-label", "Mikrofonu aç");
      microphoneButtonText.textContent = "Mikrofonu Aç";
      setMicrophoneStatus("Kapalı", "error");
      showNotification("Mikrofon izni reddedildi. Tarayıcı ayarlarından izin verin.", true);
      return;
    }

    if (event.error === "no-speech") {
      showNotification("Ses algılanmadı, dinleme sürüyor.");
    } else {
      showNotification("Mikrofon dinlemesi geçici olarak durdu.", true);
    }

    scheduleRecognitionRestart();
  };

  recognition.onend = () => {
    isRecognitionRunning = false;
    scheduleRecognitionRestart();
  };
}

function safelyStartRecognition() {
  if (!recognition || isRecognitionRunning) {
    return;
  }

  try {
    recognition.start();
  } catch (error) {
    scheduleRecognitionRestart();
  }
}

function scheduleRecognitionRestart() {
  window.clearTimeout(restartTimer);

  if (!isMicrophoneActive) {
    return;
  }

  restartTimer = window.setTimeout(() => {
    safelyStartRecognition();
  }, 550);
}

function setMicrophoneStatus(text, state) {
  microphoneStatus.textContent = text;
  microphoneStatus.classList.remove("is-listening", "is-unsupported", "is-error");

  if (state === "listening") {
    microphoneStatus.classList.add("is-listening");
  }

  if (state === "unsupported") {
    microphoneStatus.classList.add("is-unsupported");
  }

  if (state === "error") {
    microphoneStatus.classList.add("is-error");
  }
}

function normalizeCommand(transcript) {
  return transcript
    .toLocaleLowerCase("tr-TR")
    .replace(/[.,!?;:]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatTime(value) {
  if (!Number.isFinite(value)) {
    return "0:00";
  }

  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
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
    changeVolume(Number(volumeSlider.value) + 10);
    showNotification("Ses artırıldı");
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    changeVolume(Number(volumeSlider.value) - 10);
    showNotification("Ses azaltıldı");
  }
}

previousButton.addEventListener("click", previousSong);
playButton.addEventListener("click", togglePlay);
nextButton.addEventListener("click", nextSong);
volumeDownButton.addEventListener("click", () => {
  changeVolume(Number(volumeSlider.value) - 10);
  showNotification("Ses azaltıldı");
});
volumeUpButton.addEventListener("click", () => {
  changeVolume(Number(volumeSlider.value) + 10);
  showNotification("Ses artırıldı");
});
volumeSlider.addEventListener("input", (event) => changeVolume(event.target.value));
progressBar.addEventListener("click", setProgress);
microphoneButton.addEventListener("click", () => {
  if (isMicrophoneActive) {
    stopVoiceRecognition();
  } else {
    startVoiceRecognition();
  }
});

audioPlayer.addEventListener("timeupdate", updateProgress);
audioPlayer.addEventListener("loadedmetadata", updateProgress);
audioPlayer.addEventListener("ended", handleSongEnded);
audioPlayer.addEventListener("pause", () => setPlayingState(false));
audioPlayer.addEventListener("play", () => setPlayingState(true));
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

changeVolume(getStoredVolume());
loadSong(currentSongIndex);

if (!SpeechRecognition) {
  microphoneButton.disabled = true;
  microphoneButton.setAttribute("aria-label", "Mikrofon desteklenmiyor");
  microphoneButtonText.textContent = "Desteklenmiyor";
  setMicrophoneStatus("Desteklenmiyor", "unsupported");
}
