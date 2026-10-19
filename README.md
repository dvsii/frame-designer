# Frame Designer

**Use it here: https://dvsii.github.io/frame-designer/** (open it on your phone and add it to the home screen to install it; see [Install on a phone](#install-on-a-phone)).

A lightweight web app for making picture frames. Enter the sizes you know on a drawing of the frame (artwork, outside size, rail and stile widths, in any combination) and it works out the rest, then gives you:

- a to-scale front view with editable dimensions and the hidden joinery dashed in,
- a 3D model of the corner joint you can turn and pull apart,
- the cut list (long and short points, shoulder lengths, saw angles),
- joinery details for the joint you picked (tenon and mortise sizes, lap depths, spline slot heights, dowel positions…),
- glass, backer, mat and hardware sizes,
- a stock layout showing how the pieces fit on your boards, kerf included, and what's left over, cut from strips already at width, from boards you list (it rips strips from their width), or from ready-made molding,
- the set of standard 8′ boards to buy that wastes the least,
- build steps.

It runs entirely in the browser: plain HTML and JavaScript, no build step, no server, no dependencies. It installs to a phone's home screen as an app and works offline.

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

`dist/frame-designer.html` is the whole app in a single file (build it with `python3 scripts/build_single.py`), handy for e-mailing or keeping on a USB stick in the shop.

## Deploy as a web app

Upload the folder (or just `index.html`, `manifest.webmanifest`, `sw.js`, `js/` and `icons/`) to any static host: GitHub Pages, Netlify, Cloudflare Pages, or your own server. It must be served over HTTPS for the install and offline features.

GitHub Pages, for example:

```bash
git init && git add . && git commit -m "Frame Designer"
gh repo create frame-designer --public --source . --push
gh api repos/{owner}/frame-designer/pages -X POST -f "source[branch]=main" -f "source[path]=/"
```

## Install on a phone

- **iPhone / iPad:** open the site in Safari, tap Share, then Add to Home Screen.
- **Android:** open it in Chrome and tap Install app (or the menu, then Add to Home screen). On desktop Chrome and Edge the app shows an Install app button.

After the first visit it opens offline. If you want it in the App Store or Play Store, wrap the same files with [Capacitor](https://capacitorjs.com/) (`npx cap init`, point `webDir` at this folder, `npx cap add ios` / `android`); no code changes are needed.

## Tests

Start the local server and open http://localhost:8000/tests/ — the page runs about 150 checks on the sizing math, every joint's cut list, the stock layout and the 3D geometry (including exact volume checks that each joint's pieces fill the frame with no gaps or overlaps), then renders every joint for a visual check. The tab title reads `PASS n` or `FAIL n`.

## Files

```
index.html            page, styles and markup
js/core.js            sizes, joints, cut list, materials, steps, stock layout (no DOM; testable)
js/geom.js            convex solids, plane clipping, the 3D frame model for each joint
js/render.js          small z-buffer renderer with wood grain and outlines
js/app.js             UI wiring: drawing, editor, inspector, results, saved designs
sw.js                 offline cache for the installed app
manifest.webmanifest  install metadata
icons/                app icons (regenerate with scripts/make_icons.py)
scripts/              icon and single-file builders
tests/index.html      browser test page
```

Saved designs and your last design are kept in the browser's local storage on that device only.
