const { ActivityLog } = require('../models');
const logger = require('../lib/logger');

/**
 * Registra uma atividade no sistema.
 * @param {string} action
 * @param {string} category  inventory | tournament | chip_race | chip_case | system
 * @param {string} details
 * @param {object} user      req.user (decodificado do JWT)
 * @param {Array}  [changes] [{ field, from, to }] — diff opcional (P5)
 */
const logActivity = async (action, category, details, user, changes) => {
  if (process.env.NODE_ENV !== 'production' && process.env.DEBUG_ACTIVITY) {
    logger.debug({ user }, '[ActivityLog] user payload');
  }

  const userName  = user?.name || user?.username || user?.email?.split('@')[0] || 'Sistema';
  const userEmail = user?.email || '';
  const userId    = user?.id || user?._id || null;

  try {
    await ActivityLog.create({
      action,
      category,
      details: typeof details === 'object' ? JSON.stringify(details) : details,
      user_name: userName,
      user_email: userEmail,
      related_id: userId,
      changes: Array.isArray(changes) && changes.length ? changes : undefined,
    });
  } catch (error) {
    logger.error({ err: error }, 'Falha ao registrar ActivityLog');
  }
};

/** Diff de campos entre dois objetos (só os que mudaram). */
function diffFields(before = {}, after = {}, fields = []) {
  const out = [];
  for (const f of fields) {
    const a = before?.[f];
    const b = after?.[f];
    const norm = (v) => (v && typeof v === 'object' && v.toString ? v.toString() : v);
    if (JSON.stringify(norm(a)) !== JSON.stringify(norm(b)) && b !== undefined) {
      out.push({ field: f, from: norm(a) ?? null, to: norm(b) ?? null });
    }
  }
  return out;
}

module.exports = logActivity;
module.exports.diffFields = diffFields;
