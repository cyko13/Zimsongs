// Vote storage for Songs of the Year: Zim Edition.
// Each vote is its own blob, keyed  v/<year>/<voter>/<songIndex>  with an empty value.
// One key per vote means two people voting at once never overwrite each other,
// and totals come from a single key listing (no per-vote reads).

export const FIRST_YEAR = 1980;
export const LAST_YEAR = 2025;
const VOTER_RE = /^[A-Za-z0-9]{4,40}$/;

export function parseKey(key) {
  const m = /^v\/(\d{4})\/([A-Za-z0-9]+)\/(\d+)$/.exec(key);
  return m ? { y: +m[1], voter: m[2], i: +m[3] } : null;
}
const voteKey = (y, voter, i) => `v/${y}/${voter}/${i}`;

export function validVote(v) {
  if (!v || typeof v !== "object") return null;
  const y = Number(v.year), i = Number(v.idx), voter = String(v.voter || "");
  if (!Number.isInteger(y) || y < FIRST_YEAR || y > LAST_YEAR) return null;
  if (!Number.isInteger(i) || i < 0 || i > 40) return null;
  if (!VOTER_RE.test(voter)) return null;
  return { y, i, voter };
}

async function allVotes(store) {
  const { blobs } = await store.list({ prefix: "v/" });
  return blobs.map(b => parseKey(b.key)).filter(Boolean);
}

export async function summary(store) {
  const votes = await allVotes(store);
  const t = {}, voters = new Set();
  for (const v of votes) {
    ((t[v.y] ||= {})[v.i] = (t[v.y][v.i] || 0) + 1);
    voters.add(v.voter);
  }
  return { t, voters: voters.size, total: votes.length };
}

export async function castVote(store, v) {
  const prefix = `v/${v.y}/${v.voter}/`;
  const { blobs } = await store.list({ prefix });
  for (const b of blobs) if (b.key !== voteKey(v.y, v.voter, v.i)) await store.delete(b.key);
  await store.set(voteKey(v.y, v.voter, v.i), "");
}

// One-off data changes (copying the old Wix votes, moving votes when songs move),
// listed in migrations.json and applied once each. A lock key makes sure only one
// function run applies a given migration.
const done = new Set();
export async function runMigrations(store, migrations) {
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    const mark = await store.get(`meta/done/${m.id}`);
    if (mark !== null) { done.add(m.id); continue; }
    const { modified } = await store.set(`meta/lock/${m.id}`, String(Date.now()), { onlyIfNew: true });
    if (!modified) continue; // another run is applying it
    if (m.seed) {
      for (const [y, i, voter] of m.seed) {
        const v = validVote({ year: y, idx: i, voter });
        if (!v) continue;
        const { blobs } = await store.list({ prefix: `v/${v.y}/${v.voter}/` });
        if (!blobs.length) await store.set(voteKey(v.y, v.voter, v.i), "");
      }
    }
    if (m.map) {
      // map: { "<year>": [ [newYear, newIndex] | null, ... ] }  (old index -> new place, null = removed)
      const votes = (await allVotes(store)).filter(v => m.map[v.y]);
      const moves = [];
      for (const v of votes) {
        const to = m.map[v.y][v.i];
        if (to === undefined) continue;
        if (to && to[0] === v.y && to[1] === v.i) continue;
        moves.push({ v, to });
      }
      // delete first, then add, so swaps within a year can't collide
      for (const { v } of moves) await store.delete(voteKey(v.y, v.voter, v.i));
      for (const { v, to } of moves) {
        if (!to) continue;
        const { blobs } = await store.list({ prefix: `v/${to[0]}/${v.voter}/` });
        if (!blobs.length) await store.set(voteKey(to[0], v.voter, to[1]), "");
      }
    }
    await store.set(`meta/done/${m.id}`, String(Date.now()));
    done.add(m.id);
  }
}
