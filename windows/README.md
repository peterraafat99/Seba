# Seba AI Tutor - Cross-Platform Application

A cross-platform desktop and mobile application for the Seba AI Tutor learning platform.

## Platforms Supported

| Platform | Technology | Output |
|----------|-----------|--------|
| **Windows** | Electron + electron-builder | `.exe` (portable) |
| **macOS** | Electron + electron-builder | `.dmg` |
| **Linux** | Electron + electron-builder | `.AppImage` |
| **Android** | Capacitor + Android Studio | `.apk` / `.aab` |
| **iOS** | Capacitor + Xcode | `.ipa` |

## Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.10+ (for the backend)
- **Android Studio** (for Android builds)
- **Xcode** (for iOS builds, macOS only)

## Quick Start - Windows .exe

### Option 1: Use the build script
```bash
# From the project root (Seba AI tutor/)
build-windows.bat
```

### Option 2: Manual build
```bash
# 1. Build the frontend
cd frontend
npm install
npx vite build

# 2. Build the .exe
cd "../desktop app"
npm install
npx electron-builder --win portable
```

The `.exe` will be created at: `desktop app/dist/Seba-AI-Tutor.exe`

## Development Mode

```bash
cd "desktop app"
npm start
```
This starts the backend + frontend dev server and opens Electron.

## Mobile Builds

### Android

```bash
cd frontend

# Build and open in Android Studio
npm run mobile:android

# Or just sync the latest web build
npm run mobile:sync:android
```

Then build the APK from Android Studio.

### iOS (macOS only)

```bash
cd frontend

# Build and open in Xcode
npm run mobile:ios

# Or just sync the latest web build
npm run mobile:sync:ios
```

Then build the IPA from Xcode.

## Architecture

```
Seba AI Tutor/
├── frontend/           # React + Vite + TypeScript (shared web UI)
│   ├── dist/           # Built static files (generated)
│   ├── android/        # Capacitor Android project
│   ├── ios/            # Capacitor iOS project
│   └── capacitor.config.json
├── backend/            # Python FastAPI backend
├── desktop app/        # Electron desktop wrapper
│   ├── main.js         # Electron main process
│   ├── splash.html     # Loading splash screen
│   ├── dist/           # Build output (.exe, etc.)
│   └── package.json    # Electron & builder config
└── build-windows.bat   # One-click Windows build
```

### How it works

- **Desktop (Electron)**: Starts the Python backend, loads the built React frontend as static files in a native window
- **Mobile (Capacitor)**: Wraps the built React frontend in a native WebView, connects to the backend via network
- **Web**: The React frontend runs in any browser, connecting to the backend API

## Build Variants

### Desktop
```bash
# Windows Portable (.exe, no installation needed)
npx electron-builder --win portable

# Windows Installer (NSIS)
npx electron-builder --win nsis

# macOS DMG
npx electron-builder --mac

# Linux AppImage
npx electron-builder --linux
```

## Important Notes

1. **Backend Requirement**: The desktop app starts the Python backend automatically. Make sure Python 3.10+ is installed and backend dependencies are set up:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. **Mobile Backend**: For mobile apps, the backend must be running on a reachable server. Update the API URL in the app settings.

3. **First Run**: The first time you run the `.exe`, Windows SmartScreen may show a warning. Click "More info" → "Run anyway".