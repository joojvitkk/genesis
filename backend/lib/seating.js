// Lógica pura de mesas/seating (P4). Sem I/O.

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Monta a visão de mesas a partir dos documentos de Seat.
 * @returns [{ number, occupants: [{ seat_number, entry_id }], occupied: [seat], free: [seat] }]
 */
function buildTables(seatDocs, seatsPerTable) {
  const byTable = new Map();
  for (const s of seatDocs) {
    if (!byTable.has(s.table_number)) byTable.set(s.table_number, []);
    byTable.get(s.table_number).push({ seat_number: s.seat_number, entry_id: String(s.entry_id) });
  }
  const maxTable = Math.max(0, ...byTable.keys());
  const tables = [];
  for (let n = 1; n <= maxTable; n++) {
    const occupants = (byTable.get(n) || []).sort((a, b) => a.seat_number - b.seat_number);
    const occupied = occupants.map((p) => p.seat_number);
    const free = [];
    for (let s = 1; s <= seatsPerTable; s++) if (!occupied.includes(s)) free.push(s);
    tables.push({ number: n, occupants, occupied, free });
  }
  return tables;
}

function randomOf(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/** Escolhe mesa+lugar para um novo jogador (equilibra ao sentar). */
function pickSeatForNewEntry(tables, seatsPerTable) {
  const withRoom = tables.filter((t) => t.free.length > 0);
  if (withRoom.length === 0) {
    const nextTable = tables.length + 1;
    return { table_number: nextTable, seat_number: randomOf(Array.from({ length: seatsPerTable }, (_, i) => i + 1)) };
  }
  const minCount = Math.min(...withRoom.map((t) => t.occupants.length));
  const target = randomOf(withRoom.filter((t) => t.occupants.length === minCount));
  return { table_number: target.number, seat_number: randomOf(target.free) };
}

/** Sugere um movimento de balanceamento quando as mesas diferem em 2+. */
function suggestBalance(tables, seatsPerTable) {
  const active = tables.filter((t) => t.occupants.length > 0);
  if (active.length < 2) return null;
  const biggest = active.reduce((a, b) => (b.occupants.length > a.occupants.length ? b : a));
  const smallest = active.reduce((a, b) => (b.occupants.length < a.occupants.length ? b : a));
  if (biggest.occupants.length - smallest.occupants.length < 2) return null;
  if (smallest.free.length === 0) return null;
  return {
    from_table: biggest.number,
    to_table: smallest.number,
    to_seat: randomOf(smallest.free),
    entry_id: randomOf(biggest.occupants).entry_id,
  };
}

/**
 * Sugere quebrar a MENOR mesa, quando o total de jogadores cabe em uma mesa a menos.
 * Retorna no máximo uma entrada.
 */
function breakableTables(tables, seatsPerTable) {
  const active = tables.filter((t) => t.occupants.length > 0);
  if (active.length < 2) return [];
  const total = active.reduce((s, t) => s + t.occupants.length, 0);
  if (total > (active.length - 1) * seatsPerTable) return [];
  const smallest = active.reduce((a, b) => (b.occupants.length < a.occupants.length ? b : a));
  return [{ table_number: smallest.number, count: smallest.occupants.length }];
}

/** Redistribui todos os jogadores ativos em N mesas (ou N automático). */
function redraw(entryIds, tablesCount, seatsPerTable) {
  const ids = shuffle(entryIds);
  const n = tablesCount && tablesCount > 0 ? tablesCount : Math.max(1, Math.ceil(ids.length / seatsPerTable));
  const perTable = Array.from({ length: n }, () => []);
  ids.forEach((id, i) => perTable[i % n].push(id));
  const assignments = [];
  perTable.forEach((occupants, ti) => {
    shuffle(Array.from({ length: seatsPerTable }, (_, i) => i + 1))
      .slice(0, occupants.length)
      .sort((a, b) => a - b)
      .forEach((seat, idx) => assignments.push({ entry_id: occupants[idx], table_number: ti + 1, seat_number: seat }));
  });
  return assignments;
}

module.exports = { buildTables, pickSeatForNewEntry, suggestBalance, breakableTables, redraw, shuffle };
