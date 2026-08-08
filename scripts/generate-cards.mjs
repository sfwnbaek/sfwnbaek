// Fetches real GitHub stats via the GraphQL API and renders the two
// custom stat cards (overview ring + language breakdown) as SVG,
// using live numbers instead of hand-typed placeholders.
//
// Required env vars:
//   GITHUB_TOKEN   - provided automatically by Actions (secrets.GITHUB_TOKEN)
//   GH_LOGIN       - the username to fetch stats for
//
// Output:
//   dist/stats-card.svg
//   dist/languages-card.svg

import { writeFile, mkdir } from "node:fs/promises";

const TOKEN = process.env.GITHUB_TOKEN;
const LOGIN = process.env.GH_LOGIN;

if (!TOKEN || !LOGIN) {
  console.error("Missing GITHUB_TOKEN or GH_LOGIN env vars.");
  process.exit(1);
}

// ---- theme: black / red -----------------------------------------------
const COLORS = {
  bgFrom: "#050505",
  bgTo: "#170606",
  glow: "#ff3b3b",
  ringTrack: "rgba(255,255,255,0.08)",
  ringFrom: "#ff3b3b",
  ringTo: "#a4161a",
  textPrimary: "#f5f5f5",
  textMuted: "#9a8080",
  border: "rgba(255,59,59,0.32)",
  divider: "rgba(255,255,255,0.08)",
  trackBg: "rgba(255,255,255,0.06)",
  // used cyclically for stat-row dots and language bars
  accents: ["#ff3b3b", "#e63946", "#ff6b6b", "#a4161a", "#c81e1e", "#ff8a80"],
};

// ---- GraphQL --------------------------------------------------------------
const QUERY = `
query($login: String!) {
  user(login: $login) {
    followers { totalCount }
    repositories(ownerAffiliations: OWNER, isFork: false, first: 100) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name } }
        }
      }
    }
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

async function fetchStats() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.user;
}

function computeStreak(weeks) {
  const days = weeks.flatMap((w) => w.contributionDays).sort((a, b) => new Date(b.date) - new Date(a.date));
  let streak = 0;
  for (const day of days) {
    if (day.contributionCount > 0) streak++;
    else break;
  }
  return streak;
}

function computeLanguages(repoNodes) {
  const totals = new Map();
  for (const repo of repoNodes) {
    for (const edge of repo.languages.edges) {
      totals.set(edge.node.name, (totals.get(edge.node.name) || 0) + edge.size);
    }
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const grandTotal = sorted.reduce((sum, [, size]) => sum + size, 0) || 1;
  const top = sorted.slice(0, 6).map(([name, size]) => ({
    name,
    pct: (size / grandTotal) * 100,
  }));
  return top;
}

// ---- SVG rendering ----------------------------------------------------

function renderStatsCard({ stars, repos, followers, streak, contributions }) {
  // ring shows contributions in the last year, capped at 2000 for the gauge fill
  const CIRC = 2 * Math.PI * 60; // r=60
  const pct = Math.min(contributions / 2000, 1);
  const dashoffset = CIRC * (1 - pct);

  const rows = [
    ["Total Stars", stars],
    ["Total Repos", repos],
    ["Followers", followers],
    ["Current Streak", `${streak}d`],
  ];

  const rowSvg = rows
    .map(
      ([label, value], i) => `
<circle cx="196" cy="${56 + i * 42}" r="4" fill="${COLORS.accents[i % COLORS.accents.length]}"/>
<text x="210" y="${60 + i * 42}" font-family="-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" font-size="13.5" fill="${COLORS.textMuted}">${label}</text>
<text x="460" y="${60 + i * 42}" font-family="SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace" font-size="16" font-weight="700" fill="${COLORS.textPrimary}" text-anchor="end">${value}</text>
<line x1="196" y1="${70 + i * 42}" x2="460" y2="${70 + i * 42}" stroke="${COLORS.divider}" stroke-width="1"/>`
    )
    .join("\n");

  return `<svg width="480" height="230" viewBox="0 0 480 230" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="sBg" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${COLORS.bgFrom}"/><stop offset="100%" stop-color="${COLORS.bgTo}"/>
  </linearGradient>
  <linearGradient id="sRing" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${COLORS.ringFrom}"/><stop offset="100%" stop-color="${COLORS.ringTo}"/>
  </linearGradient>
  <radialGradient id="sGlow" cx="18%" cy="30%" r="70%">
    <stop offset="0%" stop-color="${COLORS.glow}" stop-opacity="0.22"/>
    <stop offset="100%" stop-color="${COLORS.glow}" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="sClip"><rect x="0" y="0" width="480" height="230" rx="18"/></clipPath>
</defs>
<g clip-path="url(#sClip)">
<rect width="480" height="230" fill="url(#sBg)"/>
<rect width="480" height="230" fill="url(#sGlow)"/>
<text x="20" y="30" font-family="-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" font-size="14" font-weight="700" letter-spacing="2" fill="${COLORS.textMuted}">GITHUB STATS</text>
<circle cx="96" cy="132" r="60" fill="none" stroke="${COLORS.ringTrack}" stroke-width="12"/>
<circle cx="96" cy="132" r="60" fill="none" stroke="url(#sRing)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${CIRC}" stroke-dashoffset="${dashoffset}" transform="rotate(-90 96 132)"/>
<text x="96" y="138" font-family="-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" font-size="26" font-weight="800" fill="${COLORS.textPrimary}" text-anchor="middle">${contributions}</text>
<text x="96" y="160" font-family="SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace" font-size="9.5" fill="${COLORS.textMuted}" text-anchor="middle" letter-spacing="1.2">CONTRIBUTIONS / YR</text>
${rowSvg}
</g>
<rect x="1" y="1" width="478" height="228" rx="18" fill="none" stroke="${COLORS.border}" stroke-width="1.2"/>
</svg>`;
}

function renderLanguagesCard(languages) {
  let x = 20;
  const overviewSegments = languages
    .map((lang, i) => {
      const w = (lang.pct / 100) * 440;
      const seg = `<rect x="${x}" y="48" width="${w.toFixed(1)}" height="14" fill="${COLORS.accents[i % COLORS.accents.length]}"/>`;
      x += w;
      return seg;
    })
    .join("\n");

  const rows = languages
    .map((lang, i) => {
      const y = 88 + i * 25;
      const barY = y - 7;
      const barW = (lang.pct / 100) * 290;
      return `
<circle cx="24" cy="${y}" r="4" fill="${COLORS.accents[i % COLORS.accents.length]}"/>
<text x="34" y="${y + 4}" font-family="-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" font-size="12.5" fill="${COLORS.textPrimary}">${lang.name}</text>
<rect x="130" y="${barY}" width="290" height="8" rx="4" fill="${COLORS.trackBg}"/>
<rect x="130" y="${barY}" width="${barW.toFixed(1)}" height="8" rx="4" fill="${COLORS.accents[i % COLORS.accents.length]}"/>
<text x="460" y="${y + 4}" font-family="SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace" font-size="12" fill="${COLORS.textMuted}" text-anchor="end">${lang.pct.toFixed(0)}%</text>`;
    })
    .join("\n");

  const height = 70 + languages.length * 25 + 15;

  return `<svg width="480" height="${height}" viewBox="0 0 480 ${height}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="lBg" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${COLORS.bgFrom}"/><stop offset="100%" stop-color="${COLORS.bgTo}"/>
  </linearGradient>
  <radialGradient id="lGlow" cx="85%" cy="15%" r="70%">
    <stop offset="0%" stop-color="${COLORS.glow}" stop-opacity="0.18"/>
    <stop offset="100%" stop-color="${COLORS.glow}" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="lClip"><rect x="0" y="0" width="480" height="${height}" rx="18"/></clipPath>
</defs>
<g clip-path="url(#lClip)">
<rect width="480" height="${height}" fill="url(#lBg)"/>
<rect width="480" height="${height}" fill="url(#lGlow)"/>
<text x="20" y="30" font-family="-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" font-size="14" font-weight="700" letter-spacing="2" fill="${COLORS.textMuted}">MOST USED LANGUAGES</text>
<rect x="20" y="48" width="440" height="14" rx="7" fill="${COLORS.trackBg}"/>
${overviewSegments}
<rect x="20" y="48" width="440" height="14" rx="7" fill="none" stroke="${COLORS.divider}" stroke-width="1"/>
${rows}
</g>
<rect x="1" y="1" width="478" height="${height - 2}" rx="18" fill="none" stroke="${COLORS.border}" stroke-width="1.2"/>
</svg>`;
}

// ---- main ---------------------------------------------------------------

const user = await fetchStats();
const repoNodes = user.repositories.nodes;

const stars = repoNodes.reduce((sum, r) => sum + r.stargazerCount, 0);
const repos = user.repositories.totalCount;
const followers = user.followers.totalCount;
const contributions = user.contributionsCollection.contributionCalendar.totalContributions;
const streak = computeStreak(user.contributionsCollection.contributionCalendar.weeks);
const languages = computeLanguages(repoNodes);

await mkdir("dist", { recursive: true });
await writeFile("dist/stats-card.svg", renderStatsCard({ stars, repos, followers, streak, contributions }));
await writeFile("dist/languages-card.svg", renderLanguagesCard(languages));

console.log("Generated dist/stats-card.svg and dist/languages-card.svg with live data:");
console.log({ stars, repos, followers, streak, contributions, languages });
