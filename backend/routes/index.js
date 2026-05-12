const express = require('express');
const router = express.Router();
const { verifyToken, requirePageAccess } = require('../middlewares/authMiddleware');
const logActivity = require('../services/activityLogger');
const { User, ChipModel, Tournament, ChipCase, ActivityLog, ChipRace, StackModel, TournamentEntry, ChatMessage } = require('../models');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Rota de Login (Pública)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Senha incorreta.' });

    const token = jwt.sign(
      { id: user._id, name: user.name, email: user.email, role: user.role }, 
      process.env.JWT_SECRET || 'secret_genesis_key',
      { expiresIn: '12h' }
    );

    res.json({ message: 'Login realizado', token, user: { name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CRUD de Usuários (Apenas Admin)
router.get('/users', verifyToken, requirePageAccess('usuarios'), async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', verifyToken, requirePageAccess('usuarios'), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const user = new User({ 
      name, 
      email, 
      password, 
      role, 
      created_by: req.user?.name || 'Admin' 
    });
    await user.save();
    await logActivity('Usuário Criado', 'system', `Nome: ${name} | Email: ${email} | Role: ${role}`, req.user);
    res.json({ message: 'Usuário criado com sucesso' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/users/:id', verifyToken, requirePageAccess('usuarios'), async (req, res) => {
  try {
    const { name, email, role, password } = req.body;
    const updates = { name, email, role };
    if (password) {
      const salt = await bcrypt.genSalt(10);
      updates.password = await bcrypt.hash(password, salt);
    }
    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true });
    await logActivity('Usuário Atualizado', 'system', `Nome: ${name} | Email: ${email}`, req.user);
    res.json({ message: 'Usuário atualizado', user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/users/:id', verifyToken, requirePageAccess('usuarios'), async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    await logActivity('Usuário Removido', 'system', `ID: ${req.params.id}`, req.user);
    res.json({ message: 'Usuário removido' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Dashboard Stats (Protegida)
router.get('/dashboard/stats', verifyToken, async (req, res) => {
  try {
    const activeTournamentsCount = await Tournament.countDocuments({ status: 'running' });
    
    const chipsAggregate = await ChipModel.aggregate([
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
      metrics: {
        activeTournamentsCount,
        totalChipsInStock,
        availableCases,
        chipRacesToday
      },
      recentTournaments,
      recentActivities
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rota de criação de usuário
router.post('/users', verifyToken, requirePageAccess('usuarios'), async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const user = new User({ username, password, role });
    await user.save();
    
    await logActivity('Usuário Criado', 'system', `Username: ${username}, Role: ${role}`, req.user);
    
    res.status(201).json({ message: 'Usuário criado com sucesso' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// CRUD de Fichas (ChipModel)
router.get('/chips', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    const chips = await ChipModel.find().sort({ value: 1 });
    res.json(chips);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/chips', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    const chip = new ChipModel(req.body);
    await chip.save();
    await logActivity('Ficha Criada', 'inventory', `Nome: ${chip.name} | Valor: ${chip.value}`, req.user);
    res.status(201).json(chip);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/chips/:id', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    const chip = await ChipModel.findByIdAndUpdate(req.params.id, req.body, { new: true });
    await logActivity('Ficha Editada', 'inventory', `ID: ${chip._id} | Novo Nome: ${chip.name}`, req.user);
    res.json(chip);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/chips/:id', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    const chip = await ChipModel.findByIdAndDelete(req.params.id);
    await logActivity('Ficha Excluída', 'inventory', `ID: ${req.params.id} | Nome: ${chip?.name}`, req.user);
    res.json({ message: 'Ficha excluída com sucesso' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// CRUD de Fichários (ChipCase)
router.get('/cases', verifyToken, requirePageAccess('ficharios'), async (req, res) => {
  try {
    const cases = await ChipCase.find().populate('chips.chip_id').sort({ createdAt: -1 });
    res.json(cases);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cases', verifyToken, requirePageAccess('ficharios'), async (req, res) => {
  try {
    const chipCase = new ChipCase(req.body);
    await chipCase.save();
    await logActivity('Fichário Criado', 'chip_case', `Nome: ${chipCase.name}`, req.user);
    res.status(201).json(chipCase);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/cases/:id', verifyToken, requirePageAccess('ficharios'), async (req, res) => {
  try {
    const chipCase = await ChipCase.findByIdAndUpdate(req.params.id, req.body, { new: true });
    await logActivity('Fichário Editado', 'chip_case', `ID: ${chipCase._id} | Nome: ${chipCase.name}`, req.user);
    res.json(chipCase);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/cases/:id', verifyToken, requirePageAccess('ficharios'), async (req, res) => {
  try {
    const chipCase = await ChipCase.findByIdAndDelete(req.params.id);
    await logActivity('Fichário Excluído', 'chip_case', `ID: ${req.params.id} | Nome: ${chipCase?.name}`, req.user);
    res.json({ message: 'Fichário excluído com sucesso' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Atualização de estoque manual
router.post('/inventory/update', verifyToken, requirePageAccess('estoque'), async (req, res) => {
  try {
    const { chip_id, quantity_change } = req.body; 
    const chip = await ChipModel.findById(chip_id);
    if (!chip) return res.status(404).json({ error: 'Ficha não encontrada' });
    
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

// CRUD de Torneios
router.get('/tournaments', verifyToken, async (req, res) => {
  try {
    const tournaments = await Tournament.find().sort({ date: -1, createdAt: -1 });
    res.json(tournaments);
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
    const tournament = new Tournament(req.body);
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

    if (tournament.allocated_cases && tournament.allocated_cases.length > 0) {
      await ChipCase.updateMany(
        { _id: { $in: tournament.allocated_cases } },
        { $set: { status: 'available', allocated_to_tournament: null, allocated_to_tournament_name: null } }
      );
    }

    await Tournament.findByIdAndDelete(req.params.id);
    await logActivity('Torneio Excluído', 'tournament', `Nome: ${tournament.name}`, req.user);
    res.json({ message: 'Torneio excluído com sucesso' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/tournaments/:id', verifyToken, requirePageAccess('torneios'), async (req, res) => {
  try {
    const io = req.app.get('io');
    const oldTournament = await Tournament.findById(req.params.id);
    if (!oldTournament) return res.status(404).json({ error: 'Torneio não encontrado' });

    if (req.body.status === 'running' && oldTournament.status !== 'running') {
      if (oldTournament.allocated_cases && oldTournament.allocated_cases.length > 0) {
        await ChipCase.updateMany(
          { _id: { $in: oldTournament.allocated_cases } },
          { $set: { status: 'allocated', allocated_to_tournament: oldTournament._id, allocated_to_tournament_name: oldTournament.name } }
        );
        io.emit('chipCasesAllocated', { tournament_id: oldTournament._id, cases: oldTournament.allocated_cases });
      }
    }

    if (req.body.status === 'finished' && oldTournament.status !== 'finished') {
      if (oldTournament.allocated_cases && oldTournament.allocated_cases.length > 0) {
        await ChipCase.updateMany(
          { _id: { $in: oldTournament.allocated_cases } },
          { $set: { status: 'available', allocated_to_tournament: null, allocated_to_tournament_name: null } }
        );
        io.emit('chipCasesReleased', { tournament_id: oldTournament._id, cases: oldTournament.allocated_cases });
      }
    }

    const tournament = await Tournament.findByIdAndUpdate(req.params.id, req.body, { new: true });

    if (tournament.actual_players && tournament.starting_stack) {
      const totalChipsInPlay = tournament.actual_players * tournament.starting_stack;
      io.emit('tournamentTrackingUpdate', {
        tournament_id: tournament._id,
        actual_players: tournament.actual_players,
        starting_stack: tournament.starting_stack,
        total_chips_in_play: totalChipsInPlay
      });
    }

    await logActivity('Torneio Alterado', 'tournament', `ID: ${tournament._id} | Nome: ${tournament.name}`, req.user);
    res.json({ message: 'Torneio atualizado', tournament });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// CRUD de Modelos de Stack
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
    const stack = new StackModel(req.body);
    await stack.save();
    res.status(201).json(stack);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/stacks/:id', verifyToken, requirePageAccess('modelos_stack'), async (req, res) => {
  try {
    const stack = await StackModel.findByIdAndUpdate(req.params.id, req.body, { new: true });
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

// Rotas de Entradas de Torneio
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
    const { type, stack_model_id } = req.body;
    const entry = new TournamentEntry({ tournament_id: req.params.id, type, stack_model_id });
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

// CRUD de Chip Race / Color Up
router.get('/chip-races', verifyToken, async (req, res) => {
  try {
    const races = await ChipRace.find()
      .populate('tournament_id')
      .populate('from_chip')
      .populate('to_chip')
      .sort({ createdAt: -1 });
    res.json(races);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/chip-races', verifyToken, requirePageAccess('chip_race'), async (req, res) => {
  try {
    const { tournament_id, type, active_tables, from_chip, from_quantity, to_chip } = req.body;
    
    const fromChipModel = await ChipModel.findById(from_chip);
    const toChipModel = await ChipModel.findById(to_chip);
    
    if (!fromChipModel || !toChipModel) {
      return res.status(400).json({ error: 'Modelos de ficha inválidos.' });
    }

    const total_value = from_quantity * fromChipModel.value;
    const to_quantity = total_value / toChipModel.value;
    
    const race = new ChipRace({
      tournament_id,
      type,
      active_tables,
      from_chip,
      from_quantity,
      to_chip,
      to_quantity,
      total_value
    });

    await race.save();
    
    const io = req.app.get('io');
    io.emit('chipRaceUpdated', race);

    await logActivity('Cálculo de Chip Race Salvo', 'chip_race', `Torneio: ${tournament_id}`, req.user);
    
    res.status(201).json(race);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Log de Auditoria do Estoque
router.get('/inventory/logs', verifyToken, requirePageAccess('relatorios'), async (req, res) => {
  try {
    const { search, type, page = 1, limit = 50 } = req.query;
    const filter = { category: 'inventory' };

    if (search) {
      filter.$or = [
        { details: { $regex: search, $options: 'i' } },
        { user_name: { $regex: search, $options: 'i' } },
        { action: { $regex: search, $options: 'i' } }
      ];
    }

    if (type && type !== 'all') {
      filter.action = { $regex: type === 'entry' ? 'Entrada' : 'Saída', $options: 'i' };
    }

    const total = await ActivityLog.countDocuments(filter);
    const logs = await ActivityLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      logs,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Relatórios e Auditoria
router.get('/reports/data', verifyToken, requirePageAccess('relatorios'), async (req, res) => {
  try {
    const totalTournaments = await Tournament.countDocuments();
    const finishedTournaments = await Tournament.countDocuments({ status: 'finished' });
    const totalChipRaces = await ChipRace.countDocuments();
    
    // Distribuição de Fichas (Pizza)
    const chipDistribution = await ChipModel.find({}, 'value total_quantity color');
    
    // Chip Races por Torneio (Torre)
    const racesByTournament = await ChipRace.aggregate([
      {
        $group: {
          _id: '$tournament_id',
          count: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'tournaments',
          localField: '_id',
          foreignField: '_id',
          as: 'tournament'
        }
      },
      { $unwind: '$tournament' },
      {
        $project: {
          name: '$tournament.name',
          count: 1
        }
      },
      { $limit: 10 }
    ]);

    // Logs de Atividade (Filtro e Paginação)
    const { category, startDate, endDate, page = 1, limit = 50 } = req.query;
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
      .limit(parseInt(limit));

    res.json({
      stats: {
        totalTournaments,
        finishedTournaments,
        totalChipRaces,
        totalChips: chipDistribution.reduce((acc, c) => acc + c.total_quantity, 0)
      },
      charts: {
        chipDistribution: chipDistribution.map(c => ({ name: `Ficha ${c.value}`, value: c.total_quantity, color: c.color })),
        racesByTournament
      },
      logs,
      pagination: {
        total: totalLogs,
        page: parseInt(page),
        pages: Math.ceil(totalLogs / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Chat Intersetorial
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
