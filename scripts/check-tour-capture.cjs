/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Node/Playwright entrypoint. */
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');

// Counts are deliberate: adding another registration to an allowed file also fails.
const allowed = new Map([
  ['components/Tour/tourEvents.ts', 2], // central boundary
  ['editor/CanvasStage.tsx', 2], // held-modifier state; checks isHelpActive
  ['editor/SlideEditor.tsx', 1], // existing popover Escape; checks isHelpActive
  ['editor/EditorPasteMenu.tsx', 1], // existing paste Escape; checks isHelpActive
  ['sfx.ts', 1], // one-shot audio unlock, not an application shortcut
]);
function captures(source, file = 'input.ts') {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const values = new Map();
  function collect(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) values.set(node.name.text, node.initializer);
    ts.forEachChild(node, collect);
  }
  collect(ast);
  const resolve = (node, seen = new Set()) => {
    if (node && (ts.isAsExpression(node) || ts.isParenthesizedExpression(node))) return resolve(node.expression, seen);
    if (node && ts.isIdentifier(node) && values.has(node.text) && !seen.has(node.text)) {
      seen.add(node.text); return resolve(values.get(node.text), seen);
    }
    return node;
  };
  const findings = [];
  function visit(node) {
    if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))) {
      const method = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : resolve(node.expression.argumentExpression);
      const nameOfMethod = typeof method === 'string' ? method : method && ts.isStringLiteralLike(method) ? method.text : null;
      const receiver = resolve(node.expression.expression);
      const isWindow = receiver && ['window', 'globalThis', 'globalThis.window'].includes(receiver.getText(ast));
      if (isWindow && (nameOfMethod === 'addEventListener' || nameOfMethod === null)) {
        const name = resolve(node.arguments[0]);
        const event = name && ts.isStringLiteralLike(name) ? name.text : null;
        if (event === null || event === 'keydown' || event === 'keyup') {
          const options = resolve(node.arguments[2]);
          let capture = 'dynamic';
          if (!options || options.kind === ts.SyntaxKind.FalseKeyword) capture = false;
          else if (options.kind === ts.SyntaxKind.TrueKeyword) capture = true;
          else if (ts.isObjectLiteralExpression(options)) {
            capture = false;
            for (const prop of options.properties) {
              if (ts.isSpreadAssignment(prop)) { capture = 'dynamic'; break; }
              const propName = prop.name && ts.isComputedPropertyName(prop.name) ? resolve(prop.name.expression) : prop.name;
              if (!propName) { capture = 'dynamic'; break; }
              const key = ts.isIdentifier(propName) ? propName.text : ts.isStringLiteralLike(propName) ? propName.text : null;
              if (key === null) { capture = 'dynamic'; break; }
              if (key === 'capture') {
                const value = ts.isPropertyAssignment(prop) ? resolve(prop.initializer) : null;
                capture = value?.kind === ts.SyntaxKind.TrueKeyword ? true : value?.kind === ts.SyntaxKind.FalseKeyword ? false : 'dynamic';
              }
            }
          }
          if (capture !== false) findings.push({ line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, dynamic: event === null || capture === 'dynamic' });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return findings;
}
function check(root = path.resolve('src/renderer')) {
  const problems = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (/\.tsx?$/.test(entry.name)) {
        const file = path.relative(root, absolute).replace(/\\/g, '/');
        const found = captures(fs.readFileSync(absolute, 'utf8'), file);
        if (found.some(item => item.dynamic) || found.length > (allowed.get(file) ?? 0)) problems.push({ file, findings: found });
      }
    }
  }
  walk(root);
  return problems;
}
module.exports = { captures, check };
if (require.main === module) {
  const problems = check();
  if (problems.length) { console.error(JSON.stringify(problems, null, 2)); process.exitCode = 1; }
  else console.log('Window keyboard capture boundary checked.');
}
