# Study Tracker App - Constitution

## 1. Design Philosophy

### Simplicity & Elegance
- **Easy-to-use controls**: Intuitive UI with minimal cognitive load. Users should understand functionality at a glance.
- **Sleek design**: Clean aesthetic with generous whitespace, consistent typography, and purposeful visual hierarchy.
- **Minimal but functional**: No unnecessary features cluttering the interface. Each control serves a clear purpose.
- **Accessibility first**: Ensure controls are easily accessible and responsive to user input.

---

## 2. Core Data Structures & Efficiency

### Study Session Model
```
StudySession {
  id: UUID
  subject: String
  startTime: Timestamp
  endTime: Timestamp (nullable, for ongoing sessions)
  duration: Number (in minutes)
  notes: String
  tags: Set<String> (for quick filtering)
}
```
**Structure choice**: Use `Set<String>` for tags to ensure O(1) lookup time when filtering.

### Subject Tracker
```
Subject {
  id: UUID
  name: String
  color: HexColor
  sessions: List<SessionID> (indexed for quick retrieval)
  totalStudyTime: Number (cached, updated on session completion)
  goalHoursPerWeek: Number
}
```
**Efficiency**: Cache `totalStudyTime` to avoid recalculating from sessions frequently.

### Study Statistics
```
Statistics {
  weeklyBreakdown: Map<DayOfWeek, Number> (study minutes per day)
  subjectDistribution: Map<SubjectID, Number> (total time per subject)
  streakData: {
    currentStreak: Number (days)
    longestStreak: Number (days)
    lastSessionDate: Date
  }
  goals: Map<SubjectID, Number> (target hours)
}
```
**Structure choice**: Use `Map` for O(1) lookups and efficient aggregations.

### Data Persistence Layer
```
StorageManager {
  save(data: AppState): Promise
  load(): Promise<AppState>
  backup(): Promise
  export(format: 'JSON' | 'CSV'): Promise
}
```
**Strategy**: 
- Local storage (IndexedDB for web) or SQLite (for desktop)
- Auto-save after each session completion
- Manual export options for backup

---

## 3. Core Features

### Essential Features (MVP)
1. **Quick Start Button**: Start a study session with one click
2. **Subject Selector**: Choose or add subjects in a dropdown/modal
3. **Timer Display**: Large, readable countdown/elapsed time
4. **Stop/Pause Controls**: Simple button controls for session management
5. **Session History**: Scrollable list of past sessions with timestamps
6. **Weekly Overview**: Visual representation of study time per subject

### Secondary Features (Post-MVP)
- Goal setting per subject
- Streak counter
- Study notes/reflection
- Progress analytics & charts
- Dark mode toggle

---

## 4. Visual Design Principles

### Color Palette
- **Primary**: Clean blue (#2563eb) for main actions
- **Accent**: Warm accent color (#f59e0b) for achievements/goals
- **Neutral**: Greys (#f3f4f6 - #374151) for backgrounds and text
- **Subject Tags**: Distinct, accessible color palette for subject differentiation

### Typography
- **Font Family**: Modern sans-serif (e.g., Inter, Segoe UI, -apple-system)
- **Headlines**: Bold, 24-32px for clarity
- **Body**: Regular, 14-16px for readability
- **Hierarchy**: 3-4 distinct sizes max

### Layout
- **Grid System**: 12-column responsive grid
- **Spacing**: 8px base unit for consistent padding/margins
- **Cards**: Subtle shadows and rounded corners (8px) for depth
- **Icons**: Consistent, medium-weight icons with proper sizing

### Components
- **Buttons**: Rounded corners, proper contrast, hover states
- **Inputs**: Clear focus states, placeholder text, validation feedback
- **Timers**: Large, monospaced font, high contrast
- **Charts**: Clean lines, limited colors, accessible patterns (not color-only)

---

## 5. Data Persistence Strategy

### Auto-Save
- Save session data automatically upon:
  - Session completion
  - Every 30 seconds during sessions (for recovery)
  - Subject/goal changes

### Storage Options
- **Web Version**: IndexedDB (primary) + Cloud sync (optional)
- **Desktop Version**: SQLite local database
- **Backup**: Export to JSON with session + settings data

### Data Structure on Disk
```json
{
  "version": "1.0",
  "lastSaved": "2026-02-24T10:30:00Z",
  "subjects": [...],
  "sessions": [...],
  "goals": {...},
  "preferences": {...}
}
```

### Recovery
- Automatic restoration on app launch
- Session recovery for interrupted studies (within 5 minutes)

---

## 6. User Experience Flow

### Onboarding
1. Welcome screen
2. Add your first subject
3. Set initial weekly goal (optional)
4. Jump into first session

### Main Loop
1. Select Subject → Start Timer → Study → Stop/Complete → Save
2. View stats and progress
3. Adjust goals if needed

### Analytics View
- Weekly breakdown (bar chart)
- Subject comparison (pie chart)
- Streak counter (prominent display)
- Average daily study time

---

## 7. Technical Architecture

### Frontend (UI Layer)
- Clean component-based structure
- State management for sessions and subjects
- Real-time updates to UI

### Data Layer
- Abstraction for storage (easy to swap implementations)
- Efficient querying for statistics
- Structured backups

### Performance Targets
- App loads in < 1 second
- Session start/stop: < 100ms response
- Statistics calculations: < 500ms even with 1000+ sessions

---

## 8. Aesthetic Rules

- **Consistency**: Same fonts, spacing, and colors across all views
- **No Clutter**: Remove any UI element that doesn't directly serve user goals
- **Responsive**: Works seamlessly on mobile, tablet, and desktop
- **Dark Mode**: Optional, maintains contrast ratios and aesthetic consistency
- **Animations**: Subtle, purposeful transitions (200-300ms)

---

## 9. Guiding Principles

> **"Simple, fast, and beautiful"**

Every feature decision should ask:
- Is it necessary? (Does it help track study progress?)
- Is it efficient? (Does it perform well?)
- Is it intuitive? (Can a new user understand it immediately?)
- Is it beautiful? (Does it fit our visual language?)

If any answer is "no", reconsider or redesign.

---

## 10. Success Metrics

- ✅ App launches in < 1 second
- ✅ Users can start a study session in 2 taps/clicks
- ✅ No information loss between sessions
- ✅ Visual design passes accessibility checks (WCAG AA minimum)
- ✅ Users feel motivated by their progress visualization
