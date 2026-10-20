"""Inline styles written for right-to-left → the logical ones, so a screen keeps its look in Hebrew and mirrors in
English (the owner, 2026-10-20: "Hebrew right to left, English left to right"). The tx codemod does it for Tailwind
classes; this does it for style={{ … }} objects:
  textAlign "right"/"left" → "start"/"end", marginRight/Left → marginInlineStart/End (padding, border too),
  right:/left: offsets → insetInlineStart/End, and drops direction: "rtl".
Never inside an element marked dir="ltr" (a phone number, an e-mail) — those stay as written.
usage (from web/): python scripts/logical-styles.py <files…>   — prints what it changed per file."""
import re
import sys

PAIRS = [
    (r'textAlign:\s*"right"', 'textAlign: "start"'), (r'textAlign:\s*"left"', 'textAlign: "end"'),
    (r'textAlign:\s*\'right\'', "textAlign: 'start'"), (r'textAlign:\s*\'left\'', "textAlign: 'end'"),
    (r'\bmarginRight:', 'marginInlineStart:'), (r'\bmarginLeft:', 'marginInlineEnd:'),
    (r'\bpaddingRight:', 'paddingInlineStart:'), (r'\bpaddingLeft:', 'paddingInlineEnd:'),
    (r'\bborderRight:', 'borderInlineStart:'), (r'\bborderLeft:', 'borderInlineEnd:'),
    (r'\bborderRightColor:', 'borderInlineStartColor:'), (r'\bborderLeftColor:', 'borderInlineEndColor:'),
    (r'\bborderRightWidth:', 'borderInlineStartWidth:'), (r'\bborderLeftWidth:', 'borderInlineEndWidth:'),
    # an offset: `right: 16` / `left: "1rem"` as a style key (after { or ,)
    (r'([{,]\s*)right:(\s*[-"\'\d])', r'\1insetInlineStart:\2'), (r'([{,]\s*)left:(\s*[-"\'\d])', r'\1insetInlineEnd:\2'),
]
DROP = [r',\s*direction:\s*"rtl"', r'direction:\s*"rtl",\s*', r'direction:\s*"rtl"']

# a style object: style={{ … }} (one level of nesting) or a named style object's `key: { … }`
STYLE = re.compile(r'style=\{\{(?:[^{}]|\{[^{}]*\})*\}\}|^\s*\w+:\s*\{[^{}\n]*\},?\s*$', re.M)


def fix(block: str) -> str:
    if 'direction: "ltr"' in block:
        return block
    for a, b in PAIRS:
        block = re.sub(a, b, block)
    for d in DROP:
        block = re.sub(d, "", block)
    return block


for path in sys.argv[1:]:
    src = open(path, encoding="utf-8").read()
    out, n = [], 0
    last = 0
    for m in STYLE.finditer(src):
        before = src[max(0, m.start() - 400):m.start()]
        tag = before[before.rfind("<"):] if "<" in before else ""
        new = m.group(0) if 'dir="ltr"' in tag else fix(m.group(0))
        if new != m.group(0):
            n += 1
        out.append(src[last:m.start()])
        out.append(new)
        last = m.end()
    out.append(src[last:])
    if n:
        open(path, "w", encoding="utf-8").write("".join(out))
        print(n, path)
