/* Blind Rank web app. Vanilla JS, no build step. Depends on logic.js and (optionally) config.js.
 * 2 to 4 players share one phone; players are identified by their index (0..3) during a round. */
(function () {
  'use strict';

  var L = window.BlindLogic;
  var CONFIG = window.BLINDRANK_CONFIG || {};
  var MUSICKIT_URL = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
  var HISTORY_KEY = 'blindrank.history.v2';
  var PLAYERS_KEY = 'blindrank.players.v1';
  var MIN_PLAYERS = 2;
  var MAX_PLAYERS = 4;
  var DEFAULT_NAMES = ['Driver', 'Passenger', 'Player 3', 'Player 4'];
  var LENGTHS = [5, 10, 15, 20];

  // ---------- storage (wrapped: some browsers/sandboxes throw) ----------
  function readJSON(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  function loadPlayers() {
    var saved = readJSON(PLAYERS_KEY, null);
    if (Array.isArray(saved) && saved.length >= MIN_PLAYERS && saved.length <= MAX_PLAYERS &&
        saved.every(function (n) { return typeof n === 'string'; })) return saved;
    return [DEFAULT_NAMES[0], DEFAULT_NAMES[1]];
  }

  // ---------- state ----------
  var state = {
    screen: 'setup',
    backTo: 'setup',
    source: CONFIG.developerToken ? 'apple' : 'demo',
    appleAuthorized: false,
    loading: false,
    toast: '',
    playlists: [],
    playlistId: null,
    roundLength: 10,
    players: loadPlayers(),   // names as typed on the setup screen
    roundNames: [],           // unique display names fixed when a round starts
    pool: [],
    played: [],
    current: null,
    placements: [],           // per player: { songId: slot }
    pending: [],              // per player: slot or null
    order: [],                // per player: songs in final order
    locked: [],               // per player: reorder locked in
    tab: 0,
    playing: false,
    result: null,
  };

  // ---------- music providers ----------
  var DEMO_SONGS = [
    ['Glass Houses', 'Mara Voss'], ['Paper Moons', 'Juniper Hale'], ['Slow Static', 'Night Orchard'],
    ['Velvet Hours', 'Ines Quarry'], ['Sundown Highway', 'The Lanterns'], ['Rust & Rain', 'The Fairweathers'],
    ['Second Sunrise', 'Juniper Hale'], ['Paper Kites', 'Dune Parade'], ['Neon Orchard', 'Mara Voss'],
    ['Low Tide', 'Coastline Club'], ['Hollow Echoes', 'Ines Quarry'], ['Gold Leaf', 'The Lanterns'],
    ['Midnight Ferry', 'Dune Parade'], ['Static Bloom', 'Night Orchard'], ['Copper Sky', 'Coastline Club'],
    ['Quiet Engines', 'The Fairweathers'], ['Salt & Smoke', 'Mara Voss'], ['Open Windows', 'Juniper Hale'],
    ['Last Exit Waltz', 'Dune Parade'], ['Tin Roof', 'Coastline Club'], ['Afterglow Road', 'The Lanterns'],
    ['Pale Fire', 'Ines Quarry'], ['Wildflower Hours', 'Night Orchard'], ['Blue Hour', 'The Fairweathers'],
  ];

  var Demo = {
    playlists: function () {
      return Promise.resolve([
        { id: 'demo-road', name: 'Road Trip Mix (demo)' },
        { id: 'demo-throwbacks', name: 'Throwbacks (demo)' },
      ]);
    },
    tracks: function (playlistId) {
      return Promise.resolve(DEMO_SONGS.map(function (s) {
        return { id: playlistId + ':' + s[0], title: s[0], artist: s[1] };
      }));
    },
    play: function () { return Promise.resolve(); },
    pause: function () {},
    resume: function () { return Promise.resolve(); },
  };

  var Apple = {
    music: null,

    init: function () {
      if (Apple.music) return Promise.resolve();
      return new Promise(function (resolve, reject) {
        function configure() {
          Promise.resolve(window.MusicKit.configure({
            developerToken: CONFIG.developerToken,
            app: { name: 'Blind Rank', build: '1.0' },
          })).then(function () {
            Apple.music = window.MusicKit.getInstance();
            resolve();
          }, reject);
        }
        if (window.MusicKit) return configure();
        document.addEventListener('musickitloaded', configure, { once: true });
        var s = document.createElement('script');
        s.src = MUSICKIT_URL;
        s.async = true;
        s.onerror = function () { reject(new Error('Could not load Apple MusicKit. Check your connection.')); };
        document.head.appendChild(s);
      });
    },

    authorize: function () {
      return Apple.init().then(function () { return Apple.music.authorize(); }).then(function () {
        return !!Apple.music.isAuthorized;
      });
    },

    isAuthorized: function () { return !!(Apple.music && Apple.music.isAuthorized); },

    // Fetch every page of a library collection.
    pages: function (path) {
      var all = [];
      function next(offset) {
        return Apple.music.api.music(path, { limit: 100, offset: offset }).then(function (res) {
          var body = res.data || res;
          var items = body.data || [];
          all = all.concat(items);
          if (items.length < 100 || !body.next) return all;
          return next(offset + 100);
        });
      }
      return next(0);
    },

    playlists: function () {
      return Apple.pages('/v1/me/library/playlists').then(function (items) {
        return items
          .map(function (p) { return { id: p.id, name: (p.attributes && p.attributes.name) || 'Untitled' }; })
          .sort(function (a, b) { return a.name.localeCompare(b.name); });
      });
    },

    tracks: function (playlistId) {
      return Apple.pages('/v1/me/library/playlists/' + encodeURIComponent(playlistId) + '/tracks').then(function (items) {
        return items.map(function (t) {
          var a = t.attributes || {};
          var pp = a.playParams || {};
          return { id: t.id, title: a.name || 'Unknown', artist: a.artistName || '', playId: pp.catalogId || pp.id || t.id };
        });
      });
    },

    play: function (song) {
      return Apple.music.setQueue({ song: song.playId }).then(function () { return Apple.music.play(); });
    },
    pause: function () { if (Apple.music) Apple.music.pause(); },
    resume: function () { return Apple.music ? Apple.music.play() : Promise.resolve(); },
  };

  function provider() { return state.source === 'apple' ? Apple : Demo; }

  // ---------- helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function setupName(i) {
    var n = (state.players[i] || '').trim();
    return n || DEFAULT_NAMES[i];
  }
  // Name to show for player i: the round's fixed names once a round has started.
  function nm(i) { return state.roundNames[i] || setupName(i); }

  function buildRoundNames() {
    var seen = {};
    return state.players.map(function (_, i) {
      var base = setupName(i);
      var name = base;
      var k = 2;
      while (seen[L.nameKey(name)]) { name = base + ' (' + k++ + ')'; }
      seen[L.nameKey(name)] = true;
      return name;
    });
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function joinNames(list) {
    if (list.length <= 1) return list.join('');
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }
  function showToast(msg) {
    state.toast = msg;
    render();
    setTimeout(function () { if (state.toast === msg) { state.toast = ''; render(); } }, 3200);
  }
  function persistPlayers() { writeJSON(PLAYERS_KEY, state.players); }

  var ICON = {
    note: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f2f4f8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    play: '<svg width="20" height="20" viewBox="0 0 24 24" fill="#0e1014" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>',
    pause: '<svg width="20" height="20" viewBox="0 0 24 24" fill="#0e1014" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
    star: function (c, s) { return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="' + c + '" aria-hidden="true"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>'; },
    grip: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#a3abba" aria-hidden="true"><circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="6" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/></svg>',
  };

  // Each player gets a color and a shape (circle, square, hexagon, diamond).
  function dot(i) { return '<span class="dot p' + i + '"></span>'; }
  function badge(i, text) { return '<span class="badge p' + i + '">' + (text === undefined ? '' : esc(text)) + '</span>'; }

  // ---------- rendering ----------
  var appEl = null;

  function render() {
    if (!appEl) return;
    var html;
    switch (state.screen) {
      case 'rank': html = renderRank(); break;
      case 'reorder': html = renderReorder(); break;
      case 'results': html = renderResults(); break;
      case 'board': html = renderBoard(); break;
      default: html = renderSetup();
    }
    if (state.toast) html += '<div class="toast" role="status">' + esc(state.toast) + '</div>';
    appEl.innerHTML = html;
  }

  function go(screen) {
    state.screen = screen;
    render();
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  }

  function renderSetup() {
    var hasToken = !!CONFIG.developerToken;
    var apple = state.source === 'apple';
    var source = '';
    if (hasToken) {
      source =
        '<section class="stack"><h2 class="eyebrow">Music source</h2><div class="seg">' +
        '<button data-action="source" data-value="apple" class="' + (apple ? 'on' : '') + '">Apple Music</button>' +
        '<button data-action="source" data-value="demo" class="' + (!apple ? 'on' : '') + '">Demo</button>' +
        '</div></section>';
    }

    var playlists;
    if (apple && !state.appleAuthorized) {
      playlists = '<button class="btn secondary" data-action="connect">Connect Apple Music</button>';
    } else if (state.loading && !state.playlists.length) {
      playlists = '<p class="spin">Loading…</p>';
    } else if (!state.playlists.length) {
      playlists = '<p class="note">No playlists found in your library.</p>';
    } else {
      playlists = state.playlists.map(function (p) {
        var on = p.id === state.playlistId;
        return '<button class="pl ' + (on ? 'on' : '') + '" data-action="playlist" data-id="' + esc(p.id) + '" aria-pressed="' + on + '">' +
          '<span>' + esc(p.name) + '</span>' + (on ? '<small>Shuffled</small>' : '') + '</button>';
      }).join('');
    }

    var lengths = LENGTHS.map(function (n) {
      return '<button data-action="length" data-value="' + n + '" class="' + (state.roundLength === n ? 'on' : '') + '">' + n + '</button>';
    }).join('');

    var canRemove = state.players.length > MIN_PLAYERS;
    var players = state.players.map(function (n, i) {
      return '<div class="prow p' + i + '">' + dot(i) +
        '<input data-name="' + i + '" type="text" maxlength="20" value="' + esc(n) + '" placeholder="' + esc(DEFAULT_NAMES[i]) + '" aria-label="Player ' + (i + 1) + ' name" autocomplete="off">' +
        (canRemove ? '<button class="iconbtn" data-action="removeplayer" data-index="' + i + '" aria-label="Remove ' + esc(setupName(i)) + '">&times;</button>' : '') +
        '</div>';
    }).join('');
    if (state.players.length < MAX_PLAYERS) {
      players += '<button class="btn secondary" data-action="addplayer">Add player</button>';
    }

    var demoNote = hasToken
      ? 'One phone, one person taps. Songs play through your Apple Music subscription.'
      : 'Demo mode: no audio. Add a MusicKit token to play real Apple Music (see README).';

    return '<main class="screen">' +
      '<div class="stack" style="gap:8px"><h1 class="title">Blind Rank</h1>' +
      '<p class="sub">Rank each song before you hear the next one. Fewest points off wins.</p></div>' +
      source +
      '<section class="stack"><h2 class="eyebrow">Playlist</h2>' + playlists + '</section>' +
      '<section class="stack"><h2 class="eyebrow">Songs per round</h2><div class="seg">' + lengths + '</div></section>' +
      '<section class="stack"><h2 class="eyebrow">Players (2 to 4)</h2>' + players + '</section>' +
      '</main>' +
      '<div class="footer"><p class="note">' + demoNote + '</p>' +
      '<button class="btn" data-action="start"' + (!state.playlistId || state.loading ? ' disabled' : '') + '>Shuffle &amp; start</button>' +
      '<button class="btn secondary" data-action="board">Scoreboard</button></div>';
  }

  function slotCell(p, slot, compact) {
    var locked = null;
    for (var i = 0; i < state.played.length; i++) {
      if (state.placements[p][state.played[i].id] === slot) { locked = state.played[i]; break; }
    }
    var who = esc(nm(p));
    if (locked) {
      return compact
        ? '<div class="slot lock stk p' + p + '"><i>' + slot + '</i><span>' + esc(locked.title) + '</span></div>'
        : '<div class="slot lock p' + p + '">' + badge(p, slot) + '<span>' + esc(locked.title) + '</span></div>';
    }
    if (state.pending[p] === slot) {
      var title = esc(state.current ? state.current.title : '');
      return '<button class="slot pend p' + p + (compact ? ' stk' : '') + '" data-action="pick" data-player="' + p + '" data-slot="' + slot + '" aria-label="' + who + ' picked slot ' + slot + '. Tap to undo.">' +
        (compact ? '<i>' + slot + '</i><span>' + title + '</span>' : badge(p, slot) + '<span>' + title + '</span>') + '</button>';
    }
    return '<button class="slot" data-action="pick" data-player="' + p + '" data-slot="' + slot + '" aria-label="' + who + ' slot ' + slot + '">' + slot + '</button>';
  }

  function canLock() {
    return state.pending.length > 0 && state.pending.every(function (s) { return s !== null; });
  }

  function lockLabel() {
    var waiting = [];
    state.pending.forEach(function (s, i) { if (s === null) waiting.push(i); });
    if (!waiting.length) return 'Lock in';
    if (waiting.length === state.pending.length) return 'Pick a slot for each player';
    if (waiting.length === 1) return 'Waiting for ' + nm(waiting[0]) + '’s pick';
    return 'Waiting for ' + waiting.length + ' players';
  }

  function renderRank() {
    var n = state.roundLength;
    var np = state.players.length;
    var compact = np >= 3;
    var prog = '';
    for (var i = 0; i < n; i++) prog += '<i class="' + (i < state.played.length ? 'done' : i === state.played.length ? 'now' : '') + '"></i>';

    var cols = 'grid-template-columns:repeat(' + np + ',minmax(0,1fr))';
    var grid = '';
    for (var s = 1; s <= n; s++) {
      for (var p = 0; p < np; p++) grid += slotCell(p, s, compact);
    }

    var heads = '';
    for (var q = 0; q < np; q++) {
      var pick = state.pending[q];
      heads += '<div class="colh p' + q + '"><b>' + dot(q) + '<span class="nm">' + esc(nm(q)) + '</span></b>' +
        (pick !== null ? '<span class="st pick">Picked ' + pick + '</span>' : '<span class="st">Tap a slot</span>') + '</div>';
    }

    var cur = state.current || { title: '', artist: '' };
    return '<main class="screen rank">' +
      '<div class="top"><div><b>Song ' + (state.played.length + 1) + ' of ' + n + '</b><div class="prog">' + prog + '</div></div>' +
      '<button class="btn secondary small" data-action="skip"' + (state.pool.length ? '' : ' disabled') + '>Skip song</button></div>' +
      '<div class="np"><div class="art">' + ICON.note + '</div><div class="meta"><div class="t">' + esc(cur.title) + '</div><div class="a">' + esc(cur.artist) + '</div></div>' +
      '<button class="pp" data-action="toggle" aria-label="' + (state.playing ? 'Pause' : 'Play') + '">' + (state.playing ? ICON.pause : ICON.play) + '</button></div>' +
      '<div class="cols ' + (compact ? 'cmp' : '') + '" style="' + cols + '">' + heads + '</div>' +
      '<div class="grid" style="' + cols + '">' + grid + '</div>' +
      '</main>' +
      '<div class="footer"><button class="btn" data-action="lock"' + (canLock() ? '' : ' disabled') + '>' + esc(lockLabel()) + '</button></div>';
  }

  function chip(off) {
    if (off === 0) return '<span class="chip exact">' + ICON.star('#ffc24b', 12) + 'Exact</span>';
    if (off === 1) return '<span class="chip">off 1</span>';
    return '<span class="chip far">off ' + off + '</span>';
  }

  function renderReorder() {
    var p = state.tab;
    var order = state.order[p];
    var placements = state.placements[p];
    var locked = state.locked[p];

    var tabs = state.players.map(function (_, i) {
      return '<button data-action="tab" data-index="' + i + '" class="p' + i + (i === p ? ' on' : '') + '">' + esc(nm(i)) + (state.locked[i] ? ' ✓' : '') + '</button>';
    }).join('');

    var rows = order.map(function (song, idx) {
      var off = L.displacement(song.id, idx, placements);
      return '<div class="item ' + (off >= 2 ? 'hot ' : '') + (locked ? 'locked' : '') + '" data-id="' + esc(song.id) + '">' +
        '<span class="rk">' + (idx + 1) + '</span>' +
        '<div class="tx"><b>' + esc(song.title) + '</b><small>' + esc(song.artist) + ' · was ' + placements[song.id] + '</small></div>' +
        chip(off) +
        '<button class="grip" data-drag aria-label="Drag to reorder ' + esc(song.title) + '">' + ICON.grip + '</button></div>';
    }).join('');

    var pts = L.pointsOff(order, placements);
    var ex = L.exactHits(order, placements);
    return '<main class="screen">' +
      '<div class="seg">' + tabs + '</div>' +
      '<div class="stack" style="gap:6px"><h1 class="h1">Rank them for real</h1>' +
      '<p class="sub" style="font-size:14px">Drag songs into your true order, best at the top. Each song scores how many spots it is from where you placed it.</p></div>' +
      '<div class="list">' + rows + '</div></main>' +
      '<div class="footer"><div class="foot-row">' +
      '<div><div class="eyebrow">Points off</div><div class="big">' + pts + '</div></div>' +
      '<div class="exactn">' + ICON.star('#ffc24b', 16) + ex + '</div>' +
      '<button class="btn" data-action="lockreorder"' + (locked ? ' disabled' : '') + '>' + (locked ? 'Locked' : 'Lock in ' + esc(nm(p))) + '</button>' +
      '</div></div>';
  }

  function renderResults() {
    var r = state.result;
    if (!r) return renderSetup();
    var np = r.standings.length;
    var winnerNames = r.winners.map(function (i) { return esc(r.names[i]); });
    var title = r.winners.length === np ? 'It’s a tie'
      : r.winners.length === 1 ? winnerNames[0] + ' wins'
      : joinNames(winnerNames) + ' tie';

    var board;
    if (np === 2) {
      board = '<div class="cards">' + r.names.map(function (name, i) {
        var s = r.standings.filter(function (x) { return x.idx === i; })[0];
        var win = s.place === 1 && r.winners.length === 1;
        return '<div class="card p' + i + (win ? ' win' : '') + '">' +
          '<b class="who">' + dot(i) + '<span class="nm">' + esc(name) + '</span></b>' +
          '<span class="num">' + s.points + '</span>' +
          '<small>points off · ' + ICON.star(win ? '#0e1014' : '#a3abba', 13) + s.exact + '</small></div>';
      }).join('') + '</div>';
    } else {
      board = '<div class="lb">' + r.standings.map(function (s) {
        var win = s.place === 1;
        return '<div class="lbrow p' + s.idx + (win ? ' win' : '') + '">' +
          '<span class="pl-n">' + s.place + '</span>' +
          '<span class="who">' + badge(s.idx) + '<b>' + esc(r.names[s.idx]) + '</b></span>' +
          '<span class="sc"><b>' + s.points + '</b><small>' + ICON.star(win ? '#0e1014' : '#a3abba', 11) + s.exact + ' exact</small></span></div>';
      }).join('') + '</div>';
    }

    var dis = r.disagreement && r.disagreement.spread > 0
      ? '<p>Biggest disagreement: <b>' + esc(r.disagreement.title) + '</b>. ' + esc(r.disagreement.bestName) + ' ranked it ' + ordinal(r.disagreement.bestRank) + ', ' + esc(r.disagreement.worstName) + ' ' + ordinal(r.disagreement.worstRank) + '.</p>'
      : '';
    var judge = esc(r.names[r.judge]);
    var best = r.best
      ? '<div class="mini"><span class="eyebrow">Best call</span><b>' + esc(r.best.title) + '</b><small class="amber">' + judge + ' · spot on</small></div>'
      : '<div class="mini"><span class="eyebrow">Best call</span><b>None this round</b><small>No exact hits</small></div>';
    var worst = r.worst
      ? '<div class="mini"><span class="eyebrow">Worst call</span><b>' + esc(r.worst.title) + '</b><small>' + judge + ' · off by ' + r.worst.off + '</small></div>'
      : '<div class="mini"><span class="eyebrow">Worst call</span><b>None</b><small>Perfect round</small></div>';

    return '<main class="screen">' +
      '<div class="stack" style="gap:4px"><span class="eyebrow">' + esc(r.playlist) + ' · ' + r.n + ' songs</span>' +
      '<h1 class="title" style="font-size:34px">' + title + '</h1><p class="sub">Fewest points off takes the round.</p></div>' +
      board +
      '<div class="tile"><div><div class="pct">' + Math.round(r.agreement * 100) + '%</div><div class="eyebrow" style="margin-top:4px">Agreement</div></div>' + dis + '</div>' +
      '<div class="pair">' + best + worst + '</div>' +
      '</main>' +
      '<div class="footer"><button class="btn" data-action="again">Play again</button>' +
      '<div class="row2"><button class="btn secondary" data-action="share">Share result</button><button class="btn secondary" data-action="board">Scoreboard</button></div></div>';
  }

  function renderBoard() {
    var rounds = readJSON(HISTORY_KEY, []);
    var s = L.summarizeHistory(rounds);
    var body;
    if (!s.total) {
      body = '<p class="sub" style="text-align:center;padding:40px 0">Play a round to start your rivalry.</p>';
    } else {
      var streak = s.streak && s.streak.count >= 2
        ? '<span class="streak">' + esc(s.streak.name) + ' is on a ' + s.streak.count + '-round streak</span>' : '';
      var people = s.people.slice(0, 8).map(function (p, i) {
        return '<div class="person"><div class="l"><b>' + esc(p.name) + '</b><small>' + p.rounds + ' round' + (p.rounds === 1 ? '' : 's') +
          ' · best ' + p.best + ' off · ' + p.exact + ' exact</small></div><span class="w" style="color:var(--c' + (i % 4) + ')">' + p.wins + '</span></div>';
      }).join('');
      var insights = s.tendencies.map(function (t) {
        return '<div class="ins">' + dot(0) + '<span>' + esc(t.name) + (t.kind === 'early-high' ? ' tends to rank early songs too high' : ' tends to rank early songs too low') + '</span></div>';
      }).join('');
      var recent = s.recent.map(function (r) {
        var d = new Date(r.ts);
        var label = isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        var pts = r.players.map(function (p) { return p.points; }).sort(function (a, b) { return a - b; }).join('–');
        var res = r.winners.length === 1 ? esc(r.winners[0]) + ' ' + pts : 'Tie ' + pts;
        return '<div class="rec"><span>' + esc(label) + ' · ' + esc(r.playlist) + '</span><b>' + res + '</b></div>';
      }).join('');
      body =
        '<div class="record"><span class="eyebrow">Rounds won</span>' + people + streak + '</div>' +
        '<div class="pair"><div class="mini"><span class="eyebrow">Best round</span><b style="font-size:22px">' + s.best.points + ' off</b><small>' + esc(s.best.name) + '</small></div>' +
        '<div class="mini"><span class="eyebrow">Rounds played</span><b style="font-size:22px">' + s.total + '</b><small>on this phone</small></div></div>' +
        (insights ? '<section class="stack"><h2 class="eyebrow">Tendencies</h2>' + insights + '</section>' : '') +
        '<section class="stack"><h2 class="eyebrow">Recent rounds</h2>' + recent + '</section>';
    }
    return '<main class="screen"><div class="top"><h1 class="h1" style="font-size:28px">Rivalry</h1>' +
      '<button class="btn secondary small" data-action="back">Back</button></div>' + body + '</main>';
  }

  // ---------- game flow ----------
  function playCurrent() {
    if (!state.current) return Promise.resolve();
    return Promise.resolve(provider().play(state.current)).then(function () {
      state.playing = true;
      render();
    }, function () {
      state.playing = false;
      render();
      showToast('Couldn’t start that song. Tap play to try again.');
    });
  }

  function loadPlaylists() {
    state.loading = true;
    render();
    return provider().playlists().then(function (list) {
      state.playlists = list;
      if (!state.playlistId || !list.some(function (p) { return p.id === state.playlistId; })) {
        state.playlistId = list.length ? list[0].id : null;
      }
      state.loading = false;
      render();
    }, function (err) {
      state.loading = false;
      render();
      showToast('Couldn’t load playlists: ' + (err && err.message ? err.message : 'unknown error'));
    });
  }

  function setSource(value) {
    state.source = value;
    state.playlists = [];
    state.playlistId = null;
    if (value === 'demo') return loadPlaylists();
    state.loading = true;
    render();
    return Apple.init().then(function () {
      state.appleAuthorized = Apple.isAuthorized();
      state.loading = false;
      if (state.appleAuthorized) return loadPlaylists();
      render();
    }, function (err) {
      state.loading = false;
      render();
      showToast(err && err.message ? err.message : 'Apple Music failed to load.');
    });
  }

  function connect() {
    return Apple.authorize().then(function (ok) {
      state.appleAuthorized = ok;
      if (ok) return loadPlaylists();
      render();
      showToast('Apple Music wasn’t authorized.');
    }, function (err) {
      showToast('Apple Music sign-in failed' + (err && err.message ? ': ' + err.message : '.'));
    });
  }

  function startRound() {
    if (!state.playlistId) return Promise.resolve();
    state.loading = true;
    render();
    return provider().tracks(state.playlistId).then(function (all) {
      var seen = {};
      var songs = all.filter(function (s) { if (seen[s.id]) return false; seen[s.id] = true; return true; });
      state.loading = false;
      if (songs.length < 5) {
        render();
        showToast('That playlist needs at least 5 songs.');
        return;
      }
      shuffle(songs);
      var np = state.players.length;
      var blank = function (v) { return state.players.map(function () { return v; }); };
      state.roundNames = buildRoundNames();
      state.roundLength = Math.min(state.roundLength, Math.max(5, songs.length - 3));
      state.pool = songs;
      state.played = [];
      state.placements = state.players.map(function () { return {}; });
      state.pending = blank(null);
      state.order = state.players.map(function () { return []; });
      state.locked = blank(false);
      state.tab = 0;
      state.result = null;
      state.current = state.pool.shift();
      state.playing = false;
      go('rank');
      return playCurrent();
    }, function (err) {
      state.loading = false;
      render();
      showToast('Couldn’t load songs: ' + (err && err.message ? err.message : 'unknown error'));
    });
  }

  function pick(p, slot) {
    for (var i = 0; i < state.played.length; i++) {
      if (state.placements[p][state.played[i].id] === slot) return;
    }
    state.pending[p] = state.pending[p] === slot ? null : slot;
    render();
  }

  function lock() {
    if (!canLock() || !state.current) return Promise.resolve();
    var song = state.current;
    state.players.forEach(function (_, p) { state.placements[p][song.id] = state.pending[p]; });
    state.played.push(song);
    state.pending = state.players.map(function () { return null; });
    if (state.played.length >= state.roundLength || !state.pool.length) {
      beginReorder();
      return Promise.resolve();
    }
    state.current = state.pool.shift();
    render();
    return playCurrent();
  }

  function skip() {
    if (!state.pool.length) return Promise.resolve();
    state.pending = state.players.map(function () { return null; });
    state.current = state.pool.shift();
    render();
    return playCurrent();
  }

  function togglePlayback() {
    if (state.playing) {
      provider().pause();
      state.playing = false;
      render();
      return Promise.resolve();
    }
    return Promise.resolve(provider().resume()).then(function () {
      state.playing = true;
      render();
    }, function () {
      showToast('Couldn’t resume playback.');
    });
  }

  function beginReorder() {
    provider().pause();
    state.playing = false;
    state.current = null;
    state.players.forEach(function (_, p) {
      var slots = state.placements[p];
      state.order[p] = state.played.slice().sort(function (a, b) { return slots[a.id] - slots[b.id]; });
    });
    state.locked = state.players.map(function () { return false; });
    state.tab = 0;
    go('reorder');
  }

  function lockReorder(p) {
    state.locked[p] = true;
    if (state.locked.every(Boolean)) return finishRound();
    var np = state.players.length;
    for (var k = 1; k <= np; k++) {
      var j = (p + k) % np;
      if (!state.locked[j]) { state.tab = j; break; }
    }
    render();
  }

  function finishRound() {
    var names = state.roundNames.slice();
    var points = [], exact = [];
    names.forEach(function (_, p) {
      points[p] = L.pointsOff(state.order[p], state.placements[p]);
      exact[p] = L.exactHits(state.order[p], state.placements[p]);
    });
    var standings = L.standings(points, exact);
    var winners = standings.filter(function (s) { return s.place === 1; }).map(function (s) { return s.idx; });
    var agreement = L.groupAgreement(state.order);
    var dis = L.spreadDisagreement(state.order);

    var songs = state.played.map(function (song, playIdx) {
      return {
        playIdx: playIdx,
        players: names.map(function (name, p) {
          return {
            name: name,
            placed: state.placements[p][song.id],
            final: state.order[p].findIndex(function (s) { return s.id === song.id; }) + 1,
          };
        }),
      };
    });

    // Best / worst call, judged on the (first) winner.
    var judge = winners[0];
    var best = null, worst = null, worstOff = 0;
    state.order[judge].forEach(function (song, idx) {
      var off = L.displacement(song.id, idx, state.placements[judge]);
      if (off === 0 && !best) best = { title: song.title };
      if (off > worstOff) { worstOff = off; worst = { title: song.title, off: off }; }
    });

    var pl = state.playlists.filter(function (p) { return p.id === state.playlistId; })[0];
    var playlistName = pl ? pl.name : 'Playlist';

    state.result = {
      playlist: playlistName,
      n: state.played.length,
      names: names,
      standings: standings,
      winners: winners,
      agreement: agreement,
      disagreement: dis ? {
        title: dis.song.title, spread: dis.spread,
        bestName: names[dis.best.idx], bestRank: dis.best.rank,
        worstName: names[dis.worst.idx], worstRank: dis.worst.rank,
      } : null,
      best: best, worst: worst, judge: judge,
    };

    var history = readJSON(HISTORY_KEY, []);
    history.push({
      ts: Date.now(), playlist: playlistName, n: state.played.length,
      players: names.map(function (name, p) {
        var place = standings.filter(function (s) { return s.idx === p; })[0].place;
        return { name: name, points: points[p], exact: exact[p], place: place };
      }),
      winners: winners.map(function (i) { return names[i]; }),
      agreement: agreement,
      songs: songs,
    });
    writeJSON(HISTORY_KEY, history.slice(-200));

    state.backTo = 'results';
    go('results');
  }

  function share() {
    var r = state.result;
    if (!r) return Promise.resolve();
    var lines = r.standings.map(function (s) { return r.names[s.idx] + ': ' + s.points + ' points off'; });
    var headline = r.winners.length === r.standings.length ? 'Tie'
      : joinNames(r.winners.map(function (i) { return r.names[i]; })) + (r.winners.length === 1 ? ' wins' : ' tie');
    var text = 'Blind Rank · ' + r.playlist + ' · ' + r.n + ' songs\n' + lines.join('\n') + '\n' +
      headline + ' · ' + Math.round(r.agreement * 100) + '% agreement';
    if (navigator.share) {
      return navigator.share({ text: text }).catch(function () {});
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { showToast('Result copied'); }, function () { showToast('Couldn’t copy'); });
    }
    showToast('Sharing isn’t available here.');
    return Promise.resolve();
  }

  // ---------- events ----------
  function intAttr(el, name) { return parseInt(el.getAttribute(name), 10); }

  var actions = {
    source: function (el) { return setSource(el.getAttribute('data-value')); },
    connect: function () { return connect(); },
    playlist: function (el) { state.playlistId = el.getAttribute('data-id'); render(); },
    length: function (el) { state.roundLength = intAttr(el, 'data-value'); render(); },
    addplayer: function () {
      if (state.players.length >= MAX_PLAYERS) return;
      state.players.push(DEFAULT_NAMES[state.players.length]);
      persistPlayers();
      render();
    },
    removeplayer: function (el) {
      if (state.players.length <= MIN_PLAYERS) return;
      state.players.splice(intAttr(el, 'data-index'), 1);
      persistPlayers();
      render();
    },
    start: function () { return startRound(); },
    pick: function (el) { pick(intAttr(el, 'data-player'), intAttr(el, 'data-slot')); },
    lock: function () { return lock(); },
    skip: function () { return skip(); },
    toggle: function () { return togglePlayback(); },
    tab: function (el) { state.tab = intAttr(el, 'data-index'); render(); },
    lockreorder: function () { lockReorder(state.tab); },
    again: function () { go('setup'); },
    share: function () { return share(); },
    board: function () { state.backTo = state.screen === 'results' ? 'results' : 'setup'; go('board'); },
    back: function () { go(state.backTo === 'results' && state.result ? 'results' : 'setup'); },
  };

  function onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el || el.disabled) return;
    var fn = actions[el.getAttribute('data-action')];
    if (fn) fn(el);
  }

  function onInput(e) {
    var idx = e.target.getAttribute && e.target.getAttribute('data-name');
    if (idx === null || idx === undefined || idx === false) return;
    var i = parseInt(idx, 10);
    if (isNaN(i) || i >= state.players.length) return;
    state.players[i] = e.target.value;
    persistPlayers();
  }

  // ---------- drag to reorder (pointer events, works with touch) ----------
  var drag = null;

  function applyDrag() {
    var d = drag;
    var dy = d.lastClientY + window.scrollY - d.startY;
    d.row.style.transform = 'translateY(' + dy + 'px)';
    d.target = Math.max(0, Math.min(d.rows.length - 1, d.idx + Math.round(dy / d.rowH)));
    d.rows.forEach(function (r, j) {
      if (r === d.row) return;
      var shift = 0;
      if (d.idx < d.target && j > d.idx && j <= d.target) shift = -d.rowH;
      else if (d.idx > d.target && j < d.idx && j >= d.target) shift = d.rowH;
      r.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
    });
  }

  function autoScrollLoop() {
    if (!drag) return;
    var y = drag.lastClientY;
    var vh = window.innerHeight;
    var step = 0;
    if (y < 90) step = -8;
    else if (y > vh - 90) step = 8;
    if (step) { window.scrollBy(0, step); applyDrag(); }
    drag.raf = requestAnimationFrame(autoScrollLoop);
  }

  function onPointerDown(e) {
    var handle = e.target.closest ? e.target.closest('[data-drag]') : null;
    if (!handle || state.locked[state.tab]) return;
    var row = handle.closest('.item');
    var rows = Array.prototype.slice.call(row.parentElement.children);
    var idx = rows.indexOf(row);
    var rowH = rows.length > 1 ? rows[1].offsetTop - rows[0].offsetTop : row.offsetHeight;
    drag = { row: row, rows: rows, idx: idx, target: idx, rowH: rowH, startY: e.clientY + window.scrollY, lastClientY: e.clientY, pointerId: e.pointerId, raf: 0 };
    if (handle.setPointerCapture) handle.setPointerCapture(e.pointerId);
    row.classList.add('dragging');
    e.preventDefault();
    drag.raf = requestAnimationFrame(autoScrollLoop);
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.lastClientY = e.clientY;
    applyDrag();
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    cancelAnimationFrame(drag.raf);
    var d = drag;
    drag = null;
    if (e.type !== 'pointercancel' && d.target !== d.idx) {
      var arr = state.order[state.tab];
      var moved = arr.splice(d.idx, 1)[0];
      arr.splice(d.target, 0, moved);
    }
    render();
  }

  // ---------- boot ----------
  function init() {
    appEl = document.getElementById('app');
    appEl.addEventListener('click', onClick);
    appEl.addEventListener('input', onInput);
    appEl.addEventListener('pointerdown', onPointerDown);
    appEl.addEventListener('pointermove', onPointerMove);
    appEl.addEventListener('pointerup', onPointerUp);
    appEl.addEventListener('pointercancel', onPointerUp);
    render();
    if (state.source === 'apple') setSource('apple');
    else loadPlaylists();
  }

  // Exposed for tests only.
  window.BlindRankApp = { state: state, actions: actions, render: render, init: init, lock: lock, startRound: startRound, pick: pick, lockReorder: lockReorder, finishRound: finishRound };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
