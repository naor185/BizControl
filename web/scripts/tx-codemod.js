// The English translation codemod (BizControl, language stages 2–4 — the owner, 2026-10-19). Run from web/:
//   node scripts/tx-codemod.js list  <files…>    → the Hebrew texts it would wrap (JSON lines: key, file:line, kind)
//   node scripts/tx-codemod.js write <files…> [--exclude exclude.json]
// then write the English of the listed texts (JSON: Hebrew → English) and: python scripts/merge-en.py en.json "title"
// It parses TSX with the TypeScript compiler and:
//  - wraps Hebrew JSX text, JSX string attributes, string / template literals in tx("…") (lib/i18n — English from
//    lib/en.ts when the language is English, Hebrew as it is otherwise); a template's ${…} become {0}, {1}…
//  - skips: comparisons, switch cases, object keys, types, imports, string-method arguments, calls already
//    tx/tr/t/console, encodeURIComponent and anything in the exclude list (texts that go to clients stay Hebrew)
//  - turns the right/left Tailwind classes into start/end ones (RTL-authored: right = start), drops dir="rtl", mirrors
//    the left/right arrow icons in LTR — never inside a dir="ltr" element, so Hebrew looks exactly the same
//  - "he-IL" → intl()
const fs = require("fs");
const path = require("path");
const ts = require(require.resolve("typescript", { paths: [process.cwd()] }));

const HEB = /[֐-׿]/;
const [mode, ...rest] = process.argv.slice(2);
let files = [], exclude = new Set();
for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--exclude") exclude = new Set(JSON.parse(fs.readFileSync(rest[++i], "utf8")));
    else files.push(rest[i]);
}
const SKIP_METHODS = new Set(["includes", "startsWith", "endsWith", "indexOf", "lastIndexOf", "split", "replace", "replaceAll",
    "match", "matchAll", "test", "search", "getItem", "setItem", "removeItem", "querySelector", "querySelectorAll", "localeCompare",
    "encodeURIComponent", "encodeURI", "has", "get", "set", "delete", "padStart", "padEnd"]);
const SKIP_CALLS = new Set(["tx", "tr", "t", "encodeURIComponent", "encodeURI", "RegExp", "fillTerms", "require", "Symbol"]);
const ARROWS = new Set(["ChevronLeft", "ChevronRight", "ArrowLeft", "ArrowRight", "ChevronsLeft", "ChevronsRight", "MoveLeft", "MoveRight"]);

function physToLogical(token) {
    const m = /^((?:[a-z0-9-]+:)*)(-?)(.*)$/.exec(token);
    const [, variants, neg, cls] = m;
    let out = null;
    let mm;
    if ((mm = /^(m|p)(r|l)-(.+)$/.exec(cls))) out = `${mm[1]}${mm[2] === "r" ? "s" : "e"}-${mm[3]}`;
    else if ((mm = /^(right|left)-(.+)$/.exec(cls)) && !/^1\/2$/.test(mm[2])) out = `${mm[1] === "right" ? "start" : "end"}-${mm[2]}`;
    else if (cls === "text-right") out = "text-start";
    else if (cls === "text-left") out = "text-end";
    else if ((mm = /^border-(r|l)(-.+)?$/.exec(cls))) out = `border-${mm[1] === "r" ? "s" : "e"}${mm[2] || ""}`;
    else if ((mm = /^rounded-(r|l)(-.+)?$/.exec(cls))) out = `rounded-${mm[1] === "r" ? "s" : "e"}${mm[2] || ""}`;
    else if ((mm = /^rounded-(tr|tl|br|bl)(-.+)?$/.exec(cls))) out = `rounded-${{ tr: "ss", tl: "se", br: "es", bl: "ee" }[mm[1]]}${mm[2] || ""}`;
    return out === null ? null : variants + neg + out;
}
const CLASSY = /^[a-z0-9:\-\[\]\/.%#()_!]+$/;
function convertClasses(text) {
    const parts = text.split(/(\s+)/);
    const tokens = parts.filter(p => p.trim());
    if (!tokens.length || !tokens.every(t => CLASSY.test(t))) return null;
    let changed = false;
    const out = parts.map(p => {
        if (!p.trim()) return p;
        const c = physToLogical(p);
        if (c) { changed = true; return c; }
        return p;
    });
    return changed ? out.join("") : null;
}

function insideLtr(node) {
    for (let n = node; n; n = n.parent) {
        const el = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
        if (!el) continue;
        for (const a of el.attributes.properties) {
            if (ts.isJsxAttribute(a) && a.name.getText() === "dir" && a.initializer && ts.isStringLiteral(a.initializer) && a.initializer.text === "ltr") return true;
        }
    }
    return false;
}

function inHebrewDocument(node) {
    for (let n = node.parent; n; n = n.parent) {
        const tag = ts.isJsxElement(n) ? n.openingElement.tagName.getText() : (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) ? n.tagName.getText() : "";
        if (tag === "style" || tag === "script") return true;
        if ((ts.isVariableDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name && /^print/i.test(n.name.getText())) return true;
        if (ts.isCallExpression(n) && /document\.write$/.test(n.expression.getText())) return true;
        // a helper that writes a document (a receipt to print) — all of it stays Hebrew
        if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) {
            const name = ts.isFunctionDeclaration(n) ? (n.name ? n.name.getText() : "") : (ts.isVariableDeclaration(n.parent) ? n.parent.name.getText() : "");
            if (name && /^[a-z]/.test(name) && n.getText().includes("document.write(")) return true;
        }
    }
    return false;
}

function skipContext(node) {
    const p = node.parent;
    if (!p) return true;
    if (inHebrewDocument(node)) return true;
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isExternalModuleReference(p)) return true;
    if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isEnumMember(p)) && p.name === node) return true;
    if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return true;
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(p.operatorToken.kind)) return true;
    if (ts.isCaseClause(p)) return true;
    if (ts.isTaggedTemplateExpression(p)) return true;
    // a call's argument: string methods, our own translators, console, client-bound encoders
    for (let n = node, q = p; q; n = q, q = q.parent) {
        if (ts.isCallExpression(q) || ts.isNewExpression(q)) {
            const callee = q.expression;
            const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
            const owner = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression.text : "";
            if (SKIP_CALLS.has(name) || owner === "console") return true;
            if (q.arguments && q.arguments.includes(n) && SKIP_METHODS.has(name)) return true;
            break;
        }
        if (ts.isJsxAttribute(q) || ts.isBlock(q) || ts.isSourceFile(q) || ts.isVariableDeclaration(q)) break;
    }
    return false;
}

function process1(file, write) {
    const src = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const edits = [];   // {start, end, text}
    const keys = [];
    const used = new Set();
    const lineOf = n => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const want = key => !exclude.has(key);

    function addKey(key, n, kind) { keys.push({ key, at: `${path.basename(file)}:${lineOf(n)}`, kind }); }

    function visit(node) {
        // ── JSX text ──
        if (ts.isJsxText(node) && HEB.test(node.text) && !inHebrewDocument(node)) {
            const raw = node.getFullText(sf);
            const ent = t => t.replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
                .replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”").replace(/&lsquo;/g, "‘").replace(/&rsquo;/g, "’")
                .replace(/&nbsp;/g, " ").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&hellip;/g, "…")
                .replace(/&amp;/g, "&");
            let lead = "", key = raw, trail = "";
            if (raw.includes("\n")) {            // JSX drops whitespace with a line break, and joins the lines with a space
                const m = /^(\s*)[\s\S]*?(\s*)$/.exec(raw);
                lead = m[1]; trail = m[2];
                key = raw.split("\n").map(s => s.trim()).filter(Boolean).join(" ");
            }
            key = ent(key);                      // single-line: its spaces next to a {…} matter — kept in the key
            if (want(key.trim())) {
                addKey(key.trim(), node, "jsx");
                edits.push({ start: node.pos, end: node.end, text: `${lead}{tx(${JSON.stringify(key)})}${trail}` });
                used.add("tx");
            }
            return;
        }
        // ── string literals ──
        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
            const p = node.parent;
            if (node.text === "he-IL" && !ts.isLiteralTypeNode(p) && !inHebrewDocument(node)) {
                edits.push({ start: node.getStart(sf), end: node.end, text: "intl()" });
                used.add("intl");
                return;
            }
            if (HEB.test(node.text) && !skipContext(node) && want(node.text.trim())) {
                addKey(node.text.trim(), node, ts.isJsxAttribute(p) ? "attr" : "str");
                const call = `tx(${JSON.stringify(node.text)})`;
                edits.push({ start: node.getStart(sf), end: node.end, text: ts.isJsxAttribute(p) ? `{${call}}` : call });
                used.add("tx");
                return;
            }
            if (!HEB.test(node.text)) {
                const conv = !insideLtr(node) ? convertClasses(node.text) : null;
                if (conv !== null) {
                    const q = src[node.getStart(sf)];
                    edits.push({ start: node.getStart(sf), end: node.end, text: q + conv + q });
                }
                // dir="rtl" → gone (the page's direction follows the language)
                if (ts.isJsxAttribute(p) && p.name.getText() === "dir" && node.text === "rtl" && !insideLtr(p.parent.parent)) {
                    let a = p.getStart(sf), b = p.end;
                    const ls = src.lastIndexOf("\n", a - 1) + 1, le = src.indexOf("\n", b);
                    if (!src.slice(ls, a).trim() && !src.slice(b, le < 0 ? src.length : le).trim()) { a = ls; b = le < 0 ? src.length : le + 1; }
                    else if (src[a - 1] === " ") a -= 1;            // alone on its line — the whole line goes
                    edits.push({ start: a, end: b, text: "" });
                }
            }
            return;
        }
        // ── template literals with ${…} ──
        if (ts.isTemplateExpression(node)) {
            const pieces = [node.head.text, ...node.templateSpans.map(s => s.literal.text)];
            if (pieces.some(t => HEB.test(t)) && !skipContext(node)) {
                let key = node.head.text;
                node.templateSpans.forEach((s, i) => { key += `{${i}}` + s.literal.text; });
                if (want(key.trim()) && !/https?:|wa\.me/.test(key)) {
                    addKey(key.trim(), node, "tpl");
                    const spans = node.templateSpans;
                    edits.push({ start: node.getStart(sf), end: spans[0].expression.getStart(sf), text: `tx(${JSON.stringify(key)}, { 0: ` });
                    for (let i = 1; i < spans.length; i++)
                        edits.push({ start: spans[i - 1].expression.end, end: spans[i].expression.getStart(sf), text: `, ${i}: ` });
                    edits.push({ start: spans[spans.length - 1].expression.end, end: node.end, text: " })" });
                    used.add("tx");
                    spans.forEach(sp => visit(sp.expression));    // Hebrew inside the ${…} — translated in place
                    return;
                }
                return;
            }
            // class lists in a template: convert the literal parts
            if (!insideLtr(node)) {
                const parts = [node.head, ...node.templateSpans.map(s => s.literal)];
                for (const lit of parts) {
                    const conv = convertClasses(lit.text);
                    if (conv !== null) {
                        const s0 = lit.getStart(sf), raw = src.slice(s0, lit.end);
                        // head: `text${  span: }text${ or }text`
                        const open = raw.startsWith("`") ? "`" : "}";
                        const close = raw.endsWith("${") ? "${" : "`";
                        edits.push({ start: s0, end: lit.end, text: open + conv + close });
                    }
                }
            }
        }
        // ── arrow icons point the reading way ──
        if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && ARROWS.has(node.tagName.getText()) && !insideLtr(node)) {
            const cls = node.attributes.properties.find(a => ts.isJsxAttribute(a) && a.name.getText() === "className");
            if (!cls) {
                edits.push({ start: node.tagName.end, end: node.tagName.end, text: ` className="ltr:-scale-x-100"` });
            } else if (cls.initializer && ts.isStringLiteral(cls.initializer) && !cls.initializer.text.includes("scale-x")) {
                const s0 = cls.initializer.getStart(sf);
                edits.push({ start: s0 + 1, end: s0 + 1, text: "ltr:-scale-x-100 " });
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sf);

    if (mode === "list") return keys;
    if (!edits.length) return keys;
    edits.sort((a, b) => b.start - a.start);
    let out = src;
    let lastStart = Infinity;
    for (const e of edits) {
        if (e.end > lastStart) continue;           // overlapping (an outer edit already took it)
        out = out.slice(0, e.start) + e.text + out.slice(e.end);
        lastStart = e.start;
    }
    const names = [...used].filter(n => !new RegExp(`import[^;]*\\b${n}\\b[^;]*from "@/lib/i18n"`).test(out));
    if (names.length) {
        const imp = `import { ${names.join(", ")} } from "@/lib/i18n";\n`;
        const existing = /import \{([^}]*)\} from "@\/lib\/i18n";/.exec(out);
        if (existing) out = out.replace(existing[0], `import {${existing[1].replace(/\s*$/, "")}, ${names.join(", ")} } from "@/lib/i18n";`);
        else {
            const lastImport = [...out.matchAll(/^import [\s\S]*?;\s*$/gm)].pop();
            const at = lastImport ? lastImport.index + lastImport[0].length + 1 : (out.startsWith('"use client"') ? out.indexOf("\n") + 1 : 0);
            out = out.slice(0, at) + imp + out.slice(at);
        }
    }
    if (write) fs.writeFileSync(file, out);
    return keys;
}

const all = [];
for (const f of files) all.push(...process1(f, mode === "write"));
const seen = new Map();
for (const k of all) if (!seen.has(k.key)) seen.set(k.key, k);
for (const k of seen.values()) console.log(JSON.stringify(k));
console.error(`${files.length} files, ${all.length} texts, ${seen.size} unique`);
