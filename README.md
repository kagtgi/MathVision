<div align="center">

# MathTeacherVision

### AI-Powered LaTeX & TikZ Generator for Math Teachers

Convert handwritten or printed math content from images into clean, compilable **LaTeX** and **TikZ** code — instantly.

[![Gemini](https://img.shields.io/badge/Powered%20by-Gemini%202.5%20Pro-4285F4?logo=google&logoColor=white)](https://ai.google.dev/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

---

## Features

- **Image to LaTeX** — Upload a photo of math problems, formulas, or expressions and get clean LaTeX output
- **Image to TikZ** — Upload geometric figures, diagrams, or graphs and get compilable TikZ code
- **Live Preview** — See rendered formulas (KaTeX) and TikZ diagrams side-by-side with the source code
- **Copy to Clipboard** — One-click copy of generated LaTeX/TikZ code
- **Bilingual Support** — Works with both Vietnamese and English math content
- **Drag & Drop** — Simple drag-and-drop or click-to-upload interface
- **Powered by Gemini 2.5 Pro** — Uses Google's most powerful model for maximum accuracy

---

## Demo

| Upload Image | Get LaTeX + Preview |
|:---:|:---:|
| Drag & drop any math image | Rendered formulas & copyable code |

---

## Tech Stack

| Technology | Purpose |
|---|---|
| **React 19** | UI framework |
| **TypeScript 5.8** | Type-safe development |
| **Vite 6** | Build tool & dev server |
| **Tailwind CSS 4** | Styling |
| **Google Gemini 2.5 Pro** | AI vision model |
| **KaTeX** | Math formula rendering |
| **TikZJax** | TikZ diagram rendering |
| **Framer Motion** | Animations |

---

## Getting Started — Run Locally with Gemini API

### Prerequisites

- **Node.js** >= 18.0 ([Download](https://nodejs.org/))
- **npm** >= 9.0 (comes with Node.js)
- **Gemini API Key** (free tier available)

### Step 1: Get a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Sign in with your Google account
3. Click **"Create API Key"**
4. Copy the generated API key — you'll need it in the next step

> **Free tier**: Gemini API offers a generous free tier. See [pricing](https://ai.google.dev/pricing) for details.

### Step 2: Clone the Repository

```bash
git clone https://github.com/kagtgi/MathVision.git
cd MathVision
```

### Step 3: Install Dependencies

```bash
npm install
```

### Step 4: Configure Environment Variables

Create a `.env.local` file in the project root:

```bash
cp .env.example .env.local
```

Open `.env.local` and replace the placeholder with your actual Gemini API key:

```env
GEMINI_API_KEY="your-gemini-api-key-here"
```

> **Security Note**: `.env.local` is gitignored by default — your API key will never be committed.

### Step 5: Start the Development Server

```bash
npm run dev
```

The app will be available at **http://localhost:3000**

### Step 6: Use the App

1. Open **http://localhost:3000** in your browser
2. Drag & drop (or click to upload) an image containing math content
3. Click **"Convert to LaTeX"**
4. View the generated LaTeX/TikZ code with live preview
5. Click **"Copy"** to copy the code to your clipboard
6. Paste into your LaTeX editor (Overleaf, MathType, TeXShop, etc.)

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server on port 3000 |
| `npm run build` | Build for production (outputs to `dist/`) |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run TypeScript type checking |
| `npm run clean` | Remove the `dist/` build directory |

---

## Project Structure

```
MathVision/
├── index.html            # HTML entry point (loads KaTeX + TikZJax)
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── vite.config.ts        # Vite build config (env vars, plugins)
├── metadata.json         # App metadata
├── .env.example          # Environment variable template
├── .gitignore            # Git ignore rules
└── src/
    ├── main.tsx          # React entry point
    ├── App.tsx           # Main application (UI + Gemini API integration)
    └── index.css         # Global styles (Tailwind CSS)
```

---

## How It Works

1. **Image Upload** — The user uploads a photo of math content (formulas, geometric figures, graphs)
2. **Image Processing** — The image is resized to max 1024x1024 and converted to JPEG base64
3. **AI Analysis** — The base64 image is sent to Gemini 2.5 Pro with a detailed system instruction
4. **Content Classification** — The AI classifies the content as:
   - **Type A** (Geometric Figure) → Generates TikZ code
   - **Type B** (Formula/Expression) → Generates LaTeX code
   - **Both** → Generates both TikZ and LaTeX
5. **Rendering** — Results are displayed with:
   - KaTeX for math formula preview
   - TikZJax for diagram preview
   - Split view (preview + source code)
6. **Copy** — One-click copy of the generated code

---

## Supported Content Types

| Category | Examples |
|---|---|
| **Geometry** | Triangles, circles, polygons, coordinate systems, vectors, solid geometry |
| **Algebra** | Systems of equations, polynomials, inequalities |
| **Calculus** | Limits, derivatives, integrals, series |
| **Matrices** | Matrix operations, determinants |
| **Probability** | Combinatorics, distributions, statistical formulas |
| **Graphs** | Function plots, coordinate geometry |

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Your Google Gemini API key |
| `APP_URL` | No | App URL (used in AI Studio deployment) |
| `DISABLE_HMR` | No | Set to `true` to disable hot module replacement |

### Changing the AI Model

The model is configured in `src/App.tsx`. To use a different Gemini model, change the model identifier:

```typescript
const response = await ai.models.generateContent({
  model: 'gemini-pro-latest',  // Change this to any supported model
  // ...
});
```

Available models: `gemini-pro-latest`, `gemini-2.5-flash-latest`, `gemini-2.0-flash`, etc.
See the [Gemini model documentation](https://ai.google.dev/gemini-api/docs/models) for all options.

---

## Building for Production

```bash
# Build the app
npm run build

# Preview the production build
npm run preview
```

The production build is output to the `dist/` directory and can be deployed to any static hosting service (Vercel, Netlify, Cloudflare Pages, etc.).

> **Important**: The Gemini API key is embedded in the client-side bundle at build time. For production deployments serving public users, consider adding a backend proxy to keep your API key server-side.

---

## Troubleshooting

| Issue | Solution |
|---|---|
| **"Gemini API key is not set"** | Make sure `.env.local` exists with `GEMINI_API_KEY` set |
| **API returns an error** | Verify your API key at [Google AI Studio](https://aistudio.google.com/apikey) |
| **TikZ diagrams not rendering** | TikZJax loads from CDN — check your internet connection |
| **Port 3000 already in use** | Kill the existing process or change the port in `package.json` |
| **npm install fails** | Make sure you have Node.js >= 18 installed |

---

## License

This project is licensed under the MIT License.
