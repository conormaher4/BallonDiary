// api/h2h.js
//
// Vercel serverless function: given two teams (by name, or more efficiently
// by their API-Football IDs if you already have them — e.g. from
// /api/fixtures), returns their recent head-to-head goals average, and,
// when a fixtureId is supplied, that fixture's real win-probability
// predictions too. Deploy this alongside your app's HTML on Vercel so it's
// on the same origin — see the README for full steps.
//
// Call it either way:
//   /api/h2h?home=Arsenal&away=Chelsea&last=6
//   /api/h2h?homeId=42&awayId=49&fixtureId=1035101&last=6

const API_HOST = 'v3.football.api-sports.io';

async function apiFootball(path) {
  const res = await fetch(`https://${API_HOST}${path}`, {
    headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY }
  });
  if (!res.ok) throw new Error(`API-Football request failed: ${res.status}`);
  return res.json();
}

// Looks up a team's numeric API-Football ID by name. Only used as a fallback
// when homeId/awayId aren't supplied directly.
// NOTE: name search can be ambiguous (e.g. more than one club called
// "Inter"). If you get the wrong team back, pass homeId/awayId explicitly
// instead (the /api/fixtures endpoint already returns these for you).
async function findTeamId(name) {
  const data = await apiFootball(`/teams?search=${encodeURIComponent(name)}`);
  const match = data.response && data.response[0];
  if (!match) throw new Error(`No team found for "${name}"`);
  return match.team.id;
}

module.exports = async (req, res) => {
  // Permissive CORS: tighten this to your own domain once deployed.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    if (!process.env.API_FOOTBALL_KEY) {
      return res.status(500).json({ error: 'API_FOOTBALL_KEY environment variable is not set.' });
    }

    const { home, away, homeId, awayId, fixtureId, last = '6' } = req.query;
    let hId = homeId, aId = awayId;
    if (!hId || !aId) {
      if (!home || !away) {
        return res.status(400).json({ error: 'Provide either homeId & awayId, or home & away.' });
      }
      [hId, aId] = await Promise.all([findTeamId(home), findTeamId(away)]);
    }

    const h2hRes = await apiFootball(`/fixtures/headtohead?h2h=${hId}-${aId}&last=${last}`);
    const meetings = h2hRes.response || [];

    let avgGoals = null;
    if (meetings.length) {
      const totalGoals = meetings.reduce((sum, f) => sum + (f.goals.home ?? 0) + (f.goals.away ?? 0), 0);
      avgGoals = Number((totalGoals / meetings.length).toFixed(2));
    }

    let probHome = null, probDraw = null, probAway = null;
    if (fixtureId) {
      try {
        const predRes = await apiFootball(`/predictions?fixture=${fixtureId}`);
        const p = predRes.response && predRes.response[0];
        const pct = p && p.predictions && p.predictions.percent;
        if (pct) {
          probHome = parseFloat(pct.home);
          probDraw = parseFloat(pct.draw);
          probAway = parseFloat(pct.away);
        }
      } catch (e) {
        // predictions aren't available for every fixture (lower-tier leagues,
        // fixtures too far out) — just leave probabilities null and move on
      }
    }

    res.status(200).json({ avgGoals, meetings: meetings.length, probHome, probDraw, probAway });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
