const { ActivityLog } = require('../models');

/**
 * Registra uma atividade no sistema.
 * @param {string} action Descrição da ação
 * @param {string} category Categoria ('inventory', 'tournament', 'chip_race', 'chip_case', 'system')
 * @param {object|string} details Detalhes adicionais
 * @param {object} user Usuário que executou a ação (req.user)
 */
const logActivity = async (action, category, details, user) => {
  try {
    await ActivityLog.create({
      action,
      category,
      details: typeof details === 'object' ? JSON.stringify(details) : details,
      user_name: user?.username || 'Sistema',
      user_email: user?.email || '', 
      related_id: user?.id || null
    });
  } catch (error) {
    console.error('Falha ao registrar ActivityLog:', error);
  }
};

module.exports = logActivity;
