# BallonDiary — self-hosted version

This folder has everything needed to host BallonDiary yourself, with a real
head-to-head goals average pulled from API-Football instead of the
illustrative estimates used in the claude.ai artifact version.

```
ballondiary-backend/
├── index.html      the app itself (same file as the claude.ai artifact)
└── api/
    └── h2h.js       serverless function that fetches head-to-head data
```

## 1. Get an API-Football key

1. Go to https://rapidapi.com/api-sports/api/api-football and subscribe to
   the free tier (100 requests/day, enough to try this out).
2. Copy your RapidAPI key from the dashboard.

## 2. Deploy to Vercel

1. Install the Vercel CLI: `npm install -g vercel`
2. From inside this folder, run: `vercel`
   (Follow the prompts — accept the defaults; no build step is needed since
   this is a plain HTML file plus one serverless function.)
3. Add your API key as a secret environment variable:
   `vercel env add RAPIDAPI_KEY`
   Paste your key when prompted, and select all three environments
   (Production, Preview, Development).
4. Deploy for real: `vercel --prod`

You'll get a URL like `https://ballondiary-yourname.vercel.app`. Open it —
this is now your real, self-hosted app, not a claude.ai artifact.

## 3. Test the API function

Visit `https://your-deployment.vercel.app/api/h2h?home=Arsenal&away=Chelsea`
directly in a browser. You should see JSON like:

```json
{ "avgGoals": 2.83, "meetings": 6 }
```

If you get an error about team names, see the note in `api/h2h.js` about
hardcoding team IDs for ambiguous club names.

## 4. Wire the app up to use it

Inside `index.html`, find the `fixtures` array (search for `const fixtures`).
Each entry currently has hardcoded `avgGoals` and `meetings` values. Replace
the static array with a version fetched at load time — add this near the top
of the `<script>` block, and call it before `fixturesRanked` is computed:

```js
async function loadRealH2H(fixtures) {
  const results = await Promise.all(fixtures.map(async f => {
    try {
      const res = await fetch(`/api/h2h?home=${encodeURIComponent(f.home)}&away=${encodeURIComponent(f.away)}`);
      const data = await res.json();
      return { ...f, avgGoals: data.avgGoals ?? f.avgGoals, meetings: data.meetings ?? f.meetings };
    } catch (e) {
      return f; // fall back to the illustrative estimate if the call fails
    }
  }));
  return results;
}
```

Then, since `fixturesRanked` is currently computed synchronously at load,
you'll want to move the `hype()` scoring and the Look Out For render into an
async init step that awaits `loadRealH2H(fixtures)` first, then computes
`fixturesRanked` from the real data, then calls `renderAll()`. Show a brief
loading state in the Look Out For tab while that fetch is in flight.

## Notes

- The free API-Football tier is rate-limited (100 requests/day) — with 14
  fixtures that's 14 calls per full page load, so cache results (e.g. in
  `localStorage` with a timestamp) rather than re-fetching on every visit.
- Real upcoming fixtures would need a similar swap — API-Football's
  `/v3/fixtures` endpoint by league and date range covers that, but isn't
  wired in here yet.
- Once this is self-hosted, "Add to Home Screen" and PWA install behave
  exactly as discussed earlier in this conversation, but now against your
  own domain instead of the claude.ai artifact link.
