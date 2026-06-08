# Music Player Interface

This repository contains the web-based music player and audio files used by the ESP32 voice control system.

The interface is hosted on GitHub Pages and provides the music library that can be controlled through commands detected by the ESP32.

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

The website acts as the music player interface of the ESP32-based voice control system. The ESP32 firmware and voice recognition model are maintained separately.

## Deployment

Enable GitHub Pages from:

```text
Settings -> Pages -> Deploy from a branch
```

Select the `main` branch and `/root` folder.
