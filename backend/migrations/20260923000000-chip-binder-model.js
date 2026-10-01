// G1 — Ficha × Modelo de Fichário × Fichário físico.
//
//  1. Detecta fichas ATIVAS duplicadas (mesmo valor + cor). Se houver, ABORTA sem escrever nada,
//     a menos que GENESIS_MERGE_DUPLICATE_CHIPS=1 (a mesclagem é assistida — decisão D4:
//     rode antes `node scripts/audit-legacy-chips.js` e confira os grupos listados).
//  2. Mescla cada grupo na ficha mais antiga: reaponta fichários, stacks, torneios, chip races e o
//     ledger; recalcula o saldo; a duplicata fica inativa/excluída com `merged_into`.
//  3. Normaliza todas as fichas: cor hexadecimal, `kind`, `active`, `monetary_value`, e troca o
//     `name` (que virava "nome de modelo") por um rótulo derivado — o nome antigo vai p/ `legacy_name`.
//  4. Cria um Modelo de Fichário para cada fichário existente sem modelo (mesma composição) e o vincula.
//  5. Cria o índice único (valor, cor, tipo) entre as fichas ativas.
//
// Idempotente: rodar de novo não duplica modelos nem refaz mesclagens.

const MERGE_FLAG = 'GENESIS_MERGE_DUPLICATE_CHIPS';
const RESERVATION = ['alocacao', 'retorno'];
const INDEX_NAME = 'chip_identity_active';

const sid = (x) => String(x);
const isLive = (d) => d.deleted_at == null;

function normColor(raw) {
  if (raw == null || raw === '') return null;
  let c = String(raw).trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(c)) c = `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  return /^#[0-9a-f]{6}$/.test(c) ? c : String(raw).trim().toLowerCase();
}
const label = (c) => (c.kind === 'KO' ? `Ficha KO ${c.value}` : `Ficha ${c.value}`);

function findDuplicateGroups(chips) {
  const groups = new Map();
  for (const c of chips.filter((x) => isLive(x) && x.active !== false)) {
    const k = `${c.value}|${normColor(c.color) || ''}|${c.kind || 'TOURNAMENT'}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0) || sid(a._id).localeCompare(sid(b._id))));
}

// junta linhas repetidas da mesma ficha somando a quantidade
function remapLines(lines, idMap, qtyField) {
  const out = new Map();
  let changed = false;
  for (const l of lines || []) {
    const from = sid(l.chip_id);
    const to = idMap.get(from) || from;
    if (to !== from) changed = true;
    if (out.has(to)) { out.get(to)[qtyField] = (out.get(to)[qtyField] || 0) + (l[qtyField] || 0); changed = true; }
    else out.set(to, { ...l, chip_id: idMap.has(from) ? idMap.get(from + ':oid') : l.chip_id });
  }
  return { lines: [...out.values()], changed };
}

async function recalcKeeper(db, chipId) {
  const rows = await db.collection('inventoryledgers').find({ chip_id: chipId }).sort({ createdAt: 1, _id: 1 }).toArray();
  let total = 0; let reserved = 0;
  const ops = [];
  for (const r of rows) {
    if (RESERVATION.includes(r.type)) reserved += r.quantity; else total += r.quantity;
    ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: { balance_after: Math.max(0, total) } } } });
  }
  if (ops.length) await db.collection('inventoryledgers').bulkWrite(ops);
  const t = Math.max(0, total); const rs = Math.max(0, reserved);
  await db.collection('chipmodels').updateOne(
    { _id: chipId },
    { $set: { total_quantity: t, reserved_quantity: rs, available_quantity: Math.max(0, t - rs) } },
  );
}

async function mergeGroup(db, group) {
  const [keeper, ...dups] = group;
  const idMap = new Map(); // dupId -> keeperId (string) ; `${dupId}:oid` -> ObjectId do keeper
  for (const d of dups) { idMap.set(sid(d._id), sid(keeper._id)); idMap.set(`${sid(d._id)}:oid`, keeper._id); }
  const dupIds = dups.map((d) => d._id);
  const now = new Date();

  // fichários (composição + alocações legadas)
  for (const b of await db.collection('chipcases').find({ 'chips.chip_id': { $in: dupIds } }).toArray()) {
    const { lines } = remapLines(b.chips, idMap, 'quantity');
    await db.collection('chipcases').updateOne({ _id: b._id }, { $set: { chips: lines } });
  }
  for (const b of await db.collection('chipcases').find({ 'allocations.chip_ids': { $in: dupIds } }).toArray()) {
    const allocations = (b.allocations || []).map((a) => ({
      ...a, chip_ids: [...new Map((a.chip_ids || []).map((id) => [sid(idMap.get(sid(id)) || id), idMap.get(`${sid(id)}:oid`) || id])).values()],
    }));
    await db.collection('chipcases').updateOne({ _id: b._id }, { $set: { allocations } });
  }
  // stacks e torneios
  for (const s of await db.collection('stackmodels').find({ 'composition.chip_id': { $in: dupIds } }).toArray()) {
    const { lines } = remapLines(s.composition, idMap, 'quantity');
    await db.collection('stackmodels').updateOne({ _id: s._id }, { $set: { composition: lines } });
  }
  for (const t of await db.collection('tournaments').find({ 'stack_composition.chip_id': { $in: dupIds } }, { projection: { stack_composition: 1 } }).toArray()) {
    const { lines } = remapLines(t.stack_composition, idMap, 'per_player');
    await db.collection('tournaments').updateOne({ _id: t._id }, { $set: { stack_composition: lines } });
  }
  // chip races e ledger
  await db.collection('chipraces').updateMany({ from_chip: { $in: dupIds } }, { $set: { from_chip: keeper._id } });
  await db.collection('chipraces').updateMany({ to_chip: { $in: dupIds } }, { $set: { to_chip: keeper._id } });
  await db.collection('inventoryledgers').updateMany({ chip_id: { $in: dupIds } }, { $set: { chip_id: keeper._id } });

  // duplicatas viram inativas/excluídas, com rastro
  await db.collection('chipmodels').updateMany(
    { _id: { $in: dupIds } },
    { $set: { deleted_at: now, active: false, merged_into: keeper._id, updatedAt: now } },
  );
  await recalcKeeper(db, keeper._id);
  return dups.length;
}

module.exports = {
  async up(db) {
    const chipsCol = db.collection('chipmodels');
    let chips = await chipsCol.find({}).toArray();

    // 1) duplicatas ativas: aborta antes de escrever qualquer coisa, salvo autorização explícita
    const groups = findDuplicateGroups(chips);
    if (groups.length && process.env[MERGE_FLAG] !== '1') {
      const lines = groups.map((g) => `  • valor ${g[0].value}${g[0].color ? ` cor ${normColor(g[0].color)}` : ''}: ${g.map((c) => `"${c.name}" (${sid(c._id)})`).join(', ')}`);
      throw new Error(
        `Migração G1 abortada: ${groups.length} grupo(s) de fichas duplicadas (mesmo valor + cor).\n${lines.join('\n')}\n` +
        `Confira com "node scripts/audit-legacy-chips.js". Se a mesclagem estiver correta, rode de novo com ${MERGE_FLAG}=1 ` +
        '(a ficha mais antiga de cada grupo é mantida e as demais são mescladas nela).',
      );
    }

    // 2) mescla
    let merged = 0;
    for (const g of groups) merged += await mergeGroup(db, g);
    if (merged) chips = await chipsCol.find({}).toArray();

    // 3) normaliza todas as fichas (vivas, descontinuadas e excluídas)
    const now = new Date();
    const ops = chips.map((c) => {
      const kind = c.kind || 'TOURNAMENT';
      const set = {
        color: normColor(c.color),
        kind,
        active: c.active === false ? false : isLive(c),
        monetary_value: c.monetary_value ?? null,
        name: label({ value: c.value, kind }),
      };
      if (c.legacy_name === undefined && c.name !== undefined && c.name !== set.name) set.legacy_name = c.name;
      return { updateOne: { filter: { _id: c._id }, update: { $set: set } } };
    });
    if (ops.length) await chipsCol.bulkWrite(ops);

    // 4) um Modelo de Fichário por fichário existente (mesma composição)
    const modelCol = db.collection('bindermodels');
    const usedNames = new Set((await modelCol.find({}, { projection: { name: 1 } }).toArray()).map((m) => String(m.name).toLowerCase()));
    const liveChipIds = new Set(chips.filter((c) => isLive(c) && c.active !== false).map((c) => sid(c._id)));
    for (const b of await db.collection('chipcases').find({ deleted_at: null, model_id: null }).toArray()) {
      const existing = await modelCol.findOne({ migrated_from_binder: b._id });
      if (existing) { await db.collection('chipcases').updateOne({ _id: b._id }, { $set: { model_id: existing._id } }); continue; }

      const byChip = new Map();
      for (const l of b.chips || []) {
        if (!l.chip_id || !(l.quantity > 0) || !liveChipIds.has(sid(l.chip_id))) continue;
        byChip.set(sid(l.chip_id), { chip_id: l.chip_id, quantity: (byChip.get(sid(l.chip_id))?.quantity || 0) + Math.floor(l.quantity) });
      }
      if (!byChip.size) continue; // fichário vazio: nada a modelar

      let name = b.name; let n = 2;
      while (usedNames.has(String(name).toLowerCase())) name = `${b.name} (${n++})`;
      usedNames.add(String(name).toLowerCase());
      const { insertedId } = await modelCol.insertOne({
        name, composition: [...byChip.values()], deleted_at: null,
        notes: `Criado pela migração G1 a partir do fichário "${b.name}".`,
        migrated_from_binder: b._id, createdAt: now, updatedAt: now, __v: 0,
      });
      await db.collection('chipcases').updateOne({ _id: b._id }, { $set: { model_id: insertedId } });
    }
    await db.collection('chipcases').updateMany({ model_id: { $exists: false } }, { $set: { model_id: null } });

    // 5) uma denominação = uma ficha ativa
    await chipsCol.createIndex(
      { value: 1, color: 1, kind: 1 },
      { unique: true, partialFilterExpression: { active: true }, name: INDEX_NAME },
    );
  },

  async down(db) {
    // Reverte modelos/vínculos e o nome antigo. A mesclagem de fichas duplicadas NÃO é revertida
    // (use o backup feito antes da migração).
    const modelCol = db.collection('bindermodels');
    const migrated = await modelCol.find({ migrated_from_binder: { $exists: true } }).toArray();
    if (migrated.length) {
      await db.collection('chipcases').updateMany({ model_id: { $in: migrated.map((m) => m._id) } }, { $set: { model_id: null } });
      await modelCol.deleteMany({ _id: { $in: migrated.map((m) => m._id) } });
    }
    for (const c of await db.collection('chipmodels').find({ legacy_name: { $exists: true } }).toArray()) {
      await db.collection('chipmodels').updateOne({ _id: c._id }, { $set: { name: c.legacy_name }, $unset: { legacy_name: '' } });
    }
    try { await db.collection('chipmodels').dropIndex(INDEX_NAME); } catch { /* índice inexistente */ }
  },

  // exportados para teste
  _internals: { findDuplicateGroups, normColor },
};
