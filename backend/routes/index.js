const express = require('express');
const router = express.Router();
const {
  verifyToken,
  requirePageAccess,
  loginRateLimiter,
  registerFailedLogin,
  clearLoginAttempts,
  JWT_SECRET,
} = require('../middlewares/authMiddleware');
const logActivity = require('../services/activityLogger');
const { escapeRegex, toInt, pick } = require('../utils/sanitize');
const { paginate } = require('../lib/pagination');
const { applyAction, clockPayload } = require('../lib/tournamentClock');
const { entryContribution, summarize, payoutTable, validateTemplate } = require('../lib/tournamentFinance');
const { recordEntry, recordMany } = require('../lib/inventoryLedger');
const {
  User, ChipModel, Tournament, ChipCase, ActivityLog, ChipRace, StackModel, TournamentEntry, ChatMessage,
  Player, PayoutTemplate, Elimination, InventoryLedger,
} = require('../models');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const MIN_PASSWORD_LENGTH = 6;

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

    const token = jwt.sign(
      { id: user._id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({ message: 'Login realizado', token, user: { name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Revalidação de sessão pelo frontend
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.json({ name: user.name, email: user.email, role: user.role, id: user._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Usuários (Apenas Admin) ─────────────────────────────────────────────────
router.get('/users', verifyToken, requirePageAccess('usuarios'), async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', verifyToken, requirePageAccess('usuarios'), async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios.' });
    if (String(password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `A senha deve ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.` });
    }
    if (!['admin', 'material', 'salao'].includes(role)) {
      return res.status(400).json({ error: 'Papel inválido.' });
    }

    const user = new User({ name, email, password, role, created_by: req.user?.name || 'Admin' });
    await user.save();
    await logActivity('Usuário Criado', 'system', `Nome: ${name} | Email: ${email} | Role: ${role}`, req.user);
    res.status(201).json({ message: 'Usuário criado com sucesso' });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Já existe um usuário com este e-mail.' });
    res.status(400).json({ error: err.message });
  }
});

router.put('/users/:id', verifyToken, requirePageAccess('usuarios'), async (req, res) => {
  try {
    const { name, email, role, password } = req.body || {};
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

    // Impede remover o papel do último admin
    if (target.role === 'admin' && role && role !== 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) return res.status(400).json({ error: 'Não é possível rebaixar o único administrador.' });
    }

    if (name) target.name = name;
    if (email) target.email = email;
    if (role && ['admin', 'material', 'salao'].includes(role)) target.role = role;
    if (password) {
      if (String(password).length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: `A senha deve ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.` });
      }
      target.password = password; // hasheada pelo hook pre('save')
    }
    await target.save();

    await logActivity('Usuário Atualizado', 'system', `Nome: ${target.name} | Email: ${target.email}`, req.user);
    res.json({ message: 'Usuário atualizado', user: { name: target.name, email: target.email, role: target.role } });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Já existe um usuário com este e-mail.' });
    res.status(400).json({ error: err.message });
  }
});

router.delete('/users/:id', verifyToken, requirePageAccess('usuarios'), async (req, res) => {
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

// ─── Dashboard ───────────────────────────────────────────────────────────────
router.get('/dashboard/stats', verifyToken, async (req, res) => {
  try {
    const activeTournamentsCount = await Tournament.countDocuments({ status: 'running' });

    const chipsAggregate = await ChipModel.aggregate([
      { $match: { deleted_at: null } },
      { $group: { _id: null, total: { $sum: '$total_quantity' } } }
    ]);
    const totalChipsInStock = chipsAggregate.length ? chipsAggregate[0].total : 0;

    const availableCases = await ChipCase.countDocuments({ status: 'available' });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const chipRacesToday = await ChipRace.countDocuments({ createdAt: { $gte: startOfDay } });

    const recentTournaments = await Tournament.find().sort({ createdAt: -1 }).limit(5).select('name status start_time date');
    const recentActivities = await ActivityLog.find().sort({ createdAt: -1 }).limit(7);

    res.json({
      metrics: { activeTournamentsCount, totalChipsInStock, availableCases, chipRacesToday },
      recentTournaments,
      recentActivities,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Fichas (ChipModel) ──────────────────────────────────────────────────────
// total/reserved/available são DERIVADOS do InventoryLedger — não entram na whitelist.
const CHIP_FIELDS = ['name', 'value', 'color'];

router.get('/chips', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    await paginate(res, ChipModel, {}, { sort: { value: 1 }, query: req.query });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/chips', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    const data = pick(req.body, CHIP_FIELDS);
    const initial = Number(req.body?.total_quantity ?? req.body?.initial_quantity ?? 0);
    if (!data.name || data.value === undefined) {
      return res.status(400).json({ error: 'Nome e valor são obrigatórios.' });
    }
    data.value = Number(data.value);
    if (!Number.isFinite(data.value) || data.value < 0 || !Number.isFinite(initial) || initial < 0) {
      return res.status(400).json({ error: 'Valor e quantidade inicial devem ser números não negativos.' });
    }
    const chip = await ChipModel.create({ ...data, total_quantity: 0, available_quantity: 0 });
    if (initial > 0) {
      await recordEntry({
        chip_id: chip._id, type: 'saldo_inicial', quantity: initial,
        ref: { kind: 'manual', id: null, label: 'Cadastro da ficha' }, user: req.user,
      });
    }
    await logActivity('Ficha Criada', 'inventory', `Nome: ${chip.name} | Valor: ${chip.value} | Inicial: ${initial}`, req.user);
    res.status(201).json(await ChipModel.findById(chip._id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/chips/:id', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    const data = pick(req.body, CHIP_FIELDS);
    if (data.value !== undefined) data.value = Number(data.value);
    const chip = await ChipModel.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!chip) return res.status(404).json({ error: 'Ficha não encontrada.' });
    await logActivity('Ficha Editada', 'inventory', `ID: ${chip._id} | Nome: ${chip.name}`, req.user);
    res.json(chip);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/chips/:id', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    const chip = await ChipModel.findById(req.params.id);
    if (!chip) return res.status(404).json({ error: 'Ficha não encontrada.' });
    await chip.softDelete();
    await logActivity('Ficha Excluída', 'inventory', `ID: ${req.params.id} | Nome: ${chip.name}`, req.user);
    res.json({ message: 'Ficha excluída com sucesso' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Fichários (ChipCase) ────────────────────────────────────────────────────
const CASE_FIELDS = ['name', 'chips', 'status', 'allocations', 'allocated_to_tournament', 'allocated_to_tournament_name'];

router.get('/cases', verifyToken, requirePageAccess('ficharios'), async (req, res) => {
  try {
    await paginate(res, ChipCase, {}, { populate: 'chips.chip_id', sort: { createdAt: -1 }, query: req.query });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cases', verifyToken, requirePageAccess('ficharios'), async (req, res) => {
  try {
    const data = pick(req.body, CASE_FIELDS);
    if (!data.name) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const chipCase = new ChipCase(data);
    await chipCase.save();
    await logActivity('Fichário Criado', 'chip_case', `Nome: ${chipCase.name}`, req.user);
    res.status(201).json(chipCase);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/cases/:id', verifyToken, requirePageAccess('ficharios'), async (req, res) => {
  try {
    const data = pick(req.body, CASE_FIELDS);
    const chipCase = await ChipCase.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!chipCase) return res.status(404).json({ error: 'Fichário não encontrado.' });
    await logActivity('Fichário Editado', 'chip_case', `ID: ${chipCase._id} | Nome: ${chipCase.name}`, req.user);
    res.json(chipCase);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/cases/:id', verifyToken, requirePageAccess('ficharios'), async (req, res) => {
  try {
    const chipCase = await ChipCase.findById(req.params.id);
    if (!chipCase) return res.status(404).json({ error: 'Fichário não encontrado.' });
    await chipCase.softDelete();
    await logActivity('Fichário Excluído', 'chip_case', `ID: ${req.params.id} | Nome: ${chipCase.name}`, req.user);
    res.json({ message: 'Fichário excluído com sucesso' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Conferência física de um fichário: informa o que foi contado, o sistema
// ajusta o conteúdo e lança a diferença no livro-razão.
router.post('/cases/:id/count', verifyToken, requirePageAccess('ficharios'), async (req, res) => {
  try {
    const chipCase = await ChipCase.findById(req.params.id);
    if (!chipCase) return res.status(404).json({ error: 'Fichário não encontrado.' });
    const counts = Array.isArray(req.body?.counts) ? req.body.counts : [];

    const diffs = [];
    for (const c of counts) {
      const line = chipCase.chips.find((x) => String(x.chip_id) === String(c.chip_id));
      if (!line) continue;
      const counted = Math.max(0, Number(c.counted) || 0);
      const diff = counted - (line.quantity || 0);
      if (diff !== 0) {
        await recordEntry({
          chip_id: c.chip_id, type: 'contagem', quantity: diff,
          ref: { kind: 'case', id: chipCase._id, label: chipCase.name },
          note: `Conferência "${chipCase.name}": esperado ${line.quantity}, contado ${counted}`,
          user: req.user,
        });
        diffs.push({ chip_id: c.chip_id, expected: line.quantity, counted, diff });
      }
      line.quantity = counted;
    }
    await chipCase.save();
    await logActivity('Conferência de Fichário', 'chip_case', `${chipCase.name} | ${diffs.length} diferença(s)`, req.user);
    res.json({ message: 'Conferência registrada', diffs, case: await ChipCase.findById(chipCase._id).populate('chips.chip_id') });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Movimentação de estoque (P3: via livro-razão) ───────────────────────────
router.post('/inventory/update', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    const { chip_id, note } = req.body || {};
    const quantity_change = Number(req.body?.quantity_change);
    if (!chip_id) return res.status(400).json({ error: 'Ficha não informada.' });
    if (!Number.isFinite(quantity_change) || quantity_change === 0) {
      return res.status(400).json({ error: 'Quantidade de movimentação inválida.' });
    }

    const chip = await ChipModel.findById(chip_id);
    if (!chip) return res.status(404).json({ error: 'Ficha não encontrada' });
    if (chip.total_quantity + quantity_change < 0) {
      return res.status(400).json({ error: 'Movimentação deixaria o estoque negativo.' });
    }

    await recordEntry({
      chip_id, type: quantity_change > 0 ? 'entrada' : 'saida',
      quantity: quantity_change, note, user: req.user,
    });

    const action = quantity_change > 0 ? 'Entrada de Ficha no Estoque' : 'Saída de Ficha do Estoque';
    await logActivity(action, 'inventory', `Ficha: ${chip.name} | Alteração: ${quantity_change}${note ? ` | ${note}` : ''}`, req.user);
    res.json({ message: 'Estoque atualizado', chip: await ChipModel.findById(chip_id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Quebra / perda de fichas
router.post('/inventory/breakage', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    const { chip_id, note } = req.body || {};
    const quantity = Math.abs(Number(req.body?.quantity));
    if (!chip_id || !Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'Ficha e quantidade são obrigatórias.' });
    }
    const chip = await ChipModel.findById(chip_id);
    if (!chip) return res.status(404).json({ error: 'Ficha não encontrada.' });
    if (chip.total_quantity - quantity < 0) return res.status(400).json({ error: 'Quantidade maior que o estoque.' });

    await recordEntry({ chip_id, type: 'quebra', quantity: -quantity, note, user: req.user });
    await logActivity('Quebra/Perda de Fichas', 'inventory', `Ficha: ${chip.name} | -${quantity}${note ? ` | ${note}` : ''}`, req.user);
    res.json({ message: 'Registrado', chip: await ChipModel.findById(chip_id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Livro-razão (paginado)
router.get('/inventory/ledger', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    const filter = {};
    if (req.query.chip_id) filter.chip_id = req.query.chip_id;
    if (req.query.type && req.query.type !== 'all') filter.type = req.query.type;
    await paginate(res, InventoryLedger, filter, {
      populate: { path: 'chip_id', select: 'name value color' },
      sort: { createdAt: -1 },
      query: req.query,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Torneios ────────────────────────────────────────────────────────────────
// `current_level` e os campos de relógio NÃO entram aqui — são controlados
// exclusivamente por POST /tournaments/:id/clock.
const TOURNAMENT_FIELDS = [
  'name', 'date', 'start_time', 'status', 'estimated_players', 'actual_players',
  'starting_stack', 'stack_model_id', 'blind_structure', 'allocated_cases',
  'stack_composition', 'notes',
  // financeiro (P2)
  'buy_in', 'rake', 'addon_value', 'addon_chips', 'bounty_value', 'payout_template_id',
];

const CLOCK_ACTIONS = ['start', 'pause', 'resume', 'stop', 'next', 'prev', 'goto', 'adjust'];

router.get('/tournaments', verifyToken, async (req, res) => {
  try {
    await paginate(res, Tournament, {}, { sort: { date: -1, createdAt: -1 }, query: req.query });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tournaments/:id', verifyToken, async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id).populate({
      path: 'allocated_cases',
      populate: { path: 'chips.chip_id' }
    });
    if (!tournament) return res.status(404).json({ error: 'Torneio não encontrado' });
    res.json(tournament);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tournaments', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    const body = pick(req.body, TOURNAMENT_FIELDS);
    if (!body.name || !body.date) return res.status(400).json({ error: 'Nome e data são obrigatórios.' });

    if (body.stack_model_id) {
      const stackModel = await StackModel.findById(body.stack_model_id).populate('composition.chip_id');
      if (stackModel) {
        const totalValue = stackModel.composition.reduce(
          (sum, comp) => sum + (comp.chip_id?.value || 0) * comp.quantity, 0
        );
        body.starting_stack = totalValue || stackModel.total_value;
        body.stack_composition = stackModel.composition.map(c => ({
          chip_id: c.chip_id?._id,
          per_player: c.quantity,
        }));
      }
    }

    const tournament = new Tournament(body);
    await tournament.save();
    await logActivity('Torneio Criado', 'tournament', `Nome: ${tournament.name}`, req.user);
    res.status(201).json(tournament);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/tournaments/:id', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Torneio não encontrado' });

    // Libera fichários alocados (e devolve a reserva de fichas se estava em andamento)
    if (tournament.allocated_cases && tournament.allocated_cases.length > 0) {
      await ChipCase.updateMany(
        { _id: { $in: tournament.allocated_cases } },
        { $set: { status: 'available', allocated_to_tournament: null, allocated_to_tournament_name: null } }
      );
      if (['running', 'paused'].includes(tournament.status)) {
        await releaseCases(tournament, req.user);
      }
    }

    // Cascata: entradas e eliminações somem, chip races ficam arquivadas
    const [entriesRes, racesRes] = await Promise.all([
      TournamentEntry.deleteMany({ tournament_id: tournament._id }),
      ChipRace.updateMany({ tournament_id: tournament._id }, { $set: { status: 'cancelled' } }),
      Elimination.deleteMany({ tournament_id: tournament._id }),
    ]);

    await tournament.softDelete();
    await logActivity(
      'Torneio Excluído', 'tournament',
      `Nome: ${tournament.name} | Entradas removidas: ${entriesRes.deletedCount} | Chip races arquivadas: ${racesRes.modifiedCount}`,
      req.user
    );
    res.json({ message: 'Torneio excluído com sucesso' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Reserva (+1) as fichas dos fichários no livro-razão.
async function reserveCases(caseIds, tournament, user) {
  if (!caseIds?.length) return;
  const cases = await ChipCase.find({ _id: { $in: caseIds } });
  const entries = [];
  for (const c of cases) {
    for (const line of c.chips || []) {
      if (!line.chip_id || !(line.quantity > 0)) continue;
      entries.push({
        chip_id: line.chip_id, type: 'alocacao', quantity: line.quantity,
        ref: { kind: 'tournament', id: tournament._id, label: tournament.name },
        note: `Alocado — fichário "${c.name}"`, user,
      });
    }
  }
  await recordMany(entries);
}

// Devolve (-1) EXATAMENTE o que foi reservado para este torneio, somando os
// lançamentos 'alocacao' do ledger (imune a mudanças no conteúdo da maleta).
async function releaseCases(tournament, user) {
  const allocs = await InventoryLedger.aggregate([
    { $match: { type: 'alocacao', 'ref.id': tournament._id } },
    { $group: { _id: '$chip_id', total: { $sum: '$quantity' } } },
  ]);
  const returned = await InventoryLedger.aggregate([
    { $match: { type: 'retorno', 'ref.id': tournament._id } },
    { $group: { _id: '$chip_id', total: { $sum: '$quantity' } } },
  ]);
  const returnedMap = new Map(returned.map((r) => [String(r._id), -r.total]));

  const entries = [];
  for (const a of allocs) {
    const outstanding = a.total - (returnedMap.get(String(a._id)) || 0);
    if (outstanding > 0) {
      entries.push({
        chip_id: a._id, type: 'retorno', quantity: -outstanding,
        ref: { kind: 'tournament', id: tournament._id, label: tournament.name },
        note: 'Fichas devolvidas ao estoque', user,
      });
    }
  }
  await recordMany(entries);
}

const RUNNING_STATES = ['running', 'paused'];
const CLOSED_STATES = ['finished', 'finalized'];

router.put('/tournaments/:id', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    const io = req.app.get('io');
    const updates = pick(req.body, TOURNAMENT_FIELDS);
    const oldTournament = await Tournament.findById(req.params.id);
    if (!oldTournament) return res.status(404).json({ error: 'Torneio não encontrado' });

    const wasRunning = RUNNING_STATES.includes(oldTournament.status);
    const willRun = RUNNING_STATES.includes(updates.status);
    const willClose = CLOSED_STATES.includes(updates.status);

    if (willRun && !wasRunning && oldTournament.allocated_cases?.length) {
      await ChipCase.updateMany(
        { _id: { $in: oldTournament.allocated_cases } },
        { $set: { status: 'allocated', allocated_to_tournament: oldTournament._id, allocated_to_tournament_name: oldTournament.name } }
      );
      await reserveCases(oldTournament.allocated_cases, oldTournament, req.user);
      io.emit('chipCasesAllocated', { tournament_id: oldTournament._id, cases: oldTournament.allocated_cases });
    }

    if (willClose && !CLOSED_STATES.includes(oldTournament.status) && oldTournament.allocated_cases?.length) {
      await ChipCase.updateMany(
        { _id: { $in: oldTournament.allocated_cases } },
        { $set: { status: 'available', allocated_to_tournament: null, allocated_to_tournament_name: null } }
      );
      if (wasRunning) await releaseCases(oldTournament, req.user);
      io.emit('chipCasesReleased', { tournament_id: oldTournament._id, cases: oldTournament.allocated_cases });
    }

    const tournament = await Tournament.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });

    if (tournament.actual_players && tournament.starting_stack) {
      io.emit('tournamentTrackingUpdate', {
        tournament_id: tournament._id,
        actual_players: tournament.actual_players,
        starting_stack: tournament.starting_stack,
        total_chips_in_play: tournament.actual_players * tournament.starting_stack,
      });
    }

    await logActivity('Torneio Alterado', 'tournament', `ID: ${tournament._id} | Nome: ${tournament.name}`, req.user);
    res.json({ message: 'Torneio atualizado', tournament });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Relógio do torneio (P1) ─────────────────────────────────────────────────
router.post('/tournaments/:id/clock', verifyToken, requirePageAccess('torneios'), async (req, res) => {
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

// ─── Modelos de Stack ────────────────────────────────────────────────────────
const STACK_FIELDS = ['name', 'composition', 'total_value', 'notes'];

router.get('/stacks', verifyToken, async (req, res) => {
  try {
    const stacks = await StackModel.find().populate('composition.chip_id');
    res.json(stacks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/stacks', verifyToken, requirePageAccess('modelos_stack'), async (req, res) => {
  try {
    const data = pick(req.body, STACK_FIELDS);
    if (!data.name) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const stack = new StackModel(data);
    await stack.save();
    res.status(201).json(stack);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/stacks/:id', verifyToken, requirePageAccess('modelos_stack'), async (req, res) => {
  try {
    const data = pick(req.body, STACK_FIELDS);
    const stack = await StackModel.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!stack) return res.status(404).json({ error: 'Modelo de stack não encontrado.' });
    res.json(stack);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/stacks/:id', verifyToken, requirePageAccess('modelos_stack'), async (req, res) => {
  try {
    await StackModel.findByIdAndDelete(req.params.id);
    res.json({ message: 'Modelo de stack excluído' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Entradas de Torneio ─────────────────────────────────────────────────────
router.get('/tournaments/:id/entries', verifyToken, async (req, res) => {
  try {
    const entries = await TournamentEntry.find({ tournament_id: req.params.id })
      .populate('stack_model_id')
      .populate('player_id', 'name document')
      .sort({ timestamp: -1 });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tournaments/:id/entries', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    const { type, stack_model_id, player_id, player_name } = req.body || {};
    if (!['buy-in', 're-entry', 'add-on'].includes(type)) {
      return res.status(400).json({ error: 'Tipo de entrada inválido.' });
    }

    const tournament = await Tournament.findById(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Torneio não encontrado.' });

    if (type === 'add-on' && !(tournament.addon_value > 0)) {
      return res.status(400).json({ error: 'Este torneio não tem add-on configurado.' });
    }
    if (player_id && !(await Player.findById(player_id))) {
      return res.status(400).json({ error: 'Jogador não encontrado.' });
    }

    const money = entryContribution(tournament, type);
    const entry = new TournamentEntry({
      tournament_id: tournament._id,
      type,
      stack_model_id: stack_model_id || undefined,
      player_id: player_id || null,
      player_name: player_name || undefined,
      ...money,
    });
    await entry.save();

    if (type === 'buy-in') {
      await Tournament.findByIdAndUpdate(tournament._id, { $inc: { actual_players: 1 } });
    }
    // re-entry: se o jogador estava eliminado, ele volta (remove a eliminação)
    if (type === 're-entry' && player_id) {
      await Elimination.deleteMany({ tournament_id: tournament._id, player_id });
    }

    await logActivity('Entrada Registrada', 'tournament', `${tournament.name} | ${type}${player_name ? ` | ${player_name}` : ''}`, req.user);
    const populated = await entry.populate('player_id', 'name document');
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/tournaments/:tid/entries/:eid', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    const entry = await TournamentEntry.findOne({ _id: req.params.eid, tournament_id: req.params.tid });
    if (!entry) return res.status(404).json({ error: 'Entrada não encontrada.' });
    await entry.deleteOne();
    if (entry.type === 'buy-in') {
      await Tournament.findByIdAndUpdate(req.params.tid, { $inc: { actual_players: -1 } });
    }
    await logActivity('Entrada Removida', 'tournament', `ID: ${req.params.eid}`, req.user);
    res.json({ message: 'Entrada removida' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/tournaments/:id/consolidated-chips', verifyToken, async (req, res) => {
  try {
    const entries = await TournamentEntry.find({ tournament_id: req.params.id }).populate({
      path: 'stack_model_id',
      populate: { path: 'composition.chip_id' }
    });

    const consolidated = {};
    entries.forEach(entry => {
      if (!entry.stack_model_id) return;
      entry.stack_model_id.composition.forEach(comp => {
        const chip = comp.chip_id;
        if (!chip) return;
        const chipId = chip._id.toString();
        if (!consolidated[chipId]) {
          consolidated[chipId] = { value: chip.value, color: chip.color, quantity: 0 };
        }
        consolidated[chipId].quantity += comp.quantity;
      });
    });
    res.json(Object.values(consolidated).sort((a, b) => a.value - b.value));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Jogadores (P2) ──────────────────────────────────────────────────────────
const PLAYER_FIELDS = ['name', 'document', 'phone', 'email', 'notes'];

router.get('/players', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    const filter = {};
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(req.query.search), 'i');
      filter.$or = [{ name: rx }, { document: rx }, { phone: rx }];
    }
    await paginate(res, Player, filter, { sort: { name: 1 }, query: req.query });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/players/:id', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    const player = await Player.findById(req.params.id);
    if (!player) return res.status(404).json({ error: 'Jogador não encontrado.' });
    const [entries, eliminations] = await Promise.all([
      TournamentEntry.find({ player_id: player._id }).populate('tournament_id', 'name date').sort({ timestamp: -1 }),
      Elimination.find({ player_id: player._id }).populate('tournament_id', 'name date'),
    ]);
    res.json({ player, entries, eliminations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/players', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    const data = pick(req.body, PLAYER_FIELDS);
    if (!data.name) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const player = await Player.create({ ...data, created_by: req.user?.name || 'Sistema' });
    await logActivity('Jogador Cadastrado', 'tournament', `Nome: ${player.name}`, req.user);
    res.status(201).json(player);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/players/:id', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    const data = pick(req.body, PLAYER_FIELDS);
    const player = await Player.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!player) return res.status(404).json({ error: 'Jogador não encontrado.' });
    res.json(player);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/players/:id', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    const player = await Player.findById(req.params.id);
    if (!player) return res.status(404).json({ error: 'Jogador não encontrado.' });
    await player.softDelete();
    res.json({ message: 'Jogador removido' });
  } catch (err) {
    res.status(400).json({ error: err.message });
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

router.post('/payout-templates', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    const data = pick(req.body, ['name', 'brackets', 'notes']);
    const errors = validateTemplate(data);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    res.status(201).json(await PayoutTemplate.create(data));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/payout-templates/:id', verifyToken, requirePageAccess('torneios'), async (req, res) => {
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

router.delete('/payout-templates/:id', verifyToken, requirePageAccess('torneios'), async (req, res) => {
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
    Elimination.find({ tournament_id: t._id }).populate('player_id', 'name').populate('eliminated_by', 'name'),
  ]);

  const s = summarize(entries, eliminations);
  const payouts = payoutTable(s.prize_pool, t.payout_template_id, s.total_entries);

  // jogadores ativos = entrou (buy-in/re-entry) e não tem eliminação
  const eliminatedIds = new Set(eliminations.map((e) => String(e.player_id?._id || e.player_id)));
  const enteredIds = new Set(
    entries.filter((e) => e.type !== 'add-on' && e.player_id).map((e) => String(e.player_id))
  );
  const remaining = [...enteredIds].filter((id) => !eliminatedIds.has(id)).length;

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
    eliminations: eliminations.sort((a, b) => a.position - b.position),
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

// Registra uma eliminação. Se sobrar só 1 jogador, finaliza o torneio e
// grava os prêmios de cada colocação.
router.post('/tournaments/:id/eliminations', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    const { player_id, eliminated_by } = req.body || {};
    const t = await Tournament.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Torneio não encontrado.' });
    if (t.status === 'finalized') return res.status(400).json({ error: 'Torneio já finalizado.' });
    if (!player_id || !(await Player.findById(player_id))) {
      return res.status(400).json({ error: 'Jogador inválido.' });
    }

    const [entries, elims] = await Promise.all([
      TournamentEntry.find({ tournament_id: t._id, type: { $in: ['buy-in', 're-entry'] } }),
      Elimination.find({ tournament_id: t._id }),
    ]);
    const enteredIds = new Set(entries.filter((e) => e.player_id).map((e) => String(e.player_id)));
    const eliminatedIds = new Set(elims.map((e) => String(e.player_id)));

    if (!enteredIds.has(String(player_id))) return res.status(400).json({ error: 'Jogador não está inscrito.' });
    if (eliminatedIds.has(String(player_id))) return res.status(400).json({ error: 'Jogador já eliminado.' });

    const remaining = [...enteredIds].filter((id) => !eliminatedIds.has(id)).length;
    const position = remaining; // 8 jogadores restando → quem sai é o 8º

    const bountyAwarded = eliminated_by ? (t.bounty_value || 0) : 0;
    await Elimination.create({
      tournament_id: t._id, player_id, position,
      eliminated_by: eliminated_by || null, bounty_awarded: bountyAwarded,
    });

    // Sobrou 1 → esse é o campeão; finaliza.
    if (remaining - 1 === 1) {
      const winnerId = [...enteredIds].find((id) => !eliminatedIds.has(id) && id !== String(player_id));
      if (winnerId) await Elimination.create({ tournament_id: t._id, player_id: winnerId, position: 1 });

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

router.delete('/tournaments/:tid/eliminations/:eid', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    const elim = await Elimination.findOne({ _id: req.params.eid, tournament_id: req.params.tid });
    if (!elim) return res.status(404).json({ error: 'Eliminação não encontrada.' });
    await elim.deleteOne();
    // desfazer a finalização se for o caso
    await Tournament.findByIdAndUpdate(req.params.tid, { status: 'running', finalized_at: null });
    await logActivity('Eliminação Desfeita', 'tournament', `ID: ${req.params.eid}`, req.user);
    res.json(await buildFinance(req.params.tid));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/tournaments/:id/results', verifyToken, async (req, res) => {
  try {
    const eliminations = await Elimination.find({ tournament_id: req.params.id })
      .populate('player_id', 'name document')
      .populate('eliminated_by', 'name')
      .sort({ position: 1 });

    // bounties ganhos por jogador
    const bountyByPlayer = {};
    eliminations.forEach((e) => {
      if (e.eliminated_by) {
        const k = String(e.eliminated_by._id);
        bountyByPlayer[k] = (bountyByPlayer[k] || 0) + (e.bounty_awarded || 0);
      }
    });

    res.json(eliminations.map((e) => ({
      position: e.position,
      player: e.player_id,
      prize: e.prize_awarded || 0,
      bounty_won: bountyByPlayer[String(e.player_id?._id)] || 0,
      eliminated_by: e.eliminated_by || null,
      at: e.at,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Chip Race / Color Up ────────────────────────────────────────────────────
function computeRace(fromChipModel, toChipModel, num_players, chips_per_player) {
  const from_quantity = Number(num_players) * Number(chips_per_player);
  const total_value = from_quantity * fromChipModel.value;
  const to_quantity = toChipModel.value ? total_value / toChipModel.value : 0;
  return { from_quantity, total_value, to_quantity };
}

router.get('/chip-races', verifyToken, async (req, res) => {
  try {
    await paginate(res, ChipRace, {}, {
      populate: ['tournament_id', 'from_chip', 'to_chip'],
      sort: { createdAt: -1 },
      query: req.query,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/chip-races', verifyToken, requirePageAccess('chip_race'), async (req, res) => {
  try {
    const { tournament_id, type, active_tables, num_players, chips_per_player, from_chip, to_chip } = req.body || {};

    const fromChipModel = await ChipModel.findById(from_chip);
    const toChipModel = await ChipModel.findById(to_chip);
    if (!fromChipModel || !toChipModel) return res.status(400).json({ error: 'Modelos de ficha inválidos.' });

    const { from_quantity, total_value, to_quantity } = computeRace(fromChipModel, toChipModel, num_players, chips_per_player);

    const race = new ChipRace({
      tournament_id, type, active_tables,
      num_players, chips_per_player,
      from_chip, from_quantity, to_chip, to_quantity, total_value,
    });
    await race.save();

    req.app.get('io').emit('chipRaceUpdated', race);
    await logActivity('Cálculo de Chip Race Salvo', 'chip_race', `Torneio: ${tournament_id}`, req.user);
    res.status(201).json(race);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/chip-races/:id', verifyToken, requirePageAccess('chip_race'), async (req, res) => {
  try {
    const { tournament_id, type, active_tables, num_players, chips_per_player, from_chip, to_chip } = req.body || {};

    const fromChipModel = await ChipModel.findById(from_chip);
    const toChipModel = await ChipModel.findById(to_chip);
    if (!fromChipModel || !toChipModel) return res.status(400).json({ error: 'Modelos de ficha inválidos.' });

    const { from_quantity, total_value, to_quantity } = computeRace(fromChipModel, toChipModel, num_players, chips_per_player);

    const race = await ChipRace.findByIdAndUpdate(req.params.id, {
      tournament_id, type, active_tables,
      num_players, chips_per_player,
      from_chip, from_quantity, to_chip, to_quantity, total_value,
    }, { new: true });
    if (!race) return res.status(404).json({ error: 'Registro não encontrado.' });

    await logActivity('Cálculo de Chip Race Editado', 'chip_race', `ID: ${race._id}`, req.user);
    res.json(race);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/chip-races/:id', verifyToken, requirePageAccess('chip_race'), async (req, res) => {
  try {
    await ChipRace.findByIdAndDelete(req.params.id);
    await logActivity('Cálculo de Chip Race Excluído', 'chip_race', `ID: ${req.params.id}`, req.user);
    res.json({ message: 'Registro excluído' });
  } catch (err) {
    res.status(400).json({ error: err.message });
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
    const totalChipRaces = await ChipRace.countDocuments();

    const chipDistribution = await ChipModel.find({}, 'value total_quantity color');

    const racesByTournament = await ChipRace.aggregate([
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

    res.json({
      stats: {
        totalTournaments,
        finishedTournaments,
        totalChipRaces,
        totalChips: chipDistribution.reduce((acc, c) => acc + c.total_quantity, 0),
      },
      charts: {
        chipDistribution: chipDistribution.map(c => ({ name: `Ficha ${c.value}`, value: c.total_quantity, color: c.color })),
        racesByTournament,
      },
      logs,
      pagination: { total: totalLogs, page, pages: Math.ceil(totalLogs / limit) },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Chat ────────────────────────────────────────────────────────────────────
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
