<div align="center">

<img src="logo.jpg" alt="MathVision Logo" width="400" />

# MathVision

**Turn photos of math into LaTeX & TikZ. Convert PDFs into editable Word documents.**

The AI-powered toolkit for mathematics teachers — upload an image or PDF, get clean LaTeX code or a fully formatted `.docx` file with editable equations, native Word tables, and extracted images.

[![Powered by Gemini](https://img.shields.io/badge/Powered%20by-Gemini-4285F4?logo=google&logoColor=white&style=flat-square)](https://ai.google.dev/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white&style=flat-square)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/Version-1.0.0-f59e0b?style=flat-square)](package.json)

</div>

---

## Two powerful modes

### Mode 1 — Image to LaTeX

| You upload… | You get… |
|:---|:---|
| Photo of **math formulas** | Clean `$...$` **LaTeX** code |
| Photo of **geometric figures** | Compilable **TikZ** code with live preview |
| Photo with **both** | Both LaTeX + TikZ blocks |
| **Handwritten** or printed | Works either way |

- Live TikZ rendering in the browser — download as PNG with one click
- Copy-paste ready for Overleaf, MathType, or any LaTeX editor

### Mode 2 — PDF to DOCX

| You upload… | You get… |
|:---|:---|
| Any **PDF** (textbook, worksheet, exam) | Fully formatted **.docx** file |

- **Editable Word equations** — every math expression becomes a native Office Math object you can edit in Word
- **Native Word tables** — tables are real Word tables with styled headers, alternating row colors, and LaTeX math rendered per cell
- **Extracted images** — figures and diagrams are cropped and placed at the correct position
- **Preserved structure** — headings, paragraphs, numbered lists, and page layout are maintained
- **Multi-page support** — processes every page with a live progress bar

---

## Key features

- Handles **Vietnamese** and **English** content natively
- Recognizes geometry notation: points, angles (`$\widehat{ABC}$`), triangles, vectors, circles, perpendiculars, parallels
- Your API key **never leaves your browser** — no server, no tracking
- Works on **Mac, Windows, and Linux**
- Free to use with Google's free Gemini API tier

---

## Quick Start

> No coding experience needed — just follow these steps.

### 1. Install Node.js *(one time)*

Go to **https://nodejs.org** → download the **LTS** version → run the installer.

### 2. Get a free Gemini API key *(one time)*

Go to **https://aistudio.google.com/apikey** → sign in → click **"Create API Key"** → copy it.

> The free tier is generous — no credit card required.

### 3. Download MathVision

**Option A — Download ZIP** *(easiest)*
Click the green **"Code"** button → **"Download ZIP"** → extract to any folder.

**Option B — Git clone**

```bash
git clone https://github.com/kagtgi/MathVision.git
cd MathVision
```

### 4. Start the app

| Platform | Command |
|:---|:---|
| **Mac / Linux** | Open Terminal in the folder → `./start.sh` |
| **Windows** | Double-click `start.bat` |

> First run installs dependencies automatically (~1 minute). Subsequent starts are instant.

### 5. Use it

1. Open **http://localhost:3000** in your browser
2. Paste your **Gemini API key** when prompted
3. Choose your mode: **Image → LaTeX** or **PDF → DOCX**
4. Upload your file and click convert
5. Preview the result and download

---

## LaTeX output quality

MathVision follows strict Vietnamese math conventions for clean, professional output:

| Element | Output |
|:---|:---|
| Angle at B | `$\widehat{ABC}$` |
| Triangle | `$\triangle ABC$` |
| Congruent | `$\triangle ABC \cong \triangle DEF$` |
| Vector | `$\overrightarrow{AB}$` |
| Perpendicular | `$AB \perp CD$` |
| Degree | `$60{}^\circ$` |
| Area | `$S_{\triangle ABC}$` |
| Derivative | `${f}'(x)$` |
| Vietnamese decimal | `$3{,}14$` |
| Brackets | Always `\left( \right)` — never bare |

TikZ figures include labeled points, right-angle marks, equal-segment tick marks, angle arcs, and compile cleanly with pdfLaTeX.

---

## DOCX output quality

The generated Word documents are ready to use — no manual cleanup needed:

- **Headings** are styled with proper Word heading levels (H1, H2, H3)
- **Equations** are native Office Math objects — double-click to edit in Word's equation editor
- **Tables** use Word's native table format with:
  - Styled header row (blue background)
  - Alternating row shading for readability
  - LaTeX math rendered as editable equations inside each cell
  - Consistent borders and padding
- **Images** are cropped from the original PDF and placed inline with captions
- **Fonts** default to Cambria with professional spacing and margins

---

## FAQ

**Is the Gemini API free?**
Yes. Google's free tier covers typical classroom usage. See [pricing details](https://ai.google.dev/pricing).

**Is my API key safe?**
Your key is kept only in your browser's memory for the current session. It is never sent to any server other than Google's Gemini API and is not saved to disk.

**How do I stop the app?**
Press `Ctrl+C` in the terminal, or close the command window on Windows.

**Can I convert scanned PDFs?**
Yes — MathVision renders each page as an image and uses AI to extract the content, so it works with scanned documents, not just text-based PDFs.

**What's the maximum PDF size?**
50 MB. For very large documents, processing may take a few minutes depending on page count.

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
| DOCX equations not editable | Open the file in Microsoft Word (not Google Docs) for full equation editing |

---

## Tech stack

| Layer | Technology |
|:---|:---|
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS 4 |
| AI | Google Gemini (`gemini-pro-latest`) |
| Math rendering | KaTeX (preview) + Office Math XML (DOCX) |
| TikZ rendering | TikZJax (browser-side) |
| DOCX generation | docx.js |
| PDF parsing | PDF.js |
| Animations | Framer Motion |

---

## License

MIT — free to use, modify, and distribute.

---

<div align="center">

Made for mathematics teachers · Vietnam & beyond

</div>
