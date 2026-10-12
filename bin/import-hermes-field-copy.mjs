// Import only static, display-only field copy. Never execute installed app code.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root = process.argv[2];
if (!root) throw new Error('Usage: node bin/import-hermes-field-copy.mjs <hermes-agent directory>');
function extract(file, names) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const found = {};
  function flat(node, prefix = '', out = {}) {
    if (ts.isCallExpression(node)) return flat(node.arguments[0], prefix, out);
    if (!ts.isObjectLiteralExpression(node)) throw new Error('Expected static copy object');
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = property.name.text;
      const full = prefix ? `${prefix}.${key}` : key;
      if (ts.isStringLiteralLike(property.initializer)) out[full] = property.initializer.text;
      else flat(property.initializer, full, out);
    }
    return out;
  }
  function visit(node) {
    if (ts.isPropertyAssignment(node) && names.includes(node.name.text)) found[node.name.text] = flat(node.initializer);
    if (ts.isVariableDeclaration(node) && names.includes(node.name.text)) found[node.name.text] = flat(node.initializer);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}
const desktop = path.join(root, 'apps/desktop/src');
const zh = extract(path.join(desktop, 'i18n/zh.ts'), ['fieldLabels', 'fieldDescriptions']);
const en = extract(path.join(desktop, 'app/settings/constants.ts'), ['FIELD_LABELS', 'FIELD_DESCRIPTIONS']);
fs.mkdirSync('lib/i18n/hermes', { recursive: true });
fs.writeFileSync('lib/i18n/hermes/fields.json', JSON.stringify({ 'zh-CN': zh, en: { fieldLabels: en.FIELD_LABELS, fieldDescriptions: en.FIELD_DESCRIPTIONS } }, null, 2) + '\n');
fs.copyFileSync(path.join(root, 'LICENSE'), 'lib/i18n/hermes/LICENSE');
console.log(`Imported ${Object.keys(zh.fieldLabels).length} labels and ${Object.keys(zh.fieldDescriptions).length} descriptions.`);
