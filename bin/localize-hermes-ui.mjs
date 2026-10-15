// One-time AST migration of display strings into the Hermes message catalog.
import fs from 'node:fs';
import ts from 'typescript';
import crypto from 'node:crypto';
const files = [...fs.readdirSync('components').filter(name => /^Hermes.*\.tsx$/.test(name)).map(name => `components/${name}`), 'app/login/page.tsx'];
const messages = {};
const id = text => { const key = `hermes.ui.${crypto.createHash('sha256').update(text).digest('hex').slice(0, 12)}`; messages[text] = key; return key; };
for (const pathname of files) {
  const source = fs.readFileSync(pathname, 'utf8');
  const tree = ts.createSourceFile(pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = []; const owners = new Set();
  function owner(node) { while (node) { if (ts.isFunctionDeclaration(node)) return node; node = node.parent; } }
  function visit(node) {
    const fn = owner(node);
    const eligible = fn && /^[A-Z]/.test(fn.name?.text ?? '') && fn.name.text !== 'HermesChat';
    if ((ts.isStringLiteralLike(node) || ts.isJsxText(node)) && /[\u3400-\u9fff]/.test(node.text)) {
      const text = ts.isJsxText(node) ? node.text.trim() : node.text;
      if (text && !text.startsWith('[') && !text.includes('querySelector')) {
        id(text);
        if (process.argv.includes('--migrate') && eligible && !(ts.isCallExpression(node.parent) && node.parent.expression.getText(tree) === 'ht')) {
          const replacement = `ht(${JSON.stringify(text)})`;
          edits.push({ start: node.getStart(tree), end: node.end, text: ts.isJsxText(node) || ts.isJsxAttribute(node.parent) ? `{${replacement}}` : replacement });
          owners.add(fn);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const fn of owners) edits.push({ start: fn.body.getStart(tree) + 1, end: fn.body.getStart(tree) + 1, text: '\n  const { ht } = useHermesI18n();' });
  if (owners.size) edits.push({ start: source.indexOf('\n', source.indexOf('"use client";')) + 1, end: source.indexOf('\n', source.indexOf('"use client";')) + 1, text: '\nimport { useHermesI18n } from "@/hooks/useHermesI18n";\n' });
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  fs.writeFileSync(pathname, output);
}
fs.mkdirSync('lib/i18n/hermes', { recursive: true });
fs.writeFileSync('lib/i18n/hermes/ui.json', JSON.stringify(messages, null, 2) + '\n');
console.log(`Extracted ${Object.keys(messages).length} UI messages.`);
