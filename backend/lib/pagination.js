const { toInt } = require('../utils/sanitize');

// Teto rígido para qualquer listagem, mesmo sem ?page — evita respostas ilimitadas.
const HARD_CAP = 500;
const DEFAULT_LIMIT = 50;

/**
 * Lê page/limit da query.
 * @returns {{ page: number, limit: number, skip: number, paginated: boolean }}
 * `paginated` é true quando o cliente pediu ?page ou ?limit explicitamente.
 */
function readPageParams(query = {}) {
  const paginated = query.page !== undefined || query.limit !== undefined;
  const page = toInt(query.page, { min: 1, fallback: 1 });
  const limit = toInt(query.limit, { min: 1, max: HARD_CAP, fallback: paginated ? DEFAULT_LIMIT : HARD_CAP });
  return { page, limit, skip: (page - 1) * limit, paginated };
}

/**
 * Executa a query paginada e responde.
 * - Sem ?page/?limit: responde um array (compatível com o frontend atual),
 *   limitado ao HARD_CAP, com headers X-Total-Count / X-Total-Pages.
 * - Com ?page/?limit: responde { data, pagination }.
 */
async function paginate(res, model, filter, { sort, populate, select, query } = {}) {
  const { page, limit, skip, paginated } = readPageParams(query);

  let q = model.find(filter);
  if (sort) q = q.sort(sort);
  if (select) q = q.select(select);
  if (populate) [].concat(populate).forEach((p) => { q = q.populate(p); });
  q = q.skip(skip).limit(limit);

  const [data, total] = await Promise.all([q.exec(), model.countDocuments(filter)]);
  const pages = Math.max(1, Math.ceil(total / limit));

  res.set('X-Total-Count', String(total));
  res.set('X-Total-Pages', String(pages));

  if (paginated) return res.json({ data, pagination: { total, page, pages, limit } });
  return res.json(data);
}

module.exports = { readPageParams, paginate, HARD_CAP, DEFAULT_LIMIT };
