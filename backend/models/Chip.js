const mongoose = require('mongoose');
const softDelete = require('../lib/softDelete');

// Ficha = cadastro MESTRE de uma denominação física (spec §3.1). Só atributos estáveis:
// valor NOMINAL, cor e ativa. Não tem tipo, nome de modelo, quantidade nem valor monetário —
// a quantidade pertence ao modelo/fichário (João) e a ficha jamais carrega dinheiro.

// #abc → #aabbcc, tudo minúsculo; devolve null se não for uma cor hexadecimal válida.
function normalizeColor(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  let c = String(raw).trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(c)) c = `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  return /^#[0-9a-f]{6}$/.test(c) ? c : null;
}

// Rótulo DERIVADO (o cadastro não tem nome): as telas que exibem `chip.name` continuam funcionando.
function chipLabel({ value }) {
  return `Ficha ${value}`;
}

const ChipSchema = new mongoose.Schema({
  value: { type: Number, required: true, min: 0 },           // valor nominal
  color: { type: String, set: (v) => normalizeColor(v) ?? v }, // hexadecimal (normalizado)
  active: { type: Boolean, default: true },                    // descontinuar sem apagar histórico
  name: { type: String },                                      // derivado — nunca vem do cliente
}, { timestamps: true });

ChipSchema.pre('validate', function () {
  if (this.color && !normalizeColor(this.color)) {
    this.invalidate('color', 'Cor inválida — use hexadecimal (ex.: #ff0000).');
  }
  if (this.value !== undefined && this.value !== null) this.name = chipLabel(this);
});

ChipSchema.plugin(softDelete);

// Uma denominação = uma ficha: (valor, cor) é único entre as fichas ATIVAS.
// O filtro parcial (`active: true`) deixa fichas legadas (sem o campo) e descontinuadas de fora,
// então o índice não quebra em bancos com duplicatas antigas. (Índice novo: o antigo incluía o tipo, hoje inexistente.)
ChipSchema.index(
  { value: 1, color: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: 'chip_value_color_active' },
);

// Mantém a coleção `chipmodels` (sem migração de coleção); o model passa a se chamar `Chip`
// para não confundir "ficha" com "modelo de fichário".
module.exports = mongoose.model('Chip', ChipSchema, 'chipmodels');
module.exports.normalizeColor = normalizeColor;
module.exports.chipLabel = chipLabel;
