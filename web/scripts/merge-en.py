"""Merge a stage's English (JSON: Hebrew → English) into web/src/lib/en.ts — only the texts it doesn't have yet.
usage: merge_en.py <stage_en.json> "<section title>" """
import json
import pathlib
import re
import sys

en = json.load(open(sys.argv[1], encoding="utf-8"))
title = sys.argv[2]
p = pathlib.Path(__file__).resolve().parent.parent / "src" / "lib" / "en.ts"
s = p.read_text(encoding="utf-8")
key_re = re.compile(r'^\s*("(?:[^"\\]|\\.)*")\s*:', re.M)
have = {json.loads(k) for k in key_re.findall(s)}
add = [(k, v) for k, v in en.items() if k not in have]
block = f"\n    // ── {title} ──\n" + "".join(
    f"    {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)},\n" for k, v in add)
i = s.rstrip().rindex("};")
s = s[:i].rstrip() + "\n" + block + "};\n"
p.write_text(s, encoding="utf-8")
print("added", len(add), "already there", len(en) - len(add))
