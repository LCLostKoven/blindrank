// Run with: node tests/logic.test.js
const assert = require('assert');
const L = require('../logic.js');

const song = (id) => ({ id, title: id });

// The Driver's round from the design mockups: 8 points off, 3 exact hits.
const rows = [
  ['Glass Houses', 1], ['Paper Moons', 2], ['Slow Static', 4], ['Velvet Hours', 3],
  ['Sundown Highway', 6], ['Rust & Rain', 7], ['Second Sunrise', 5], ['Paper Kites', 8],
  ['Neon Orchard', 10], ['Low Tide', 9],
];
const order = rows.map(([id]) => song(id));
const placements = Object.fromEntries(rows);
assert.strictEqual(L.pointsOff(order, placements), 8);
assert.strictEqual(L.exactHits(order, placements), 3);

// Moving a song further costs more: placed 10th, moved to 4th (6) vs 8th (2).
assert.strictEqual(L.displacement('x', 3, { x: 10 }), 6);
assert.strictEqual(L.displacement('x', 7, { x: 10 }), 2);

// Perfect round.
const ten = Array.from({ length: 10 }, (_, i) => song('s' + (i + 1)));
const perfect = Object.fromEntries(ten.map((s, i) => [s.id, i + 1]));
assert.strictEqual(L.pointsOff(ten, perfect), 0);
assert.strictEqual(L.exactHits(ten, perfect), 10);

// Agreement and max score.
assert.strictEqual(L.maxPointsOff(10), 50);
assert.strictEqual(L.agreement(ten, ten), 1);
assert.strictEqual(L.agreement(ten, ten.slice().reverse()), 0);
for (const n of [3, 5, 7, 10, 15, 20]) {
  const a = Array.from({ length: n }, (_, i) => song('q' + i));
  const placed = Object.fromEntries(a.map((s, i) => [s.id, n - i]));
  assert.strictEqual(L.pointsOff(a, placed), L.maxPointsOff(n), 'n=' + n);
}

// Group agreement: identical = 1; three players with one outlier is in between.
const rev = ten.slice().reverse();
assert.strictEqual(L.groupAgreement([ten, ten, ten]), 1);
assert.strictEqual(L.groupAgreement([ten]), 1);
assert.ok(Math.abs(L.groupAgreement([ten, ten, rev]) - 1 / 3) < 1e-9);

// Biggest disagreement across several players.
const a = [song('a'), song('b'), song('c')];
const b = [song('c'), song('b'), song('a')];
const c = [song('a'), song('c'), song('b')];
let d = L.spreadDisagreement([a, b]);
assert.deepStrictEqual([d.best.rank, d.worst.rank, d.spread], [1, 3, 2]);
d = L.spreadDisagreement([a, b, c]);
assert.strictEqual(d.spread, 2);
assert.strictEqual(L.spreadDisagreement([a]), null);

// Standings: fewer points first, exact hits break ties, equal on both share a place.
let st = L.standings([8, 14, 20], [3, 1, 0]);
assert.deepStrictEqual(st.map((x) => [x.idx, x.place]), [[0, 1], [1, 2], [2, 3]]);
st = L.standings([8, 8], [1, 3]);
assert.deepStrictEqual(st.map((x) => [x.idx, x.place]), [[1, 1], [0, 2]]);
st = L.standings([8, 8, 12], [2, 2, 0]);
assert.deepStrictEqual(st.map((x) => [x.idx, x.place]), [[0, 1], [1, 1], [2, 3]]);

// History summary, grouped by name (case-insensitive).
const round = (names, points, winners, early) => ({
  ts: 1, playlist: 'P', n: 4,
  players: names.map((name, i) => ({ name, points: points[i], exact: 1, place: 1 })),
  winners,
  songs: [0, 1, 2, 3].map((i) => ({
    playIdx: i,
    players: names.map((name) => ({ name, placed: 1, final: name === 'Steven' ? early : 1 })),
  })),
});
const rounds = [
  round(['Steven', 'Ana'], [9, 5], ['Ana'], 3),
  round(['Steven', 'ana', 'Mia'], [4, 7, 9], ['Steven'], 3),
  round(['Steven', 'Ana'], [6, 8], ['Steven'], 3),
  round(['Steven', 'Ana', 'Mia'], [5, 9, 9], ['Steven'], 3),
  round(['Steven', 'Ana'], [5, 5], ['Steven', 'Ana'], 3),
];
const sum = L.summarizeHistory(rounds);
const by = Object.fromEntries(sum.people.map((p) => [p.key, p]));
assert.strictEqual(by.steven.wins, 3);
assert.strictEqual(by.ana.wins, 1);
assert.strictEqual(by.ana.rounds, 5);
assert.strictEqual(by.mia.rounds, 2);
assert.strictEqual(sum.people[0].key, 'steven');
assert.strictEqual(sum.best.points, 4);
assert.strictEqual(sum.streak, null); // last round was a tie
assert.strictEqual(L.summarizeHistory(rounds.slice(0, 4)).streak.count, 3);
assert.deepStrictEqual(sum.tendencies.map((t) => [t.name, t.kind]), [['Steven', 'early-high']]);
assert.strictEqual(sum.recent.length, 5);
assert.strictEqual(L.summarizeHistory([]).total, 0);

console.log('logic tests passed');
