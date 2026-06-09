# Music Player Interface

This repository contains the web-based music player and audio files used by the ESP32 music control system.

The interface is hosted on GitHub Pages and provides the music library that can be controlled through commands sent by the ESP32.

## Features

* Play and pause music
* Switch between songs
* Adjust the volume
* Display the current song
* Responsive design
* GitHub Pages support

## Project Structure

```text
/
├── index.html
├── style.css
├── script.js
└── assets/
    ├── music/
    │   ├── song1.mp3
    │   ├── song2.mp3
    │   └── song3.mp3
    └── images/
```

## Adding Music

Add MP3 files to the `assets/music` folder and update the song list inside `script.js`.

```javascript
const songs = [
  {
    title: "Song Name",
    artist: "Artist Name",
    src: "assets/music/song1.mp3"
  }
];
```

## Usage

The website acts as the music player interface of the ESP32-based control system. Next and previous commands sent to the computer can also update the website through browser media controls.

## Local PC Control Panel

Run the local control server when you want the PC control panel under the song list to read ESP32 serial output and control Windows audio:

```bash
python pc_control_server.py --serial-port COM12
```

Then open:

```text
http://127.0.0.1:8765
```

The panel uses the same command names as the ESP32 serial output: `VOLUME_DOWN`, `VOLUME_UP`, `MUTE`, `NEXT`, and `PREVIOUS`.

## Deployment

Enable GitHub Pages from:

```text
Settings -> Pages -> Deploy from a branch
```

Select the `main` branch and `/root` folder.
