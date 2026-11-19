/* Blind Rank: pure game logic (no DOM, no music). Works in the browser and in Node.
 * Supports any number of players; players are identified by their index in a round. */
(function (root) {
  'use strict';

  /** How many spots a song is from where it was originally placed (index is 0-based). */
  function displacement(songId, index, placements) {
    var finalRank = index + 1;
    var placed = placements[songId];
    if (placed === undefined || placed === null) placed = finalRank;
    return Math.abs(placed - finalRank);
  }

  /** Sum of |placed slot - final rank|. Lower is better. */
  function pointsOff(order, placements) {
    var total = 0;
    for (var i = 0; i < order.length; i++) total += displacement(order[i].id, i, placements);
    return total;
  }

  function exactHits(order, placements) {
    var hits = 0;
    for (var i = 0; i < order.length; i++) {
      if (displacement(order[i].id, i, placements) === 0) hits++;
    }
    return hits;
  }

  /** Worst possible total for n songs (a fully reversed list). */
  function maxPointsOff(n) {
    return Math.floor((n * n) / 2);
  }

  /** 0..1, how closely two final rankings match (1 = identical). */
  function agreement(a, b) {
    if (a.length !== b.length || a.length < 2) return 1;
    var indexInB = {};
    for (var i = 0; i < b.length; i++) indexInB[b[i].id] = i;
    var total = 0;
    for (var j = 0; j < a.length; j++) {
      var k = indexInB[a[j].id];
      total += Math.abs(j - (k === undefined ? j : k));
    }
    return 1 - total / maxPointsOff(a.length);
  }

  /** Average pairwise agreement across all players' final orders. */
  function groupAgreement(orders) {
    if (orders.length < 2) return 1;
    var sum = 0;
    var pairs = 0;
    for (var i = 0; i < orders.length; i++) {
      for (var j = i + 1; j < orders.length; j++) {
        sum += agreement(orders[i], orders[j]);
        pairs++;
      }
    }
    return sum / pairs;
  }

  /**
   * The song the group ranked furthest apart: { song, best:{idx,rank}, worst:{idx,rank}, spread }.
   * `best` is the player who ranked it highest (lowest rank number); ranks are 1-based.
   */
  function spreadDisagreement(orders) {
    if (orders.length < 2) return null;
    var ranks = orders.map(function (order) {
      var m = {};
      order.forEach(function (s, i) { m[s.id] = i + 1; });
      return m;
    });
    var result = null;
    var bestSpread = -1;
    orders[0].forEach(function (song) {
      var lo = { idx: 0, rank: ranks[0][song.id] };
      var hi = { idx: 0, rank: lo.rank };
      for (var p = 1; p < orders.length; p++) {
        var r = ranks[p][song.id];
        if (r === undefined) return;
        if (r < lo.rank) lo = { idx: p, rank: r };
        if (r > hi.rank) hi = { idx: p, rank: r };
      }
      var spread = hi.rank - lo.rank;
      if (spread > bestSpread) {
        bestSpread = spread;
        result = { song: song, best: lo, worst: hi, spread: spread };
      }
    });
    return result;
  }

  /**
   * Final standings. Fewest points off wins; more exact hits breaks a tie.
   * Players equal on both share a place (so several can win).
   * Returns [{ idx, points, exact, place }] best first.
   */
  function standings(points, exact) {
    var list = points.map(function (p, i) { return { idx: i, points: p, exact: exact[i] }; });
    list.forEach(function (x) {
      x.place = 1 + list.filter(function (y) {
        return y.points < x.points || (y.points === x.points && y.exact > x.exact);
      }).length;
    });
    list.sort(function (a, b) { return a.place - b.place || a.idx - b.idx; });
    return list;
  }

  function nameKey(name) {
    return String(name).trim().toLowerCase();
  }

  /**
   * Rivalry stats from saved rounds, grouped by player name. Each round looks like:
   * { ts, playlist, n, players:[{name, points, exact, place}], winners:[name],
   *   agreement, songs:[{ playIdx, players:[{name, placed, final}] }] }
   * Only a sole winner earns a win; a shared first place is a tie.
   */
  function summarizeHistory(rounds) {
    var people = {};
    var best = null;

    rounds.forEach(function (r) {
      r.players.forEach(function (p) {
        var k = nameKey(p.name);
        var s = people[k] || (people[k] = { key: k, name: p.name, rounds: 0, wins: 0, exact: 0, best: null, sum: 0, early: 0, earlyN: 0 });
        s.name = p.name;
        s.rounds++;
        s.exact += p.exact;
        s.sum += p.points;
        if (s.best === null || p.points < s.best) s.best = p.points;
        if (r.winners.length === 1 && nameKey(r.winners[0]) === k) s.wins++;
        if (!best || p.points < best.points) best = { name: p.name, points: p.points, ts: r.ts };
      });
      var half = r.n / 2;
      r.songs.forEach(function (song) {
        if (song.playIdx >= half) return;
        song.players.forEach(function (sp) {
          var s = people[nameKey(sp.name)];
          if (!s) return;
          s.early += sp.final - sp.placed; // positive: placed it higher than it deserved
          s.earlyN++;
        });
      });
    });

    var list = Object.keys(people).map(function (k) { return people[k]; });
    list.sort(function (a, b) { return b.wins - a.wins || b.rounds - a.rounds || a.name.localeCompare(b.name); });

    var tendencies = [];
    list.forEach(function (s) {
      if (s.rounds >= 3 && s.earlyN > 0) {
        var mean = s.early / s.earlyN;
        if (mean >= 0.5) tendencies.push({ name: s.name, kind: 'early-high' });
        else if (mean <= -0.5) tendencies.push({ name: s.name, kind: 'early-low' });
      }
    });

    var streak = null;
    for (var i = rounds.length - 1; i >= 0; i--) {
      if (rounds[i].winners.length !== 1) break;
      var w = nameKey(rounds[i].winners[0]);
      if (!streak) streak = { name: rounds[i].winners[0], key: w, count: 1 };
      else if (streak.key === w) streak.count++;
      else break;
    }

    return {
      total: rounds.length,
      people: list,
      best: best,
      streak: streak,
      tendencies: tendencies,
      recent: rounds.slice(-5).reverse(),
    };
  }

  var api = {
    displacement: displacement,
    pointsOff: pointsOff,
    exactHits: exactHits,
    maxPointsOff: maxPointsOff,
    agreement: agreement,
    groupAgreement: groupAgreement,
    spreadDisagreement: spreadDisagreement,
    standings: standings,
    nameKey: nameKey,
    summarizeHistory: summarizeHistory,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BlindLogic = api;
})(typeof self !== 'undefined' ? self : this);
