// P3 — semeia o InventoryLedger a partir do estado atual das fichas.
// Preserva os números atuais: saldo_inicial = total_quantity; se available < total,
// lança a diferença como 'alocacao' (reserva) para não perder o estado.

module.exports = {
  async up(db) {
    const chips = await db.collection('chipmodels').find({}).toArray();
    const ledger = db.collection('inventoryledgers');
    const now = new Date();

    for (const chip of chips) {
      const already = await ledger.countDocuments({ chip_id: chip._id });
      if (already > 0) continue;

      const total = Math.max(0, chip.total_quantity || 0);
      const available = Math.max(0, chip.available_quantity ?? total);
      const reserved = Math.max(0, total - available);

      const rows = [{
        chip_id: chip._id, type: 'saldo_inicial', quantity: total,
        ref: { kind: 'manual', id: null, label: 'Migração — saldo inicial' },
        note: 'Saldo importado da versão anterior', user_name: 'Migração',
        balance_after: total, createdAt: now, updatedAt: now,
      }];
      if (reserved > 0) {
        rows.push({
          chip_id: chip._id, type: 'alocacao', quantity: reserved,
          ref: { kind: 'manual', id: null, label: 'Migração — reserva pendente' },
          note: 'Diferença total/disponível importada', user_name: 'Migração',
          balance_after: total, createdAt: now, updatedAt: now,
        });
      }
      await ledger.insertMany(rows);
      await db.collection('chipmodels').updateOne(
        { _id: chip._id },
        { $set: { total_quantity: total, reserved_quantity: reserved, available_quantity: available } }
      );
    }
  },

  async down(db) {
    await db.collection('inventoryledgers').deleteMany({});
  },
};
