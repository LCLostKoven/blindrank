// Headless smoke test: runs app.js against a stub DOM and plays full demo rounds.
// Run with: node tests/smoke.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const store = {};
const appEl = {
  innerHTML: '',
  listeners: {},
  addEventListener(type, fn) { this.listeners[type] = fn; },
};
const ctx = vm.createContext({
  document: {
    readyState: 'complete',
    getElementById: () => appEl,
    addEventListener() {},
    createElement: () => ({}),
    head: { appendChild() {} },
  },
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  },
  navigator: {},
  scrollTo() {}, scrollBy() {}, scrollY: 0, innerHeight: 800,
  requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  setTimeout, clearTimeout, console, Promise, Math, Date, JSON,
});
ctx.window = ctx;
ctx.self = ctx;
vm.runInContext(read('logic.js'), ctx);
vm.runInContext(read('app.js'), ctx);

const A = ctx.BlindRankApp;
const S = A.state;
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const click = (attrs) => appEl.listeners.click({
  target: { closest: () => ({ disabled: false, getAttribute: (k) => attrs[k] }) },
});
const typeName = (i, value) => appEl.listeners.input({ target: { getAttribute: () => String(i), value } });
const html = () => appEl.innerHTML;

// Plays the whole placing phase. Player p places song i at a slot given by slotFor(p, i, n).
async function placeAll(slotFor) {
  const n = S.roundLength;
  for (let i = 0; i < n; i++) {
    S.players.forEach((_, p) => A.pick(p, slotFor(p, i, n)));
    await A.lock();
  }
}

(async () => {
  await tick();
  assert.ok(html().includes('Road Trip Mix (demo)'), 'setup lists demo playlists');
  assert.ok(html().includes('Demo mode'), 'shows demo note without a token');
  assert.strictEqual(S.players.length, 2);
  assert.ok(html().includes('value="Driver"') && html().includes('value="Passenger"'));

  // The 15-song option exists and can be chosen.
  assert.ok(html().includes('data-value="15"'));
  click({ 'data-action': 'length', 'data-value': '15' });
  assert.strictEqual(S.roundLength, 15);

  // ---------- Round 1: two players, 5 songs ----------
  click({ 'data-action': 'length', 'data-value': '5' });
  typeName(0, '<b>Bob</b>');
  typeName(1, 'Ana');
  assert.deepStrictEqual(JSON.parse(store['blindrank.players.v1']), ['<b>Bob</b>', 'Ana']);
  click({ 'data-action': 'start' });
  await tick(20);
  assert.strictEqual(S.screen, 'rank');
  assert.ok(html().includes('Song 1 of 5'));
  assert.ok(!html().includes('<b>Bob</b>'), 'names must be escaped');
  assert.ok(html().includes('&lt;b&gt;Bob&lt;/b&gt;'));
  assert.ok(html().includes('Pick a slot for each player'));
  click({ 'data-action': 'pick', 'data-player': '0', 'data-slot': '2' });
  assert.ok(html().includes('Waiting for'));
  click({ 'data-action': 'pick', 'data-player': '0', 'data-slot': '2' }); // undo
  assert.strictEqual(S.pending[0], null);

  await placeAll((p, i, n) => (p === 0 ? i + 1 : n - i));
  assert.strictEqual(S.screen, 'reorder');
  assert.ok(html().includes('<div class="big">0</div>'), 'zero points off before any dragging');
  const arr = S.order[0];
  [arr[0], arr[1]] = [arr[1], arr[0]]; // first player swaps two songs
  click({ 'data-action': 'tab', 'data-index': '1' });
  click({ 'data-action': 'lockreorder' });
  assert.strictEqual(S.locked[1], true);
  assert.strictEqual(S.tab, 0, 'moves to the next unlocked player');
  click({ 'data-action': 'lockreorder' });
  assert.strictEqual(S.screen, 'results');
  const plain = (x) => JSON.parse(JSON.stringify(x));
  assert.deepStrictEqual(plain(S.result.standings.map((s) => [s.idx, s.points, s.place])), [[1, 0, 1], [0, 2, 2]]);
  assert.ok(html().includes('Ana wins'));
  assert.ok(html().includes('Agreement'));
  assert.ok(html().includes('class="card p1 win"'));

  // ---------- Round 2: four players, 15 songs ----------
  click({ 'data-action': 'again' });
  assert.strictEqual(S.screen, 'setup');
  click({ 'data-action': 'addplayer' });
  click({ 'data-action': 'addplayer' });
  assert.strictEqual(S.players.length, 4);
  assert.ok(!html().includes('data-action="addplayer"'), 'no add button at 4 players');
  typeName(2, 'Mia');
  typeName(3, 'ana'); // same name as player 2 (case-insensitive): must be made unique
  click({ 'data-action': 'length', 'data-value': '15' });
  click({ 'data-action': 'start' });
  await tick(20);
  assert.strictEqual(S.roundLength, 15);
  assert.deepStrictEqual(Array.from(S.roundNames), ['<b>Bob</b>', 'Ana', 'Mia', 'ana (2)']);
  assert.ok(html().includes('repeat(4,minmax(0,1fr))'), 'four columns');
  assert.ok(html().includes('slot stk') === false, 'no locked cells yet');

  await placeAll((p, i, n) => {
    if (p === 0) return i + 1;           // perfect order
    if (p === 1) return n - i;           // reversed
    if (p === 2) return ((i * 4) % n) + 1 > 0 ? ((i + 1) % n) + 1 : 1; // rotated
    return i + 1;                         // same as player 0
  });
  // The rotated placement for p2 may collide; the app ignores taken slots, so just check we got through.
  assert.ok(['rank', 'reorder'].includes(S.screen));
  if (S.screen === 'rank') {
    // Fill remaining songs with straightforward placements to finish.
    while (S.screen === 'rank') {
      const free = (p) => { for (let s = 1; s <= S.roundLength; s++) { if (!S.played.some((x) => S.placements[p][x.id] === s)) return s; } };
      S.players.forEach((_, p) => A.pick(p, free(p)));
      await A.lock();
    }
  }
  assert.strictEqual(S.screen, 'reorder');
  assert.ok(html().includes('Rank them for real'));
  assert.strictEqual(S.order.length, 4);
  for (let k = 0; k < 4; k++) click({ 'data-action': 'lockreorder' });
  assert.strictEqual(S.screen, 'results');
  assert.strictEqual(S.result.standings.length, 4);
  assert.ok(html().includes('class="lb"'), 'leaderboard for 3+ players');
  assert.ok(html().includes('Agreement'));

  // ---------- Compact slots while placing (3 players) ----------
  click({ 'data-action': 'again' });
  click({ 'data-action': 'removeplayer', 'data-index': '3' });
  assert.strictEqual(S.players.length, 3);
  click({ 'data-action': 'length', 'data-value': '5' });
  click({ 'data-action': 'start' });
  await tick(20);
  S.players.forEach((_, p) => A.pick(p, 1));
  await A.lock();
  assert.ok(html().includes('slot lock stk'), 'compact locked cells for 3+ players');

  // ---------- History and scoreboard ----------
  const history = JSON.parse(store['blindrank.history.v2']);
  assert.strictEqual(history.length, 2);
  assert.strictEqual(history[1].players.length, 4);
  click({ 'data-action': 'board' });
  assert.strictEqual(S.screen, 'board');
  assert.ok(html().includes('Rounds won'));
  assert.ok(html().includes('Ana'));
  click({ 'data-action': 'back' });
  assert.strictEqual(S.screen, 'setup');

  console.log('smoke test passed');
})().catch((e) => { console.error(e); process.exit(1); });
