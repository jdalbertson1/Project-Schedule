# NEORide EZData Schedule — Web App

A web replacement for `EZData_Schedule.xlsm`. Everything the workbook did, without macros:

- **Dashboard** — overall completion, items due in the next 14 days, in-progress / complete counts, phase summary, near-term actions list, plus an overdue list (new).
- **Schedule** — the full WBS table with the 48-month Gantt view, phase color coding, and inline editing of leaf rows. Parent rows roll up automatically (min start, max deadline, average % of leaf tasks — same math as the hidden formula columns).
- **Add task** — the Task Entry form. WBS numbers are generated and the line is inserted into the right block automatically, exactly like the old `SubmitTask` macro (including "new subtask" creation).
- **Export CSV** — download the computed schedule any time.

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

4. **Redeploy** the app service (Deployments → ⋮ → Redeploy). On first boot it creates the `tasks` table and seeds it from `seed.json` — you'll see `Seeded 55 tasks` in the deploy logs.

5. **Get your URL.** App service → **Settings** → **Networking** → **Generate Domain**. That's the link you share with the team.

6. **(Recommended) Add a password.** The URL is public by default. In the app service → **Variables** → add `APP_PASSWORD` = anything you like. The site will then prompt for it (leave the username blank). Share the password with Jenna, Katherine, etc.

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
| Schedule sheet + hidden helper columns (BG/BH/BI) + Gantt formulas | `GET /api/schedule` (rollups computed server-side) + Gantt rendered in the browser |
| Task Entry sheet + `SubmitTask` macro | Add task form → `POST /api/tasks` |
| Hidden Lists sheet | `GET /api/lists` (derived live from the data, so new leads appear automatically) |
| Editing cells directly | Edit button on any leaf row → `PATCH /api/tasks/:id` |
| — | `DELETE /api/tasks/:id`, `GET /api/export.csv` (new) |

## Notes / known data quirks carried over from the workbook

- **Three rows were invisible to the old dashboard.** Rows for *Agency Interviews (2.1.4)*, *Draft SEMP*, and *Final SEMP* were inserted into the sheet without the hidden helper formulas, so Excel excluded them from every completion metric. The web app includes them, which is why overall completion reads **13.1%** here vs **14.2%** in Excel — the web number is the correct one.
- **Duplicate WBS "2.1.3".** *Draft SEMP* and *Final SEMP* both carry WBS 2.1.3 (also used by *Synthesize discovery findings*), even though they sit under 2.2 Systems Engineering Management Plan. The data was preserved exactly as-is; you can renumber them with the Edit button (e.g. retitle them or fold them under 2.2 by deleting and re-adding with "Existing subtask: 2.2").

## Backups

Railway Postgres supports backups from the database service's **Backups** tab. You can also just hit **Export CSV** in the app periodically — it captures the full computed schedule.
