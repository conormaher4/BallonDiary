// api/fixtures.js
//
// Fetches upcoming fixtures for the next N days from football-data.org,
// whose free tier (unlike API-Football's) covers the current season for its
// 12 supported competitions: Premier League, Champions League, La Liga,
// Bundesliga, Serie A, Ligue 1, Eredivisie, Primeira Liga, the Championship,
// Brazilian Serie A, the World Cup, and the European Championship.
//
// Needs the FOOTBALL_DATA_KEY environment variable (from
// football-data.org/client/register — separate from your API_FOOTBALL_KEY,
// which api/h2h.js still uses for head-to-head goals data).
//
// Call it like:
//   /api/fixtures?days=14

const API_HOST = 'api.football-data.org';

function fmt(d) { return d.toISOString().slice(0, 10); }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    if (!process.env.FOOTBALL_DATA_KEY) {
      return res.status(500).json({ error: 'FOOTBALL_DATA_KEY environment variable is not set.' });
    }
    const days = Math.min(Number(req.query.days) || 14, 21);
    const from = new Date();
    const to = new Date();
    to.setDate(to.getDate() + days);

    const url = `https://${API_HOST}/v4/matches?dateFrom=${fmt(from)}&dateTo=${fmt(to)}&status=SCHEDULED`;
    const apiRes = await fetch(url, { headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_KEY } });
    const data = await apiRes.json();

    if (!apiRes.ok) {
      return res.status(200).json({ fixtures: [], days, error: data.message || `Request failed: ${apiRes.status}` });
    }

    const fixtures = (data.matches || []).map(m => ({
      fixtureId: m.id,
      home: m.homeTeam.name,
      homeId: m.homeTeam.id,
      away: m.awayTeam.name,
      awayId: m.awayTeam.id,
      competition: m.competition.name,
      date: m.utcDate
    })).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 100);

    res.status(200).json({ fixtures, days, count: fixtures.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
