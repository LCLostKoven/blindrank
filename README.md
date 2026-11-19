# Blind Rank (web version)

A phone-friendly web app for the ranking game. No Mac, no App Store, no build step: it's plain HTML, CSS, and JavaScript.

- **Demo mode** works out of the box: invented songs, no audio, the full game flow.
- **Apple Music mode** plays real songs from your library playlists using Apple's MusicKit JS. It needs a developer token (below) and the app hosted on an `https://` address.

## Try it locally

Open `index.html` in a browser, or run `python3 -m http.server` in this folder and visit `http://localhost:8000`.

## Turn on real Apple Music

You need an Apple Developer account (you have one) and an active Apple Music subscription on the phone.

1. **Create a MusicKit key.** Go to developer.apple.com, then Certificates, Identifiers & Profiles, then Keys, then the + button. Name it "Blind Rank", tick **Media Services (MusicKit, ...)**, then Continue, Register, and Download. You get a file like `AuthKey_ABC123DEFG.p8`. Note the **Key ID** (also in the file name). Apple only lets you download it once, so keep it safe and never upload it anywhere.
2. **Find your Team ID** on developer.apple.com under Membership details.
3. **Host the folder.** The simplest free option is GitHub Pages: make a repository, upload everything in this folder (not the `.p8`), then Settings, Pages, deploy from the main branch. Your address will be `https://YOURNAME.github.io/REPO`. Netlify Drop (drag the folder onto app.netlify.com/drop) also works.
4. **Make a token** on any computer with Node 16 or newer (Windows is fine):

   ```
   node tools/make-token.mjs --team YOURTEAMID --key YOURKEYID --p8 path/to/AuthKey_ABC123DEFG.p8 --origin https://YOURNAME.github.io
   ```

   `--origin` locks the token to your site, so it's useless if someone copies it. It prints a long token and lasts 150 days; run the command again to renew it.
5. Paste the token into `config.js` between the quotes, and upload the updated file.
6. On your iPhone, open the site in **Safari**, tap **Connect Apple Music**, and approve. Then Share, then **Add to Home Screen** for a full-screen app.

## How the game works

2 to 4 players share one phone and one person taps. Everyone ranks each song before the next plays. At the end each player drags their songs into their true order. Score = sum of |placed slot - final rank|, fewest points off wins; more exact hits breaks a tie, and players still level share the win. Rounds can be 5, 10, 15 or 20 songs.

Player names are saved on the phone. The Scoreboard groups results by name (not seat), so it tracks each person's rounds won, best round, exact hits, and tendencies across rounds with different line-ups. Each player has their own color and shape (circle, square, hexagon, diamond). History lives in this browser only.

## Not included yet

Mind-reader mode, saving a round's best songs to an Apple Music playlist, and iCloud sync (history lives in this browser only, so clearing Safari data erases it).

## Known unknowns (not tested against real Apple Music)

This was built without access to a real Apple Music account, so the Apple parts are written to Apple's documentation but untested. Most likely trouble spots:

- **Audio won't start by itself.** iOS only allows audio after a tap. If a song doesn't start after "Shuffle & start" or "Lock in", tap the play button on the now-playing card.
- **Playlists only show your library.** Add a playlist to your library first if it isn't there.
- **Songs that fail to play.** Library tracks are queued by their catalog ID. A song missing from the catalog (an uploaded file, for example) may not play.
- **Background audio.** Keep the screen on and Safari in front for the most reliable playback.

## Tests

```
node tests/logic.test.js     # scoring and history math
node tests/smoke.test.js     # plays a full demo round against a fake DOM
```
