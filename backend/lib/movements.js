// Motor de movimentações (G2) — fonte da verdade dos saldos.
//
//  • postBatch(specs, { user })     grava movimentos em lote (tudo ou nada), validando o saldo da origem.
//  • reverseMovements(ids, {...})   estorno: movimento inverso vinculado ao original (nunca apaga nada).
//  • balances / balanceAt           saldo DERIVADO = Σ entradas (to) − Σ saídas (from).
//  • (sem caches: conteúdo do fichário, totais e reservas são SEMPRE derivados na leitura)
//  • G6: localização `play` (em jogo, id = torneio). Envios/conversões só saem do que está ALOCADO ao torneio:
//    reservado(alocação) = alocado − enviado_líquido, com o enviado DERIVADO dos movimentos (nada é gravado).
//
// Concorrência: dois débitos simultâneos na mesma localização/ficha inserem documentos diferentes e
// não conflitariam entre si (write skew). Por isso todo débito incrementa um BalanceLock (ponto de
// conflito) dentro da transação; o perdedor é retentado e enxerga o saldo já debitado. Sem replica
// set (MongoDB standalone, só para desenvolvimento) cai num mutex em memória — seguro para UM
// processo; produção deve usar replica set (ver README).
const mongoose = require('mongoose');
const { Movement, BalanceLock, Chip, Binder, Allocation, Tournament } = require('../models');
const { MOVEMENT_TYPES } = require('../models/Movement');
const { HttpError } = require('./catalog');
const logger = require('./logger');

const oid = (x) => new mongoose.Types.ObjectId(String(x));

// ─── regras por tipo ─────────────────────────────────────────────────────────
const RULES = {
  ASSEMBLY:   { reason: true,  ok: (f, t) => f.kind === 'external' && t.kind === 'binder' },
  WITHDRAWAL: { reason: true,  ok: (f, t) => f.kind === 'binder' && t.kind === 'external' },
  ADJUSTMENT: { reason: true,  ok: (f, t) => (f.kind === 'external' && t.kind === 'binder') || (f.kind === 'binder' && t.kind === 'external') },
  // perda: do fichário para as divergências dele, ou do jogo para as divergências do torneio (G8)
  LOSS:       { reason: true,  ok: (f, t) => ['binder', 'play'].includes(f.kind) && t.kind === 'lost' && String(f.id) === String(t.id) },
  // G8 — sobra achada na conferência (entra do "externo") e recuperação do que estava em divergência
  FOUND:      { reason: true,  ok: (f, t) => f.kind === 'external' && ['binder', 'play'].includes(t.kind) },
  RECOVERY:   { reason: true,  ok: (f, t) => f.kind === 'lost' && t.kind === 'binder' },
  REVERSAL:   { reason: true,  ok: () => true }, // construído por reverseMovements a partir do original
};
// G6 — material no torneio. Envio/entrada de conversão: fichário → em jogo (limitado pela ALOCAÇÃO do torneio).
// Retorno/saída de conversão: em jogo → fichário.
const TO_PLAY = { reason: false, ok: (f, t) => f.kind === 'binder' && t.kind === 'play' };
const FROM_PLAY = { reason: false, ok: (f, t) => f.kind === 'play' && t.kind === 'binder' };
for (const type of ['SEND_BUY_IN', 'SEND_OPTIONAL', 'SEND_REENTRY', 'SEND_ADDITIONAL', 'CHIP_RACE_IN', 'COLOR_UP_IN']) RULES[type] = TO_PLAY;
for (const type of ['RETURN', 'CHIP_RACE_OUT', 'COLOR_UP_OUT', 'DISCARD']) RULES[type] = FROM_PLAY;
/** Tipos que consomem a alocação do torneio (binder → play, exceto estorno). */
const CAPPED = new Set(['SEND_BUY_IN', 'SEND_OPTIONAL', 'SEND_REENTRY', 'SEND_ADDITIONAL', 'CHIP_RACE_IN', 'COLOR_UP_IN']);

function location(raw, label) {
  const kind = raw?.kind;
  if (!['external', 'binder', 'lost', 'play'].includes(kind)) throw new HttpError(400, `Localização de ${label} inválida.`);
  if (kind === 'external') return { kind, id: null };
  if (!mongoose.isValidObjectId(raw.id)) throw new HttpError(400, `${kind === 'play' ? 'Torneio' : 'Fichário'} de ${label} inválido.`);
  return { kind, id: oid(raw.id) };
}

function normalize(spec) {
  const type = spec?.type;
  if (!MOVEMENT_TYPES.includes(type)) throw new HttpError(400, `Tipo de movimentação inválido: ${type}.`);
  const quantity = Number(spec.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) throw new HttpError(400, 'A quantidade deve ser um inteiro maior que zero.');
  if (!mongoose.isValidObjectId(spec.chip_id)) throw new HttpError(400, 'Ficha inválida.');
  const from = location(spec.from, 'origem');
  const to = location(spec.to, 'destino');
  const rule = RULES[type];
  if (!rule.ok(from, to)) throw new HttpError(400, `Origem/destino incompatíveis com ${type}.`);
  const reason = spec.reason == null ? '' : String(spec.reason).trim();
  if (rule.reason && !reason) throw new HttpError(400, 'Informe o motivo da movimentação.');
  const play = [to, from].find((l) => l.kind === 'play'); // o torneio É a localização
  // perda em jogo: a divergência é do TORNEIO (id do torneio), não de um fichário
  const binder = [to, from].find((l) => l.kind === 'binder') || (play ? null : [to, from].find((l) => l.kind === 'lost'));
  return {
    type, chip_id: oid(spec.chip_id), quantity, from, to, reason: reason || undefined,
    binder_id: binder ? binder.id : null,
    reverses: spec.reverses ? oid(spec.reverses) : null,
    tournament_id: play ? play.id : (spec.tournament_id || null), // em jogo: o torneio É a localização
    session_id: spec.session_id || null,
    meta: spec.meta,
  };
}

// ─── saldo derivado ──────────────────────────────────────────────────────────
const locKey = (l, chip) => `${l.kind}:${l.id ?? ''}:${chip}`;
const isDebitable = (l) => ['binder', 'lost', 'play'].includes(l.kind); // `external` é a origem ilimitada

async function sumSide(side, loc, chipId, session) {
  const [row] = await Movement.aggregate([
    { $match: { chip_id: oid(chipId), [`${side}.kind`]: loc.kind, [`${side}.id`]: loc.id ?? null } },
    { $group: { _id: null, q: { $sum: '$quantity' } } },
  ]).session(session || null);
  return row?.q || 0;
}

/** Saldo de UMA localização/ficha. Sequencial de propósito (uma sessão não aceita operações paralelas). */
async function balanceAt(loc, chipId, session) {
  const inn = await sumSide('to', loc, chipId, session);
  const out = await sumSide('from', loc, chipId, session);
  return inn - out;
}

/**
 * Saldos por fichário × ficha (só linhas ≠ 0).
 * @param {{ kind?: 'binder'|'lost', binder_id?: string, chip_id?: string }} q
 * @returns {Promise<Array<{ binder_id: ObjectId, chip_id: ObjectId, quantity: number }>>}
 */
async function balances({ kind = 'binder', binder_id, chip_id } = {}) {
  const match = (side) => ({
    [`${side}.kind`]: kind,
    ...(binder_id ? { [`${side}.id`]: oid(binder_id) } : {}),
    ...(chip_id ? { chip_id: oid(chip_id) } : {}),
  });
  const agg = (side) => Movement.aggregate([
    { $match: match(side) },
    { $group: { _id: { id: `$${side}.id`, chip: '$chip_id' }, q: { $sum: '$quantity' } } },
  ]);
  const [ins, outs] = await Promise.all([agg('to'), agg('from')]);
  const map = new Map();
  const add = (rows, sign) => rows.forEach((r) => {
    const k = `${r._id.id}:${r._id.chip}`;
    const cur = map.get(k) || { binder_id: r._id.id, chip_id: r._id.chip, quantity: 0 };
    cur.quantity += sign * r.q;
    map.set(k, cur);
  });
  add(ins, 1); add(outs, -1);
  return [...map.values()].filter((r) => r.quantity !== 0);
}

/** Total físico de uma ficha dentro de fichários (Σ dos saldos). */
async function chipTotal(chipId) {
  return (await balances({ chip_id: chipId })).reduce((a, r) => a + r.quantity, 0);
}

// ─── execução (transação ou mutex local) ─────────────────────────────────────
let txMode = null; // true | false | null (auto-detecta)
async function supportsTransactions() {
  if (txMode !== null) return txMode;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    txMode = !!hello.setName || hello.msg === 'isdbgrid';
  } catch { txMode = false; }
  if (!txMode) logger.warn('MongoDB sem replica set: movimentações usam mutex em memória (seguro só com 1 processo). Use replica set em produção.');
  return txMode;
}
/** Só para testes: força o modo (true/false) ou volta ao automático (null). */
function _setTransactionMode(v) { txMode = v; }

const tails = new Map();
async function withLocalLocks(keys, fn) {
  const held = [];
  try {
    for (const k of [...new Set(keys)].sort()) {
      const prev = tails.get(k) || Promise.resolve();
      let release;
      const mine = new Promise((r) => { release = r; });
      const tail = prev.then(() => mine);
      tails.set(k, tail);
      await prev;
      held.push({ k, release, tail });
    }
    return await fn(null);
  } finally {
    for (const h of held) { h.release(); if (tails.get(h.k) === h.tail) tails.delete(h.k); }
  }
}

async function ensureLocks(keys) {
  await Promise.all(keys.map((k) => BalanceLock.updateOne({ _id: k }, { $setOnInsert: { v: 0 } }, { upsert: true }).catch((e) => { if (e.code !== 11000) throw e; })));
}

async function execute(keys, fn) {
  const uniq = [...new Set(keys)].sort();
  if (!(await supportsTransactions())) return withLocalLocks(uniq, fn);
  await ensureLocks(uniq);
  const session = await mongoose.startSession();
  try {
    let out;
    await session.withTransaction(async () => {
      for (const k of uniq) await BalanceLock.updateOne({ _id: k }, { $inc: { v: 1 } }, { session });
      out = await fn(session);
    });
    return out;
  } finally {
    await session.endSession();
  }
}

// ─── referências ─────────────────────────────────────────────────────────────
async function loadRefs(items) {
  const chipIds = [...new Set(items.map((i) => String(i.chip_id)))];
  const locs = items.flatMap((i) => [i.from, i.to]).filter((l) => l.id);
  // divergência (`lost`) é de um fichário OU de um torneio (perda em jogo): procura nos dois
  const lostIds = locs.filter((l) => l.kind === 'lost').map((l) => String(l.id));
  const binderIds = [...new Set([...locs.filter((l) => !['play', 'lost'].includes(l.kind)).map((l) => String(l.id)), ...lostIds])];
  const tournamentIds = [...new Set([...locs.filter((l) => l.kind === 'play').map((l) => String(l.id)), ...lostIds])];
  const [chips, binders, tournaments] = await Promise.all([
    Chip.find({ _id: { $in: chipIds } }),
    Binder.find({ _id: { $in: binderIds } }).setOptions({ withDeleted: true }),
    Tournament.find({ _id: { $in: tournamentIds } }).setOptions({ withDeleted: true }).select('name status'),
  ]);
  const chipById = new Map(chips.map((c) => [String(c._id), c]));
  const binderById = new Map(binders.map((b) => [String(b._id), b]));
  const tournamentById = new Map(tournaments.map((t) => [String(t._id), t]));
  for (const i of items) {
    const chip = chipById.get(String(i.chip_id));
    if (!chip) throw new HttpError(400, 'Ficha não encontrada.');
    if (['ASSEMBLY', 'ADJUSTMENT'].includes(i.type) && chip.active === false && i.to.kind === 'binder') {
      throw new HttpError(400, `A ${chip.name} está inativa e não pode receber novas fichas.`);
    }
    for (const l of [i.from, i.to]) {
      if (!l.id) continue;
      if (l.kind === 'play') {
        if (!tournamentById.get(String(l.id))) throw new HttpError(404, 'Torneio não encontrado.');
        continue;
      }
      if (l.kind === 'lost' && tournamentById.get(String(l.id)) && !binderById.get(String(l.id))) continue;
      const b = binderById.get(String(l.id));
      if (!b) throw new HttpError(404, 'Fichário não encontrado.');
      if (b.deleted_at && i.type !== 'REVERSAL') throw new HttpError(400, `O fichário "${b.name}" foi excluído.`);
    }
  }
  return { chipById, binderById, tournamentById };
}

// ─── alocações (G5/G6): reservas por torneio que retiradas e envios precisam respeitar ──────────
// Tipos que TIRAM fichas do fichário por decisão de gestão. LOSS fica de fora de propósito: perda
// física é realidade (conferência) e não pode ser barrada — vira falta (shortfall) na alocação.
const ALLOCATION_GUARDED = new Set(['WITHDRAWAL', 'ADJUSTMENT', 'REVERSAL']);

/**
 * Líquido ENVIADO de fichários a torneios, derivado dos movimentos: Σ fichário→em jogo − Σ em jogo→fichário
 * (por fichário × torneio × ficha). Chave: "<fichário>:<torneio>:<ficha>".
 */
async function sentNetMap({ binderIds, chipId, session } = {}) {
  const match = { $or: [{ 'to.kind': 'play' }, { 'from.kind': 'play' }], binder_id: { $ne: null } };
  if (binderIds) match.binder_id = { $in: binderIds.map(oid) };
  if (chipId) match.chip_id = oid(chipId);
  const rows = await Movement.aggregate([
    { $match: match },
    { $group: {
      _id: { b: '$binder_id', t: { $cond: [{ $eq: ['$to.kind', 'play'] }, '$to.id', '$from.id'] }, c: '$chip_id' },
      q: { $sum: { $cond: [{ $eq: ['$to.kind', 'play'] }, '$quantity', { $multiply: ['$quantity', -1] }] } },
    } },
  ]).session(session || null);
  return new Map(rows.map((r) => [`${r._id.b}:${r._id.t}:${r._id.c}`, r.q]));
}

/**
 * Alocações abertas de um fichário com o estado por ficha: alocado (teto), enviado e RESTANTE (= reserva
 * que ainda está dentro do fichário). `deltaSent` (Map "<torneio>:<ficha>" → q) simula um lote em andamento.
 */
async function allocationStates(binderId, { session, excludeAllocationId, chipId, deltaSent } = {}) {
  const filter = { binder_id: oid(binderId), open: true, ...(excludeAllocationId ? { _id: { $ne: oid(excludeAllocationId) } } : {}) };
  const allocs = await Allocation.find(filter).sort({ createdAt: 1 }).session(session || null).lean();
  if (!allocs.length) return [];
  const net = await sentNetMap({ binderIds: [binderId], chipId, session });
  return allocs.map((a) => ({
    allocation_id: a._id, tournament_id: a.tournament_id, status: a.status,
    chips: a.chips.filter((c) => !chipId || String(c.chip_id) === String(chipId)).map((c) => {
      const k = `${a.tournament_id}:${c.chip_id}`;
      const sent = Math.max(0, (net.get(`${binderId}:${k}`) || 0) + (deltaSent?.get(k) || 0));
      return { chip_id: c.chip_id, allocated: c.quantity, sent, remaining: Math.max(0, c.quantity - sent) };
    }),
  }));
}

/** Quanto de uma ficha está RESERVADO (ainda dentro do fichário) por alocações abertas, e por quem. */
async function allocatedIn(binderId, chipId, opts = {}) {
  const states = await allocationStates(binderId, { ...opts, chipId });
  const by = states.map((st) => ({ tournament_id: st.tournament_id, quantity: st.chips[0]?.remaining || 0, allocated: st.chips[0]?.allocated || 0, sent: st.chips[0]?.sent || 0 }))
    .filter((x) => x.allocated > 0);
  return { total: by.reduce((a, r) => a + r.quantity, 0), by: by.filter((x) => x.quantity > 0) };
}

async function tournamentNames(ids) {
  const docs = ids.length ? await Tournament.find({ _id: { $in: ids } }).setOptions({ withDeleted: true }).select('name') : [];
  return new Map(docs.map((t) => [String(t._id), t.name]));
}

// ─── notificação em tempo real (G10) ─────────────────────────────────────────
// Cada lote gravado avisa quem escuta (server.js liga isto ao socket): o dashboard refaz só o bloco afetado.
let notifier = null;
/** Registra o ouvinte de lotes gravados (`null` desliga). Falha do ouvinte NUNCA desfaz nem atrapalha o lançamento. */
function setNotifier(fn) { notifier = typeof fn === 'function' ? fn : null; }
function notify(payload) {
  if (!notifier) return;
  try { notifier(payload); } catch (e) { logger.error({ err: e }, 'falha ao notificar movimentação'); }
}

// ─── lançamento ──────────────────────────────────────────────────────────────
/**
 * Grava movimentos em lote (tudo ou nada). Nunca deixa o saldo de uma origem ficar negativo.
 * @param {Array<{type, chip_id, quantity, from:{kind,id}, to:{kind,id}, reason?, reverses?, meta?}>} specs
 * @param {{ user?: object, batch_id?: ObjectId }} opts
 * @returns {Promise<Array>} movimentos criados
 */
async function postBatch(specs, { user, batch_id } = {}) {
  if (!Array.isArray(specs) || !specs.length) throw new HttpError(400, 'Nenhuma movimentação informada.');
  const items = specs.map(normalize);
  const { chipById, binderById, tournamentById } = await loadRefs(items);

  // débitos agregados por (origem, ficha)
  const debits = new Map();
  for (const i of items) {
    if (!isDebitable(i.from)) continue;
    const k = locKey(i.from, i.chip_id);
    const cur = debits.get(k) || { loc: i.from, chip_id: i.chip_id, requested: 0, reversal: i.type === 'REVERSAL', guarded: false, toPlay: new Map(), capped: new Map() };
    cur.requested += i.quantity;
    if (i.from.kind === 'binder' && ALLOCATION_GUARDED.has(i.type)) cur.guarded = true;
    if (i.from.kind === 'binder' && i.to.kind === 'play') {
      const tk = `${i.to.id}:${i.chip_id}`;
      cur.toPlay.set(tk, (cur.toPlay.get(tk) || 0) + i.quantity);             // enviado líquido deste lote
      if (CAPPED.has(i.type)) cur.capped.set(tk, (cur.capped.get(tk) || 0) + i.quantity); // e o que consome a alocação
    }
    debits.set(k, cur);
  }

  const batch = batch_id || new mongoose.Types.ObjectId();
  let docs;
  try {
    docs = await execute([...debits.keys()], async (session) => {
      const short = [];
      for (const d of debits.values()) {
        const available = await balanceAt(d.loc, d.chip_id, session);
        if (available < d.requested) short.push({ ...d, available });
      }
      if (short.length) {
        const s = short[0];
        const chip = chipById.get(String(s.chip_id));
        const binder = binderById.get(String(s.loc.id));
        const where = s.loc.kind === 'lost' ? `divergências de "${binder?.name || tournamentById.get(String(s.loc.id))?.name}"`
          : s.loc.kind === 'play' ? `jogo no torneio "${tournamentById.get(String(s.loc.id))?.name}"` : `fichário "${binder?.name}"`;
        const msg = s.reversal
          ? `Não é possível estornar: o saldo atual de ${chip?.name} em ${where} é ${s.available}, mas o estorno precisa de ${s.requested} — as fichas já foram movimentadas depois deste lançamento.`
          : `Saldo insuficiente: ${chip?.name} em ${where} tem ${s.available}, mas o lançamento pede ${s.requested}.`;
        throw new HttpError(409, msg, short.map((x) => ({
          chip_id: x.chip_id, location: { kind: x.loc.kind, id: x.loc.id }, available: x.available, requested: x.requested,
        })));
      }
      for (const d of debits.values()) {
        if (d.loc.kind !== 'binder' || (!d.guarded && !d.capped.size)) continue;
        const available = await balanceAt(d.loc, d.chip_id, session);
        const chip = chipById.get(String(d.chip_id));
        const binder = binderById.get(String(d.loc.id));

        // envio/entrada de conversão: só até o que o torneio ainda tem RESERVADO neste fichário (alocado − enviado)
        for (const [tk, requested] of d.capped) {
          const [tid] = tk.split(':');
          const st = (await allocationStates(d.loc.id, { session, chipId: d.chip_id })).find((x) => String(x.tournament_id) === tid);
          const remaining = st?.chips[0]?.remaining || 0;
          if (requested > remaining) {
            const t = tournamentById.get(tid);
            throw new HttpError(409,
              `${chip?.name} em "${binder?.name}": o torneio "${t?.name}" tem ${remaining} reservada(s) (alocado ${st?.chips[0]?.allocated || 0}, já enviado ${st?.chips[0]?.sent || 0}), mas o lançamento pede ${requested}. `
              + (st ? 'Aumente a alocação.' : 'Aloque o fichário ao torneio antes.'),
              [{ chip_id: d.chip_id, binder_id: d.loc.id, tournament_id: tid, allocated: st?.chips[0]?.allocated || 0, sent: st?.chips[0]?.sent || 0, remaining, requested }]);
          }
        }

        // o saldo que sobra não pode ficar abaixo do que está RESERVADO a torneios — spec §18.2. O que este lote envia a um
        // torneio já sai da reserva dele (deltaSent), por isso enviar o alocado nunca é barrado por ela.
        if (d.guarded) {
          const held = await allocatedIn(d.loc.id, d.chip_id, { session, deltaSent: d.toPlay });
          if (held.total > 0 && available - d.requested < held.total) {
            const names = await tournamentNames(held.by.map((h) => h.tournament_id));
            throw new HttpError(409,
              `${chip?.name} em "${binder?.name}": ${held.total} estão alocadas (${held.by.map((h) => `${names.get(String(h.tournament_id)) || 'torneio'}: ${h.quantity}`).join(', ')}); `
              + `só ${Math.max(0, available - held.total)} podem sair. Libere ou reduza a alocação antes.`,
              [{ chip_id: d.chip_id, binder_id: d.loc.id, balance: available, requested: d.requested, allocated: held.total, free: Math.max(0, available - held.total) }]);
          }
        }
      }
      return Movement.insertMany(items.map((i) => ({
        ...i, batch_id: batch, user_id: user?.id || user?._id || null, user_name: user?.name || user?.email || 'Sistema',
      })), { session: session || undefined });
    });
  } catch (err) {
    if (err?.code === 11000 && /movement_reversed_once|reverses/.test(String(err.message))) {
      throw new HttpError(409, 'Este movimento já foi estornado.');
    }
    throw err;
  }

  notify({
    batch_id: batch,
    types: [...new Set(items.map((i) => i.type))],
    chip_ids: [...new Set(items.map((i) => String(i.chip_id)))],
    binder_ids: [...new Set(items.flatMap((i) => [i.from, i.to]).filter((l) => l.id && ['binder', 'lost'].includes(l.kind)).map((l) => String(l.id)))],
    tournament_ids: [...new Set(items.map((i) => i.tournament_id).filter(Boolean).map(String))],
  });
  return docs;
}

/**
 * Estorna movimentos: grava o inverso de cada um, vinculado ao original (`reverses`). O original
 * permanece intacto. Não estorna estorno (lance um novo movimento) nem estorna duas vezes.
 */
async function reverseMovements(ids, { reason, user } = {}) {
  if (!String(reason || '').trim()) throw new HttpError(400, 'Informe o motivo do estorno.');
  const originals = await Movement.find({ _id: { $in: ids } });
  if (originals.length !== new Set(ids.map(String)).size) throw new HttpError(404, 'Movimentação não encontrada.');
  if (originals.some((o) => o.type === 'REVERSAL')) {
    throw new HttpError(400, 'Um estorno não pode ser estornado — registre um novo lançamento.');
  }
  if (await Movement.exists({ reverses: { $in: originals.map((o) => o._id) } })) {
    throw new HttpError(409, 'Este movimento já foi estornado.');
  }
  return postBatch(originals.map((o) => ({
    type: 'REVERSAL', chip_id: o.chip_id, quantity: o.quantity,
    from: { kind: o.to.kind, id: o.to.id }, to: { kind: o.from.kind, id: o.from.id },
    reverses: o._id, reason, tournament_id: o.tournament_id, session_id: o.session_id,
    meta: { original_type: o.type, original_batch: o.batch_id },
  })), { user });
}

// ─── reservas derivadas ──────────────────────────────────────────────────────
/**
 * Fichas RESERVADAS por ficha = Σ (alocado − enviado) das alocações abertas: o que ainda está dentro dos fichários
 * separado para algum torneio. (Enviar consome a reserva: o "livre" não muda ao enviar.)
 */
async function reservedByChip(chipIds) {
  const ids = chipIds ? chipIds.map(oid) : null;
  const allocs = await Allocation.find({ open: true, ...(ids ? { 'chips.chip_id': { $in: ids } } : {}) }).lean();
  if (!allocs.length) return new Map();
  const net = await sentNetMap({ binderIds: [...new Set(allocs.map((a) => String(a.binder_id)))] });
  const out = new Map();
  for (const a of allocs) {
    for (const c of a.chips) {
      if (ids && !ids.some((x) => String(x) === String(c.chip_id))) continue;
      const sent = Math.max(0, net.get(`${a.binder_id}:${a.tournament_id}:${c.chip_id}`) || 0);
      out.set(String(c.chip_id), (out.get(String(c.chip_id)) || 0) + Math.max(0, c.quantity - sent));
    }
  }
  return out;
}

/** Fichas EM JOGO num torneio (Σ recebido − Σ devolvido), por ficha; `session_id` filtra pela sessão do movimento. */
async function playBalances({ tournament_id, session_id, chip_id } = {}) {
  const base = { ...(chip_id ? { chip_id: oid(chip_id) } : {}), ...(session_id ? { session_id: oid(session_id) } : {}) };
  const agg = (side) => Movement.aggregate([
    { $match: { ...base, [`${side}.kind`]: 'play', ...(tournament_id ? { [`${side}.id`]: oid(tournament_id) } : {}) } },
    { $group: { _id: { t: `$${side}.id`, c: '$chip_id' }, q: { $sum: '$quantity' } } },
  ]);
  const [ins, outs] = await Promise.all([agg('to'), agg('from')]);
  const map = new Map();
  const add = (rows, sign) => rows.forEach((r) => {
    const k = `${r._id.t}:${r._id.c}`;
    const cur = map.get(k) || { tournament_id: r._id.t, chip_id: r._id.c, quantity: 0 };
    cur.quantity += sign * r.q;
    map.set(k, cur);
  });
  add(ins, 1); add(outs, -1);
  return [...map.values()].filter((r) => r.quantity !== 0);
}

/** Texto legível de um lote: "100 × Ficha 100 · 4 × Ficha 500 (valor 12.000)" — para o log dizer O QUE aconteceu. */
async function describeBatch(docs) {
  const { Chip } = require('../models');
  const chips = new Map((await Chip.find({ _id: { $in: docs.map((d) => d.chip_id) } }).setOptions({ withDeleted: true }).select('value').lean()).map((c) => [String(c._id), c.value]));
  const by = new Map();
  for (const d of docs) by.set(String(d.chip_id), (by.get(String(d.chip_id)) || 0) + d.quantity);
  const lines = [...by].map(([id, q]) => ({ value: chips.get(id) || 0, q })).sort((a, b) => a.value - b.value);
  const total = lines.reduce((sum, l) => sum + l.value * l.q, 0);
  return `${lines.map((l) => `${l.q} × ficha ${l.value}`).join(' · ')} (valor nominal ${total})`;
}

module.exports = {
  describeBatch,
  postBatch, reverseMovements, balances, balanceAt, chipTotal, reservedByChip,
  allocatedIn, allocationStates, sentNetMap, playBalances, execute, locKey, supportsTransactions, _setTransactionMode, setNotifier,
};
