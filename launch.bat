@echo off
title Study Tracker

echo  Study Tracker - Launching...
echo.

:: Check for Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Node.js is not installed.
    echo  Download it from https://nodejs.org and re-run this script.
    pause
    exit /b 1
)

:: Install dependencies if node_modules is missing
if not exist "node_modules\" (
    echo  Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo  ERROR: npm install failed.
        pause
        exit /b 1
    )
    echo  Dependencies installed.
    echo.
)

:: Build main process and preload (TypeScript)
echo  Building...
call npx tsc -p tsconfig.main.json
if %errorlevel% neq 0 (
    echo  ERROR: TypeScript build failed.
    pause
    exit /b 1
)

:: Copy static files
call node scripts/copy-static.js

:: Bundle renderer
call npx esbuild src/renderer/app.ts --bundle --platform=browser --target=chrome108 --outfile=dist/renderer/app.js
if %errorlevel% neq 0 (
    echo  ERROR: Renderer build failed.
    pause
    exit /b 1
)

echo  Build complete. Starting app...
echo.

:: Launch Electron
call npx electron .
