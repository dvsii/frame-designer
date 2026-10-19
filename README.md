# Frame Designer

**Use it here: https://dvsii.github.io/frame-designer/** (open it on your phone and add it to the home screen to install it; see [Install on a phone](#install-on-a-phone)). There's also a native [iPhone app](#iphone-app) built from the same files.

A lightweight web app for making picture frames. Enter the sizes you know on a drawing of the frame (artwork, outside size, rail and stile widths, in any combination) and it works out the rest, then gives you:

- a to-scale front view with editable dimensions and the hidden joinery dashed in,
- a 3D model of the corner joint you can turn and pull apart,
- the cut list (long and short points, shoulder lengths, saw angles),
- joinery details for the joint you picked (tenon and mortise sizes, lap depths, spline slot heights, dowel positions…),
- glass, backer, mat and hardware sizes,
- a stock layout showing how the pieces fit on your boards, kerf included, and what's left over, cut from strips already at width, from boards you list (it rips strips from their width), or from ready-made molding,
- the set of standard 8′ boards to buy that wastes the least,
- build steps.

It runs entirely in the browser: plain HTML and JavaScript, no build step, no server, no dependencies (the fonts are bundled in `fonts/`). It installs to a phone's home screen as an app and works offline.

## Joints

| Joint | What runs full length | Rail length (stiles through) |
|---|---|---|
| Miter (glue, V-nails or biscuits) | everything, measured on the long point | outside width |
| Miter w/ spline (triangular splines across each corner) | everything, measured on the long point | outside width |
| Half-lap | everything | outside width |
| Mitered half-lap | everything | outside width |
| Bridle (open mortise) | everything | outside width |
| Mortise & tenon | stiles (or rails) | outside − 2 × stile + 2 × tenon |
| Tongue & groove (stub tenon) | stiles (or rails) | outside − 2 × stile + 2 × groove depth |
| Cope & stick | stiles (or rails) | outside − 2 × stile + 2 × cope depth |
| Butt (dowels, biscuits, pocket screws, Domino) | stiles (or rails) | outside − 2 × stile |

Miters handle unequal widths (for example a wider bottom rail): the miter line runs corner to corner and the saw angle for each end is `atan(width of the mating piece / width of this piece)`, so the two angles at a corner always add up to 90°.

## Stock

Under **Stock and cutting**, choose what the pieces are cut from:

- **Strips at width**: stock already ripped to the frame widths; pieces are cut end to end along it.
- **Boards**: list the boards you have (width × thickness × length × quantity). Strips are ripped from each board's width, with a saw kerf per rip, and pieces are cut along them. Your smallest boards are used first. Boards thinner than the frame stock are left out; thicker ones get a note to plane them down. Anything that doesn't fit can be bought as standard boards.
- **Molding**: ready-made molding. Its width, thickness and rabbet set the frame, the same all round.

With **Suggest the boards to buy** on, the stock layout shows the mix of standard boards (1×2 to 1×12 at ¾″, or 5/4 and 2× for thicker frames; 18–44 mm metric) of the length you set that holds every piece with the least wood. It also lists single-size alternatives. The search is exact for the usual three strip widths (stiles, top and bottom rails) and falls back to a greedy fill for very large batches.

## How sizes relate

```
glass (= artwork, or mat outer size)
rabbet opening = glass + fit allowance
sight opening  = rabbet opening − 2 × rabbet width
outside        = sight opening + left + right stile   (width)
               = sight opening + top + bottom rail    (height)
```

"Calculate" picks which of the three (outside size, artwork size, or widths) is worked out from the other two. Editing a calculated value in the drawing switches what's calculated, so any combination works. With a mat, the artwork size is the image: glass = image − 2 × overlap + borders.

## Run it

Any static file server works. From this folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` straight from disk also works, apart from offline install.

`dist/frame-designer.html` is the whole app in a single file (build it with `python3 scripts/build_single.py`), handy for e-mailing or keeping on a USB stick in the shop. It loads its fonts from Google Fonts and falls back to system fonts offline.

## Deploy as a web app

Upload the folder (or just `index.html`, `manifest.webmanifest`, `sw.js`, `js/`, `icons/` and `fonts/`) to any static host: GitHub Pages, Netlify, Cloudflare Pages, or your own server. It must be served over HTTPS for the install and offline features.

GitHub Pages, for example:

```bash
git init && git add . && git commit -m "Frame Designer"
gh repo create frame-designer --public --source . --push
gh api repos/{owner}/frame-designer/pages -X POST -f "source[branch]=main" -f "source[path]=/"
```

## Install on a phone

- **iPhone / iPad:** open the site in Safari, tap Share, then Add to Home Screen.
- **Android:** open it in Chrome and tap Install app (or the menu, then Add to Home screen). On desktop Chrome and Edge the app shows an Install app button.

After the first visit it opens offline.

## iPhone app

`ios/` is a native iPhone (and iPad) app made with [Capacitor](https://capacitorjs.com/): a native shell with a web view that loads these same files from inside the app, so it works with no connection at all. In the app, the cut list's **Share** button opens the iPhone share sheet (Copy, Mail, Messages, Notes, Save to Files…) in place of Copy as text and Print, and saved designs live in the app's own storage, which iOS doesn't clear. The repo root stays the GitHub Pages site; `npm run sync` copies the web files into `www/` and from there into the Xcode project.

### Build it

You need Xcode (free from the Mac App Store) and Node. Once:

```bash
brew install node
```

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

```bash
npm install
```

Then, after every change to the web files:

```bash
npm run sync
```

`npm run ios` does the same and opens the project in Xcode. To try it in the Simulator, pick an iPhone from the device menu at the top of the Xcode window and press Run (⌘R).

### Run it on your own iPhone

A free Apple ID is enough for this.

1. In Xcode, open **Settings → Accounts**, press **+** and sign in with your Apple ID.
2. `npm run ios`. In the project navigator click **App**, then the **App** target, then **Signing & Capabilities**. Leave **Automatically manage signing** on and set **Team** to your name (Personal Team). If Xcode says the bundle identifier `com.dvsii.framedesigner` isn't available, change it here and in `capacitor.config.json` to something of your own, such as `com.yourname.framedesigner`.
3. Plug the iPhone in with a cable, unlock it and tap **Trust**. Turn on **Settings → Privacy & Security → Developer Mode** on the phone (it shows up once Xcode has seen the phone) and let it restart.
4. Pick the iPhone from the device menu at the top of the Xcode window and press Run (⌘R).
5. The first time, the phone refuses to open the app from an untrusted developer: go to **Settings → General → VPN & Device Management**, tap your Apple ID and tap **Trust**.

With a free Apple ID the app stops opening after 7 days, and a free account can have only three such apps on a phone at once. Plug the phone in and press Run again to renew it for another 7 days; your saved designs are kept. After the first install, Xcode can also install over Wi-Fi when the phone is on the same network.

### TestFlight and the App Store

These need the [Apple Developer Program](https://developer.apple.com/programs/) ($99 a year). It also stops the 7-day expiry.

1. Enrol, then in Xcode set **Team** (step 2 above) to the paid team.
2. In [App Store Connect](https://appstoreconnect.apple.com), go to **Apps → + → New App**: platform iOS, name Frame Designer, the bundle identifier from step 2, and any SKU (for example `framedesigner`).
3. In Xcode, under the App target's **General** tab, set **Version** (1.0) and **Build** (1). Raise the build number for every upload.
4. Pick **Any iOS Device (arm64)** from the device menu, then **Product → Archive**. When the Organizer opens, choose **Distribute App → App Store Connect** and upload.
5. **TestFlight:** once the build has processed (usually 15–30 minutes), add yourself and anyone else on your team as internal testers in the TestFlight tab; they install it with the TestFlight app. Testers outside your team need a short beta review first.
6. **App Store:** fill in the listing, attach the build and press **Submit for Review**.

What the review asks for:

- **App privacy:** answer **Data Not Collected**. The app makes no network requests, has no analytics or accounts, and keeps designs on the phone.
- **Privacy policy URL:** https://dvsii.github.io/frame-designer/privacy.html ([privacy.html](privacy.html)). The app's footer links to it too, which the review also expects.
- **Support URL:** https://dvsii.github.io/frame-designer/support.html ([support.html](support.html)), which points people to https://github.com/dvsii/frame-designer/issues.
- **Screenshots:** at least one set for the largest iPhone (6.9″, 1320 × 2868 portrait, from the iPhone Pro Max simulator: **File → Save Screen** in the Simulator). The app also runs on iPad, so you'll need 13″ iPad screenshots too, unless you make it iPhone-only under **General → Supported Destinations**.
- **Age rating:** the questionnaire is all "None", which gives 4+. Category: Productivity or Utilities. Price: free, or whatever you choose.
- **Export compliance:** already answered. `Info.plist` declares that the app uses no non-exempt encryption, so uploads don't ask.
- **Minimum functionality (guideline 4.2):** Apple sometimes turns down apps that are just a website in a wrapper. Frame Designer runs fully offline from files inside the app and uses the native share sheet and storage, which is the usual answer to that. If a reviewer pushes back, reply in App Store Connect explaining that it's an offline design tool, not a website.

## Tests

Start the local server and open http://localhost:8000/tests/ — the page runs about 150 checks on the sizing math, every joint's cut list, the stock layout and the 3D geometry (including exact volume checks that each joint's pieces fill the frame with no gaps or overlaps), then renders every joint for a visual check. The tab title reads `PASS n` or `FAIL n`.

## Files

```
index.html            page, styles and markup
privacy.html          privacy policy (the App Store's privacy policy URL)
support.html          support page (the App Store's support URL)
js/core.js            sizes, joints, cut list, materials, steps, stock layout (no DOM; testable)
js/geom.js            convex solids, plane clipping, the 3D frame model for each joint
js/render.js          small z-buffer renderer with wood grain and outlines
js/app.js             UI wiring: drawing, editor, inspector, results, saved designs
sw.js                 offline cache for the installed app
manifest.webmanifest  install metadata
icons/                app icons (regenerate with scripts/make_icons.py, which also writes the iPhone app icon)
fonts/                Barlow, Barlow Semi Condensed and IBM Plex Mono, with their licences (scripts/fetch_fonts.py)
scripts/              icon, font and single-file builders, and copy_www.mjs for the iPhone app
tests/index.html      browser test page
package.json          Capacitor and the iPhone app's npm scripts
capacitor.config.json app id and name for the iPhone app
ios/                  the Xcode project (www/ and node_modules/ are generated and not committed)
```

Saved designs and your last design are kept in the browser's local storage on that device only (in the iPhone app, in the app's own storage). The web app and the iPhone app don't share them.
