const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const {
  verifyToken,
  requirePageAccess,
  adminOnly,
  requireRole,
  hasLevel,
  requireTournamentAccess,
  allowedTournaments,
  loginRateLimiter,
  registerFailedLogin,
  clearLoginAttempts,
  bumpSessionVersion,
  JWT_SECRET,
} = require('../middlewares/authMiddleware');
const logActivity = require('../services/activityLogger');
const { diffFields } = require('../services/activityLogger');
const { escapeRegex, toInt, pick } = require('../utils/sanitize');
const { paginate } = require('../lib/pagination');
const { applyAction, clockPayload } = require('../lib/tournamentClock');
const { entryContribution, summarize, payoutTable, validateTemplate } = require('../lib/tournamentFinance');
const { postBatch, reverseMovements, balances, chipTotal } = require('../lib/movements');
const {
  HttpError, sendError, chipInUse, findChipTwin, normalizeComposition, rejectedChipFields,
  assertUniqueBinderModelName, assertUniqueBinder,
} = require('../lib/catalog');
const seating = require('../lib/seating');
const stackCalc = require('../lib/stackCalc');
const tournamentChips = require('../lib/tournamentChips');
const sessionsLib = require('../lib/sessions');
const allocationLib = require('../lib/allocation');
const material = require('../lib/material');
const occurrences = require('../lib/occurrences');
const dashboardLib = require('../lib/dashboard');
const binderView = require('../lib/binderView');
const historyLib = require('../lib/history');
const logger = require('../lib/logger');
const severityLib = require('../lib/severity');
const settingsLib = require('../lib/settings');
const { computeStartsAt } = require('../lib/datetime');
const { normalizeColor } = require('../models/Chip');
const {
  User, Chip, BinderModel, Tournament, Binder, ActivityLog, StackModel, TournamentEntry, ChatMessage,
  PayoutTemplate, Elimination, Seat, BlindStructureTemplate, Movement, Event, TournamentSession, Allocation, Conversion, Occurrence,
} = require('../models');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const MIN_PASSWORD_LENGTH = 6;

function signToken(user) {
  return jwt.sign(
    { id: user._id, name: user.name, email: user.email, role: user.role, sv: user.session_version || 1 },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function randomPassword(len = 10) {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(len)).map((b) => chars[b % chars.length]).join('');
}

// ─── Auth ────────────────────────────────────────────────────────────────────
router.post('/login', loginRateLimiter, async (req, res) => {
  try {
    const { password } = req.body || {};
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !password) return res.status(400).json({ error: 'Informe e-mail e senha.' });

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      registerFailedLogin(req);
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      registerFailedLogin(req);
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    clearLoginAttempts(req);

    res.json({
      message: 'Login realizado',
      token: signToken(user),
      user: {
        name: user.name, email: user.email, role: user.role,
        must_change_password: !!user.must_change_password,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Revalidação de sessão pelo frontend
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.json({
      id: user._id, name: user.name, email: user.email, role: user.role,
      must_change_password: !!user.must_change_password,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Troca de senha do próprio usuário (também usada no fluxo "senha temporária")
router.post('/me/password', verifyToken, async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!new_password || String(new_password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `A nova senha deve ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.` });
    }
    const user = await User.findById(req.user.id).select('+password');
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (!(await bcrypt.compare(current_password || '', user.password))) {
      return res.status(401).json({ error: 'Senha atual incorreta.' });
    }
    user.password = new_password;
    user.must_change_password = false;
    user.session_version = (user.session_version || 1) + 1; // derruba as outras sessões
    await user.save();
    bumpSessionVersion(user._id);
    await logActivity('Senha Alterada', 'system', user.email, req.user);
    res.json({ message: 'Senha alterada', token: signToken(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Encerra todas as sessões do próprio usuário
router.post('/me/logout-all', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    user.session_version = (user.session_version || 1) + 1;
    await user.save();
    bumpSessionVersion(user._id);
    await logActivity('Sessões Encerradas', 'system', user.email, req.user);
    res.json({ message: 'Todas as sessões foram encerradas.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** `allowed_tournament_ids`: undefined = não mexer; lista de ids de torneios existentes (vazia = sem restrição). */
async function normalizeScope(raw) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new HttpError(400, 'allowed_tournament_ids deve ser uma lista.');
  const ids = [...new Set(raw.map(String))];
  if (ids.some((id) => !mongoose.isValidObjectId(id))) throw new HttpError(400, 'Torneio inválido na lista de acesso.');
  if (ids.length && (await Tournament.countDocuments({ _id: { $in: ids } })) !== ids.length) throw new HttpError(400, 'Torneio não encontrado na lista de acesso.');
  return ids;
}

// ─── Usuários (Apenas Admin) ─────────────────────────────────────────────────
router.get('/users', verifyToken, requirePageAccess('usuarios'), async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', verifyToken, requirePageAccess('usuarios', 'manage'), async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};
    const scope = await normalizeScope(req.body?.allowed_tournament_ids);
    if (!name || !email || !password) return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios.' });
    if (String(password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `A senha deve ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.` });
    }
    if (!['admin', 'material', 'salao'].includes(role)) {
      return res.status(400).json({ error: 'Papel inválido.' });
    }

    // usuário criado por um admin já entra tendo que trocar a senha
    const user = new User({ name, email, password, role, allowed_tournament_ids: scope || [], created_by: req.user?.name || 'Admin', must_change_password: true });
    await user.save();
    await logActivity('Usuário Criado', 'system', `Nome: ${name} | Email: ${email} | Role: ${role}`, req.user);
    res.status(201).json({ message: 'Usuário criado com sucesso' });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Já existe um usuário com este e-mail.' });
    res.status(400).json({ error: err.message });
  }
});

router.put('/users/:id', verifyToken, requirePageAccess('usuarios', 'manage'), async (req, res) => {
  try {
    const { name, email, role, password } = req.body || {};
    const scope = await normalizeScope(req.body?.allowed_tournament_ids);
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

    // Impede remover o papel do último admin
    if (target.role === 'admin' && role && role !== 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) return res.status(400).json({ error: 'Não é possível rebaixar o único administrador.' });
    }

    const before = { name: target.name, email: target.email, role: target.role };
    if (name) target.name = name;
    if (email) target.email = email;
    if (role && ['admin', 'material', 'salao'].includes(role)) target.role = role;
    if (password) {
      if (String(password).length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: `A senha deve ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.` });
      }
      target.password = password; // hasheada pelo hook pre('save')
      target.session_version = (target.session_version || 1) + 1;
      bumpSessionVersion(target._id);
    }
    if (scope !== undefined) { target.allowed_tournament_ids = scope; bumpSessionVersion(target._id); } // o escopo vale já (limpa o cache)
    await target.save();

    const changes = diffFields(before, { name: target.name, email: target.email, role: target.role }, ['name', 'email', 'role']);
    await logActivity('Usuário Atualizado', 'system', `Email: ${target.email}`, req.user, changes);
    res.json({ message: 'Usuário atualizado', user: { name: target.name, email: target.email, role: target.role } });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Já existe um usuário com este e-mail.' });
    res.status(400).json({ error: err.message });
  }
});

router.delete('/users/:id', verifyToken, requirePageAccess('usuarios', 'manage'), async (req, res) => {
  try {
    if (req.user?.id === req.params.id) {
      return res.status(400).json({ error: 'Você não pode excluir seu próprio usuário.' });
    }
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

    if (target.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) return res.status(400).json({ error: 'Não é possível excluir o único administrador.' });
    }

    await target.deleteOne();
    await logActivity('Usuário Removido', 'system', `ID: ${req.params.id} | Email: ${target.email}`, req.user);
    res.json({ message: 'Usuário removido' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Admin gera uma senha temporária (mostrada uma vez); usuário troca no próximo login
router.post('/users/:id/reset-password', verifyToken, requirePageAccess('usuarios', 'manage'), async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const temp = randomPassword(10);
    target.password = temp;
    target.must_change_password = true;
    target.session_version = (target.session_version || 1) + 1;
    await target.save();
    bumpSessionVersion(target._id);
    await logActivity('Senha Redefinida pelo Admin', 'system', target.email, req.user);
    res.json({ message: 'Senha temporária gerada', temporary_password: temp });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Admin encerra todas as sessões de um usuário
router.post('/users/:id/revoke-sessions', verifyToken, requirePageAccess('usuarios', 'manage'), async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    target.session_version = (target.session_version || 1) + 1;
    await target.save();
    bumpSessionVersion(target._id);
    await logActivity('Sessões Revogadas pelo Admin', 'system', target.email, req.user);
    res.json({ message: 'Sessões revogadas.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Dashboard (G10) ─────────────────────────────────────────────────────────
// Tudo derivado dos MOVIMENTOS (lib/dashboard.js) — nenhuma leitura dos caches legados de quantidade.
// `?blocks=inventory,in_play,...` refaz só os blocos pedidos (o painel atualiza por bloco em tempo real).
// Blocos: metrics, recent, inventory, in_play, flows, occurrences, ko, conflicts, timeline, binders.
router.get('/dashboard/stats', verifyToken, async (req, res) => {
  try {
    const asked = String(req.query.blocks || '').split(',').map((x) => x.trim()).filter(Boolean);
    const all = ['metrics', 'recent', ...Object.keys(dashboardLib.BLOCKS)];
    const unknown = asked.filter((b) => !all.includes(b));
    if (unknown.length) throw new HttpError(400, `Bloco(s) desconhecido(s): ${unknown.join(', ')}. Use: ${all.join(', ')}.`);
    const wanted = asked.length ? asked : all;
    const out = {};

    if (wanted.includes('metrics')) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const [activeTournamentsCount, chips, binders, chipRacesToday] = await Promise.all([
        Tournament.countDocuments({ status: 'running' }),
        dashboardLib.byChip(),
        dashboardLib.freeBinders(),
        Conversion.countDocuments({ createdAt: { $gte: startOfDay }, status: 'active', legacy: { $ne: true } }),
      ]);
      out.metrics = {
        activeTournamentsCount, totalChipsInStock: chips.totals.in_binders, stockValue: chips.totals.value_in_binders,
        chipsInPlay: chips.totals.in_play, valueInPlay: chips.totals.value_in_play, availableCases: binders.free, chipRacesToday,
      };
    }
    if (wanted.includes('recent')) {
      out.recentTournaments = await Tournament.find().sort({ createdAt: -1 }).limit(5).select('name status start_time date');
      out.recentActivities = await ActivityLog.find().sort({ createdAt: -1 }).limit(7);
    }
    Object.assign(out, await dashboardLib.stats(wanted.filter((b) => dashboardLib.BLOCKS[b])));
    res.json(out);
  } catch (err) {
    sendError(res, err);
  }
});

// Saldos por ficha (Estoque): em fichários, reservado, livre, em jogo, em divergência — derivados dos movimentos.
router.get('/inventory/by-chip', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    res.json(await dashboardLib.byChip());
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Fichas (Chip) ───────────────────────────────────────────────────────────
// Ficha = cadastro MESTRE de uma denominação (spec §3.1): valor NOMINAL, cor e ativa. NÃO tem nome de modelo,
// quantidade nem valor monetário — isso vive no modelo/fichário (João); a ficha jamais carrega dinheiro.
// Só o administrador cria/edita (spec §13). Fichas não são excluídas: são desativadas.
const CHIP_FIELDS = ['value', 'color', 'active'];
const CHIP_IDENTITY = ['value', 'color'];

const REJECTED_CHIP_MSG =
  'A ficha só possui valor nominal, cor e situação: não tem nome de modelo, quantidade nem valor monetário (nome e quantidades ficam no Modelo de Fichário).';

router.get('/chips', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    const filter = {};
    if (req.query.active === 'true') filter.active = { $ne: false };
    if (req.query.active === 'false') filter.active = false;
    await paginate(res, Chip, filter, { sort: { value: 1 }, query: req.query });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/chips', verifyToken, requirePageAccess('estoque'), adminOnly, async (req, res) => {
  try {
    if (rejectedChipFields(req.body).length) throw new HttpError(400, REJECTED_CHIP_MSG);
    const data = pick(req.body, CHIP_FIELDS);
    if (data.value === undefined || data.value === '' || !Number.isFinite(Number(data.value)) || Number(data.value) < 0) {
      throw new HttpError(400, 'Informe o valor nominal da ficha (número não negativo).');
    }
    data.value = Number(data.value);
    if (!normalizeColor(data.color)) throw new HttpError(400, 'Informe a cor da ficha em hexadecimal (ex.: #ff0000).');
    data.color = normalizeColor(data.color);

    const twin = await findChipTwin(data);
    if (twin) throw new HttpError(409, `Já existe uma ficha ativa com este valor e cor (${twin.name}). Reutilize o cadastro existente nos modelos de fichário.`);

    const chip = await new Chip(data).save();
    await logActivity('Ficha Criada', 'inventory', `${chip.name} | Cor: ${chip.color}`, req.user);
    res.status(201).json(chip);
  } catch (err) {
    sendError(res, err);
  }
});

router.put('/chips/:id', verifyToken, requirePageAccess('estoque'), adminOnly, async (req, res) => {
  try {
    if (rejectedChipFields(req.body).length) throw new HttpError(400, REJECTED_CHIP_MSG);
    const chip = await Chip.findById(req.params.id);
    if (!chip) throw new HttpError(404, 'Ficha não encontrada.');
    const data = pick(req.body, CHIP_FIELDS);
    if (data.value !== undefined) data.value = Number(data.value);
    if (data.color !== undefined) data.color = normalizeColor(data.color) ?? data.color;

    // valor e cor são fixos depois que a ficha entra em uso (preserva o histórico)
    const identityChanged = CHIP_IDENTITY.some((f) => data[f] !== undefined && String(data[f]) !== String(chip[f] ?? ''));
    if (identityChanged && await chipInUse(chip._id)) {
      throw new HttpError(409, 'Valor e cor são fixos: esta ficha já foi usada (estoque, modelo, fichário, stack ou torneio). Cadastre outra ficha ou desative esta.');
    }
    // desativar exige saldo físico zero (Σ dos saldos nos fichários, derivado das movimentações)
    if (data.active === false && chip.active !== false) {
      const total = await chipTotal(chip._id);
      if (total > 0) throw new HttpError(409, `Esta ficha ainda tem ${total} unidade(s) em fichários. Zere o saldo antes de desativar.`);
    }

    chip.set(data);
    const reactivating = data.active === true && chip.isModified('active');
    if (identityChanged || reactivating) {
      const twin = await findChipTwin({ value: chip.value, color: chip.color }, chip._id);
      if (twin) throw new HttpError(409, `Já existe uma ficha ativa com este valor e cor (${twin.name}).`);
    }
    await chip.save();
    await logActivity('Ficha Editada', 'inventory', `ID: ${chip._id} | ${chip.name}${chip.active === false ? ' | desativada' : ''}`, req.user);
    res.json(chip);
  } catch (err) {
    sendError(res, err);
  }
});

// Fichas não são apagadas (spec §3.1): desative com PUT { active: false }.
router.delete('/chips/:id', verifyToken, (req, res) => {
  res.status(405).json({ error: 'Fichas não são excluídas — desative a ficha (active: false) para descontinuá-la sem perder o histórico.' });
});

// ─── Modelos de Fichário (composição padrão — G1) ────────────────────────────
// "O modelo define quanto de cada ficha compõe um fichário." Leitura para quem vê fichários;
// criar/editar/excluir só admin. Editar um modelo NÃO altera fichários físicos já criados.
router.get('/binder-models', verifyToken, requirePageAccess('ficharios'), async (req, res) => {
  try {
    await paginate(res, BinderModel, {}, { populate: 'composition.chip_id', sort: { name: 1 }, query: req.query });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/binder-models', verifyToken, requirePageAccess('ficharios'), adminOnly, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'Nome do modelo é obrigatório.');
    await assertUniqueBinderModelName(name);
    const composition = await normalizeComposition(req.body?.composition);
    const model = await new BinderModel({ name, composition, notes: req.body?.notes }).save();
    await logActivity('Modelo de Fichário Criado', 'chip_case', `Nome: ${model.name} | ${composition.length} ficha(s)`, req.user);
    res.status(201).json(await BinderModel.findById(model._id).populate('composition.chip_id'));
  } catch (err) {
    sendError(res, err);
  }
});

router.put('/binder-models/:id', verifyToken, requirePageAccess('ficharios'), adminOnly, async (req, res) => {
  try {
    const model = await BinderModel.findById(req.params.id);
    if (!model) throw new HttpError(404, 'Modelo de fichário não encontrado.');
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) throw new HttpError(400, 'Nome do modelo é obrigatório.');
      await assertUniqueBinderModelName(name, model._id);
      model.name = name;
    }
    if (req.body?.composition !== undefined) {
      model.composition = await normalizeComposition(req.body.composition, { keepIds: model.composition.map((l) => l.chip_id) });
    }
    if (req.body?.notes !== undefined) model.notes = req.body.notes;
    await model.save();
    await logActivity('Modelo de Fichário Editado', 'chip_case', `ID: ${model._id} | Nome: ${model.name}`, req.user);
    res.json(await BinderModel.findById(model._id).populate('composition.chip_id'));
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/binder-models/:id', verifyToken, requirePageAccess('ficharios'), adminOnly, async (req, res) => {
  try {
    const model = await BinderModel.findById(req.params.id);
    if (!model) throw new HttpError(404, 'Modelo de fichário não encontrado.');
    const used = await Binder.countDocuments({ model_id: model._id });
    if (used > 0) throw new HttpError(409, `${used} fichário(s) físico(s) seguem este modelo. Exclua ou desvincule-os antes.`);
    await model.softDelete();
    await logActivity('Modelo de Fichário Excluído', 'chip_case', `ID: ${req.params.id} | Nome: ${model.name}`, req.user);
    res.json({ message: 'Modelo de fichário excluído com sucesso' });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Fichários físicos (Binder) ──────────────────────────────────────────────
// Unidade real usada no evento; pode seguir um Modelo de Fichário. Conteúdo, alocações e situação são
// DERIVADOS na leitura (lib/binderView.js). Criar/editar/excluir só admin; a conferência é operacional.
const BINDER_FIELDS = ['name', 'code', 'model_id', 'status'];
const CHIPS_READONLY_MSG = 'O conteúdo do fichário é derivado das movimentações e não pode ser editado: use a montagem (POST /binders/:id/assemble) ou movimentações (POST /movements).';
const BINDER_PATHS = ['/binders'];

router.get(BINDER_PATHS, verifyToken, requirePageAccess('ficharios'), async (req, res) => {
  try {
    await paginate(res, Binder, {}, { populate: ['model_id'], sort: { createdAt: -1 }, query: req.query, transform: (rows) => binderView.present(rows) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post(BINDER_PATHS, verifyToken, requirePageAccess('ficharios'), adminOnly, async (req, res) => {
  try {
    const data = pick(req.body, BINDER_FIELDS);
    data.name = String(data.name || '').trim();
    if (!data.name) throw new HttpError(400, 'Nome é obrigatório.');
    if (data.code !== undefined) data.code = String(data.code).trim() || undefined;
    await assertUniqueBinder(data);

    if (req.body?.chips !== undefined) throw new HttpError(400, CHIPS_READONLY_MSG);
    // O fichário nasce vazio: o estoque físico entra por montagem (ASSEMBLY) — a partir do modelo ou avulsa.
    if (data.model_id) {
      if (!(await BinderModel.exists({ _id: data.model_id }))) throw new HttpError(400, 'Modelo de fichário não encontrado.');
    } else {
      data.model_id = null;
    }

    const binder = await new Binder(data).save();
    await logActivity('Fichário Criado', 'chip_case', `Nome: ${binder.name}${data.model_id ? ' | a partir de modelo' : ''}`, req.user);
    res.status(201).json(await binderView.presentOne(await Binder.findById(binder._id).populate('model_id')));
  } catch (err) {
    sendError(res, err);
  }
});

router.put(BINDER_PATHS.map((p) => `${p}/:id`), verifyToken, requirePageAccess('ficharios'), adminOnly, async (req, res) => {
  try {
    const binder = await Binder.findById(req.params.id);
    if (!binder) throw new HttpError(404, 'Fichário não encontrado.');
    const data = pick(req.body, BINDER_FIELDS);
    if (data.name !== undefined) {
      data.name = String(data.name).trim();
      if (!data.name) throw new HttpError(400, 'Nome é obrigatório.');
    }
    if (data.code !== undefined) data.code = String(data.code).trim() || undefined;
    await assertUniqueBinder({ name: data.name, code: data.code }, binder._id);
    if (data.model_id) {
      if (!(await BinderModel.exists({ _id: data.model_id }))) throw new HttpError(400, 'Modelo de fichário não encontrado.');
    }
    if (req.body?.chips !== undefined) throw new HttpError(400, CHIPS_READONLY_MSG);
    binder.set(data);
    await binder.save();
    await logActivity('Fichário Editado', 'chip_case', `ID: ${binder._id} | Nome: ${binder.name}`, req.user);
    res.json(await binderView.presentOne(await Binder.findById(binder._id).populate('model_id')));
  } catch (err) {
    sendError(res, err);
  }
});

router.delete(BINDER_PATHS.map((p) => `${p}/:id`), verifyToken, requirePageAccess('ficharios'), adminOnly, async (req, res) => {
  try {
    const binder = await Binder.findById(req.params.id);
    if (!binder) throw new HttpError(404, 'Fichário não encontrado.');
    const held = (await balances({ binder_id: binder._id })).filter((r) => r.quantity > 0);
    if (held.length) throw new HttpError(409, 'Este fichário ainda contém fichas. Retire-as (saída/estorno) antes de excluí-lo.');
    await binder.softDelete();
    await logActivity('Fichário Excluído', 'chip_case', `ID: ${req.params.id} | Nome: ${binder.name}`, req.user);
    res.json({ message: 'Fichário excluído com sucesso' });
  } catch (err) {
    sendError(res, err);
  }
});

/** Avisa em tempo real que ocorrências foram abertas; as VERMELHAS viram alerta urgente para todos (spec §11). */
async function announceOccurrences(req, list) {
  const io = req.app.get('io');
  if (!io || !list?.length) return;
  for (const o of list) {
    try { io.emit('occurrenceOpened', await occurrences.alertPayload(o)); } catch (e) { logger.error({ err: e }, 'falha ao anunciar ocorrência'); }
  }
}

// ─── Montagem e conferência de fichário (G2) ─────────────────────────────────
// Montagem = ASSEMBLY (externo → fichário). "A partir do modelo" lança a composição padrão do modelo.
router.post(BINDER_PATHS.map((p) => `${p}/:id/assemble`), verifyToken, requirePageAccess('ficharios'), adminOnly, async (req, res) => {
  try {
    const binder = await Binder.findById(req.params.id);
    if (!binder) throw new HttpError(404, 'Fichário não encontrado.');
    let items; let reason = req.body?.reason;
    if (req.body?.from_model) {
      const model = binder.model_id ? await BinderModel.findById(binder.model_id) : null;
      if (!model) throw new HttpError(400, 'Este fichário não segue nenhum modelo de fichário.');
      items = model.composition.map((l) => ({ chip_id: l.chip_id, quantity: l.quantity }));
      reason = reason || `Montagem a partir do modelo "${model.name}"`;
    } else {
      items = await normalizeComposition(req.body?.items);
    }
    const docs = await postBatch(items.map((i) => ({
      type: 'ASSEMBLY', chip_id: i.chip_id, quantity: i.quantity,
      from: { kind: 'external' }, to: { kind: 'binder', id: binder._id }, reason,
    })), { user: req.user });
    await logActivity('Montagem de Fichário', 'chip_case', `${binder.name} | ${docs.length} ficha(s)`, req.user);
    req.app.get('io')?.emit('balancesChanged', { binder_id: binder._id });
    res.status(201).json({ message: 'Fichário montado', batch_id: docs[0].batch_id, movements: docs.length, case: await binderView.presentOne(await Binder.findById(binder._id).populate('model_id')) });
  } catch (err) {
    sendError(res, err);
  }
});

// Conferência física: compara o CONTADO com o ESPERADO (saldo derivado) e NÃO sobrescreve nada.
// Falta → LOSS (fichário → divergência); sobra → FOUND (externo → fichário). Cada diferença abre uma OCORRÊNCIA
// com semáforo (G8); a justificativa só é obrigatória a partir do nível configurado (default: vermelho).
router.post(BINDER_PATHS.map((p) => `${p}/:id/count`), verifyToken, requirePageAccess('ficharios', 'operate'), async (req, res) => {
  try {
    const binder = await Binder.findById(req.params.id);
    if (!binder) throw new HttpError(404, 'Fichário não encontrado.');
    const r = await occurrences.countBinder(binder, { counts: req.body?.counts, reason: req.body?.reason, user: req.user });
    if (r.diffs.length) {
      req.app.get('io')?.emit('balancesChanged', { binder_id: binder._id });
      await announceOccurrences(req, r.occurrences);
    }
    await logActivity('Conferência de Fichário', 'chip_case', `${binder.name} | ${r.diffs.length} diferença(s)`, req.user);
    res.json({ message: 'Conferência registrada', diffs: r.diffs, occurrences: r.occurrences.map(occurrences.shape), case: await binderView.presentOne(await Binder.findById(binder._id)) });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Movimentações (G2) — fonte da verdade dos saldos ────────────────────────
// Lançar: ASSEMBLY/WITHDRAWAL/ADJUSTMENT só admin; LOSS (quebra/perda) admin e material.
// Não existe PUT/DELETE: erro se corrige por estorno (POST /movements/:id/reverse).
const MANUAL_TYPES = ['ASSEMBLY', 'WITHDRAWAL', 'ADJUSTMENT', 'LOSS'];
const MOVEMENT_ACTIVITY = {
  ASSEMBLY: 'Entrada de Ficha no Estoque', WITHDRAWAL: 'Saída de Ficha do Estoque',
  LOSS: 'Quebra/Perda de Fichas', ADJUSTMENT: 'Ajuste de Estoque',
};

router.post('/movements', verifyToken, requirePageAccess('estoque', 'operate'), async (req, res) => {
  try {
    const { type, binder_id, direction, reason } = req.body || {};
    if (!MANUAL_TYPES.includes(type)) throw new HttpError(400, `Tipo inválido. Use: ${MANUAL_TYPES.join(', ')}.`);
    // perda é operação (material); montagem, saída e ajuste são administrativos
    if (!hasLevel(req.user.role, 'estoque', type === 'LOSS' ? 'operate' : 'manage')) throw new HttpError(403, 'Você não tem permissão para este tipo de movimentação.');
    if (!binder_id) throw new HttpError(400, 'Informe o fichário.');
    if (type === 'ADJUSTMENT' && !['in', 'out'].includes(direction)) throw new HttpError(400, 'Ajuste exige direction: "in" ou "out".');

    const items = Array.isArray(req.body.items) ? req.body.items : [{ chip_id: req.body.chip_id, quantity: req.body.quantity }];
    const bin = { kind: 'binder', id: binder_id };
    const ext = { kind: 'external' };
    const ends = {
      ASSEMBLY: [ext, bin], WITHDRAWAL: [bin, ext], LOSS: [bin, { kind: 'lost', id: binder_id }],
      ADJUSTMENT: direction === 'out' ? [bin, ext] : [ext, bin],
    }[type];

    let docs; let opened = [];
    if (type === 'LOSS') { // perda lançada à mão também é ocorrência (G8)
      if (!mongoose.isValidObjectId(binder_id) || items.some((i) => !mongoose.isValidObjectId(i?.chip_id))) throw new HttpError(400, 'Fichário ou ficha inválidos.');
      const binder = await Binder.findById(binder_id);
      if (!binder) throw new HttpError(404, 'Fichário não encontrado.');
      ({ docs, occurrences: opened } = await occurrences.recordManualLoss(binder, items, { reason, user: req.user }));
    } else {
      docs = await postBatch(items.map((i) => ({ type, chip_id: i.chip_id, quantity: i.quantity, from: ends[0], to: ends[1], reason })), { user: req.user });
    }
    await logActivity(MOVEMENT_ACTIVITY[type], 'inventory', `${docs.length} lançamento(s)${reason ? ` | ${reason}` : ''}`, req.user);
    req.app.get('io')?.emit('balancesChanged', { binder_id });
    await announceOccurrences(req, opened);
    res.status(201).json({ batch_id: docs[0].batch_id, movements: docs, ...(opened.length ? { occurrences: opened.map(occurrences.shape) } : {}) });
  } catch (err) {
    sendError(res, err);
  }
});

// Estorno (admin): grava o movimento inverso vinculado ao original, que permanece intacto.
// `whole_batch: true` estorna todos os lançamentos gravados juntos (ex.: uma montagem inteira).
router.post('/movements/:id/reverse', verifyToken, requirePageAccess('estoque'), adminOnly, async (req, res) => {
  try {
    let ids = [req.params.id];
    if (req.body?.whole_batch) {
      const one = await Movement.findById(req.params.id);
      if (!one) throw new HttpError(404, 'Movimentação não encontrada.');
      ids = (await Movement.find({ batch_id: one.batch_id, type: { $ne: 'REVERSAL' } }).select('_id')).map((m) => m._id);
    }
    const owned = await Movement.findOne({ _id: { $in: ids }, 'meta.occurrence_id': { $exists: true } }).select('meta');
    const legacyOwner = owned ? null : await Occurrence.findOne({ legacy_movement_id: { $in: ids } }).select('_id');
    if (owned || legacyOwner) throw new HttpError(409, `Este lançamento pertence à ocorrência ${owned?.meta.occurrence_id || legacyOwner._id}: corrija pela própria ocorrência (estornar).`);
    const docs = await reverseMovements(ids, { reason: req.body?.reason, user: req.user });
    await logActivity('Estorno de Movimentação', 'inventory', `${docs.length} lançamento(s) | ${req.body.reason}`, req.user);
    req.app.get('io')?.emit('balancesChanged', {});
    res.status(201).json({ batch_id: docs[0].batch_id, movements: docs });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/movements', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    const q = req.query;
    const filter = {};
    for (const f of ['binder_id', 'chip_id', 'tournament_id', 'session_id', 'batch_id', 'user_id']) if (q[f]) filter[f] = q[f];
    if (q.type && q.type !== 'all') filter.type = q.type;
    if (q.from || q.to) {
      filter.createdAt = {};
      if (q.from) filter.createdAt.$gte = new Date(q.from);
      if (q.to) filter.createdAt.$lte = new Date(q.to);
    }
    await paginate(res, Movement, filter, {
      populate: [{ path: 'chip_id', select: 'name value color' }, { path: 'binder_id', select: 'name code' }, { path: 'tournament_id', select: 'name' }],
      sort: { createdAt: -1, _id: -1 },
      query: q,
      // o original é imutável: "estornado" é derivado da existência do REVERSAL que aponta para ele
      transform: async (rows) => {
        const rev = await Movement.find({ reverses: { $in: rows.map((r) => r._id) } }).select('reverses createdAt user_name reason');
        const byOriginal = new Map(rev.map((r) => [String(r.reverses), r]));
        return rows.map((r) => {
          const o = r.toObject();
          const r2 = byOriginal.get(String(r._id));
          o.reversed_by = r2 ? { _id: r2._id, at: r2.createdAt, user_name: r2.user_name, reason: r2.reason } : null;
          return o;
        });
      },
    });
  } catch (err) {
    sendError(res, err);
  }
});

// Saldos derivados por fichário × ficha (`kind=lost` mostra as divergências abertas).
router.get('/balances', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    const kind = req.query.kind === 'lost' ? 'lost' : 'binder';
    const rows = await balances({ kind, binder_id: req.query.binder_id, chip_id: req.query.chip_id });
    const [chips, binders] = await Promise.all([
      Chip.find({ _id: { $in: rows.map((r) => r.chip_id) } }).select('name value color').lean(),
      Binder.find({ _id: { $in: rows.map((r) => r.binder_id) } }).setOptions({ withDeleted: true }).select('name code').lean(),
    ]);
    const chipById = new Map(chips.map((c) => [String(c._id), c]));
    const binderById = new Map(binders.map((b) => [String(b._id), b]));
    const out = rows.map((r) => ({
      binder: binderById.get(String(r.binder_id)) || { _id: r.binder_id }, chip: chipById.get(String(r.chip_id)) || { _id: r.chip_id }, quantity: r.quantity,
    })).sort((a, b) => String(a.binder.name).localeCompare(String(b.binder.name)) || (a.chip.value ?? 0) - (b.chip.value ?? 0));
    res.json({
      kind, rows: out,
      totals: { quantity: out.reduce((a, r) => a + r.quantity, 0), value: out.reduce((a, r) => a + r.quantity * (r.chip.value || 0), 0) },
    });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Torneios ────────────────────────────────────────────────────────────────
// `current_level` e os campos de relógio NÃO entram aqui — são controlados
// exclusivamente por POST /tournaments/:id/clock.
const TOURNAMENT_FIELDS = [
  'name', 'date', 'start_time', 'timezone', 'status', 'estimated_players', 'actual_players',
  'stack_model_id', 'stack_models', 'blind_structure',
  'notes', 'seats_per_table', 'event_id', 'number',
  // financeiro (P2)
  'buy_in', 'rake', 'addon_value', 'addon_chips', 'bounty_value', 'payout_template_id',
];

// ─── helpers de seating (P4) — por SESSÃO (G4) ───────────────────────────────
// Cada sessão (Dia 1A, 1B…) tem as suas mesas. Torneios sem sessão (dados antigos) usam session_id nulo.
/** "Entrada #12": identificação da entrada nas mesas, eliminações e resultados (não há nomes de jogadores). */
const entryLabel = (e) => (e?.number != null ? `Entrada #${e.number}` : 'Entrada');
const seatScope = (tournamentId, sessionId) => ({ tournament_id: tournamentId, session_id: sessionId || null });

/** Senta uma ENTRADA (não há cadastro de jogadores: quem ocupa o lugar é a entrada). */
async function seatNewEntry(tournament, entryId, sessionId = null) {
  const seatsPerTable = tournament.seats_per_table || 9;
  const scope = seatScope(tournament._id, sessionId);
  const existing = await Seat.findOne({ ...scope, entry_id: entryId });
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt++) {
    const docs = await Seat.find(scope);
    const tables = seating.buildTables(docs, seatsPerTable);
    const spot = seating.pickSeatForNewEntry(tables, seatsPerTable);
    try {
      return await Seat.create({ ...scope, entry_id: entryId, ...spot });
    } catch (e) {
      if (e.code !== 11000) throw e; // colisão de lugar — tenta de novo
    }
  }
  return null;
}

async function seatingView(tournamentId, sessionId = null) {
  const t = await Tournament.findById(tournamentId);
  if (!t) return null;
  const seatsPerTable = t.seats_per_table || 9;
  // (sem populate: buildTables faz String(entry_id), que num documento populado vira lixo em vez do id)
  const docs = await Seat.find(seatScope(tournamentId, sessionId));
  const tablesRaw = seating.buildTables(docs, seatsPerTable);
  const seated = await TournamentEntry.find({ _id: { $in: docs.map((d) => d.entry_id) } }).select('number type').lean();
  const entryById = new Map(seated.map((e) => [String(e._id), e]));

  const tables = tablesRaw.map((tb) => ({
    number: tb.number,
    seats: Array.from({ length: seatsPerTable }, (_, i) => {
      const o = tb.occupants.find((x) => x.seat_number === i + 1);
      const e = o ? entryById.get(o.entry_id) : null;
      return { seat: i + 1, entry_id: o?.entry_id || null, entry_number: e?.number ?? null, label: e ? entryLabel(e) : null };
    }),
    count: tb.occupants.length,
  }));

  return {
    session_id: sessionId || null,
    seats_per_table: seatsPerTable,
    total_seated: docs.length,
    tables,
    balancing: seating.suggestBalance(tablesRaw, seatsPerTable),
    breakable: seating.breakableTables(tablesRaw, seatsPerTable),
  };
}

const CLOCK_ACTIONS = ['start', 'pause', 'resume', 'stop', 'next', 'prev', 'goto', 'adjust'];

// Escopo por torneio (G11): quem tem `allowed_tournament_ids` só enxerga/opera esses torneios (admin: todos).
router.use('/tournaments/:tid', requireTournamentAccess);

router.get('/tournaments', verifyToken, async (req, res) => {
  try {
    const allowed = await allowedTournaments(req.user);
    await paginate(res, Tournament, allowed ? { _id: { $in: allowed } } : {}, { sort: { date: -1, createdAt: -1 }, query: req.query });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tournaments/:id', verifyToken, async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Torneio não encontrado' });
    res.json(tournament);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Evento e nº do torneio: o evento precisa existir e o número é único dentro do evento (#02 Warm Up).
async function normalizeEventFields(body, existing) {
  const out = {};
  if (body.event_id !== undefined) {
    if (body.event_id && !(await Event.exists({ _id: body.event_id }))) throw new HttpError(400, 'Evento não encontrado.');
    out.event_id = body.event_id || null;
  }
  if (body.number !== undefined) {
    if (body.number === null || body.number === '') out.number = null;
    else {
      const n = Number(body.number);
      if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'O número do torneio deve ser um inteiro ≥ 1.');
      out.number = n;
    }
  }
  const eventId = out.event_id !== undefined ? out.event_id : existing?.event_id;
  const number = out.number !== undefined ? out.number : existing?.number;
  if (eventId && number) {
    const q = { event_id: eventId, number };
    if (existing) q._id = { $ne: existing._id };
    if (await Tournament.exists(q)) throw new HttpError(409, `Já existe o torneio nº ${number} neste evento.`);
  }
  return out;
}

router.post('/tournaments', verifyToken, requirePageAccess('torneios', 'manage'), async (req, res) => {
  try {
    const body = pick(req.body, TOURNAMENT_FIELDS);
    if (!body.name || !body.date) return res.status(400).json({ error: 'Nome e data são obrigatórios.' });

    // stack: o valor do stack e as fichas em jogo são DERIVADOS dos modelos (lib/tournamentChips), nunca digitados
    Object.assign(body, await tournamentChips.normalizeStackConfig(body));
    Object.assign(body, await normalizeEventFields(body));
    // sessões/fases (Dia 1A, 1B…): só o admin as define na criação; sem isso nasce "Dia Único"
    const wanted = req.body?.sessions;
    if (wanted !== undefined && !Array.isArray(wanted)) throw new HttpError(400, 'sessions deve ser uma lista.');
    if (wanted?.length && req.user.role !== 'admin') throw new HttpError(403, 'Apenas administradores definem as sessões do torneio.');

    const tournament = new Tournament(body);
    await tournament.save();
    for (const item of wanted?.length ? wanted : [{ name: 'Dia Único' }]) {
      const spec = typeof item === 'string' ? { name: item } : item;
      await sessionsLib.createSession(tournament._id, { starts_at: tournament.starts_at, ...spec });
    }
    await tournamentChips.refreshTournamentChips(tournament._id, req.app.get('io'));
    await logActivity('Torneio Criado', 'tournament', `Nome: ${tournament.name}`, req.user);
    res.status(201).json({ ...(await Tournament.findById(tournament._id)).toJSON(), sessions: await sessionsLib.listSessions(tournament._id) });
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/tournaments/:id', verifyToken, requirePageAccess('torneios', 'manage'), async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Torneio não encontrado' });

    // Libera as alocações de fichas (a capacidade volta a ficar livre para outros torneios)
    await allocationLib.releaseForTournament(tournament._id, req.user);

    // Excluir o torneio o esconde (soft delete): entradas, eliminações e movimentos PERMANECEM como histórico (spec §18.3).
    // Só a disposição das mesas (Seat), que é operacional, é limpa.
    await Seat.deleteMany({ tournament_id: tournament._id });

    await TournamentSession.updateMany({ tournament_id: tournament._id }, { $set: { deleted_at: new Date() } });
    await tournament.softDelete();
    await logActivity(
      'Torneio Excluído', 'tournament',
      `Nome: ${tournament.name} | entradas, eliminações e movimentos preservados`,
      req.user
    );
    res.json({ message: 'Torneio excluído com sucesso' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const RUNNING_STATES = ['running', 'paused'];
const CLOSED_STATES = ['finished', 'finalized'];

router.put('/tournaments/:id', verifyToken, requirePageAccess('mesas', 'operate'), async (req, res) => {
  try {
    const io = req.app.get('io');
    const updates = pick(req.body, TOURNAMENT_FIELDS);
    // o salão/material operam o torneio (status, entradas, anotações); a ESTRUTURA (stack, financeiro, blinds…) é do admin
    const OPERATIONAL = ['status', 'actual_players', 'estimated_players', 'notes'];
    if (Object.keys(updates).some((k) => !OPERATIONAL.includes(k)) && !hasLevel(req.user.role, 'torneios', 'manage')) {
      return res.status(403).json({ error: 'Alterar a estrutura do torneio (stack, financeiro, blinds…) é permitido só ao administrador.' });
    }
    const oldTournament = await Tournament.findById(req.params.id);
    if (!oldTournament) return res.status(404).json({ error: 'Torneio não encontrado' });
    const stackChanged = updates.stack_model_id !== undefined || updates.stack_models !== undefined;
    if (stackChanged) Object.assign(updates, await tournamentChips.normalizeStackConfig(updates));
    if (updates.event_id !== undefined || updates.number !== undefined) {
      Object.assign(updates, await normalizeEventFields(updates, oldTournament));
    }

    // trava otimista da estrutura de blinds (P6)
    if (updates.blind_structure !== undefined) {
      const sent = req.body?.blind_version;
      if (sent !== undefined && Number(sent) !== (oldTournament.blind_version || 0)) {
        return res.status(409).json({
          error: 'A estrutura de blinds foi alterada em outro dispositivo. Recarregue e tente de novo.',
          blind_version: oldTournament.blind_version || 0,
        });
      }
      updates.blind_version = (oldTournament.blind_version || 0) + 1;
    }

    // recomputa starts_at se data/horário/fuso mudaram (findByIdAndUpdate pula o hook)
    if (updates.date !== undefined || updates.start_time !== undefined || updates.timezone !== undefined) {
      updates.starts_at = computeStartsAt(
        updates.date ?? oldTournament.date,
        updates.start_time ?? oldTournament.start_time,
        updates.timezone ?? oldTournament.timezone,
      );
    }

    const wasRunning = RUNNING_STATES.includes(oldTournament.status);
    const willRun = RUNNING_STATES.includes(updates.status);
    const willClose = CLOSED_STATES.includes(updates.status);

    // O torneio só fecha com todas as sessões encerradas (spec §3.5). `finish_sessions: true` encerra as pendentes junto.
    if (willClose && !CLOSED_STATES.includes(oldTournament.status)) {
      const pending = await sessionsLib.pendingSessions(oldTournament._id);
      if (pending.length) {
        if (req.body?.finish_sessions !== true) {
          throw new HttpError(409, `Encerre as sessões pendentes antes de finalizar o torneio: ${pending.map((x) => x.name).join(', ')}.`,
            pending.map((x) => ({ _id: x._id, name: x.name, status: x.status })));
        }
        await sessionsLib.finishAll(oldTournament._id);
      }
    }

    // Alocações: a reserva já vale desde que foi criada (planned). Ao iniciar viram ativas; ao encerrar são liberadas.
    if (willRun && !wasRunning && !CLOSED_STATES.includes(oldTournament.status)) {
      if (await allocationLib.activateForTournament(oldTournament._id)) io.emit('allocationsChanged', { tournament_id: oldTournament._id });
    }
    if (willClose && !CLOSED_STATES.includes(oldTournament.status)) {
      if (await allocationLib.releaseForTournament(oldTournament._id, req.user)) io.emit('allocationsChanged', { tournament_id: oldTournament._id });
    }

    const tournament = await Tournament.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });

    if (stackChanged) await tournamentChips.refreshTournamentChips(tournament._id, io);

    await logActivity('Torneio Alterado', 'tournament', `ID: ${tournament._id} | Nome: ${tournament.name}`, req.user);
    res.json({ message: 'Torneio atualizado', tournament: stackChanged ? await Tournament.findById(tournament._id) : tournament });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Relógio do torneio (P1) ─────────────────────────────────────────────────
router.post('/tournaments/:id/clock', verifyToken, requirePageAccess('mesas', 'operate'), async (req, res) => {
  try {
    const { action } = req.body || {};
    const seconds = Number(req.body?.seconds) || 0;
    if (!CLOCK_ACTIONS.includes(action)) {
      return res.status(400).json({ error: `Ação inválida. Use uma de: ${CLOCK_ACTIONS.join(', ')}.` });
    }

    const t = await Tournament.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Torneio não encontrado' });

    const updates = applyAction(t, action, { seconds });
    if (updates === null) return res.status(400).json({ error: 'Ação inválida.' });
    Object.assign(t, updates);
    await t.save();

    const payload = clockPayload(t);
    req.app.get('io').to(`tournament:${t._id}`).emit('tournamentClock', payload);
    await logActivity('Relógio do Torneio', 'tournament', `${t.name} | ${action}${seconds ? ` (${seconds}s)` : ''}`, req.user);
    res.json(payload);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Mesas / Seating (P4) — por sessão (G4): ?session_id= (GET) ou session_id no corpo (POST) ──────
// Sem session_id: 1 sessão → ela; várias → a única em andamento; ambíguo → 400.
async function seatingSession(tournamentId, requested) {
  const session = await sessionsLib.resolveSession(tournamentId, requested);
  return session ? session._id : null;
}

router.get('/tournaments/:id/seating', verifyToken, async (req, res) => {
  try {
    if (!(await Tournament.exists({ _id: req.params.id }))) throw new HttpError(404, 'Torneio não encontrado.');
    const sid = await seatingSession(req.params.id, req.query.session_id);
    res.json(await seatingView(req.params.id, sid));
  } catch (err) {
    sendError(res, err);
  }
});

// Senta todas as entradas ativas da sessão que ainda não têm lugar
router.post('/tournaments/:id/seating/draw', verifyToken, requirePageAccess('mesas', 'operate'), async (req, res) => {
  try {
    const t = await Tournament.findById(req.params.id);
    if (!t) throw new HttpError(404, 'Torneio não encontrado.');
    const sid = await seatingSession(t._id, req.body?.session_id);

    const [entries, elims, seats] = await Promise.all([
      TournamentEntry.find({ ...seatScope(t._id, sid), type: { $in: ['buy-in', 're-entry'] } }),
      Elimination.find({ tournament_id: t._id }),
      Seat.find(seatScope(t._id, sid)),
    ]);
    const eliminated = new Set(elims.map((e) => String(e.entry_id)));
    const seated = new Set(seats.map((x) => String(x.entry_id)));
    const toSeat = entries.map((e) => String(e._id)).filter((id) => !eliminated.has(id) && !seated.has(id));

    for (const id of seating.shuffle(toSeat)) await seatNewEntry(t, id, sid);
    await logActivity('Sorteio de Lugares', 'tournament', `${t.name} | ${toSeat.length} entrada(s)`, req.user);
    res.json(await seatingView(t._id, sid));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/tournaments/:id/seating/move', verifyToken, requirePageAccess('mesas', 'operate'), async (req, res) => {
  try {
    const { entry_id, to_table, to_seat } = req.body || {};
    if (!entry_id || !to_table || !to_seat) throw new HttpError(400, 'Informe a entrada, a mesa e o lugar.');
    const sid = await seatingSession(req.params.id, req.body?.session_id);
    const scope = seatScope(req.params.id, sid);
    const occupied = await Seat.findOne({ ...scope, table_number: to_table, seat_number: to_seat });
    if (occupied && String(occupied.entry_id) !== String(entry_id)) throw new HttpError(400, 'Lugar ocupado.');
    await Seat.findOneAndUpdate({ ...scope, entry_id }, { table_number: to_table, seat_number: to_seat }, { upsert: true });
    await logActivity('Entrada Movida de Mesa', 'tournament', `Mesa ${to_table} lugar ${to_seat}`, req.user);
    res.json(await seatingView(req.params.id, sid));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/tournaments/:id/seating/break-table', verifyToken, requirePageAccess('mesas', 'operate'), async (req, res) => {
  try {
    const t = await Tournament.findById(req.params.id);
    if (!t) throw new HttpError(404, 'Torneio não encontrado.');
    const sid = await seatingSession(t._id, req.body?.session_id);
    const scope = seatScope(t._id, sid);
    const tableNumber = Number(req.body?.table_number);
    const seatsPerTable = t.seats_per_table || 9;

    const docs = await Seat.find(scope);
    const tables = seating.buildTables(docs, seatsPerTable);
    if (!seating.breakableTables(tables, seatsPerTable).some((x) => x.table_number === tableNumber)) {
      throw new HttpError(400, 'Essa mesa não pode ser quebrada agora (sem lugares suficientes nas outras).');
    }

    // lugares livres nas OUTRAS mesas (mesa, lugar), embaralhados
    const openSpots = seating.shuffle(
      tables.filter((tb) => tb.number !== tableNumber && tb.occupants.length > 0)
        .flatMap((tb) => tb.free.map((seat) => ({ table_number: tb.number, seat_number: seat })))
    );
    const movers = seating.shuffle(docs.filter((x) => x.table_number === tableNumber));

    await Seat.deleteMany({ ...scope, table_number: tableNumber });
    await Seat.insertMany(movers.map((m, i) => ({
      ...scope, entry_id: m.entry_id,
      table_number: openSpots[i].table_number, seat_number: openSpots[i].seat_number,
    })));
    await logActivity('Mesa Quebrada', 'tournament', `${t.name} | mesa ${tableNumber}`, req.user);
    res.json(await seatingView(t._id, sid));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/tournaments/:id/seating/redraw', verifyToken, requirePageAccess('mesas', 'operate'), async (req, res) => {
  try {
    const t = await Tournament.findById(req.params.id);
    if (!t) throw new HttpError(404, 'Torneio não encontrado.');
    const sid = await seatingSession(t._id, req.body?.session_id);
    const scope = seatScope(t._id, sid);
    const seatsPerTable = t.seats_per_table || 9;

    const [entries, elims] = await Promise.all([
      TournamentEntry.find({ ...scope, type: { $in: ['buy-in', 're-entry'] } }),
      Elimination.find({ tournament_id: t._id }),
    ]);
    const eliminated = new Set(elims.map((e) => String(e.entry_id)));
    const active = entries.map((e) => String(e._id)).filter((id) => !eliminated.has(id));

    const tablesCount = req.body?.tables ? Number(req.body.tables) : null;
    const assignments = seating.redraw(active, tablesCount, seatsPerTable);

    await Seat.deleteMany(scope);
    await Seat.insertMany(assignments.map((a) => ({ ...scope, ...a })));
    await logActivity('Redistribuição de Mesas', 'tournament', `${t.name} | ${active.length} entradas`, req.user);
    res.json(await seatingView(t._id, sid));
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Templates de estrutura de blinds (P4) ───────────────────────────────────
router.get('/blind-templates', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    res.json(await BlindStructureTemplate.find().sort({ name: 1 }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/blind-templates', verifyToken, requirePageAccess('torneios', 'manage'), async (req, res) => {
  try {
    const data = pick(req.body, ['name', 'rows', 'notes']);
    if (!data.name || !Array.isArray(data.rows) || data.rows.length === 0) {
      return res.status(400).json({ error: 'Nome e ao menos uma linha são obrigatórios.' });
    }
    res.status(201).json(await BlindStructureTemplate.create(data));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/blind-templates/:id', verifyToken, requirePageAccess('torneios', 'manage'), async (req, res) => {
  try {
    const data = pick(req.body, ['name', 'rows', 'notes']);
    const tpl = await BlindStructureTemplate.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!tpl) return res.status(404).json({ error: 'Template não encontrado.' });
    res.json(tpl);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/blind-templates/:id', verifyToken, requirePageAccess('torneios', 'manage'), async (req, res) => {
  try {
    const tpl = await BlindStructureTemplate.findById(req.params.id);
    if (!tpl) return res.status(404).json({ error: 'Template não encontrado.' });
    await tpl.softDelete();
    res.json({ message: 'Template removido' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Modelos de Stack (G3) ───────────────────────────────────────────────────
// Grade ficha × ação (spec §3.4). Ler: qualquer autenticado; criar/editar/excluir: só admin.
// O valor de cada coluna é DERIVADO (`totals`); quantidades por jogador × ações = fichas necessárias.
const asHttp = (e) => (e instanceof HttpError ? e : new HttpError(400, e.message));

async function stackPayload(body, existing) {
  try {
    const actions = stackCalc.normalizeActions(body.actions !== undefined ? body.actions : existing ? existing.actions.map((a) => ({ key: a.key, label: a.label })) : undefined);
    const composition = body.composition !== undefined
      ? stackCalc.normalizeComposition(body.composition, actions)
      : existing ? existing.composition.map((l) => ({ chip_id: l.chip_id, quantities: l.quantities || {} })) : stackCalc.normalizeComposition([], actions);
    // fichas existentes e ativas (inativas só se já estavam no modelo)
    const keep = new Set((existing?.composition || []).map((l) => String(l.chip_id)));
    const chips = await Chip.find({ _id: { $in: composition.map((l) => l.chip_id) } });
    const byId = new Map(chips.map((c) => [String(c._id), c]));
    for (const l of composition) {
      const chip = byId.get(String(l.chip_id));
      if (!chip) throw new HttpError(400, 'Ficha não encontrada na composição.');
      if (chip.active === false && !keep.has(String(l.chip_id))) throw new HttpError(400, `A ${chip.name} está inativa e não pode ser adicionada.`);
    }
    return { actions, composition };
  } catch (e) { throw asHttp(e); }
}

async function assertUniqueStackName(name, excludeId) {
  const q = { name: new RegExp(`^${escapeRegex(String(name).trim())}$`, 'i') };
  if (excludeId) q._id = { $ne: excludeId };
  if (await StackModel.exists(q)) throw new HttpError(409, `Já existe um modelo de stack chamado "${name}".`);
}

router.get('/stacks', verifyToken, async (req, res) => {
  try {
    res.json(await StackModel.find().sort({ name: 1 }).populate('composition.chip_id'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/stacks', verifyToken, requirePageAccess('modelos_stack'), adminOnly, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'Nome é obrigatório.');
    await assertUniqueStackName(name);
    const { actions, composition } = await stackPayload(req.body);
    const stack = await new StackModel({ name, actions, composition, notes: req.body?.notes }).save();
    await logActivity('Modelo de Stack Criado', 'tournament', `Nome: ${stack.name}`, req.user);
    res.status(201).json(await StackModel.findById(stack._id).populate('composition.chip_id'));
  } catch (err) {
    sendError(res, err);
  }
});

router.put('/stacks/:id', verifyToken, requirePageAccess('modelos_stack'), adminOnly, async (req, res) => {
  try {
    const stack = await StackModel.findById(req.params.id);
    if (!stack) throw new HttpError(404, 'Modelo de stack não encontrado.');
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) throw new HttpError(400, 'Nome é obrigatório.');
      await assertUniqueStackName(name, stack._id);
      stack.name = name;
    }
    const { actions, composition } = await stackPayload(req.body, stack);
    stack.actions = actions;
    stack.composition = composition;
    if (req.body?.notes !== undefined) stack.notes = req.body.notes;
    await stack.save();
    // os torneios que usam este modelo têm fichas em jogo/stack derivados: recalcula
    const users = await Tournament.find({ $or: [{ stack_model_id: stack._id }, { 'stack_models.stack_model_id': stack._id }] }).select('_id');
    for (const t of users) await tournamentChips.refreshTournamentChips(t._id, req.app.get('io'));
    await logActivity('Modelo de Stack Editado', 'tournament', `ID: ${stack._id} | Nome: ${stack.name}`, req.user);
    res.json(await StackModel.findById(stack._id).populate('composition.chip_id'));
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/stacks/:id', verifyToken, requirePageAccess('modelos_stack'), adminOnly, async (req, res) => {
  try {
    const stack = await StackModel.findById(req.params.id);
    if (!stack) throw new HttpError(404, 'Modelo de stack não encontrado.');
    const [tournaments, entries] = await Promise.all([
      Tournament.countDocuments({ $or: [{ stack_model_id: stack._id }, { 'stack_models.stack_model_id': stack._id }] }),
      TournamentEntry.countDocuments({ stack_model_id: stack._id }),
    ]);
    if (tournaments || entries) {
      throw new HttpError(409, `Este modelo está em uso (${tournaments} torneio(s)${entries ? `, ${entries} entrada(s) antigas` : ''}) e não pode ser excluído.`);
    }
    await stack.softDelete();
    await logActivity('Modelo de Stack Excluído', 'tournament', `ID: ${req.params.id} | Nome: ${stack.name}`, req.user);
    res.json({ message: 'Modelo de stack excluído' });
  } catch (err) {
    sendError(res, err);
  }
});

// Necessidade de fichas por denominação: { counts: { buy_in: 100, re_entry: 20 } } × este modelo (calculado no servidor).
router.post('/stacks/:id/needs', verifyToken, requirePageAccess('modelos_stack'), async (req, res) => {
  try {
    res.json(await tournamentChips.needsForStackModel(req.params.id, req.body?.counts));
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Entradas de Torneio ─────────────────────────────────────────────────────
router.get('/tournaments/:id/entries', verifyToken, async (req, res) => {
  try {
    const filter = { tournament_id: req.params.id };
    if (req.query.session_id) filter.session_id = req.query.session_id;
    const entries = await TournamentEntry.find(filter)
      .populate('stack_model_id')
      .sort({ timestamp: -1 });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const MAX_BATCH_ENTRIES = 500;

// Entrada = buy-in / re-entry / add-on. O STACK é derivado da AÇÃO (buy_in, optional_buy_in, re_entry,
// add_on…) e do modelo mapeado no torneio — o operador não escolhe stack por entrada.
// `quantity` > 1 registra várias ações de uma vez: é o "informar só a quantidade de ações". Não há cadastro de
// jogadores: cada entrada é numerada ("Entrada #n") e é ela que ocupa a mesa e pode ser eliminada.
router.post('/tournaments/:id/entries', verifyToken, requirePageAccess('mesas', 'operate'), async (req, res) => {
  try {
    const { type } = req.body || {}; // `stack_model_id` legado é ignorado
    if (!['buy-in', 're-entry', 'add-on'].includes(type)) throw new HttpError(400, 'Tipo de entrada inválido.');
    const quantity = req.body?.quantity === undefined ? 1 : Number(req.body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_BATCH_ENTRIES) {
      throw new HttpError(400, `A quantidade de entradas deve ser um inteiro entre 1 e ${MAX_BATCH_ENTRIES}.`);
    }

    const tournament = await Tournament.findById(req.params.id);
    if (!tournament) throw new HttpError(404, 'Torneio não encontrado.');
    if (type === 'add-on' && !(tournament.addon_value > 0)) throw new HttpError(400, 'Este torneio não tem add-on configurado.');

    const action = await tournamentChips.entryAction(tournament, type, req.body?.action);
    // a ação vai para UMA sessão (1 sessão → ela; várias → a em andamento ou `session_id`); sessão encerrada não recebe
    const session = await sessionsLib.resolveSession(tournament._id, req.body?.session_id, { open: true });
    const money = entryContribution(tournament, type);
    // numeração: o contador do torneio avança de forma atômica (nunca repete nem volta atrás, mesmo ao cancelar)
    const { entry_seq: lastSeq } = await Tournament.findByIdAndUpdate(tournament._id, { $inc: { entry_seq: quantity } }, { new: true }).select('entry_seq');
    const entries = await TournamentEntry.insertMany(Array.from({ length: quantity }, (_, i) => ({
      tournament_id: tournament._id, session_id: session?._id || null, type, action, number: lastSeq - quantity + 1 + i, ...money,
    })));

    if (type === 'buy-in') {
      await Tournament.findByIdAndUpdate(tournament._id, { $inc: { actual_players: quantity } });
    }
    // Sorteio de lugar (P4) — buy-in e re-entry ganham um assento (cada entrada ocupa o seu)
    if (['buy-in', 're-entry'].includes(type) && tournament.status !== 'finalized') {
      for (const e of entries) await seatNewEntry(tournament, e._id, session?._id);
    }
    await tournamentChips.refreshTournamentChips(tournament._id, req.app.get('io'));

    await logActivity('Entrada Registrada', 'tournament', `${tournament.name} | ${type}${action !== tournamentChips.defaultAction(type) ? ` (${action})` : ''}${quantity > 1 ? ` ×${quantity}` : ''} | #${entries[0].number}${quantity > 1 ? `–#${entries.at(-1).number}` : ''}`, req.user);
    if (quantity > 1) return res.status(201).json({ created: quantity, type, action });
    res.status(201).json(entries[0]);
  } catch (err) {
    sendError(res, err);
  }
});

// Entradas nunca são apagadas (spec §18.3): CANCELAM-SE com motivo (quem, quando e por quê ficam no registro).
const CANCEL_ONLY = 'Registros não são apagados: cancele com motivo (POST …/cancel { reason }).';
router.delete('/tournaments/:tid/entries/:eid', verifyToken, (req, res) => res.status(405).json({ error: CANCEL_ONLY }));
router.post('/tournaments/:tid/entries/:eid/cancel', verifyToken, requirePageAccess('mesas', 'operate'), async (req, res) => {
  try {
    const entry = await TournamentEntry.findOne({ _id: req.params.eid, tournament_id: req.params.tid });
    if (!entry) return res.status(404).json({ error: 'Entrada não encontrada.' });
    if (!String(req.body?.reason || '').trim()) throw new HttpError(400, 'Informe o motivo do cancelamento.');
    if (await Elimination.exists({ tournament_id: req.params.tid, entry_id: entry._id })) throw new HttpError(409, 'Esta entrada foi eliminada: cancele a eliminação antes de cancelar a entrada.');
    if (entry.session_id && req.user.role !== 'admin') {
      const closed = await TournamentSession.exists({ _id: entry.session_id, status: 'finished' });
      if (closed) throw new HttpError(409, 'A sessão desta entrada está encerrada: só o administrador altera.');
    }
    await entry.cancel({ user: req.user, reason: req.body.reason });
    if (entry.type === 'buy-in') {
      await Tournament.findByIdAndUpdate(req.params.tid, { $inc: { actual_players: -1 } });
    }
    // a entrada cancelada libera o lugar
    if (entry.type !== 'add-on') await Seat.deleteOne({ ...seatScope(req.params.tid, entry.session_id), entry_id: entry._id });
    await tournamentChips.refreshTournamentChips(req.params.tid, req.app.get('io'));
    await logActivity('Entrada Cancelada', 'tournament', `ID: ${req.params.eid} | ${req.body.reason}`, req.user);
    res.json({ message: 'Entrada cancelada' });
  } catch (err) {
    sendError(res, err);
  }
});

// Fichas em jogo (teórico) de um torneio: ações registradas × modelo de stack da ação. Tudo no servidor.
router.get('/tournaments/:id/chips-in-play', verifyToken, async (req, res) => {
  try {
    res.json(await tournamentChips.chipsInPlay(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

// Simulação: "e se houver N ações de cada tipo?" com os modelos mapeados no torneio.
router.post('/tournaments/:id/needs', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    res.json(await tournamentChips.needsForTournament(req.params.id, req.body?.counts));
  } catch (err) {
    sendError(res, err);
  }
});

// Compat: formato antigo [{ value, color, quantity }] — agora calculado pelo mesmo motor.
router.get('/tournaments/:id/consolidated-chips', verifyToken, async (req, res) => {
  try {
    const r = await tournamentChips.chipsInPlay(req.params.id);
    res.json(r.rows.map((x) => ({ value: x.chip.value, color: x.chip.color, quantity: x.quantity })));
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Eventos (G4) ────────────────────────────────────────────────────────────
// Evento → Torneio → Sessões. Ler: qualquer autenticado; criar/editar/excluir: só admin.
const EVENT_FIELDS = ['name', 'start_date', 'end_date', 'location', 'notes'];

async function normalizeEvent(body, existing) {
  const data = pick(body, EVENT_FIELDS);
  if (data.name !== undefined) {
    data.name = String(data.name).trim();
    if (!data.name) throw new HttpError(400, 'Nome do evento é obrigatório.');
    const q = { name: new RegExp(`^${escapeRegex(data.name)}$`, 'i') };
    if (existing) q._id = { $ne: existing._id };
    if (await Event.exists(q)) throw new HttpError(409, `Já existe o evento "${data.name}".`);
  } else if (!existing) throw new HttpError(400, 'Nome do evento é obrigatório.');
  for (const f of ['start_date', 'end_date']) if (data[f] === '') data[f] = null;
  const start = data.start_date !== undefined ? data.start_date : existing?.start_date;
  const end = data.end_date !== undefined ? data.end_date : existing?.end_date;
  if (start && end && new Date(end) < new Date(start)) throw new HttpError(400, 'A data final não pode ser anterior à inicial.');
  return data;
}

router.get('/events', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    const events = await Event.find().sort({ start_date: -1, createdAt: -1 }).lean();
    const counts = await Tournament.aggregate([{ $match: { event_id: { $ne: null } } }, { $group: { _id: '$event_id', n: { $sum: 1 } } }]);
    const byEvent = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json(events.map((e) => ({ ...e, tournaments_count: byEvent.get(String(e._id)) || 0 })));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/events/:id', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).lean();
    if (!event) throw new HttpError(404, 'Evento não encontrado.');
    const tournaments = await Tournament.find({ event_id: event._id }).sort({ number: 1, date: 1 }).lean();
    const sessions = await TournamentSession.find({ tournament_id: { $in: tournaments.map((t) => t._id) } }).sort({ order: 1 }).lean();
    res.json({
      ...event,
      tournaments: tournaments.map((t) => ({ ...t, sessions: sessions.filter((s) => String(s.tournament_id) === String(t._id)) })),
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/events', verifyToken, requirePageAccess('torneios'), adminOnly, async (req, res) => {
  try {
    const event = await new Event(await normalizeEvent(req.body)).save();
    await logActivity('Evento Criado', 'tournament', `Nome: ${event.name}`, req.user);
    res.status(201).json(event);
  } catch (err) {
    sendError(res, err);
  }
});

router.put('/events/:id', verifyToken, requirePageAccess('torneios'), adminOnly, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) throw new HttpError(404, 'Evento não encontrado.');
    event.set(await normalizeEvent(req.body, event));
    await event.save();
    await logActivity('Evento Editado', 'tournament', `ID: ${event._id} | Nome: ${event.name}`, req.user);
    res.json(event);
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/events/:id', verifyToken, requirePageAccess('torneios'), adminOnly, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) throw new HttpError(404, 'Evento não encontrado.');
    const n = await Tournament.countDocuments({ event_id: event._id });
    if (n) throw new HttpError(409, `Este evento tem ${n} torneio(s). Exclua ou mova os torneios antes.`);
    await event.softDelete();
    await logActivity('Evento Excluído', 'tournament', `ID: ${req.params.id} | Nome: ${event.name}`, req.user);
    res.json({ message: 'Evento excluído com sucesso' });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Sessões/fases do torneio (G4) ───────────────────────────────────────────
// Dia 1A, 1B, 1C, Dia Final… pertencem ao MESMO torneio (não são torneios independentes).
// Admin cria/renomeia/exclui; operadores leem e mudam o STATUS (scheduled → running → finished).
router.get('/tournaments/:id/sessions', verifyToken, async (req, res) => {
  try {
    const t = await Tournament.findById(req.params.id);
    if (!t) throw new HttpError(404, 'Torneio não encontrado.');
    const [sessions, counters] = await Promise.all([sessionsLib.listSessions(t._id), sessionsLib.sessionCounters(t._id)]);
    const out = [];
    for (const s of sessions) {
      const inPlay = await tournamentChips.chipsInPlay(t._id, { sessionId: s._id });
      out.push({
        ...s.toJSON(),
        counts: counters[String(s._id)] || { total: 0, by_type: {}, by_action: {} },
        chips_value: inPlay.totals.value,
      });
    }
    res.json(out);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/tournaments/:id/sessions', verifyToken, requirePageAccess('torneios'), adminOnly, async (req, res) => {
  try {
    const t = await Tournament.findById(req.params.id);
    if (!t) throw new HttpError(404, 'Torneio não encontrado.');
    if (CLOSED_STATES.includes(t.status)) throw new HttpError(409, 'O torneio está encerrado: não aceita novas sessões.');
    const session = await sessionsLib.createSession(t._id, pick(req.body, ['name', 'starts_at', 'notes']));
    await logActivity('Sessão Criada', 'tournament', `${t.name} | ${session.name}`, req.user);
    res.status(201).json(session);
  } catch (err) {
    sendError(res, err);
  }
});

router.put('/tournaments/:tid/sessions/:sid', verifyToken, requirePageAccess('mesas', 'operate'), async (req, res) => {
  try {
    const session = await TournamentSession.findOne({ _id: req.params.sid, tournament_id: req.params.tid });
    if (!session) throw new HttpError(404, 'Sessão não encontrada.');
    const isAdmin = req.user.role === 'admin';
    const structural = pick(req.body, ['name', 'starts_at', 'notes']);
    if (Object.keys(structural).length && !isAdmin) throw new HttpError(403, 'Apenas administradores renomeiam ou reagendam sessões.');
    if (structural.name !== undefined) {
      structural.name = String(structural.name).trim();
      if (!structural.name) throw new HttpError(400, 'Nome da sessão é obrigatório.');
      await sessionsLib.assertUniqueName(session.tournament_id, structural.name, session._id);
    }
    session.set(structural);
    if (req.body?.status !== undefined) sessionsLib.applyStatus(session, req.body.status, { isAdmin });
    await session.save();
    await logActivity('Sessão Atualizada', 'tournament', `${session.name} | ${session.status}`, req.user);
    res.json(session);
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/tournaments/:tid/sessions/:sid', verifyToken, requirePageAccess('torneios'), adminOnly, async (req, res) => {
  try {
    const session = await TournamentSession.findOne({ _id: req.params.sid, tournament_id: req.params.tid });
    if (!session) throw new HttpError(404, 'Sessão não encontrada.');
    if ((await TournamentSession.countDocuments({ tournament_id: req.params.tid })) <= 1) {
      throw new HttpError(409, 'O torneio precisa de ao menos uma sessão.');
    }
    const entries = await TournamentEntry.countDocuments({ session_id: session._id });
    if (entries) throw new HttpError(409, `A sessão tem ${entries} entrada(s) registrada(s) e não pode ser excluída.`);
    await Seat.deleteMany({ tournament_id: req.params.tid, session_id: session._id });
    await session.softDelete();
    await logActivity('Sessão Excluída', 'tournament', `${session.name}`, req.user);
    res.json({ message: 'Sessão excluída com sucesso' });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/tournaments/:tid/sessions/:sid/chips-in-play', verifyToken, async (req, res) => {
  try {
    const session = await TournamentSession.findOne({ _id: req.params.sid, tournament_id: req.params.tid });
    if (!session) throw new HttpError(404, 'Sessão não encontrada.');
    res.json(await tournamentChips.chipsInPlay(req.params.tid, { sessionId: session._id }));
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Alocações de fichas a torneios (G5) ─────────────────────────────────────
// Reserva por DENOMINAÇÃO e QUANTIDADE (não o fichário inteiro): o mesmo fichário atende 2 torneios se a soma
// alocada de cada ficha não passar do saldo físico. Regra `quantidade ≤ livre` no servidor (409 com o excesso).
// Definir alocações é do admin (spec §13.1); qualquer autenticado consulta.
const ALLOCATION_POPULATE = [
  { path: 'binder_id', select: 'name code' },
  { path: 'tournament_id', select: 'name status' },
  { path: 'chips.chip_id', select: 'name value color' },
];

const emitAllocationConflict = (req, err, tournamentId) => {
  if (err.allocationConflict) req.app.get('io')?.emit('allocationConflict', { ...err.allocationConflict, tournament_id: tournamentId });
};
const allocationView = async (id) => (await allocationLib.withHealth([await Allocation.findById(id).populate(ALLOCATION_POPULATE)]))[0];

router.get('/allocations', verifyToken, async (req, res) => {
  try {
    const filter = {};
    for (const f of ['tournament_id', 'binder_id']) if (req.query[f]) filter[f] = req.query[f];
    if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
    else if (req.query.open !== 'all') filter.open = req.query.open === 'false' ? false : true; // padrão: só as abertas
    const rows = await Allocation.find(filter).sort({ createdAt: -1 }).populate(ALLOCATION_POPULATE);
    res.json(await allocationLib.withHealth(rows));
  } catch (err) {
    sendError(res, err);
  }
});

// Matriz de um fichário: saldo, alocado por torneio e LIVRE de cada ficha.
router.get('/allocations/matrix', verifyToken, requirePageAccess('ficharios'), async (req, res) => {
  try {
    if (!req.query.binder_id) throw new HttpError(400, 'Informe o fichário (binder_id).');
    res.json(await allocationLib.matrix(req.query.binder_id));
  } catch (err) {
    sendError(res, err);
  }
});

// { binder_id, mode: 'binder' | 'denominations' | 'quantities', chips?, chip_ids?, min_value?, max_value?, note? }
router.post('/tournaments/:id/allocations', verifyToken, requirePageAccess('torneios'), adminOnly, async (req, res) => {
  const tournament = await Tournament.findById(req.params.id).catch(() => null);
  try {
    if (!tournament) throw new HttpError(404, 'Torneio não encontrado.');
    const alloc = await allocationLib.allocate(tournament, req.body || {}, req.user);
    await logActivity('Fichas Alocadas', 'chip_case', `${tournament.name} | ${alloc.mode} | ${alloc.chips.length} ficha(s)`, req.user);
    req.app.get('io')?.emit('allocationsChanged', { tournament_id: tournament._id, binder_id: alloc.binder_id });
    res.status(201).json(await allocationView(alloc._id));
  } catch (err) {
    emitAllocationConflict(req, err, tournament?._id);
    sendError(res, err);
  }
});

// Substitui as fichas/quantidades da alocação (a lista completa).
router.put('/allocations/:id', verifyToken, requirePageAccess('torneios'), adminOnly, async (req, res) => {
  const alloc = await Allocation.findById(req.params.id).catch(() => null);
  try {
    if (!alloc) throw new HttpError(404, 'Alocação não encontrada.');
    await allocationLib.updateChips(alloc, req.body?.chips, req.user);
    await logActivity('Alocação Editada', 'chip_case', `ID: ${alloc._id}`, req.user);
    req.app.get('io')?.emit('allocationsChanged', { tournament_id: alloc.tournament_id, binder_id: alloc.binder_id });
    res.json(await allocationView(alloc._id));
  } catch (err) {
    emitAllocationConflict(req, err, alloc?.tournament_id);
    sendError(res, err);
  }
});

// Liberar = devolver a capacidade (a alocação fica no histórico como `released`; nunca é apagada).
router.delete('/allocations/:id', verifyToken, requirePageAccess('torneios'), adminOnly, async (req, res) => {
  try {
    const alloc = await Allocation.findById(req.params.id);
    if (!alloc) throw new HttpError(404, 'Alocação não encontrada.');
    await allocationLib.release(alloc, req.user);
    await logActivity('Alocação Liberada', 'chip_case', `ID: ${alloc._id}`, req.user);
    req.app.get('io')?.emit('allocationsChanged', { tournament_id: alloc.tournament_id, binder_id: alloc.binder_id });
    res.json(await allocationView(alloc._id));
  } catch (err) {
    sendError(res, err);
  }
});


// ─── Templates de premiação (P2) ─────────────────────────────────────────────
router.get('/payout-templates', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    res.json(await PayoutTemplate.find().sort({ name: 1 }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/payout-templates', verifyToken, requirePageAccess('torneios', 'manage'), async (req, res) => {
  try {
    const data = pick(req.body, ['name', 'brackets', 'notes']);
    const errors = validateTemplate(data);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    res.status(201).json(await PayoutTemplate.create(data));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/payout-templates/:id', verifyToken, requirePageAccess('torneios', 'manage'), async (req, res) => {
  try {
    const data = pick(req.body, ['name', 'brackets', 'notes']);
    const errors = validateTemplate(data);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    const tpl = await PayoutTemplate.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!tpl) return res.status(404).json({ error: 'Template não encontrado.' });
    res.json(tpl);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/payout-templates/:id', verifyToken, requirePageAccess('torneios', 'manage'), async (req, res) => {
  try {
    const tpl = await PayoutTemplate.findById(req.params.id);
    if (!tpl) return res.status(404).json({ error: 'Template não encontrado.' });
    await tpl.softDelete();
    res.json({ message: 'Template removido' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Financeiro do torneio + resultados (P2) ─────────────────────────────────

// Monta o retrato financeiro completo de um torneio.
async function buildFinance(tournamentId) {
  const t = await Tournament.findById(tournamentId).populate('payout_template_id');
  if (!t) return null;
  const [entries, eliminations] = await Promise.all([
    TournamentEntry.find({ tournament_id: t._id }),
    Elimination.find({ tournament_id: t._id }),
  ]);

  const s = summarize(entries, eliminations);
  const payouts = payoutTable(s.prize_pool, t.payout_template_id, s.total_entries);

  // entradas em jogo = buy-in/re-entry (ativas) sem eliminação
  const eliminatedIds = new Set(eliminations.map((e) => String(e.entry_id)));
  const remaining = entries.filter((e) => e.type !== 'add-on' && !eliminatedIds.has(String(e._id))).length;

  return {
    tournament: {
      _id: t._id, name: t.name, status: t.status,
      buy_in: t.buy_in, rake: t.rake, addon_value: t.addon_value, addon_chips: t.addon_chips,
      bounty_value: t.bounty_value,
      payout_template: t.payout_template_id || null,
    },
    summary: s,
    payouts,
    players_remaining: remaining,
    // as ENTRADAS ainda em jogo (candidatas à eliminação), identificadas por número — não há cadastro de jogadores
    entries_in_play: entries.filter((e) => e.type !== 'add-on' && !eliminatedIds.has(String(e._id)))
      .sort((x, y) => (x.number ?? 0) - (y.number ?? 0)).map((e) => ({ _id: e._id, number: e.number ?? null, type: e.type, label: entryLabel(e) })),
    // `label` identifica a entrada eliminada ("Entrada #7"): não há cadastro de jogadores
    eliminations: eliminations.sort((a, b) => a.position - b.position).map((e) => ({
      ...e.toObject(), entry_number: entries.find((x) => String(x._id) === String(e.entry_id))?.number ?? null,
      label: entryLabel(entries.find((x) => String(x._id) === String(e.entry_id))),
    })),
  };
}

router.get('/tournaments/:id/finance', verifyToken, async (req, res) => {
  try {
    const data = await buildFinance(req.params.id);
    if (!data) return res.status(404).json({ error: 'Torneio não encontrado.' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Registra a eliminação de uma ENTRADA (`entry_id`). Se sobrar só 1 entrada, ela é a campeã: finaliza o torneio e
// grava os prêmios de cada colocação. (Não há cadastro de jogadores nem bounty por eliminador.)
router.post('/tournaments/:id/eliminations', verifyToken, requirePageAccess('mesas', 'operate'), async (req, res) => {
  try {
    const { entry_id } = req.body || {};
    const t = await Tournament.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Torneio não encontrado.' });
    if (t.status === 'finalized') return res.status(400).json({ error: 'Torneio já finalizado.' });
    if (!mongoose.isValidObjectId(entry_id)) return res.status(400).json({ error: 'Entrada inválida.' });

    const [entries, elims] = await Promise.all([
      TournamentEntry.find({ tournament_id: t._id, type: { $in: ['buy-in', 're-entry'] } }),
      Elimination.find({ tournament_id: t._id }),
    ]);
    const eliminatedIds = new Set(elims.map((e) => String(e.entry_id)));
    if (!entries.some((e) => String(e._id) === String(entry_id))) return res.status(400).json({ error: 'Entrada não encontrada neste torneio.' });
    if (eliminatedIds.has(String(entry_id))) return res.status(400).json({ error: 'Esta entrada já foi eliminada.' });

    const alive = entries.filter((e) => !eliminatedIds.has(String(e._id)));
    const remaining = alive.length;
    const position = remaining; // 8 entradas restando → quem sai é a 8ª

    await Elimination.create({ tournament_id: t._id, entry_id, position });
    await Seat.deleteOne({ tournament_id: t._id, entry_id }); // libera o lugar

    // Sobrou 1 → essa é a campeã; finaliza.
    if (remaining - 1 === 1) {
      const winner = alive.find((e) => String(e._id) !== String(entry_id));
      if (winner) await Elimination.create({ tournament_id: t._id, entry_id: winner._id, position: 1 });
      await Seat.deleteMany({ tournament_id: t._id }); // torneio acabou

      const finance = await buildFinance(t._id);
      // grava prize_awarded em cada eliminação premiada
      const byPlace = new Map(finance.payouts.map((p) => [p.place, p.amount]));
      await Promise.all(
        (await Elimination.find({ tournament_id: t._id })).map((e) =>
          byPlace.has(e.position)
            ? Elimination.findByIdAndUpdate(e._id, { prize_awarded: byPlace.get(e.position) })
            : null
        )
      );
      t.status = 'finalized';
      t.finalized_at = new Date();
      await sessionsLib.finishAll(t._id); // torneio encerrado → sessões encerradas
      await allocationLib.releaseForTournament(t._id, req.user); // ...e fichas alocadas liberadas
      t.clock_status = 'stopped';
      await t.save();
      await logActivity('Torneio Finalizado', 'tournament', `${t.name}`, req.user);
    } else {
      await logActivity('Eliminação Registrada', 'tournament', `${t.name} | pos ${position}`, req.user);
    }

    res.status(201).json(await buildFinance(t._id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/tournaments/:tid/eliminations/:eid', verifyToken, (req, res) => res.status(405).json({ error: CANCEL_ONLY }));
router.post('/tournaments/:tid/eliminations/:eid/cancel', verifyToken, requirePageAccess('mesas', 'operate'), async (req, res) => {
  try {
    const elim = await Elimination.findOne({ _id: req.params.eid, tournament_id: req.params.tid });
    if (!elim) return res.status(404).json({ error: 'Eliminação não encontrada.' });
    if (!String(req.body?.reason || '').trim()) throw new HttpError(400, 'Informe o motivo do cancelamento.');
    await elim.cancel({ user: req.user, reason: req.body.reason });
    // desfazer a finalização se for o caso
    await Tournament.findByIdAndUpdate(req.params.tid, { status: 'running', finalized_at: null });
    // a entrada volta ao jogo → ganha um lugar de volta
    const t = await Tournament.findById(req.params.tid);
    if (t) {
      const entry = await TournamentEntry.findById(elim.entry_id);
      if (entry) await seatNewEntry(t, entry._id, entry.session_id || null);
    }
    await logActivity('Eliminação Cancelada', 'tournament', `ID: ${req.params.eid} | ${req.body.reason}`, req.user);
    res.json(await buildFinance(req.params.tid));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/tournaments/:id/results', verifyToken, async (req, res) => {
  try {
    const [eliminations, entries] = await Promise.all([
      Elimination.find({ tournament_id: req.params.id }).sort({ position: 1 }),
      TournamentEntry.find({ tournament_id: req.params.id }).select('number type').lean(),
    ]);
    const byId = new Map(entries.map((e) => [String(e._id), e]));
    res.json(eliminations.map((e) => ({
      position: e.position,
      entry_id: e.entry_id, entry_number: byId.get(String(e.entry_id))?.number ?? null, label: entryLabel(byId.get(String(e.entry_id))),
      prize: e.prize_awarded || 0,
      at: e.at,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Material no torneio (G6): envio, retorno e conversões ───────────────────
// Toda movimentação de fichas é uma MOVEMENT imutável. Quem registra: admin e material (operação de material,
// spec §13.2); o salão consulta. Envio/entrada de conversão só saem do que está ALOCADO ao torneio (G5).
const emitMaterial = (req, tournamentId) => req.app.get('io')?.emit('materialChanged', { tournament_id: tournamentId });

// Envio por AÇÃO (o stack calcula as fichas): { items: [{ action, count }], session_id?, binder_id?, reason? }
// ou avulso ("envio adicional"): { chips: [{ chip_id, quantity }] }.
router.post('/tournaments/:id/sends', verifyToken, requirePageAccess('torneios', 'operate'), async (req, res) => {
  try {
    const t = await material.openTournament(req.params.id);
    const docs = await material.send(t, req.body, req.user);
    await logActivity('Envio de Fichas ao Torneio', 'inventory', `${t.name} | ${docs.length} lançamento(s)`, req.user);
    emitMaterial(req, t._id);
    res.status(201).json({ batch_id: docs[0].batch_id, movements: docs });
  } catch (err) {
    sendError(res, err);
  }
});

// Retorno em jogo → fichário, por denominação: { binder_id, chips: [{ chip_id, quantity }], session_id?, reason? }
router.post('/tournaments/:id/returns', verifyToken, requirePageAccess('torneios', 'operate'), async (req, res) => {
  try {
    const t = await material.openTournament(req.params.id);
    const docs = await material.returnChips(t, req.body, req.user);
    await logActivity('Retorno de Fichas do Torneio', 'inventory', `${t.name} | ${docs.length} lançamento(s)`, req.user);
    emitMaterial(req, t._id);
    res.status(201).json({ batch_id: docs[0].batch_id, movements: docs });
  } catch (err) {
    sendError(res, err);
  }
});

// Esperado (ações × stack ± conversões) × enviado × devolvido × EM JOGO, por ficha. `?session_id=` filtra a sessão.
router.get('/tournaments/:id/material', verifyToken, async (req, res) => {
  try {
    if (!(await Tournament.exists({ _id: req.params.id }))) throw new HttpError(404, 'Torneio não encontrado.');
    res.json(await material.summary(req.params.id, { sessionId: req.query.session_id }));
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Descarte de stack (G7, spec §9) ─────────────────────────────────────────
// O jogador abandona o stack (poucas fichas) e faz nova inscrição: as fichas efetivamente devolvidas — por
// denominação, não precisam ser a composição original — saem de jogo e voltam ao fichário NA HORA. Valor total
// calculado no servidor; usuário, data/hora e sessão automáticos; o lote imutável é o registro permanente.
// Material/admin registram; o salão consulta. Erro se corrige por estorno do descarte (admin).
const DISCARD_PATHS = ['/tournaments/:id/discards', '/tournaments/:id/sessions/:sid/discards'];

router.post('/tournaments/:id/discards/preview', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    const p = await material.discardPreview(req.body);
    res.json({ chips: p.chips, total_chips: p.total_chips, total_value: p.total_value });
  } catch (err) {
    sendError(res, err);
  }
});

router.post(DISCARD_PATHS, verifyToken, requirePageAccess('torneios', 'operate'), async (req, res) => {
  try {
    const t = await material.openTournament(req.params.id);
    const r = await material.discard(t, { ...req.body, session_id: req.params.sid || req.body?.session_id }, req.user);
    await tournamentChips.refreshTournamentChips(t._id, req.app.get('io')); // o valor em jogo cai (relógio/projeção)
    await logActivity('Descarte de Stack', 'inventory', `${t.name} | ${r.total_chips} ficha(s) | valor ${r.total_value}`, req.user);
    const io = req.app.get('io');
    io?.emit('materialChanged', { tournament_id: t._id });
    io?.emit('balancesChanged', { binder_id: r.binder._id });
    io?.emit('discardRegistered', { tournament_id: t._id, binder_id: r.binder._id, total_chips: r.total_chips, total_value: r.total_value });
    res.status(201).json({
      batch_id: r.docs[0].batch_id, movements: r.docs, chips: r.chips, total_chips: r.total_chips, total_value: r.total_value,
      binder: { _id: r.binder._id, name: r.binder.name },
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.get(DISCARD_PATHS, verifyToken, async (req, res) => {
  try {
    if (!(await Tournament.exists({ _id: req.params.id }))) throw new HttpError(404, 'Torneio não encontrado.');
    res.json(await material.listDiscards(req.params.id, { sessionId: req.params.sid || req.query.session_id }));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/tournaments/:id/discards/:batch/reverse', verifyToken, requirePageAccess('torneios'), adminOnly, async (req, res) => {
  try {
    const t = await material.openTournament(req.params.id);
    const docs = await material.reverseDiscard(t._id, req.params.batch, { reason: req.body?.reason, user: req.user });
    await tournamentChips.refreshTournamentChips(t._id, req.app.get('io'));
    await logActivity('Descarte Estornado', 'inventory', `${t.name} | ${req.body.reason}`, req.user);
    emitMaterial(req, t._id);
    req.app.get('io')?.emit('discardRegistered', { tournament_id: t._id, reversed: true });
    res.status(201).json({ batch_id: docs[0].batch_id, movements: docs });
  } catch (err) {
    sendError(res, err);
  }
});

// Imutável (spec §15): sem edição nem exclusão de descarte.
const DISCARD_IMMUTABLE = 'Descartes são imutáveis: corrija por estorno (POST /tournaments/:id/discards/:batch/reverse) e um novo lançamento.';
router.put('/tournaments/:id/discards/:batch', verifyToken, (req, res) => res.status(405).json({ error: DISCARD_IMMUTABLE }));
router.delete('/tournaments/:id/discards/:batch', verifyToken, (req, res) => res.status(405).json({ error: DISCARD_IMMUTABLE }));

// ─── Ocorrências, conferência do jogo e semáforo (G8, spec §10–11) ───────────
// Conferência do JOGO: contado × fichas em jogo (derivadas dos movimentos). Falta → LOSS (jogo → divergência do torneio),
// sobra → FOUND. A quebra matemática de Chip Race/Color Up NÃO é perda: vem só como explicação em valor.
router.post('/tournaments/:id/count', verifyToken, requirePageAccess('torneios', 'operate'), async (req, res) => {
  try {
    const t = await material.openTournament(req.params.id);
    const r = await occurrences.countTournament(t, { counts: req.body?.counts, reason: req.body?.reason, session_id: req.body?.session_id, user: req.user });
    if (r.diffs.length) {
      emitMaterial(req, t._id);
      req.app.get('io')?.emit('balancesChanged', { tournament_id: t._id });
      await announceOccurrences(req, r.occurrences);
    }
    await logActivity('Conferência do Torneio', 'inventory', `${t.name} | ${r.diffs.length} diferença(s)`, req.user);
    res.json({ message: 'Conferência registrada', diffs: r.diffs, occurrences: r.occurrences.map(occurrences.shape), value: r.value });
  } catch (err) {
    sendError(res, err);
  }
});

const OCC_POPULATE = [
  { path: 'chip_id', select: 'name value color' }, { path: 'binder_id', select: 'name code' }, { path: 'tournament_id', select: 'name' },
];

router.get('/occurrences/summary', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    res.json(await occurrences.summary());
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/occurrences', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    const q = req.query;
    const filter = {};
    if (q.status === 'active') filter.status = { $nin: occurrences.TERMINAL };
    else if (q.status && q.status !== 'all') filter.status = q.status;
    for (const f of ['severity', 'kind', 'scope']) if (q[f] && q[f] !== 'all') filter[f] = q[f];
    for (const f of ['binder_id', 'tournament_id', 'chip_id', 'session_id']) if (q[f]) filter[f] = q[f];
    await paginate(res, Occurrence, filter, { sort: { createdAt: -1 }, populate: OCC_POPULATE, query: q, transform: (rows) => rows.map(occurrences.shape) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/occurrences/:id', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    const o = await occurrences.load(req.params.id);
    res.json(occurrences.shape(await o.populate(OCC_POPULATE)));
  } catch (err) {
    sendError(res, err);
  }
});

// Ação sobre uma ocorrência: valida, executa, registra na auditoria e avisa em tempo real.
const occurrenceAction = (activity, fn, { admin = false, balances: touches = false } = {}) => [
  verifyToken, requirePageAccess('estoque', admin ? 'manage' : 'operate'),
  async (req, res) => {
    try {
      const o = await fn(req.params.id, req.body || {}, req.user);
      await logActivity(activity, 'inventory', `Ocorrência ${o._id} | ${o.status}`, req.user);
      const io = req.app.get('io');
      io?.emit('occurrenceUpdated', { _id: String(o._id), status: o.status, severity: o.severity });
      if (touches) io?.emit('balancesChanged', { binder_id: o.binder_id || undefined, tournament_id: o.tournament_id || undefined });
      res.status(201).json(occurrences.shape(await o.populate(OCC_POPULATE)));
    } catch (err) {
      sendError(res, err);
    }
  },
];
router.post('/occurrences/:id/justify', ...occurrenceAction('Justificativa de Ocorrência', occurrences.justify));
router.post('/occurrences/:id/recover', ...occurrenceAction('Recuperação de Fichas', occurrences.recover, { balances: true }));
router.post('/occurrences/:id/recoveries/reverse', ...occurrenceAction('Estorno de Recuperação', occurrences.reverseRecovery, { admin: true, balances: true }));
router.post('/occurrences/:id/close', ...occurrenceAction('Encerramento de Ocorrência', occurrences.close, { admin: true }));
router.post('/occurrences/:id/reverse', ...occurrenceAction('Estorno de Ocorrência', occurrences.voidOccurrence, { admin: true, balances: true }));
const OCCURRENCE_IMMUTABLE = 'Ocorrências não são editadas nem apagadas: justifique, recupere, encerre ou estorne.';
router.put('/occurrences/:id', verifyToken, (req, res) => res.status(405).json({ error: OCCURRENCE_IMMUTABLE }));
router.delete('/occurrences/:id', verifyToken, (req, res) => res.status(405).json({ error: OCCURRENCE_IMMUTABLE }));

// Semáforo: faixas por valor nominal, escalonamento por quantidade e nível a partir do qual a justificativa é obrigatória.
router.get('/settings/severity', verifyToken, async (req, res) => {
  try {
    res.json(await settingsLib.getSetting('severity'));
  } catch (err) {
    sendError(res, err);
  }
});
router.put('/settings/severity', verifyToken, adminOnly, async (req, res) => {
  try {
    const value = severityLib.validate(req.body);
    await settingsLib.setSetting('severity', value, req.user);
    await logActivity('Configuração do Semáforo', 'settings', JSON.stringify(value), req.user);
    res.json(value);
  } catch (err) {
    sendError(res, err);
  }
});
router.delete('/settings/severity', verifyToken, adminOnly, async (req, res) => {
  try {
    const value = await settingsLib.resetSetting('severity');
    await logActivity('Configuração do Semáforo (padrão)', 'settings', 'restaurado', req.user);
    res.json(value);
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Chip Race / Color Up (Conversion) ───────────────────────────────────────
// { tournament_id, type: 'CHIP_RACE'|'COLOR_UP', outs: [{ chip_id, quantity }], ins: [...], binder_id?, session_id?, note? }
// O servidor calcula valor retirado, valor colocado e a QUEBRA MATEMÁTICA (nunca uma perda física). Imutável:
// corrige-se por estorno do lote (POST /conversions/:id/reverse).
const CONVERSION_POPULATE = [
  { path: 'tournament_id', select: 'name status' }, { path: 'binder_id', select: 'name code' },
  { path: 'outs.chip_id', select: 'name value color' }, { path: 'ins.chip_id', select: 'name value color' },
];

router.post('/conversions/preview', verifyToken, requirePageAccess('chip_race'), async (req, res) => {
  try {
    res.json(await material.preview(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/conversions', verifyToken, async (req, res) => {
  try {
    const filter = {};
    if (req.query.tournament_id) filter.tournament_id = req.query.tournament_id;
    if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
    await paginate(res, Conversion, filter, { populate: CONVERSION_POPULATE, sort: { createdAt: -1 }, query: req.query });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/conversions/:id', verifyToken, async (req, res) => {
  try {
    const c = await Conversion.findById(req.params.id).populate(CONVERSION_POPULATE);
    if (!c) throw new HttpError(404, 'Conversão não encontrada.');
    res.json(c);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/conversions', verifyToken, requirePageAccess('chip_race', 'operate'), async (req, res) => {
  try {
    const scope = await allowedTournaments(req.user);
    if (scope && !scope.includes(String(req.body?.tournament_id))) return res.status(403).json({ error: 'Você não tem acesso a este torneio.' });
    const t = await material.openTournament(req.body?.tournament_id);
    const c = await material.createConversion(t, req.body, req.user);
    await logActivity('Conversão de Fichas', 'chip_race', `${t.name} | ${c.type} | quebra ${c.math_breakage}`, req.user);
    await tournamentChips.refreshTournamentChips(t._id, req.app.get('io')); // a quebra muda o valor em jogo (relógio/projeção)
    req.app.get('io')?.emit('chipRaceUpdated', c);
    emitMaterial(req, t._id);
    res.status(201).json(await Conversion.findById(c._id).populate(CONVERSION_POPULATE));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/conversions/:id/reverse', verifyToken, requirePageAccess('chip_race'), adminOnly, async (req, res) => {
  try {
    const c = await Conversion.findById(req.params.id);
    if (!c) throw new HttpError(404, 'Conversão não encontrada.');
    await material.reverseConversion(c, { reason: req.body?.reason, user: req.user });
    await tournamentChips.refreshTournamentChips(c.tournament_id, req.app.get('io'));
    await logActivity('Conversão Estornada', 'chip_race', `ID: ${c._id} | ${req.body.reason}`, req.user);
    emitMaterial(req, c.tournament_id);
    res.json(await Conversion.findById(c._id).populate(CONVERSION_POPULATE));
  } catch (err) {
    sendError(res, err);
  }
});

// Conversão e movimentos são IMUTÁVEIS (spec §15): sem edição nem exclusão.
const CONVERSION_IMMUTABLE = 'Conversões são imutáveis: corrija por estorno (POST /conversions/:id/reverse) e um novo lançamento.';
router.put('/conversions/:id', verifyToken, (req, res) => res.status(405).json({ error: CONVERSION_IMMUTABLE }));
router.delete('/conversions/:id', verifyToken, (req, res) => res.status(405).json({ error: CONVERSION_IMMUTABLE }));

// ─── Histórico de saldo (G11, spec §15) ──────────────────────────────────────
// Reconstrói o efeito de cada movimento no saldo da ficha / do fichário / do torneio (leitura pura, dos movimentos).
router.get('/audit/history', verifyToken, requirePageAccess('relatorios'), async (req, res) => {
  try {
    const scope = await allowedTournaments(req.user);
    if (scope && req.query.tournament_id && !scope.includes(String(req.query.tournament_id))) return res.status(403).json({ error: 'Você não tem acesso a este torneio.' });
    const r = await historyLib.history({ binder_id: req.query.binder_id, chip_id: req.query.chip_id, tournament_id: req.query.tournament_id });
    const page = toInt(req.query.page, { min: 1, fallback: 1 });
    const limit = toInt(req.query.limit, { min: 1, max: 200, fallback: 50 });
    res.json({
      entity: r.entity, balances: r.balances,
      rows: r.rows.slice((page - 1) * limit, page * limit),
      pagination: { total: r.rows.length, page, pages: Math.max(1, Math.ceil(r.rows.length / limit)) },
    });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Log de Auditoria do Estoque ─────────────────────────────────────────────
router.get('/inventory/logs', verifyToken, requirePageAccess('relatorios'), async (req, res) => {
  try {
    const { search, type } = req.query;
    const page = toInt(req.query.page, { min: 1, fallback: 1 });
    const limit = toInt(req.query.limit, { min: 1, max: 100, fallback: 50 });
    const filter = { category: 'inventory' };

    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ details: rx }, { user_name: rx }, { action: rx }];
    }

    if (type && type !== 'all') {
      filter.action = new RegExp(type === 'entry' ? 'Entrada' : 'Saída', 'i');
    }

    const total = await ActivityLog.countDocuments(filter);
    const logs = await ActivityLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({ logs, pagination: { total, page, pages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Relatórios ──────────────────────────────────────────────────────────────
router.get('/reports/data', verifyToken, requirePageAccess('relatorios'), async (req, res) => {
  try {
    const totalTournaments = await Tournament.countDocuments();
    const finishedTournaments = await Tournament.countDocuments({ status: 'finished' });
    const totalChipRaces = await Conversion.countDocuments({ status: 'active' });

    // fichas: TUDO derivado dos movimentos (G10) — distribuição, valor, perdas e recuperações
    const [inventory, flows, occ] = await Promise.all([dashboardLib.byChip(), dashboardLib.flows(), dashboardLib.occurrenceStats()]);

    const racesByTournament = await Conversion.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$tournament_id', count: { $sum: 1 } } },
      { $lookup: { from: 'tournaments', localField: '_id', foreignField: '_id', as: 'tournament' } },
      { $unwind: '$tournament' },
      { $project: { name: '$tournament.name', count: 1 } },
      { $limit: 10 },
    ]);

    const { category, startDate, endDate } = req.query;
    const page = toInt(req.query.page, { min: 1, fallback: 1 });
    const limit = toInt(req.query.limit, { min: 1, max: 100, fallback: 50 });
    const filter = category && category !== 'all' ? { category } : {};

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const totalLogs = await ActivityLog.countDocuments(filter);
    const logs = await ActivityLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const t = inventory.totals;
    res.json({
      stats: {
        totalTournaments,
        finishedTournaments,
        totalChipRaces,
        totalChips: t.existing,                       // fichas físicas: em fichários + em jogo
        stockValue: t.value_in_binders + t.value_in_play, // valuation = Σ valor × quantidade (saldo derivado)
        chipsInBinders: t.in_binders, chipsInPlay: t.in_play, chipsLost: t.lost,
        valueInBinders: t.value_in_binders, valueInPlay: t.value_in_play,
        discardedChips: flows.discarded.quantity, discardedValue: flows.discarded.value,
        lostChips: flows.lost.quantity, lostValue: flows.lost.value,
        recoveredChips: flows.recovered.quantity, recoveredValue: flows.recovered.value,
        openOccurrences: occ.open_total, redOccurrences: occ.open_by_severity.RED,
      },
      charts: {
        chipDistribution: inventory.rows.filter((r) => r.existing > 0).map((r) => ({
          name: `Ficha ${r.chip.value}`, value: r.existing, color: r.chip.color,
          in_binders: r.in_binders, in_play: r.in_play, lost: r.lost,
        })),
        byLocation: [
          { name: 'Em fichários', value: t.in_binders }, { name: 'Em jogo', value: t.in_play },
          { name: 'Em divergência', value: t.lost }
        ],
        racesByTournament,
      },
      logs,
      pagination: { total: totalLogs, page, pages: Math.ceil(totalLogs / limit) },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Comparativo entre torneios (P6)
router.get('/reports/comparison', verifyToken, requirePageAccess('relatorios'), async (req, res) => {
  try {
    const tournaments = await Tournament.find({ status: { $in: ['finished', 'finalized', 'running', 'paused'] } })
      .sort({ starts_at: -1, date: -1 })
      .limit(40)
      .populate('payout_template_id');

    const rows = await Promise.all(tournaments.map(async (t) => {
      const [entries, elims] = await Promise.all([
        TournamentEntry.find({ tournament_id: t._id }),
        Elimination.find({ tournament_id: t._id }),
      ]);
      const s = summarize(entries, elims);
      const winner = elims.find((e) => e.position === 1);
      const flow = await dashboardLib.flowsByType({ tournament_id: t._id });
      const breakage = (await Conversion.find({ tournament_id: t._id, status: 'active', legacy: { $ne: true } }).select('math_breakage').lean()).reduce((a, c) => a + (c.math_breakage || 0), 0);
      const sentValue = ['SEND_BUY_IN', 'SEND_OPTIONAL', 'SEND_REENTRY', 'SEND_ADDITIONAL'].reduce((a, k) => a + flow[k].value, 0);
      return {
        _id: t._id,
        name: t.name,
        starts_at: t.starts_at,
        date: t.date,
        status: t.status,
        buyins: s.buyins,
        reentries: s.reentries,
        addons: s.addons,
        total_entries: s.total_entries,
        prize_pool: s.prize_pool,
        bounty_pool: s.bounty_pool,
        rake_collected: s.rake_collected,
        actual_players: t.actual_players || 0,
        winner: winner ? entryLabel(entries.find((x) => String(x._id) === String(winner.entry_id))) : null,
        // material do torneio (movimentos): valor em fichas por destino
        material: {
          sent_value: sentValue, returned_value: flow.RETURN.value, discarded_value: flow.DISCARD.value,
          lost_value: flow.LOSS.value - flow.RECOVERY.value, math_breakage: breakage,
        },
      };
    }));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Chat ────────────────────────────────────────────────────────────────────
// Alertas urgentes recentes + confirmações de leitura (P6)
router.get('/chat/urgent', verifyToken, async (req, res) => {
  try {
    const msgs = await ChatMessage.find({ is_urgent: true }).sort({ createdAt: -1 }).limit(30);
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/chat/:id/ack', verifyToken, async (req, res) => {
  try {
    const msg = await ChatMessage.findById(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    if (!msg.acks.some((a) => a.user_email === req.user.email)) {
      msg.acks.push({ user_name: req.user.name, user_email: req.user.email });
      await msg.save();
      req.app.get('io').emit('urgentAck', { message_id: String(msg._id), user_name: req.user.name });
    }
    res.json(msg);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/chat/:channel', verifyToken, async (req, res) => {
  try {
    const messages = await ChatMessage.find({ channel: req.params.channel })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(messages.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
