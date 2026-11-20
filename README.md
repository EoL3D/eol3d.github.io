# EoL3D website

Source of the EoL3D dataset website: step-by-step disassembly of end-of-life desktop computers.

The site is static. `index.html`, `guide.html` and `assets/css/site.css` are generated; edit the sources and rebuild:

```
python tools/build.py          # needs Python 3.10+ and Jinja2
python tools/build.py --check  # exit 1 when the generated files are out of date
```

- `src/base.html` is the page frame of both pages; `src/sections/NN-<id>.html` holds one section of the home page each and `src/guide/NN-<id>.html` one part of the guide, joined in file-name order.
- `src/css/*.css` are joined in file-name order into `assets/css/site.css`. `00-tokens.css` holds every colour, size and spacing value.
- `assets/data/site.json` holds the title, the authors, the links and the headline numbers. The templates read from it, and the build stops when a value is missing. `assets/data/explorer/` holds, per desktop, a `meta.json` and three images per step.
- `assets/js/main.js` loads `assets/js/sections/<id>.js` for a section when it comes near the viewport.
- `assets/js/teardown/` is the step-by-step viewer. It shows the scanner picture with its instance masks and, in 3D, the measured points under those masks. A step is stored as a depth image, the scanner picture and an instance-id map on one pixel grid; the vertex shader turns the depth image back into points. Only measured points are drawn.

To look at it locally, serve the folder with any static file server, for example `python -m http.server 8000`.

## Fonts

`assets/fonts/` holds Latin subsets of two typefaces, both under the SIL Open Font License 1.1 (https://openfontlicense.org); their copyright and licence notices are kept inside the font files:

- `text-var.woff2`: Source Sans 3 (variable, weights 300 to 700), Copyright 2010-2023 Adobe (http://www.adobe.com/), with Reserved Font Name "Source". Because of the reserved name, the subset is stored and declared under its own names (file `text-var.woff2`, CSS family "EoL Text"), not as "Source Sans".
- `mono-400.woff`, `mono-700.woff`: JetBrains Mono, Copyright 2020 The JetBrains Mono Project Authors.

Every heading and all running text use the text face; the monospace face is used only for code and file names.
