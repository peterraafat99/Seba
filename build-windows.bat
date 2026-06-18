@echo off
echo ============================================
echo   Seba AI Tutor - Windows Build Script
echo ============================================
echo.

:: Navigate to project root
cd /d "%~dp0"

echo [1/4] Checking prerequisites...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found. Please install Node.js first.
    pause
    exit /b 1
)
echo   ✓ Node.js found

:: Install frontend dependencies
echo.
echo [2/4] Installing frontend dependencies...
cd frontend
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install frontend dependencies.
    pause
    exit /b 1
)
echo   ✓ Frontend dependencies installed

:: Build frontend
echo.
echo [3/4] Building frontend...
call npx vite build
if %errorlevel% neq 0 (
    echo ERROR: Failed to build frontend.
    pause
    exit /b 1
)
echo   ✓ Frontend built successfully
cd ..

:: Install desktop dependencies and build
echo.
echo [4/4] Building Windows .exe...
cd "windows"
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install desktop dependencies.
    pause
    exit /b 1
)
call npx electron-builder --win portable
if %errorlevel% neq 0 (
    echo ERROR: Failed to build .exe.
    pause
    exit /b 1
)
echo   ✓ Windows .exe built successfully
cd ..

echo.
echo ============================================
echo   BUILD COMPLETE!
echo ============================================
echo.
echo   Your .exe file is located at:
echo   windows\dist\Seba-AI-Tutor.exe
echo.
echo   To run the app, you also need:
echo   - Python 3.10+ installed
echo   - Backend dependencies (pip install -r backend\requirements.txt)
echo.
pause
