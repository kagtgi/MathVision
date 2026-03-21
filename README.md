<div align="center">

# MathTeacherVision

### Turn photos of math into LaTeX & TikZ code — instantly

Upload a photo of math problems, formulas, or geometric figures and get clean, copyable LaTeX code you can paste into Overleaf, MathType, or any LaTeX editor.

[![Powered by Gemini](https://img.shields.io/badge/Powered%20by-Gemini-4285F4?logo=google&logoColor=white)](https://ai.google.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

---

## Quick Start (No coding experience needed!)

You only need two things:
1. **Node.js** installed on your computer
2. **A free Gemini API key** from Google

### Step 1: Install Node.js (one time only)

1. Go to **https://nodejs.org**
2. Click the big green **"LTS"** download button
3. Run the installer — just click "Next" through everything

### Step 2: Get a free Gemini API key (one time only)

1. Go to **https://aistudio.google.com/apikey**
2. Sign in with your Google account
3. Click **"Create API Key"**
4. Copy the key (you'll paste it into the app later)

### Step 3: Download this project

Click the green **"Code"** button on this GitHub page, then click **"Download ZIP"**. Extract the ZIP file to any folder on your computer.

Or if you have Git installed:
```
git clone https://github.com/kagtgi/MathVision.git
cd MathVision
```

### Step 4: Start the app

**On Mac / Linux:** Open Terminal in the project folder and run:
```
./start.sh
```

**On Windows:** Double-click the `start.bat` file.

> The first time you run it, it will install dependencies automatically (takes about a minute).

### Step 5: Use the app

1. Open **http://localhost:3000** in your browser (it may open automatically)
2. Paste your **Gemini API key** when prompted
3. Drag & drop (or click to upload) a photo of math content
4. Click **"Convert to LaTeX"**
5. Copy the generated code and paste it into your LaTeX editor

That's it!

---

## What it does

| You upload... | You get... |
|:---|:---|
| A photo of **math formulas** | Clean **LaTeX** code |
| A photo of **geometric figures** | Compilable **TikZ** code |
| A photo with **both** | Both LaTeX and TikZ |

Works with handwritten or printed content in **Vietnamese** and **English**.

---

## FAQ

**Is the Gemini API free?**
Yes, Google offers a generous free tier. See [pricing details](https://ai.google.dev/pricing).

**Is my API key safe?**
Your key stays in your browser and is never sent to any server except Google's Gemini API. It is not stored anywhere.

**How do I stop the app?**
Press `Ctrl+C` in the terminal (Mac/Linux) or close the command window (Windows).

**How do I update the app?**
Download the latest ZIP from GitHub again, or run `git pull` if you used Git.

**Something isn't working?**

| Problem | Fix |
|:---|:---|
| "Node.js is not installed" | Install it from https://nodejs.org |
| API key error | Double-check your key at https://aistudio.google.com/apikey |
| TikZ diagrams not showing | Check your internet connection (TikZJax loads from CDN) |
| Port 3000 in use | Close other apps using that port, or change it in `package.json` |

---

## License

MIT License — free to use and modify.
