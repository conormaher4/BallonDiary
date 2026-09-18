// api/fixtures.js
//
// Fetches upcoming fixtures across a curated set of leagues and international
// competitions from API-Football, for the next N days. League IDs are looked
// up by name at runtime (rather than hardcoded) so this stays correct even if
// specific numeric IDs are unfamiliar — and cached in memory for the life of
// the serverless instance to avoid re-resolving them on every request.
//
// Call it like:
//   /api/fixtures?days=14

const API_HOST = 'v3.football.api-sports.io';

// Feel free to add or remove names here — anything findable via API-Football's
// own /leagues search will work. This mix covers the "big five" domestic
// leagues, two European club competitions, a few further domestic leagues,
// and one international competition (UEFA Nations League) for variety.
const LEAGUE_NAMES = [
  'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1',
  'UEFA Champions League', 'UEFA Europa League',
  'Eredivisie', 'Primeira Liga', 'Scottish Premiership',
  'Major League Soccer', 'UEFA Nations League'
];

let leagueIdCache = {};

async function apiFootball(path) {
  const res = await fetch(`https://${API_HOST}${path}`, {
    headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY }
  });
  if (!res.ok) throw new Error(`API-Football request failed: ${res.status}`);
  return res.json();
}

async function resolveLeagueId(name) {
  if (leagueIdCache[name] != null) return leagueIdCache[name];
  try {
    const data = await apiFootball(`/leagues?search=${encodeURIComponent(name)}`);
    const match = data.response && data.response[0];
    leagueIdCache[name] = match ? match.league.id : null;
  } catch (e) {
    leagueIdCache[name] = null;
  }
  return leagueIdCache[name];
}

function seasonForToday() {
  const now = new Date();
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}
function fmt(d) { return d.toISOString().slice(0, 10); }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    if (!process.env.API_FOOTBALL_KEY) {
      return res.status(500).json({ error: 'API_FOOTBALL_KEY environment variable is not set.' });
    }
    const days = Math.min(Number(req.query.days) || 14, 21);
    const from = new Date();
    const to = new Date();
    to.setDate(to.getDate() + days);
    const season = seasonForToday();

    const leagues = await Promise.all(
      LEAGUE_NAMES.map(async name => ({ name, id: await resolveLeagueId(name) }))
    );

    const perLeague = await Promise.all(
      leagues.filter(l => l.id != null).map(async l => {
        try {
          const data = await apiFootball(
            `/fixtures?league=${l.id}&season=${season}&from=${fmt(from)}&to=${fmt(to)}`
          );
          return {
            name: l.name, id: l.id, count: (data.response||[]).length, errors: data.errors,
            fixtures: (data.response || []).map(f => ({
              fixtureId: f.fixture.id,
              home: f.teams.home.name,
              homeId: f.teams.home.id,
              away: f.teams.away.name,
              awayId: f.teams.away.id,
              competition: l.name,
              date: f.fixture.date
            }))
          };
        } catch (e) {
          return { name: l.name, id: l.id, count: 0, errors: e.message, fixtures: [] };
        }
      })
    );

    const all = perLeague.flatMap(l => l.fixtures)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 100);

    res.status(200).json({
      fixtures: all, season, days, leaguesFound: leagues.filter(l => l.id != null).length,
      debug: { leaguesRequested: LEAGUE_NAMES, leaguesResolved: leagues, perLeagueSummary: perLeague.map(l => ({name:l.name, id:l.id, count:l.count, errors:l.errors})) }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
