# VibeBox 🎶

A sleek, browser-based media player that blends **YouTube streaming**, **local audio/video**, and **voice-powered controls** into one modern experience.  
Built with vanilla HTML/CSS/JS, Web Audio, and YouTube IFrame API. Deployed on GitHub Pages.  

[![pages](https://img.shields.io/badge/GitHub%20Pages-Live-2ea44f?logo=github)](https://<YOUR_GH_USERNAME>.github.io/<YOUR_REPO>/)
[![license](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## ✨ Features

- 🎥 **YouTube + Local media** — play videos and music from anywhere
- 🗂️ **Playlist manager** — with thumbnails, drag-to-reorder, save & clear
- 🗣️ **Speech input** (toggle) — control playback hands-free  
- 🎙️ **Mic ducking** — automatically lowers volume when you talk
- 📊 **Visualizer** — smooth live audio bars
- ⌨️ **Hotkeys** — `Space` (play/pause), `←/→` (seek), `Shift+←/→` (prev/next)
- 🔗 **Share** — copy timestamped YouTube links
- 📱 **Installable PWA** + OS media-session controls
- 💅 **Modern UI** — cards, gradients, toasts, and sticky mini-player

---

## 🚀 Live Demo

👉 [Check out VibeBox Live](https://rmehmood786.github.io/modern_voice_player/)

> 📝 Tip:  
> First click **Play** once (due to browser autoplay policies).  
> If YouTube doesn’t load, disable ad-blockers for `youtube.com/iframe_api`.

---

## 🧰 Tech Stack

- **HTML5 / CSS3** — responsive, modern design  
- **JavaScript** — Web Audio API, Media Session API  
- **YouTube IFrame API** — privacy-friendly (`youtube-nocookie.com`)  
- **GitHub Pages** — fast static hosting  

---

## 📦 Project Structure

```plaintext
.
├── assets/
│   ├── app.js       # Core logic
│   ├── styles.css   # Styling
├── index.html       # Entry point
├── LICENSE
└── README.md
