# NEORide EZData Schedule — Web App

A web replacement for `EZData_Schedule.xlsm`. Everything the workbook did, without macros, plus a few things it never did.

- **Dashboard** — overall completion (weighted — see below), items due in the next 14 days, in-progress / complete counts, phase summary, near-term actions list, plus an overdue list.
- **Schedule** — the full WBS table with the 48-month Gantt view, phase color coding, and inline editing of leaf rows. The WBS and Task/Subtask columns stay frozen while you scroll right through the Gantt view. Parent rows roll up automatically (min start, max deadline, **weighted** average % of leaf tasks). Marking a task Complete always sets it to 100%. Drag any row by its ⋮⋮ handle to reorder it or drop it onto another row to nest it underneath — hover the top/bottom edge of a row to drop as a sibling before/after it, or the middle to drop inside it as a child. Hovering the seam between two rows also reveals a **+** button to add a brand-new task right there — title, start date, and deadline are required (lead/notes optional); its WBS, level, and phase are derived entirely from where you drop it, exactly like a drag move. WBS numbers, sort order, and rollup percentages all recompute automatically; a formerly-leaf task you add something under becomes a parent row on the spot.
- **Weight** — each leaf task's weight is its duration in days (deadline − start date, inclusive), computed automatically — a 1-day task counts for 1 toward its parent's rollup, a 1000-day task counts for 1000, so long-running or recurring line items aren't diluted by lots of small finished tasks. Not editable directly; change the dates to change the weight.
- **Marking a task Complete always sets it to 100%**, no matter what the % field said before — enforced on the server so this holds however the change was made (inline edit, Add Task form, or AI fill).
- **Add task** — the Task Entry form. WBS numbers are generated and the line is inserted into the right block automatically, exactly like the old `SubmitTask` macro (including "new subtask" creation). Optionally, speak or type a plain-language description ("Josh needs to draft the security plan outline by next Friday, medium priority") and AI fills in the form fields for you to review before submitting — see the `ANTHROPIC_API_KEY` setup below.
- **Meetings** — create a dated agenda that auto-imports a snapshot of what's due in the next two weeks (as a table, same columns as the dashboard's near-term list) under an "EZData" section, plus a "NEORide Technology On-Call Projects" section for anything else. Add your own discussion items, then mark up the agenda live during the meeting — a "Meeting mode" toggle colors newly typed text so notes are visually distinct from the pre-meeting agenda. Bold/italic/font-color, new headers, and Tab/Shift+Tab to indent/outdent bullets are also available. Title and date are editable any time. Every meeting is saved and browsable from a history list. **Any meeting dated today or later has its "upcoming two weeks" table kept in sync automatically whenever the schedule changes** — past meetings are a frozen historical record and are never touched. Download any meeting as a real Word (.docx) or PDF document, or send it straight to a Dropbox folder.
- **Export** — CSV, or Excel (.xlsx) which mirrors the on-screen formatting (row shading, status/weight chips, frozen columns) and renders the Gantt chart as colored month cells, plus a phase-color legend sheet.

Your full schedule data is included in `seed.json` and loads automatically the first time the app starts against an empty database.

---

## Deploy to Railway (about 10 minutes)

### Option A — deploy from GitHub (recommended)

1. **Put this folder in a GitHub repo.**
   ```bash
   cd ezdata-schedule
   git init
   git add .
   git commit -m "EZData schedule web app"
   ```
   Create a repo on github.com (private is fine), then:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/ezdata-schedule.git
   git push -u origin main
   ```

2. **Create the Railway project.** At [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → pick `ezdata-schedule`. Railway detects Node.js and runs `npm start` automatically.

3. **Add a Postgres database.** In the project canvas: **+ Create** → **Database** → **PostgreSQL**. Then open your app service → **Variables** → **Add Variable Reference** → select `DATABASE_URL` from the Postgres service. (If Railway offers to link it automatically, accept.)

4. **Redeploy** the app service (Deployments → ⋮ → Redeploy). On first boot it creates the `tasks` and `meetings` tables and seeds tasks from `seed.json` — you'll see `Seeded 55 tasks` in the deploy logs.

5. **Get your URL.** App service → **Settings** → **Networking** → **Generate Domain**. That's the link you share with the team.

6. **(Recommended) Add a password.** The URL is public by default. In the app service → **Variables** → add `APP_PASSWORD` = anything you like. The site will then prompt for it (leave the username blank). Share the password with Jenna, Katherine, etc.

7. **(Optional) Enable "Send to Dropbox".** Requires a Dropbox app with **Full Dropbox** access (not "App folder" — that scope can only reach its own sandboxed folder, not an existing shared one) if you want exports to land in a folder you already use:
   - Create an app at [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps), scoped access → Full Dropbox, enable the `files.content.write` permission.
   - Authorize it and exchange the code for a refresh token (see Dropbox's OAuth2 docs — the short version: hit `/oauth2/authorize?client_id=...&token_access_type=offline&response_type=code`, then POST the returned code to `/oauth2/token` to get a `refresh_token`).
   - Add Railway variables: `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN`, and `DROPBOX_FOLDER` (the exact path of your destination folder, e.g. `/Team Meetings` — found from the folder's breadcrumb path in Dropbox, not its share link).
   - Any time you add/change Railway variables, you must **Deploy** the pending changes (or Redeploy) — the running server won't see them until it restarts.
   - Check `/api/dropbox/status` on your deployed app any time to see whether it's connected and which variables (if any) are missing.

8. **(Optional) Enable AI fill on the Add Task tab.** Get an API key from [console.anthropic.com](https://console.anthropic.com), add it as a Railway variable named `ANTHROPIC_API_KEY`, then Deploy the pending change. The "Fill with AI" panel appears automatically once it's detected (check `/api/ai/status`). Voice input uses the browser's built-in speech recognition (Chrome/Edge) with a typed-text fallback everywhere else — either way, the AI only fills the form; you still review and submit it yourself.

### Option B — Railway CLI (no GitHub)

```bash
npm install -g @railway/cli
railway login
cd ezdata-schedule
railway init          # create a new project
railway add           # choose PostgreSQL
railway up            # deploy this folder
railway domain        # generate the public URL
```

Then link `DATABASE_URL` to the app service in the dashboard as in step 3 above if it isn't linked automatically.

---

## Run locally (no database needed)

```bash
npm install
npm start
# open http://localhost:3000
```

With no `DATABASE_URL` set, the app uses a local SQLite file (`data.db`) — handy for trying things before they touch the team's data.

## How it maps to the workbook

| Workbook | Web app |
|---|---|
| Dashboard sheet formulas | `GET /api/dashboard` |
| Schedule sheet + hidden helper columns (BG/BH/BI) + Gantt formulas | `GET /api/schedule` (rollups computed server-side, weighted by task weight) + Gantt rendered in the browser |
| Task Entry sheet + `SubmitTask` macro | Add task form → `POST /api/tasks` |
| Hidden Lists sheet | `GET /api/lists` (derived live from the data, so new leads appear automatically) |
| Editing cells directly | Edit button on any leaf row → `PATCH /api/tasks/:id` |
| — | `DELETE /api/tasks/:id`, `GET /api/export.csv`, `GET /api/export.xlsx` |
| Dragging a row on the Schedule tab | `POST /api/tasks/:id/move` (renumbers WBS/sort/phase for the moved subtree and any shifted siblings) |
| The "+" between rows on the Schedule tab | `POST /api/tasks/insert` (creates the task, then runs it through the same renumbering engine as a move) |
| — | Meeting agendas/minutes → `GET/POST /api/meetings`, `GET/PATCH/DELETE /api/meetings/:id`, `.../export.docx`, `.../export.pdf`, `.../dropbox` |

## Notes / known data quirks carried over from the workbook

- **Three rows were invisible to the old dashboard.** Rows for *Agency Interviews (2.1.4)*, *Draft SEMP*, and *Final SEMP* were inserted into the sheet without the hidden helper formulas, so Excel excluded them from every completion metric. The web app includes them, which is why overall completion reads differently here than in the old Excel file — the web number is the correct one.
- **Duplicate WBS "2.1.3".** *Draft SEMP* and *Final SEMP* both carry WBS 2.1.3 (also used by *Synthesize discovery findings*), even though they sit under 2.2 Systems Engineering Management Plan. The data was preserved exactly as-is; you can renumber them with the Edit button (e.g. retitle them or fold them under 2.2 by deleting and re-adding with "Existing subtask: 2.2").

## Backups

Railway Postgres supports backups from the database service's **Backups** tab. You can also hit **Export ▾ → CSV** or **→ Excel** in the app any time — Excel captures the full computed schedule with formatting; CSV is the lightest-weight option.
