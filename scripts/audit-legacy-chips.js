#!/usr/bin/env node
/**
 * G0 — Auditoria SOMENTE-LEITURA do estoque legado (fichas × fichários × ledger v1).
 *
 * Serve de insumo para o G1 (mesclar fichas duplicadas — D4) e o G2 (estoque que não
 * está em nenhum fichário vai para o fichário "LEGADO" — D5). Não escreve nada no banco.
 *
 * Uso:
 *   node scripts/audit-legacy-chips.js [--uri mongodb://host/genesis] [--json saida.json] [--strict]
 *
 *   --uri     padrão: $MONGO_URI ou mongodb://127.0.0.1:27017/genesis
 *   --json    grava também o relatório completo em JSON
 *   --strict  exit code 1 se houver qualquer achado de severidade "error" (útil em CI/deploy)
 */
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');

// resolve `mongoose` a partir de backend/ (as deps do projeto vivem lá)
const mongoose = createRequire(path.join(__dirname, '..', 'backend', 'package.json'))('mongoose');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const URI = opt('--uri', process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/genesis');
const RESERVATION = new Set(['alocacao', 'retorno']);
const RUNNING = new Set(['running', 'paused']);

const findings = [];
const add = (severity, code, message, data = {}) => findings.push({ severity, code, message, ...data });
const sid = (x) => (x == null ? null : String(x));
const isLive = (d) => d && !d.deleted_at;
const colorKey = (c) => String(c || '').trim().toLowerCase();

async function main() {
  const conn = await mongoose.createConnection(URI, { serverSelectionTimeoutMS: 8000 }).asPromise();
  const col = (n) => conn.db.collection(n);

  const [chips, cases, tournaments, stacks, races, ledgerRows] = await Promise.all([
    col('chipmodels').find().toArray(),
    col('chipcases').find().toArray(),
    col('tournaments').find().toArray(),
    col('stackmodels').find().toArray(),
    col('chipraces').find().toArray(),
    col('inventoryledgers').find().toArray(),
  ]);

  const chipById = new Map(chips.map((c) => [sid(c._id), c]));
  const caseById = new Map(cases.map((c) => [sid(c._id), c]));
  const tById = new Map(tournaments.map((t) => [sid(t._id), t]));
  const liveChips = chips.filter(isLive);
  const liveCases = cases.filter(isLive);
  const liveTournaments = tournaments.filter(isLive);
  const chipLabel = (id) => {
    const c = chipById.get(sid(id));
    return c ? `${c.name} (valor ${c.value}${c.color ? `, cor ${c.color}` : ''})${c.deleted_at ? ' [excluída]' : ''}` : `${sid(id)} [inexistente]`;
  };

  // ── ledger recalculado por ficha (mesma regra do lib/inventoryLedger.recalcChip, sem o clamp)
  const ledger = new Map(); // chipId -> { total, reserved, byTournament: Map }
  for (const r of ledgerRows) {
    const k = sid(r.chip_id);
    if (!ledger.has(k)) ledger.set(k, { total: 0, reserved: 0, byTournament: new Map() });
    const acc = ledger.get(k);
    if (RESERVATION.has(r.type)) {
      acc.reserved += r.quantity;
      const tid = r.ref?.kind === 'tournament' ? sid(r.ref.id) : null;
      if (tid) acc.byTournament.set(tid, (acc.byTournament.get(tid) || 0) + r.quantity);
    } else {
      acc.total += r.quantity;
    }
  }
  const led = (id) => ledger.get(sid(id)) || { total: 0, reserved: 0, byTournament: new Map() };

  // ── A. fichas duplicadas por (valor, cor) — insumo do D4
  const groups = new Map();
  for (const c of liveChips) {
    const k = `${c.value}|${colorKey(c.color)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    const [value, color] = k.split('|');
    add('error', 'DUP_CHIP',
      `${list.length} fichas ativas com valor ${value}${color ? ` e cor ${color}` : ''} — precisam ser mescladas no G1`,
      { chips: list.map((c) => ({ id: sid(c._id), name: c.name, ledger_total: led(c._id).total })) });
  }

  // ── B/C. cache × ledger, saldo negativo escondido, reservas órfãs
  for (const c of liveChips) {
    const l = led(c._id);
    const cached = { total: c.total_quantity || 0, reserved: c.reserved_quantity || 0, available: c.available_quantity || 0 };
    const expected = {
      total: Math.max(0, l.total), reserved: Math.max(0, l.reserved),
    };
    expected.available = Math.max(0, expected.total - expected.reserved);
    if (cached.total !== expected.total || cached.reserved !== expected.reserved || cached.available !== expected.available) {
      add('warn', 'CACHE_DRIFT', `${chipLabel(c._id)}: cache diverge do ledger`, { chip_id: sid(c._id), cached, expected });
    }
    if (l.total < 0 || l.reserved < 0) {
      add('error', 'HIDDEN_NEGATIVE', `${chipLabel(c._id)}: ledger soma negativo (${l.total}/${l.reserved}) — o clamp Math.max(0) esconde isso`, { chip_id: sid(c._id), raw_total: l.total, raw_reserved: l.reserved });
    }
    for (const [tid, qty] of l.byTournament) {
      if (qty === 0) continue;
      const t = tById.get(tid);
      const active = t && isLive(t) && RUNNING.has(t.status);
      if (!active) {
        add('error', 'ORPHAN_RESERVATION',
          `${chipLabel(c._id)}: ${qty} unidade(s) reservadas para ${t ? `"${t.name}" (${t.status}${t.deleted_at ? ', excluído' : ''})` : `torneio ${tid} [inexistente]`}, que não está em andamento`,
          { chip_id: sid(c._id), tournament_id: tid, reserved: qty });
      }
    }
  }

  // ── D/E/F. fichários
  const inCases = new Map(); // chipId -> soma nas maletas vivas
  for (const cs of liveCases) {
    const seen = new Set();
    for (const line of cs.chips || []) {
      const cid = sid(line.chip_id);
      const chip = chipById.get(cid);
      if (!chip || chip.deleted_at) {
        add('error', 'CASE_DANGLING_CHIP', `Fichário "${cs.name}" aponta para ${chipLabel(cid)}`, { case_id: sid(cs._id), chip_id: cid });
        continue;
      }
      if (seen.has(cid)) add('warn', 'CASE_DUP_LINE', `Fichário "${cs.name}" tem a ficha ${chipLabel(cid)} em mais de uma linha`, { case_id: sid(cs._id), chip_id: cid });
      seen.add(cid);
      const q = line.quantity;
      if (!Number.isInteger(q) || q < 0) add('warn', 'CASE_BAD_QTY', `Fichário "${cs.name}": quantidade inválida (${q}) para ${chipLabel(cid)}`, { case_id: sid(cs._id), chip_id: cid, quantity: q });
      inCases.set(cid, (inCases.get(cid) || 0) + (Number(q) || 0));
    }
  }
  const stockOutside = []; // insumo do D5 (fichário LEGADO)
  for (const c of liveChips) {
    const total = Math.max(0, led(c._id).total);
    const cases_ = inCases.get(sid(c._id)) || 0;
    if (cases_ > total) {
      add('error', 'CASES_EXCEED_STOCK',
        `${chipLabel(c._id)}: fichários somam ${cases_} mas o estoque (ledger) é ${total} — dupla contabilização`,
        { chip_id: sid(c._id), in_cases: cases_, ledger_total: total });
    } else if (total > cases_) {
      stockOutside.push({ chip_id: sid(c._id), chip: chipLabel(c._id), ledger_total: total, in_cases: cases_, outside_cases: total - cases_ });
    }
  }
  if (stockOutside.length) {
    add('info', 'STOCK_OUTSIDE_CASES', `${stockOutside.length} ficha(s) têm estoque fora de qualquer fichário → irão para o fichário LEGADO (D5)`, { items: stockOutside });
  }

  // ── G. alocação de fichários × torneios
  const runningByCase = new Map();
  for (const t of liveTournaments.filter((t) => RUNNING.has(t.status))) {
    for (const cid of t.allocated_cases || []) {
      const k = sid(cid);
      if (!runningByCase.has(k)) runningByCase.set(k, []);
      runningByCase.get(k).push(t.name);
      const cs = caseById.get(k);
      if (!cs || cs.deleted_at) add('error', 'TOURNAMENT_DANGLING_CASE', `Torneio "${t.name}" (${t.status}) aloca fichário inexistente/excluído ${k}`, { tournament_id: sid(t._id), case_id: k });
    }
  }
  for (const [cid, names] of runningByCase) {
    if (names.length > 1) add('error', 'CASE_DOUBLE_ALLOCATED', `Fichário ${caseById.get(cid)?.name || cid} está em ${names.length} torneios em andamento (${names.join(', ')}) — reserva inteira duplicada`, { case_id: cid });
  }
  for (const cs of liveCases) {
    if (cs.status === 'allocated' && !runningByCase.has(sid(cs._id))) {
      add('warn', 'CASE_STALE_STATUS', `Fichário "${cs.name}" está "allocated" mas nenhum torneio em andamento o usa`, { case_id: sid(cs._id) });
    }
  }

  // ── H. referências a fichas removidas / chip race fracionário
  for (const s of stacks) {
    for (const line of s.composition || []) {
      const chip = chipById.get(sid(line.chip_id));
      if (!chip || chip.deleted_at) add('warn', 'STACK_DANGLING_CHIP', `Modelo de stack "${s.name}" usa ${chipLabel(line.chip_id)}`, { stack_id: sid(s._id), chip_id: sid(line.chip_id) });
    }
  }
  for (const r of races) {
    if (r.to_quantity != null && !Number.isInteger(r.to_quantity)) {
      add('warn', 'RACE_FRACTIONAL', `Chip race ${sid(r._id)} tem to_quantity fracionário (${r.to_quantity}) — sem conceito de quebra (C2)`, { race_id: sid(r._id), to_quantity: r.to_quantity });
    }
  }

  // ── relatório
  const summary = {
    uri: URI.replace(/\/\/[^@]*@/, '//***@'),
    generated_at: new Date().toISOString(),
    counts: {
      chips_live: liveChips.length, chips_deleted: chips.length - liveChips.length,
      cases_live: liveCases.length, cases_deleted: cases.length - liveCases.length,
      tournaments_live: liveTournaments.length, ledger_rows: ledgerRows.length,
      stack_models: stacks.length, chip_races: races.length,
    },
    by_severity: ['error', 'warn', 'info'].reduce((o, s) => ({ ...o, [s]: findings.filter((f) => f.severity === s).length }), {}),
  };

  const icon = { error: '✖', warn: '⚠', info: 'ℹ' };
  console.log(`\nAuditoria do estoque legado — ${summary.uri}`);
  console.log(`Fichas ativas: ${summary.counts.chips_live} (excluídas: ${summary.counts.chips_deleted}) · Fichários ativos: ${summary.counts.cases_live} · Torneios ativos: ${summary.counts.tournaments_live} · Lançamentos no ledger: ${summary.counts.ledger_rows}`);
  if (liveChips.length === 0) console.log('\n⚠ Nenhuma ficha ATIVA neste banco (só registros excluídos/resíduo de testes). Rode com --uri apontando para o banco real.');
  console.log('');
  if (!findings.length) console.log('✓ Nenhum achado.');
  for (const f of findings) console.log(`${icon[f.severity]} [${f.code}] ${f.message}`);
  console.log(`\nResumo: ${summary.by_severity.error} erro(s), ${summary.by_severity.warn} aviso(s), ${summary.by_severity.info} info.`);

  const jsonPath = opt('--json', null);
  if (jsonPath) {
    fs.writeFileSync(jsonPath, JSON.stringify({ summary, findings }, null, 2));
    console.log(`Relatório completo em ${jsonPath}`);
  }

  await conn.close();
  if (flag('--strict') && summary.by_severity.error > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Falha na auditoria:', err.message);
  process.exit(2);
});
