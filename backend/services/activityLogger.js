const { ActivityLog } = require('../models');

/**
 * Registra uma atividade no sistema.
 * @param {string} action Descrição da ação
 * @param {string} category Categoria ('inventory', 'tournament', 'chip_race', 'chip_case', 'system')
 * @param {string} details Detalhes adicionais
 * @param {object} user Usuário que executou a ação (req.user — decodificado do JWT)
 */
const logActivity = async (action, category, details, user) => {
  // Debug: log the user object to trace what's arriving
  if (process.env.NODE_ENV !== 'production') {
    console.log('[ActivityLog] user payload:', JSON.stringify(user));
  }

  // JWT payload can have: id, name, email, role (see login route)
  // Fallback chain covers legacy tokens that may have used different field names
  const userName  = user?.name || user?.username || user?.email?.split('@')[0] || 'Sistema';
  const userEmail = user?.email || '';
  const userId    = user?.id || user?._id || null;

  try {
    await ActivityLog.create({
      action,
      category,
      details: typeof details === 'object' ? JSON.stringify(details) : details,
      user_name:  userName,
      user_email: userEmail,
      related_id: userId
    });
  } catch (error) {
    console.error('Falha ao registrar ActivityLog:', error);
  }
};

module.exports = logActivity;
