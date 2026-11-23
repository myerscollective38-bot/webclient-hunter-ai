# WebClient Hunter AI

Find local businesses that need a website, score the opportunity, draft outreach, build demo sites and track your pipeline.
Zero npm dependencies. Needs Node 18+.

## Run
```
cd webclient-hunter
cp .env.example .env     # optional
node server.js           # open http://localhost:3000
```

## How it works
- **Search (live, free, no key):** OpenStreetMap Nominatim + Overpass return real business listings with whatever public phone/email/social/website tags exist. Contact details are never invented; missing = "not found publicly".
- **Website analysis:** the server fetches each listed website and checks reachability, HTTPS, mobile viewport tag, outdated copyright year, obsolete tech, and inquiry/booking forms. Results are automated hints, not verified facts — check manually before contacting.
- **Score 0–100:** no site / social only / broken / outdated score high; explanations are shown on each lead.
- **AI (optional):** set `GEMINI_API_KEY` (free tier) for AI-written messages and demo copy. Without it the app runs in **demo mode** using templates built from real lead data.
- **Storage:** `data/db.json` (survives refresh/restart).
- **Nothing is sent automatically.** You copy and send manually.

## Notes
- OpenStreetMap coverage varies by country/niche; many listings lack phone/email. Public Overpass servers can be busy — retry or narrow the city.
- Be polite with Nominatim/Overpass (fair use); don't run searches in rapid loops.
- Follow local anti-spam/marketing laws (e.g. GDPR/PECR for emails to businesses). Don't contact anyone who declined.

## Free deployment
Render / Railway / Fly.io: deploy as a Node web service, start command `node server.js`, set `APP_PASSWORD`. Free tiers have ephemeral disks — attach a persistent disk and set `DATA_DIR`, or export your data periodically. Do not deploy publicly without `APP_PASSWORD`.

## Extending
Add another lead source (e.g. Google Places API) in `server.js`: produce objects shaped like those in `search()`, then reuse `analyze()` and `scoreLead()`.

## Deploy free on Render (starter)

1. Push this project folder to a GitHub repository.
2. On Render, choose **New → Blueprint** and connect that repository. Render reads `render.yaml`.
3. Set the secret environment variable `APP_PASSWORD` to a strong password before deployment. Production startup refuses to run if it is missing.
4. Deploy the free web service. Render provides an HTTPS `onrender.com` URL.

**Free-tier limitations:** Render free web services sleep after 15 minutes idle and wake on the next visit. The filesystem is ephemeral, so saved leads can be lost after restarts, sleeping, or redeploys. This build stores leads in `data/db.json`; use it for testing and export/backup leads frequently. A persistent storage/database upgrade is needed before relying on it for long-term lead records.

This project has no npm runtime dependencies; `npm install --omit=dev` is just a deploy build step.
