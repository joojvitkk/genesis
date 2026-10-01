const mongoose = require('mongoose');

// NÃO é saldo. É só um ponto de conflito de escrita por (localização, ficha): toda movimentação que
// DEBITA uma localização incrementa `v` do seu lock dentro da transação. Duas retiradas simultâneas
// da mesma ficha/fichário passam a conflitar (uma é retentada e enxerga o saldo já debitado);
// sem isto, dois inserts em documentos diferentes passariam ambos pela validação (write skew).
const BalanceLockSchema = new mongoose.Schema({
  _id: { type: String },      // "<kind>:<location id>:<chip id>"
  v: { type: Number, default: 0 },
}, { versionKey: false });

module.exports = mongoose.model('BalanceLock', BalanceLockSchema);
