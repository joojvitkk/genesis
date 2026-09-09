const mongoose = require('mongoose');
const softDelete = require('../lib/softDelete');

// Distribuição do prize pool em %, com faixas por nº de inscritos.
// Ex.: { min_players: 10, max_players: 18, payouts: [{place:1,pct:50},{place:2,pct:30},{place:3,pct:20}] }
const PayoutTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  brackets: [{
    min_players: { type: Number, required: true },
    max_players: { type: Number, default: null }, // null = sem teto
    payouts: [{
      place: { type: Number, required: true },
      pct: { type: Number, required: true },
    }],
  }],
  notes: { type: String },
}, { timestamps: true });

PayoutTemplateSchema.plugin(softDelete);

module.exports = mongoose.model('PayoutTemplate', PayoutTemplateSchema);
