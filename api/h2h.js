// api/h2h.js
//
// Vercel serverless function: given two team names, returns an average-goals
// figure computed from their recent head-to-head meetings, via API-Football's
// own direct API (not the RapidAPI marketplace — signing up directly at
// dashboard.api-football.com is simpler). Deploy this alongside your app's
// HTML on Vercel so it's on the same origin — see the README for full steps.
//
// Call it like:
//   /api/h2h?home=Arsenal&away=Chelsea&last=6

const API_HOST = 'v3.football.api-sports.io';

async function apiFootball(path) {
  const res = await fetch(`https://${API_HOST}${path}`, {
    headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY }
  });
  if (!res.ok) throw new Error(`API-Football request failed: ${res.status}`);
  return res.json();
}

// Looks up a team's numeric API-Football ID by name.
// NOTE: name search can be ambiguous (e.g. more than one club called
// "Inter"). If you get the wrong team back, replace this with a hardcoded
// TEAM_IDS map for the specific clubs your app uses — look their IDs up
// once via the dashboard's API tester (endpoint: /teams?search=) and skip
// this lookup entirely.
async function findTeamId(name) {
  const data = await apiFootball(`/teams?search=${encodeURIComponent(name)}`);
  const match = data.response && data.response[0];
  if (!match) throw new Error(`No team found for "${name}"`);
  return match.team.id;
}

export default async function handler(req, res) {
  // Permissive CORS: tighten this to your own domain once deployed.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const { home, away, last = '6' } = req.query;
    if (!home || !away) {
      return res.status(400).json({ error: 'Provide both "home" and "away" query params.' });
    }
    if (!process.env.API_FOOTBALL_KEY) {
      return res.status(500).json({ error: 'API_FOOTBALL_KEY environment variable is not set.' });
    }

    const [homeId, awayId] = await Promise.all([findTeamId(home), findTeamId(away)]);
    const h2h = await apiFootball(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=${last}`);
    const fixtures = h2h.response || [];

    if (!fixtures.length) {
      return res.status(200).json({ avgGoals: null, meetings: 0, note: 'No past meetings found.' });
    }

    const totalGoals = fixtures.reduce((sum, f) => {
      const gh = f.goals.home ?? 0;
      const ga = f.goals.away ?? 0;
      return sum + gh + ga;
    }, 0);

    res.status(200).json({
      avgGoals: Number((totalGoals / fixtures.length).toFixed(2)),
      meetings: fixtures.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
