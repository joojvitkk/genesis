const { Setting } = require('../models');

// Defaults por chave. Só chaves listadas aqui podem ser lidas/gravadas.
const DEFAULTS = {
  // Semáforo de criticidade das divergências (spec §11). Consumido por lib/severity.js (G8).
  // `bands` é avaliada em ordem pelo valor nominal da ficha: a 1ª com `up_to >= valor` vence
  // (`up_to: null` = sem teto).
  severity: {
    bands: [
      { up_to: 500, level: 'GREEN' },     // 100 e 500: perdas unitárias toleráveis (mas registradas)
      { up_to: 1000, level: 'YELLOW' },   // 1.000: exige atenção
      { up_to: null, level: 'RED' },      // 5.000 ou superior: alta criticidade
    ],
    // Sobe a severidade quando a QUANTIDADE perdida passa do limite (null = sem escalonamento).
    // Valores a definir com o autor da spec (D6).
    escalate: { yellow_at_quantity: null, red_at_quantity: null },
    // A partir de que nível a justificativa é obrigatória.
    require_justification_from: 'RED',
  },
};

const clone = (v) => JSON.parse(JSON.stringify(v));

function assertKnown(key) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
    const err = new Error(`Configuração desconhecida: ${key}`);
    err.status = 400;
    throw err;
  }
}

/** Valor salvo da configuração, ou o default quando ainda não foi personalizada. */
async function getSetting(key) {
  assertKnown(key);
  const doc = await Setting.findOne({ key }).lean();
  return doc ? doc.value : clone(DEFAULTS[key]);
}

/** Grava (upsert) uma configuração. `user` é o req.user (para auditoria). */
async function setSetting(key, value, user) {
  assertKnown(key);
  await Setting.findOneAndUpdate(
    { key },
    { key, value, updated_by: user?.name || user?.email || 'Sistema' },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return value;
}

/** Volta a configuração para o default (apaga a personalização). */
async function resetSetting(key) {
  assertKnown(key);
  await Setting.deleteOne({ key });
  return clone(DEFAULTS[key]);
}

module.exports = { getSetting, setSetting, resetSetting, DEFAULTS };
