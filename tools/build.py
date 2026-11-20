"""Build the site: page partials + data files -> index.html, guide.html and assets/css/site.css.

    python tools/build.py            write the files
    python tools/build.py --check    exit 1 when the files on disk are out of date

Two pages share one shell (src/base.html):
    index.html   the home page, from src/sections/*.html joined in file-name order
    guide.html   the reference page, from src/guide/*.html joined in file-name order (built when the folder exists)
The shell receives `page` ("home" or "guide") and `home` ("" on the home page, "index.html" on the guide), so a link
such as href="{{ home }}#data" works from both pages, and `toc`: per partial its section id and h2 title, with the h3s
that carry an id (the guide's contents list is drawn from it).

Every partial is a Jinja2 template. The numbers, the authors and the links come from assets/data/site.json; a value
a template asks for and the data does not hold stops the build.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

import jinja2

OUT_HTML = "index.html"
OUT_GUIDE = "guide.html"
OUT_CSS = "assets/css/site.css"

# page name -> (partials folder under src/, output file, value of `home` in the templates)
PAGES = {
    "home": ("sections", OUT_HTML, ""),
    "guide": ("guide", OUT_GUIDE, OUT_HTML),
}


def _num(value) -> str:
    """2748 -> '2,748'; 11.1 -> '11.1'."""
    if isinstance(value, float) and not value.is_integer():
        return f"{value:,.1f}"
    return f"{int(value):,}"


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


_SECTION = re.compile(r'<section\b[^>]*\bid="([^"]+)"')
_HEADING = re.compile(r'<h([23])\b[^>]*\bid="([^"]+)"[^>]*>(.*?)</h\1>', re.S)
_TAGS = re.compile(r"<[^>]+>")


def contents(parts: list[str]) -> list[dict]:
    """The contents list of a page: per partial, its root section's id and its h2 (the title), with every h3 that has
    an id as a sub-entry. A partial without a section id or an h2 is left out."""
    out = []
    for html in parts:
        sec = _SECTION.search(html)
        heads = [(lvl, hid, " ".join(_TAGS.sub("", text).split())) for lvl, hid, text in _HEADING.findall(html)]
        h2 = next((t for lvl, _, t in heads if lvl == "2"), None)
        if sec and h2:
            out.append({"id": sec.group(1), "title": h2,
                        "subs": [{"id": hid, "title": t} for lvl, hid, t in heads if lvl == "3"]})
    return out


def import_map(root: Path) -> str:
    """An import map that gives every script module under assets/js its content hash, so a module imported by another
    (which a ?v= on the page's own script tag does not reach) is fetched again whenever it changes."""
    imports = {}
    for p in sorted((root / "assets" / "js").rglob("*.js")):
        rel = p.relative_to(root).as_posix()
        imports[f"./{rel}"] = f"./{rel}?v={hashlib.sha256(p.read_bytes()).hexdigest()[:8]}"
    return json.dumps({"imports": imports}, indent=1)


def build(root: Path) -> dict[str, str]:
    """Render the site under `root`; returns {relative path: content} and writes nothing."""
    root = Path(root)
    src = root / "src"
    css = "".join(p.read_text(encoding="utf-8").rstrip("\n") + "\n" for p in sorted((src / "css").glob("*.css")))
    outputs = {OUT_CSS: css}

    def versioned(rel: str) -> str:
        data = outputs[rel].encode("utf-8") if rel in outputs else (root / rel).read_bytes()
        return f"{rel}?v={hashlib.sha256(data).hexdigest()[:8]}"

    env = jinja2.Environment(loader=jinja2.FileSystemLoader(str(src)), undefined=jinja2.StrictUndefined,
                             autoescape=False, trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=True)
    env.filters.update(num=_num, v=versioned)
    data = root / "assets" / "data"
    base_ctx = {"site": _load(data / "site.json"), "stats": _load(data / "stats.json"), "importmap": import_map(root)}
    for page, (folder, out, home) in PAGES.items():
        if not (src / folder).is_dir():
            continue
        ctx = dict(base_ctx, page=page, home=home)
        parts = [env.get_template(f"{folder}/{p.name}").render(**ctx).rstrip("\n")
                 for p in sorted((src / folder).glob("*.html"))]
        outputs[out] = env.get_template("base.html").render(sections="\n\n".join(parts), toc=contents(parts), **ctx)
    return outputs


def write(root: Path, outputs: dict[str, str]) -> None:
    for rel, text in outputs.items():
        path = Path(root) / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    ap.add_argument("--check", action="store_true", help="do not write; exit 1 when the output is out of date")
    args = ap.parse_args(argv)
    outputs = build(args.root)
    if args.check:
        stale = [rel for rel, text in outputs.items()
                 if not (args.root / rel).exists() or (args.root / rel).read_text(encoding="utf-8") != text]
        for rel in stale:
            print(f"out of date: {rel}")
        return 1 if stale else 0
    write(args.root, outputs)
    print("built " + ", ".join(f"{rel} ({len(text):,} chars)" for rel, text in outputs.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
