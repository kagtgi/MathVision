<div align="center">

<img src="logo.jpg" alt="MathVision Logo" width="160" />

# MathVision

**Turn photos of math into LaTeX & TikZ — instantly**

Upload a photo of formulas or geometric figures and get clean, ready-to-paste LaTeX code for Overleaf, MathType, or any LaTeX editor. Powered by Google Gemini.

[![Powered by Gemini](https://img.shields.io/badge/Powered%20by-Gemini-4285F4?logo=google&logoColor=white&style=flat-square)](https://ai.google.dev/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white&style=flat-square)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/Version-1.0.0-f59e0b?style=flat-square)](package.json)

</div>

---

## What it does

| You upload… | You get… |
|:---|:---|
| 📸 Photo of **math formulas** | Clean `$...$` **LaTeX** code |
| 📐 Photo of **geometric figures** | Compilable **TikZ** code |
| 🖼️ Photo with **both** | Both LaTeX block + TikZ block |
| ✏️ **Handwritten** or printed | Works either way |

- Handles **Vietnamese** and **English** content
- Recognizes points, angles, triangles, vectors, circles and all geometry notation
- Renders TikZ diagrams live in the browser — download as PNG with one click
- Your API key **never leaves your browser**

---

## Quick Start

> No coding experience needed — just follow these 5 steps.

### Step 1 — Install Node.js *(one time)*

1. Go to **https://nodejs.org**
2. Download the **LTS** version
3. Run the installer — click "Next" through everything

### Step 2 — Get a free Gemini API key *(one time)*

1. Go to **https://aistudio.google.com/apikey**
2. Sign in with your Google account
3. Click **"Create API Key"** and copy it

> The free tier is generous — no credit card required.

### Step 3 — Download MathVision

**Option A — Download ZIP** *(easiest)*

Click the green **"Code"** button on this page → **"Download ZIP"** → extract to any folder.

**Option B — Git clone**

```bash
git clone https://github.com/kagtgi/MathVision.git
cd MathVision
```

### Step 4 — Start the app

| Platform | Command |
|:---|:---|
| **Mac / Linux** | Open Terminal in the folder → `./start.sh` |
| **Windows** | Double-click `start.bat` |

> First run installs dependencies automatically (~1 minute). Subsequent starts are instant.

### Step 5 — Convert your first image

1. Open **http://localhost:3000** in your browser
2. Paste your **Gemini API key** when prompted
3. Drag & drop (or click to upload) a photo of math content
4. Click **"Convert to LaTeX"**
5. Copy the code → paste into Overleaf, MathType, or your editor

---

## LaTeX output quality

MathVision follows strict conventions for clean, professional output:

| Element | Output |
|:---|:---|
| Angle at B (Vietnamese) | `$\widehat{ABC}$` |
| Triangle | `$\triangle ABC$` |
| Congruent | `$\triangle ABC \cong \triangle DEF$` |
| Vector | `$\overrightarrow{AB}$` |
| Perpendicular | `$AB \perp CD$` |
| Degree | `$60{}^\circ$` |
| Area | `$S_{\triangle ABC}$` |
| Derivative | `${f}'(x)$` |
| Vietnamese decimal | `$3{,}14$` |
| Bracket rule | Always `\left( \right)` — never bare |

TikZ figures include labeled points, right-angle marks, equal-segment tick marks, angle arcs, and compile cleanly with pdfLaTeX.

---

## FAQ

**Is the Gemini API free?**
Yes. Google's free tier covers typical classroom usage. See [pricing details](https://ai.google.dev/pricing).

**Is my API key safe?**
Your key is kept only in your browser's memory for the current session. It is never sent to any server other than Google's Gemini API and is not saved to disk.

**How do I stop the app?**
Press `Ctrl+C` in the terminal, or close the command window on Windows.

**How do I update?**
Download the latest ZIP from GitHub, or run `git pull` if you used Git.

---

## Troubleshooting

| Problem | Solution |
|:---|:---|
| `'node' is not recognized` | Install Node.js from https://nodejs.org |
| API key error | Re-check your key at https://aistudio.google.com/apikey |
| TikZ diagram not rendering | Check your internet connection (TikZJax loads from CDN) |
| Port 3000 already in use | Change the port in `package.json` → `"dev": "vite --port=3001 ..."` |
| Blank output | The image may be too dark or blurry — try a clearer photo |

---

## Tech stack

| Layer | Technology |
|:---|:---|
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS 4 |
| AI | Google Gemini (`gemini-pro-latest`) |
| Math rendering | KaTeX |
| TikZ rendering | TikZJax (browser-side) |
| Animations | Framer Motion |

---

## License

MIT — free to use, modify, and distribute.

---

<div align="center">

Made for mathematics teachers · Vietnam & beyond

</div>
