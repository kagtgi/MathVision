#!/bin/bash
# MathVision - Quick Start Script
# Just run this script and the app will open in your browser!

set -e

echo ""
echo "============================================"
echo "   MathVision - Starting Up..."
echo "============================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed."
    echo ""
    echo "Please install Node.js first:"
    echo "  -> Go to https://nodejs.org"
    echo "  -> Download the LTS version"
    echo "  -> Run the installer"
    echo ""
    echo "Then run this script again."
    exit 1
fi

echo "Node.js found: $(node --version)"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo ""
    echo "Installing dependencies (first time only, may take a minute)..."
    npm install
    echo "Dependencies installed!"
else
    echo "Dependencies already installed."
fi

echo ""
echo "============================================"
echo "   Starting MathVision..."
echo "============================================"
echo ""
echo "The app will open at: http://localhost:3000"
echo ""
echo "When the app opens in your browser:"
echo "  1. Enter your Gemini API key"
echo "     (Get one free at https://aistudio.google.com/apikey)"
echo "  2. Upload a photo of math content"
echo "  3. Click 'Convert to LaTeX'"
echo ""
echo "Press Ctrl+C to stop the server."
echo ""

# Open the browser (works on macOS and Linux)
if command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:3000 &
elif command -v open &> /dev/null; then
    open http://localhost:3000 &
fi

# Start the dev server
npm run dev
