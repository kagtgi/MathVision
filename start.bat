@echo off
REM MathVision - Quick Start Script for Windows
REM Just double-click this file and the app will start!

echo.
echo ============================================
echo    MathVision - Starting Up...
echo ============================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed.
    echo.
    echo Please install Node.js first:
    echo   -^> Go to https://nodejs.org
    echo   -^> Download the LTS version
    echo   -^> Run the installer
    echo.
    echo Then double-click this file again.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do echo Node.js found: %%i

REM Install dependencies if needed
if not exist "node_modules" (
    echo.
    echo Installing dependencies (first time only, may take a minute^)...
    call npm install
    echo Dependencies installed!
) else (
    echo Dependencies already installed.
)

echo.
echo ============================================
echo    Starting MathVision...
echo ============================================
echo.
echo The app will open at: http://localhost:3000
echo.
echo When the app opens in your browser:
echo   1. Enter your Gemini API key
echo      (Get one free at https://aistudio.google.com/apikey^)
echo   2. Upload a photo of math content
echo   3. Click 'Convert to LaTeX'
echo.
echo Close this window to stop the server.
echo.

REM Open the browser after a short delay, then start the dev server
start "" http://localhost:3000
call npm run dev
pause
