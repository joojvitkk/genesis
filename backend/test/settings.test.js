const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clearDb, disconnect } = require('./helpers');
const { getSetting, setSetting, resetSetting, DEFAULTS } = require('../lib/settings');
const { Setting } = require('../models');

before(connect);
after(disconnect);
beforeEach(clearDb);

test('getSetting devolve o default (semáforo da spec §11) quando nada foi salvo', async () => {
  const sev = await getSetting('severity');
  assert.deepEqual(sev, DEFAULTS.severity);
  assert.deepEqual(sev.bands.map((b) => b.level), ['GREEN', 'YELLOW', 'RED']);
  assert.equal(sev.require_justification_from, 'RED');
  assert.equal(await Setting.countDocuments(), 0, 'ler não deve gravar');
});

test('o default devolvido é uma cópia: mutar não vaza para o próximo leitor', async () => {
  const a = await getSetting('severity');
  a.bands[0].level = 'RED';
  const b = await getSetting('severity');
  assert.equal(b.bands[0].level, 'GREEN');
  assert.equal(DEFAULTS.severity.bands[0].level, 'GREEN');
});

test('setSetting persiste e é sobrescrito por upsert (1 documento por chave)', async () => {
  const custom = { ...DEFAULTS.severity, require_justification_from: 'YELLOW' };
  await setSetting('severity', custom, { name: 'Admin' });
  await setSetting('severity', { ...custom, require_justification_from: 'GREEN' }, { name: 'Admin' });

  assert.equal(await Setting.countDocuments({ key: 'severity' }), 1);
  const got = await getSetting('severity');
  assert.equal(got.require_justification_from, 'GREEN');
  const doc = await Setting.findOne({ key: 'severity' });
  assert.equal(doc.updated_by, 'Admin');
});

test('resetSetting volta ao default', async () => {
  await setSetting('severity', { bands: [] }, { name: 'Admin' });
  const back = await resetSetting('severity');
  assert.deepEqual(back, DEFAULTS.severity);
  assert.deepEqual(await getSetting('severity'), DEFAULTS.severity);
});

test('chave desconhecida é rejeitada (leitura, escrita e reset)', async () => {
  for (const fn of [() => getSetting('nao_existe'), () => setSetting('nao_existe', 1), () => resetSetting('nao_existe')]) {
    await assert.rejects(fn, (e) => e.status === 400 && /desconhecida/.test(e.message));
  }
  assert.equal(await Setting.countDocuments(), 0);
});
