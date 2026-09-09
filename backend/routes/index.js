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
const { User, ChipModel, Tournament, ChipCase, ActivityLog, ChipRace, StackModel, TournamentEntry, ChatMessage } = require('../models');
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
const CHIP_FIELDS = ['name', 'value', 'color', 'total_quantity', 'available_quantity'];

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
    if (!data.name || data.value === undefined || data.total_quantity === undefined) {
      return res.status(400).json({ error: 'Nome, valor e quantidade são obrigatórios.' });
    }
    data.value = Number(data.value);
    data.total_quantity = Number(data.total_quantity);
    if (!Number.isFinite(data.value) || data.value < 0 || !Number.isFinite(data.total_quantity) || data.total_quantity < 0) {
      return res.status(400).json({ error: 'Valor e quantidade devem ser números não negativos.' });
    }
    const chip = new ChipModel(data);
    await chip.save();
    await logActivity('Ficha Criada', 'inventory', `Nome: ${chip.name} | Valor: ${chip.value}`, req.user);
    res.status(201).json(chip);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/chips/:id', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    const data = pick(req.body, CHIP_FIELDS);
    if (data.value !== undefined) data.value = Number(data.value);
    if (data.total_quantity !== undefined) data.total_quantity = Number(data.total_quantity);
    const chip = await ChipModel.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!chip) return res.status(404).json({ error: 'Ficha não encontrada.' });
    await logActivity('Ficha Editada', 'inventory', `ID: ${chip._id} | Novo Nome: ${chip.name}`, req.user);
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

// ─── Movimentação de estoque ─────────────────────────────────────────────────
router.post('/inventory/update', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    const { chip_id } = req.body || {};
    const quantity_change = Number(req.body?.quantity_change);
    if (!chip_id) return res.status(400).json({ error: 'Ficha não informada.' });
    if (!Number.isFinite(quantity_change) || quantity_change === 0) {
      return res.status(400).json({ error: 'Quantidade de movimentação inválida.' });
    }

    const chip = await ChipModel.findById(chip_id);
    if (!chip) return res.status(404).json({ error: 'Ficha não encontrada' });

    if (chip.total_quantity + quantity_change < 0 || chip.available_quantity + quantity_change < 0) {
      return res.status(400).json({ error: 'Movimentação deixaria o estoque negativo.' });
    }

    chip.total_quantity += quantity_change;
    chip.available_quantity += quantity_change;
    await chip.save();

    const actionType = quantity_change > 0 ? 'Entrada de Ficha no Estoque' : 'Saída de Ficha do Estoque';
    await logActivity(actionType, 'inventory', `Ficha: ${chip.name} | Alteração: ${quantity_change}`, req.user);

    res.json({ message: 'Estoque atualizado', chip });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Torneios ────────────────────────────────────────────────────────────────
// `current_level` e os campos de relógio NÃO entram aqui — são controlados
// exclusivamente por POST /tournaments/:id/clock.
const TOURNAMENT_FIELDS = [
  'name', 'date', 'start_time', 'status', 'estimated_players', 'actual_players',
  'starting_stack', 'stack_model_id', 'blind_structure', 'allocated_cases',
  'stack_composition', 'notes',
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

    // Libera fichários alocados
    if (tournament.allocated_cases && tournament.allocated_cases.length > 0) {
      await ChipCase.updateMany(
        { _id: { $in: tournament.allocated_cases } },
        { $set: { status: 'available', allocated_to_tournament: null, allocated_to_tournament_name: null } }
      );
    }

    // Cascata: entradas somem, chip races ficam arquivadas (status cancelled)
    const [entriesRes, racesRes] = await Promise.all([
      TournamentEntry.deleteMany({ tournament_id: tournament._id }),
      ChipRace.updateMany({ tournament_id: tournament._id }, { $set: { status: 'cancelled' } }),
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

router.put('/tournaments/:id', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    const io = req.app.get('io');
    const updates = pick(req.body, TOURNAMENT_FIELDS);
    const oldTournament = await Tournament.findById(req.params.id);
    if (!oldTournament) return res.status(404).json({ error: 'Torneio não encontrado' });

    if (updates.status === 'running' && oldTournament.status !== 'running') {
      if (oldTournament.allocated_cases && oldTournament.allocated_cases.length > 0) {
        await ChipCase.updateMany(
          { _id: { $in: oldTournament.allocated_cases } },
          { $set: { status: 'allocated', allocated_to_tournament: oldTournament._id, allocated_to_tournament_name: oldTournament.name } }
        );
        io.emit('chipCasesAllocated', { tournament_id: oldTournament._id, cases: oldTournament.allocated_cases });
      }
    }

    if (updates.status === 'finished' && oldTournament.status !== 'finished') {
      if (oldTournament.allocated_cases && oldTournament.allocated_cases.length > 0) {
        await ChipCase.updateMany(
          { _id: { $in: oldTournament.allocated_cases } },
          { $set: { status: 'available', allocated_to_tournament: null, allocated_to_tournament_name: null } }
        );
        io.emit('chipCasesReleased', { tournament_id: oldTournament._id, cases: oldTournament.allocated_cases });
      }
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
      .sort({ timestamp: -1 });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tournaments/:id/entries', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    const { type, stack_model_id } = req.body || {};
    if (!['buy-in', 're-entry'].includes(type)) return res.status(400).json({ error: 'Tipo de entrada inválido.' });

    const entry = new TournamentEntry({ tournament_id: req.params.id, type, stack_model_id: stack_model_id || undefined });
    await entry.save();

    if (type === 'buy-in') {
      await Tournament.findByIdAndUpdate(req.params.id, { $inc: { actual_players: 1 } });
    }

    await logActivity('Entrada Registrada', 'tournament', `Tipo: ${type}`, req.user);
    res.status(201).json(entry);
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
