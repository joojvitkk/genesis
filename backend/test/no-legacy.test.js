// G11 — o legado foi REMOVIDO do código de aplicação. Este teste impede a volta de qualquer coisa que a spec aboliu:
// quantidade global por ficha, cache no fichário, calculadora antiga de chip race, ledger v1, alias /cases etc.
// (Migrações e testes ficam de fora: descrevem o passado e os dados antigos.)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SCAN_DIRS = ['backend/models', 'backend/lib', 'backend/routes', 'backend/services', 'backend/utils', 'backend/middlewares', 'frontend/src'];
const SCAN_FILES = ['backend/app.js', 'backend/server.js'];
const EXT = /\.(js|jsx)$/;

const FORBIDDEN = [
  [/total_quantity|available_quantity|reserved_quantity|initial_quantity/, 'quantidade global por ficha (é saldo derivado dos movimentos)'],
  [/allocated_cases|allocated_to_tournament/, 'campos de alocação gravados no fichário/torneio (são derivados das alocações)'],
  [/stack_composition/, 'stack digitado à mão (o stack vem do modelo de stack)'],
  [/InventoryLedger|inventoryLedger/, 'ledger v1 (o livro-razão é o Movement)'],
  [/refreshCaches|rebuildCaches|refreshAllocationCaches/, 'caches derivados gravados'],
  [/\/chip-races|\bChipRace\b\s*[,.})]|models\/ChipRace/, 'calculadora antiga de chip race (agora Conversion)'],
  [/['"`]\/cases|\/api\/cases/, 'alias legado /cases (agora /binders)'],
  [/legacy_name/, 'nome legado da ficha'],
  // decisões de produto: a ficha só tem VALOR NOMINAL e não existe cadastro de jogadores
  [/monetary_value|monetaryValue|exposed_value|\bexposure\b/, 'valor monetário na ficha / exposição em dinheiro (a ficha só tem valor nominal)'],
  [/KO_SETTLE|ko_settled|ko_chip_id|kind: 'KO'|kind === 'KO'|CHIP_KINDS|Ficha KO|koBalances|ko-settlements|\/ko\//, 'ficha KO / tipo de ficha (a ficha só tem valor nominal e cor)'],
  [/\bPlayer\b|player_id|player_name|PlayerSelect|\/players|Jogadores/, 'cadastro de jogadores (a identidade é a entrada, "Entrada #n")'],
];

function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(rel, out); }
    else if (EXT.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

test('legado removido: nenhum código de aplicação usa o que a spec aboliu', () => {
  const files = [...SCAN_DIRS.flatMap((d) => walk(d)), ...SCAN_FILES];
  const hits = [];
  for (const rel of files) {
    const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const [re, why] of FORBIDDEN) if (re.test(line)) hits.push(`${rel}:${i + 1}  ${why}  → ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(hits, [], `\n${hits.join('\n')}`);
});

test('acesso à ficha: grep total_quantity no código de aplicação = 0 ocorrências (aceite G11)', () => {
  const files = [...SCAN_DIRS.flatMap((d) => walk(d)), ...SCAN_FILES];
  const n = files.reduce((s, rel) => s + (fs.readFileSync(path.join(ROOT, rel), 'utf8').match(/total_quantity/g) || []).length, 0);
  assert.equal(n, 0);
});
