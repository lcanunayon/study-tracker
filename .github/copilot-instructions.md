# Study Tracker - Development Instructions

## Project Overview
Desktop study tracking application using Electron frontend + C++ backend with IPC communication.

## Architecture
- **Frontend**: Electron + TypeScript (src/main, src/renderer)
- **Backend**: Modern C++ with CMake build system
- **Communication**: Electron IPC for frontend-backend messaging
- **Data Storage**: C++ handles persistence (SQLite/JSON)

## Key Files
- `src/main/main.ts` - Electron main process
- `src/renderer/index.html` - UI entry point
- `backend/src/main.cpp` - Backend entry point
- `package.json` - Frontend dependencies & scripts
- `backend/CMakeLists.txt` - Backend build configuration

## Build & Run
- **Development**: `npm run dev` then `npm run electron:dev`
- **Production**: `npm run build && npm run electron:build`
- **Backend only**: `cd backend && cmake -B build && cmake --build build`

## Development Rules
- Follow CONSTITUTION.md design principles
- Keep C++ backend logic separate from Electron UI
- Use TypeScript for frontend with strict mode
- Maintain efficient data structures per constitution
- Auto-save on session completion (backend responsibility)

## IPC Channels
To implement:
- `start-session`: Start a new study session
- `end-session`: End current session with notes
- `get-sessions`: Retrieve session history
- `save-subject`: Create/update subject
- `get-stats`: Fetch statistics

## Next Steps
1. Implement IPC channel bindings
2. Create React/UI components for white screen test
3. Build C++ backend main loop for IPC
4. Add data persistence layer
5. Connect frontend to backend

## Status
- [x] Project scaffolding
- [ ] IPC communication
- [ ] UI components
- [ ] Backend persistence
- [ ] Testing & refinement
