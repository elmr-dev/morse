# Product Requirements Document: RufzXP Web

## 1. Overview

**Product Name:** RufzXP Web (working title)
**Type:** Static single-page web application (Vite + TypeScript + React)
**Purpose:** A browser-based CW (Morse code) callsign copy trainer faithful to the original RufzXP desktop application by DL4MM and IV3XYM. The app plays Morse-encoded amateur radio callsigns and challenges the user to type what they hear, adaptively increasing or decreasing speed based on accuracy.

**Out of Scope:** The Morse code audio engine and React audio component already exist and are assumed ready for integration. This PRD covers the product layer only: game loop, scoring, settings, UI, and local persistence.

---

## 2. Core Concept (Alignment with RufzXP)

"Rufz" is short for the German *Rufzeichen-Hören* — "listening to callsigns." The original RufzXP:

- Sends a configurable number of **real amateur radio callsigns** (default: **50**) one at a time in CW.
- After each callsign is played, the user types their answer and presses Enter.
- **Correct answer →** speed increases slightly for the next callsign.
- **Incorrect answer →** speed decreases slightly for the next callsign.
- The software automatically adapts to the user's maximum performance threshold.
- Every callsign can be **replayed once** by pressing a key (F6 in original), but with a **50% point penalty** for that callsign.
- At the end of the run, a total score is displayed.
- Scoring depends primarily on: CW speed at time of sending, accuracy (number of correct characters), and callsign length. Typing speed has minor influence.
- It is **not** a contest simulator — no QRM, QSB, or other noise artifacts.

---

## 3. User Flow

### 3.1 Start Screen

The user lands on a single-page app with:

1. **Callsign input** — the user enters their own amateur radio callsign (or any identifier/nickname). This is persisted in localStorage and pre-filled on return visits.
2. **Starting speed** — a numeric input for initial CW speed, displayed in both **WPM** (words per minute, Paris standard) and **CPM** (characters per minute). Default: 20 WPM / 100 CPM. Persisted in localStorage.
3. **Start button** — begins the attempt.

Optional settings (accessible via a gear/settings icon, see §6) are configured before starting.

### 3.2 Active Attempt (Game Loop)

Once started, the following loop repeats for each of the N callsigns in the attempt:

1. **Callsign generation** — a callsign is randomly selected from the callsign database (see §5).
2. **Audio playback** — the Morse audio engine plays the callsign at the current speed.
3. **User input** — a text input field is focused and the user types their answer.
   - Input should be **auto-uppercased** (callsigns are always uppercase).
   - The `/` character should also be accepted (some callsigns use it, e.g., `KH6/W3GW`). The `-` key can serve as an alias for `/`, matching the original RufzXP behavior.
4. **Submission** — pressing **Enter** submits the answer.
5. **Evaluation** — the app compares the typed answer to the sent callsign.
   - **Exact match:** speed increases; full points awarded.
   - **Partial/no match:** speed decreases; partial or zero points awarded.
6. **Feedback row** — after submission, the current callsign is added to a scrolling result log showing: callsign number (1–50), sent callsign, user's answer, speed at which it was sent, points earned, and a visual correct/incorrect indicator.
7. **Speed adjustment** — the new speed is calculated (see §4.2) and the next callsign begins playback after a brief pause (~0.5–1s).

### 3.3 Replay (F6 Equivalent)

- During step 3 (before submitting), the user can press a **Replay button** or a keyboard shortcut (e.g., `F6` or a clearly labeled on-screen button) to hear the current callsign **one more time**.
- Replay is allowed **once per callsign**.
- Using replay imposes a **50% point penalty** on that callsign's score.
- After replay, the button is disabled for the current callsign.

### 3.4 Abort

- The user can **abort** the attempt at any time via an Abort/Stop button or `Escape` key.
- Aborting ends the attempt early and shows the results summary with only the callsigns completed so far. The score is still calculated but marked as an incomplete attempt.

### 3.5 End-of-Run Summary

After all callsigns have been attempted (or the attempt is aborted):

1. **Total score** — prominently displayed.
2. **Statistics:**
   - Number of callsigns correct / total attempted
   - Accuracy percentage
   - Starting speed → peak speed reached → ending speed
   - Average speed across the attempt
3. **Per-callsign breakdown table** — the full result log (callsign number, sent, received, speed, points, replay used).
4. **High score comparison** — if the total score exceeds the user's stored high score, display a "New High Score!" indicator and update localStorage.
5. **Actions:**
   - "Try Again" → returns to start screen with same settings
   - "View High Scores" → shows local scoreboard

---

## 4. Scoring System

### 4.1 Per-Callsign Points

The point calculation for each callsign should approximate the original RufzXP formula. Based on analysis of the original and the open-source QRQ clone:

```
base_points = speed_cpm * callsign_length
```

Where:
- `speed_cpm` = the CW speed in characters per minute at which the callsign was sent.
- `callsign_length` = number of characters in the sent callsign.

**Accuracy modifier:**

```
correct_chars = number of characters in the user's answer that match the sent callsign (using character-by-character comparison with alignment)
accuracy_ratio = correct_chars / callsign_length
points = base_points * accuracy_ratio
```

- **Exact match:** `accuracy_ratio = 1.0` → full points.
- **Completely wrong:** `accuracy_ratio = 0.0` → zero points.
- **Partial match:** proportional credit based on how many characters were correct.

**Replay penalty:**

If the user used the replay feature on this callsign:
```
points = points * 0.5
```

**Typing speed factor (minor):**

The original RufzXP notes that typing time has "minor influence." To approximate:
```
// Optional: slight bonus/penalty based on response time
// If response time > 2x the callsign's play duration, apply 0.9 multiplier
// If response time < 0.5x the callsign's play duration, apply 1.05 multiplier
// Otherwise, no adjustment
```

This factor is optional for V1 and can be added later.

### 4.2 Speed Adjustment

After each callsign, the speed is adjusted:

- **Correct answer (exact match):** speed increases by a fixed increment.
- **Incorrect answer (any error):** speed decreases by a fixed increment.

**Increment:** Based on QRQ's open-source implementation: **±10 CPM (±2 WPM)**.

To align more closely with RufzXP's smoother curve, an alternative is a **percentage-based increment** (e.g., ±2–5% of current speed), which scales better at higher speeds. Recommended default: **+2 WPM on correct, -2 WPM on incorrect**, with a configurable option (see §6).

**Speed floor:** The speed should never drop below **10 CPM (2 WPM)** or the user's configured minimum.

**Speed ceiling:** No hard ceiling. RufzXP supports speeds up to 1000 CPM (200 WPM) and beyond.

### 4.3 Total Score

```
total_score = sum of all per-callsign points (rounded to nearest integer)
```

The total score is the primary metric stored and compared for high scores.

---

## 5. Callsign Database

### 5.1 Requirements

RufzXP uses a database of **real amateur radio callsigns** drawn from contest logs. The web version needs a similar database.

**Callsign database specification:**
- A JSON array (or newline-delimited text file bundled in the app) of real-world amateur radio callsigns.
- Minimum **5,000 callsigns** for variety; ideally 10,000+.
- Callsigns should represent international diversity (prefixes from multiple DXCC entities/countries).
- Typical callsign format: 1–2 character prefix + digit + 1–3 character suffix (e.g., `W1AW`, `DL4MM`, `JA1ABC`, `VK2IO`).

### 5.2 Sources

Publicly available sources for real callsign data:
- **Super Check Partial (SCP)** files from contest logging programs (e.g., `MASTER.SCP` from N1MM+). These contain tens of thousands of active contest callsigns.
- The QRQ open-source project bundles a `callbase.qcb` file of real callsigns.
- Public contest log databases.

### 5.3 Selection Algorithm

For each callsign in an attempt:
- Randomly select from the database **without replacement** within a single attempt (no repeats in one run).
- No weighting or filtering needed for V1 (future versions could filter by prefix/region).

---

## 6. Settings

All settings are persisted in `localStorage`.

| Setting | Type | Default | Description |
|---|---|---|---|
| **User callsign** | Text | (empty) | Identifier shown on scoreboard |
| **Starting speed** | Number (WPM) | 20 WPM | Initial CW speed for each attempt |
| **Tone frequency** | Number (Hz) | 600 Hz | Sidetone pitch for CW audio |
| **Callsigns per attempt** | Number | 50 | Number of callsigns per run (range: 10–100) |
| **Speed mode** | Toggle | Adaptive | "Adaptive" (speed changes) vs. "Fixed" (constant speed throughout) |
| **Speed increment** | Number (WPM) | 2 | How much speed changes on correct/incorrect (only in Adaptive mode) |

### 6.1 Settings UI

- Accessible via a gear icon on the start screen.
- Opens a modal or slide-out panel.
- Changes take effect on the next attempt.
- A "Reset to Defaults" button restores factory settings.

---

## 7. Local Persistence (localStorage)

### 7.1 Data Stored

| Key | Value | Purpose |
|---|---|---|
| `rufzweb_settings` | JSON object of all settings | Persist user preferences |
| `rufzweb_highscores` | JSON array of top 20 scores | Local leaderboard |
| `rufzweb_history` | JSON array of last 50 attempts (summary only) | Progress tracking |

### 7.2 High Score Entry

Each high score entry:

```typescript
interface HighScoreEntry {
  callsign: string;        // user's identifier
  score: number;           // total points
  date: string;            // ISO timestamp
  numCallsigns: number;    // how many callsigns in the attempt
  startSpeed: number;      // starting WPM
  peakSpeed: number;       // highest WPM reached
  accuracy: number;        // percentage correct (0-100)
  complete: boolean;       // whether all callsigns were attempted
}
```

### 7.3 History Entry

Each history entry (for progress tracking chart):

```typescript
interface HistoryEntry {
  date: string;
  score: number;
  startSpeed: number;
  peakSpeed: number;
  endSpeed: number;
  accuracy: number;
  numCallsigns: number;
  complete: boolean;
}
```

---

## 8. UI Layout & Screens

### 8.1 Start Screen

```
┌──────────────────────────────────────────┐
│              RufzXP Web                  │
│         CW Callsign Trainer              │
│                                          │
│  Your Call: [___________]    ⚙ Settings  │
│                                          │
│  Start Speed: [20] WPM  (100 CPM)       │
│                                          │
│         [ ▶ START ]                      │
│                                          │
│  High Score: 24,518     Best Speed: 45   │
│                                          │
│  [View Scores]  [View Progress]          │
└──────────────────────────────────────────┘
```

### 8.2 Active Attempt Screen

```
┌──────────────────────────────────────────┐
│  #12/50    Speed: 26 WPM    Score: 4,230 │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │  Type what you hear:             │    │
│  │  [W1AW____________]  [🔄 Replay] │    │
│  └──────────────────────────────────┘    │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │ #  Sent     Rcvd     WPM  Pts   │    │
│  │ 11 DL4MM   DL4MM    25   625  ✓ │    │
│  │ 10 JA1ABC  JA1ABD   24   360  ✗ │    │
│  │  9 W6NEL   W6NEL    23   575  ✓ │    │
│  │ ...                              │    │
│  └──────────────────────────────────┘    │
│                                     [⏹] │
└──────────────────────────────────────────┘
```

**Key elements:**
- **Status bar** at top: current callsign number, current speed, running score.
- **Input area** center: text field (auto-focused, auto-uppercase), replay button.
- **Result log** below: scrollable list showing most recent results, newest on top.
- **Stop button** in corner to abort.

### 8.3 Results Summary Screen

```
┌──────────────────────────────────────────┐
│           Attempt Complete!               │
│                                          │
│       Total Score: 28,450                │
│       🏆 New High Score!                 │
│                                          │
│  Correct: 38/50 (76%)                   │
│  Speed: 20 → 34 → 28 WPM               │
│         (start → peak → end)            │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │ Full breakdown table...          │    │
│  │ (scrollable, all 50 rows)        │    │
│  └──────────────────────────────────┘    │
│                                          │
│  [ Try Again ]       [ High Scores ]     │
└──────────────────────────────────────────┘
```

### 8.4 High Scores Screen

- Table of top 20 local scores.
- Columns: Rank, Callsign, Score, Peak Speed, Accuracy, Date.
- Option to clear all scores.

### 8.5 Progress Screen (Optional V1.1)

- Line chart of scores over time (last 50 attempts from history).
- Helps users track improvement, mirroring RufzXP's training progress tools.

---

## 9. Keyboard Shortcuts

| Key | Action | Context |
|---|---|---|
| `Enter` | Submit answer | During attempt |
| `F6` | Replay current callsign (once) | During attempt, before submission |
| `Escape` | Abort attempt | During attempt |
| `F5` or `Enter` | Start new attempt | Start screen |

---

## 10. Character Comparison Algorithm

When comparing the user's answer to the sent callsign:

1. **Normalize:** uppercase both strings, trim whitespace.
2. **Exact match check:** if strings are identical → 100% correct.
3. **Character-level comparison:** Use a simple positional comparison (character by character, left-aligned). Count matching characters at each position up to the length of the shorter string. This is simpler than Levenshtein distance and matches the original RufzXP behavior where partial credit is based on how many characters are in the correct position.

```typescript
function scoreAnswer(sent: string, received: string): number {
  const s = sent.toUpperCase().trim();
  const r = received.toUpperCase().trim();
  if (s === r) return s.length; // all correct
  
  let correct = 0;
  const maxLen = Math.max(s.length, r.length);
  for (let i = 0; i < Math.min(s.length, r.length); i++) {
    if (s[i] === r[i]) correct++;
  }
  return correct;
}
```

---

## 11. Speed / Unit Conversions

RufzXP displays speed in CPM (characters per minute). Many hams also think in WPM. The app should support both.

```
WPM (Paris) = CPM / 5
CPM = WPM * 5
```

The "Paris" standard defines one "word" as 5 characters (the word "PARIS"). Display both units wherever speed is shown.

---

## 12. Technical Constraints

- **Framework:** Vite + TypeScript + React (static SPA).
- **Audio:** Existing Morse code audio engine / React component (provided externally).
- **Storage:** localStorage only. No backend, no accounts, no network calls.
- **Hosting:** Static files, deployable to any CDN/static host.
- **Browser support:** Modern browsers (Chrome, Firefox, Safari, Edge — latest 2 versions).
- **Mobile:** Responsive layout. Functional on mobile (though desktop with keyboard is the primary UX).

---

## 13. Acceptance Criteria

1. User can configure their callsign, starting speed, and tone pitch, and these persist across sessions.
2. Pressing Start plays 50 (configurable) callsigns sequentially in Morse code.
3. Speed adapts up on correct answers and down on incorrect answers.
4. Replay works once per callsign with 50% point penalty.
5. Per-callsign results are shown in real-time during the attempt.
6. End-of-run summary shows total score, accuracy, speed range, and full breakdown.
7. High scores are stored locally and displayed in a leaderboard.
8. All settings are persisted in localStorage.
9. Fixed-speed mode works (speed does not change throughout the attempt).
10. The app works entirely offline after initial load (no network dependencies during use).

---

## 14. Future Considerations (Post-V1)

- **Progress chart** — score-over-time graph using attempt history.
- **Custom callsign databases** — allow users to upload a .txt file of custom words/callsigns (matching RufzXP's "Personal Callbase" trainer mode).
- **Online toplist** — optional submission of scores to a shared leaderboard (would require a minimal backend).
- **Farnsworth spacing** — option to send characters at high speed but with extra spacing between characters (useful for learners).
- **Speed increment modes** — percentage-based increment (e.g., ±5% of current speed) as an alternative to fixed ±2 WPM.
- **Session statistics** — rolling averages, best-of-last-10, trend indicators.
- **PWA support** — service worker for full offline capability and home screen install.
- **Keyboard-only navigation** — full accessibility for the entire app without mouse.
