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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiFootball(path) {
  const res = await fetch(`https://${API_HOST}${path}`, {
    headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY }
  });
  if (!res.ok) throw new Error(`API-Football request failed: ${res.status}`);
  const data = await res.json();
  if (data.errors && (data.errors.rateLimit || data.errors.requests)) {
    const err = new Error(data.errors.rateLimit || data.errors.requests);
    err.rateLimited = true;
    throw err;
  }
  return data;
}

// Strips accents (Atlético -> Atletico) so searches match API-Football's
// plainer stored names.
function stripAccents(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Removes common leading/trailing club-entity words (FC, CF, AFC, etc.) that
// official names carry but API-Football's own search often doesn't expect —
// e.g. "Sevilla FC" -> "Sevilla", "AFC Ajax" -> "Ajax". Deliberately leaves
// meaningful identity words alone (never strips "United", "City", "Real", etc.).
function cleanTeamName(s) {
  const tokens = new Set(['fc','cf','afc','sc','ac','as','cd','sad','ca','rc','rcd']);
  let words = stripAccents(s).trim().split(/\s+/);
  while (words.length > 1 && tokens.has(words[0].toLowerCase().replace(/[^a-z0-9]/g, ''))) words = words.slice(1);
  while (words.length > 1 && tokens.has(words[words.length - 1].toLowerCase().replace(/[^a-z0-9]/g, ''))) words = words.slice(0, -1);
  return words.join(' ');
}

// Looks up a team's numeric API-Football ID by name. Only used as a fallback
// when homeId/awayId aren't supplied directly. Tries a few name variations
// in turn, since API-Football's search wants simpler names than the full
// official names other providers (like football-data.org) return.
// NOTE: name search can still be ambiguous (e.g. more than one club called
// "Inter"). If you get the wrong team back for a specific match-up, that's
// the likely cause.
function isNonFirstTeam(name) {
  return /\bwomen\b/i.test(name) ||
         /\bw$/i.test(name.trim()) ||
         /\bu-?\d{2}\b/i.test(name) ||
         /\byouth\b/i.test(name) ||
         /\bjunior(s)?\b/i.test(name) ||
         /\breserves?\b/i.test(name) ||
         /\bii$/i.test(name.trim()) ||
         /\bb$/i.test(name.trim());
}

function pickBestMatch(pool, query) {
  if (!pool || !pool.length) return null;
  const q = stripAccents(query).toLowerCase().trim();
  const exact = pool.find(r => stripAccents(r.team.name).toLowerCase() === q);
  if (exact) return exact;
  const contains = pool.find(r => stripAccents(r.team.name).toLowerCase().includes(q) || q.includes(stripAccents(r.team.name).toLowerCase()));
  if (contains) return contains;
  return pool[0];
}

async function findTeamId(rawName) {
  const cleaned = cleanTeamName(rawName);
  const firstWord = cleaned.split(' ')[0];
  const attempts = [cleaned, stripAccents(rawName), rawName, firstWord];
  const tried = new Set();
  let first = true;
  for (const q of attempts) {
    const key = q.trim().toLowerCase();
    if (!key || tried.has(key)) continue;
    tried.add(key);
    if (!first) await sleep(350);
    first = false;
    const data = await apiFootball(`/teams?search=${encodeURIComponent(q)}`);
    const candidates = data.response || [];    const firstTeamsOnly = candidates.filter(r => !isNonFirstTeam(r.team.name));
    if (firstTeamsOnly.length) {
      const match = pickBestMatch(firstTeamsOnly, q);
      return { id: match.team.id, name: match.team.name, country: match.team.country, allCandidates: candidates.map(r => r.team.name) };
    }
  }
  throw new Error(`No first-team match found for "${rawName}"`);
}

module.exports = async (req, res) => {
  // Permissive CORS: tighten this to your own domain once deployed.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    if (!process.env.API_FOOTBALL_KEY) {
      return res.status(500).json({ error: 'API_FOOTBALL_KEY environment variable is not set.' });
    }

    const { home, away, homeId, awayId, fixtureId, last = '6' } = req.query;
    let hId = homeId, aId = awayId, hMatch = null, aMatch = null;
    if (!hId || !aId) {
      if (!home || !away) {
        return res.status(400).json({ error: 'Provide either homeId & awayId, or home & away.' });
      }
      hMatch = await findTeamId(home);
      await sleep(350);
      aMatch = await findTeamId(away);
      await sleep(350);
      hId = hMatch.id;
      aId = aMatch.id;
    }

    const h2hRes = await apiFootball(`/fixtures/headtohead?h2h=${hId}-${aId}`);
    const allMeetings = (h2hRes.response || []).slice().sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));
    const meetings = allMeetings.slice(0, Number(last));

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

    res.status(200).json({
      avgGoals, meetings: meetings.length, probHome, probDraw, probAway,
      debug: {
        resolvedHomeId: hId, resolvedAwayId: aId,
        matchedHomeName: hMatch ? `${hMatch.name} (${hMatch.country})` : null,
        matchedAwayName: aMatch ? `${aMatch.name} (${aMatch.country})` : null,
        homeCandidates: hMatch ? hMatch.allCandidates : null,
        awayCandidates: aMatch ? aMatch.allCandidates : null,
        rawH2hCount: (h2hRes.response || []).length
      }
    });
  } catch (err) {
    res.status(err.rateLimited ? 429 : 500).json({ error: err.message });
  }
};
