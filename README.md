# Study Tracker

A beautiful and efficient study tracking desktop application built with Electron (frontend) and C++ (backend).

## Project Structure

```
Study Tracker/
├── src/
│   ├── main/              # Electron main process
│   │   └── main.ts
│   └── renderer/          # UI & renderer process
│       ├── index.html
│       └── preload.ts
├── backend/
│   ├── include/           # C++ header files
│   │   ├── StudySession.h
│   │   ├── StorageManager.h
│   │   └── types.h
│   ├── src/               # C++ source files
│   │   ├── main.cpp
│   │   ├── StudySession.cpp
│   │   └── StorageManager.cpp
│   ├── build/             # Build output (generated)
│   └── CMakeLists.txt
├── package.json
├── tsconfig.json
├── CONSTITUTION.md        # Project principles & design
└── README.md
```

## Prerequisites

- **Node.js** (v16+)
- **npm** or **yarn**
- **C++ compiler** (MSVC on Windows, GCC/Clang on Linux/Mac)
- **CMake** (v3.16+)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. (Optional) Build the C++ backend:
   ```bash
   cd backend
   cmake -B build
   cmake --build build
   cd ..
   ```

## Development

Start the development server with frontend and backend watchers:

```bash
npm run dev
```

Then launch Electron:

```bash
npm run electron:dev
```

Or run both concurrently:

```bash
npm run dev
```

## Build

Create a production build:

```bash
npm run build
```

Create an installer/distributable:

```bash
npm run electron:build
```

## Features (Constitution)

See [CONSTITUTION.md](CONSTITUTION.md) for detailed project principles, design philosophy, and technical architecture.

## Current Status

- ✅ Project structure scaffolded
- ✅ Electron main process configured
- ✅ C++ backend framework ready
- ⏳ IPC communication (in progress)
- ⏳ UI components (coming soon)
- ⏳ Data persistence (coming soon)

## License

MIT
