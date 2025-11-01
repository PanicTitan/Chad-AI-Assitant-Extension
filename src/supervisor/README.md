# Supervisor UI - Component Documentation

## Overview
A comprehensive task supervision UI for the Chrome extension that monitors user activity and provides alerts when off-task. Features dark/light mode support, optional task timers, and detailed session statistics.

## Components

### 1. **SupervisorControls** (`SupervisorControls.tsx`)
The initial setup interface where users define their task and monitoring preferences.

**Features:**
- Task input field with text and voice support
- Notification type selector (Notification or Voice)
- Check interval selector (5s, 10s, or 15s)
- Rigor level selector (Low, Medium, High) with color-coded indicator
- **Optional timer** - Enable/disable with minutes input (1-240 min)
- **Pause on blur** - Auto-pause when window loses focus
- Theme-aware using Ant Design tokens

**Props:**
```typescript
interface SupervisorControlsProps {
  onStart: (config: SupervisorConfig) => void;
}

interface SupervisorConfig {
  task: string;
  notificationType: 'notification' | 'voice';
  checkInterval: 5 | 10 | 15;
  rigor: 'low' | 'medium' | 'high';
  timerEnabled: boolean;
  timerMinutes?: number;
  pauseOnWindowFocus: boolean;
}
```

---

### 2. **SupervisorMonitoring** (`SupervisorMonitoring.tsx`)
The active monitoring interface displayed while a task is being supervised.

**Features:**
- Real-time elapsed time counter (HH:MM:SS or MM:SS format)
- **Task timer countdown** - Shows remaining time when timer is enabled
- Countdown to next check (highlights when ≤3 seconds)
- Alert counter (highlights in red when >0)
- Status tag showing current state:
  - "On Task" (green) - user is focused
  - "Off Task" (orange) - user is not focused
  - "Paused" (blue) - monitoring paused
- Progress bars for next check and task timer
- Control buttons (Pause/Resume and Stop)
- **Window focus detection** - Auto-pauses/resumes based on settings
- Full theme support (dark/light mode)

**Props:**
```typescript
interface SupervisorMonitoringProps {
  initialState: MonitoringState;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

interface MonitoringState {
  task: string;
  status: 'running' | 'paused' | 'stopped';
  elapsedTime: number;
  nextCheckIn: number;
  checkInterval: number;
  onFocus: boolean;
  alertCount: number;
  timerMinutes?: number;
  pauseOnWindowFocus: boolean;
}
```

---

### 3. **SupervisorStats** (`SupervisorStats.tsx`) ✨ NEW
Final session statistics displayed after task completion.

**Features:**
- **Focus performance grade** - Visual feedback with icon (Trophy, Check, Fire, Warning)
- **Circular progress** - Shows focus percentage (0-100%)
- **Statistics cards:**
  - Total Time
  - Focused Time (highlighted in green)
  - Alert Count (red if >0)
- **AI-generated summaries:**
  - Activity Summary - What user was doing
  - Distraction Analysis - What caused distractions
- "Start New Task" button to return to setup
- Full theme support

**Props:**
```typescript
interface SupervisorStatsProps {
  stats: TaskStats;
  onNewTask: () => void;
}

interface TaskStats {
  task: string;
  totalTime: number;
  focusedTime: number;
  alertCount: number;
  activitySummary: string;
  distractionSummary: string;
}
```

**Grading System:**
- 90-100%: Excellent! 🏆
- 70-89%: Great! ✓
- 50-69%: Good 🔥
- 0-49%: Needs Improvement ⚠️

---

### 4. **SupervisorHistory** (`SupervisorHistory.tsx`)
Displays a list of recently completed tasks with statistics.

**Features:**
- Shows last 5 completed tasks
- Displays task name, duration, alert count, and time ago
- Empty state when no tasks exist
- Scrollable list with theme-aware styling
- Hover effects on list items

---

### 5. **Supervisor** (Main component - `index.tsx`)
The main container that orchestrates all supervisor components.

**State Management:**
- `appState`: 'setup' | 'monitoring' | 'stats' - controls which view to show
- `currentConfig`: SupervisorConfig | null - stores task configuration
- `monitoringState`: MonitoringState | null - tracks active session
- `taskHistory`: TaskHistory[] - stores completed tasks (max 5)
- `currentStats`: TaskStats | null - stores final session statistics

**Flow:**
1. **Setup** → User defines task and preferences → `handleStart()`
2. **Monitoring** → Real-time tracking with auto-pause/resume
3. **Stats** → Session complete, show performance analysis
4. **New Task** → Return to setup

**Integration Points (TODO):**
```typescript
// In handleStart():
// TODO: Start actual monitoring logic
// - Initialize screen capture/monitoring
// - Start LLM analysis intervals based on checkInterval
// - Set up notification/voice alert handlers
// - If timerMinutes is set, schedule timer completion

// In handleStop():
// TODO: Generate AI summaries
// - Calculate actual focusedTime from monitoring data
// - Generate activitySummary via LLM
// - Generate distractionSummary via LLM
// - Save session data to Chrome storage
```

---

## Theme Support 🎨

All components use Ant Design theme tokens for colors:
- `token.colorBgContainer` - Background colors
- `token.colorBorder` - Border colors
- `token.colorText*` - Text colors (primary, secondary, quaternary)
- `token.colorSuccess/Warning/Error/Info` - Status colors
- `token.borderRadius*` - Border radius values

**Benefits:**
- ✓ Automatic dark/light mode switching
- ✓ Consistent color palette
- ✓ Accessibility compliance
- ✓ Easy customization via ConfigProvider

---

## Styling

Enhanced glass morphism with theme awareness:
- **Glass container**: `backdrop-filter: blur(20px)` with theme background
- **Responsive design**: Adapts to different screen sizes
- **Smooth transitions**: 0.3s ease on state changes
- **Custom scrollbars**: Themed for history list
- **Hover effects**: Subtle lift on interactive elements

---

## Visual States

### Setup State (Default)
```
┌──────────────────────────────────┐
│          [Mascot]                │
│                                  │
│  ┌────────────────────────────┐  │
│  │ [Options Bar]              │  │
│  │ Notify•Check•Rigor•Timer   │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │ What do you want to        │  │
│  │ focus on?                  │  │
│  └────────────────────────────┘  │
│                                  │
│  Recent Tasks                    │
│  • Study - 45m - 2h ago          │
│  • Code - 30m - 5h ago           │
└──────────────────────────────────┘
```

### Monitoring State (Active)
```
┌──────────────────────────────────┐
│       [Mascot (floating)]        │
│                                  │
│  Current Task: Study for exam    │
│                    [On Task 🟢]  │
│                                  │
│  Task Timer                      │
│  [▓▓▓▓▓▓▓░░░░░] 15:30 left      │
│                                  │
│  ┌────────────────────────────┐  │
│  │ 09:30 │   7s   │     0     │  │
│  │Elapsed│  Next  │  Alerts   │  │
│  └────────────────────────────┘  │
│                                  │
│  [Progress: ▓▓▓▓▓░░░░░]         │
│                                  │
│  [Pause]              [Stop]     │
└──────────────────────────────────┘
```

### Stats State (Final) ✨ NEW
```
┌──────────────────────────────────┐
│              🏆                   │
│           Excellent!             │
│        Task Completed            │
│                                  │
│  ┌────────────────────────────┐  │
│  │   Focus Performance        │  │
│  │        ╱───╲               │  │
│  │       │ 92% │              │  │
│  │        ╲───╱               │  │
│  │       Focused              │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌──────┐ ┌──────┐ ┌──────┐    │
│  │ 45m  │ │ 41m  │ │  2   │    │
│  │Total │ │Focus │ │Alert │    │
│  └──────┘ └──────┘ └──────┘    │
│                                  │
│  ✓ Activity Summary              │
│  User worked on coding tasks...  │
│                                  │
│  ! Distraction Analysis          │
│  Brief social media checks...    │
│                                  │
│  [Start New Task]                │
└──────────────────────────────────┘
```

---

## Next Steps

To complete the monitoring functionality:

1. **Screen Capture**: Use Chrome extension APIs (`chrome.tabs.captureVisibleTab`)
2. **LLM Integration**: 
   - Send screenshots to AI with task context
   - Determine if user is focused or distracted
   - Generate activity and distraction summaries
3. **Notification System**: 
   - Browser notifications (`chrome.notifications`)
   - Text-to-speech for voice alerts (`speechSynthesis`)
4. **Persistence**: 
   - Save task history to `chrome.storage.local`
   - Store preferences and settings
5. **Timer Logic**:
   - Auto-stop when timer expires
   - Show completion notification
6. **Window Focus**:
   - Already implemented UI-side
   - Add background script integration for reliable detection

---

## Usage Example

```typescript
import Supervisor from '@/supervisor';

// The component is self-contained and manages its own state
<Supervisor />
```

The component handles everything internally with full theme support!
