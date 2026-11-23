// Idempotência dos lançamentos do Salão (item 13). Uso: `router.post(url, verifyToken, idempotent, handler)`.
// Sem chave informada, o lançamento segue como antes. Com chave:
//   • 1ª vez: registra a chave como "pending", executa e guarda a resposta de sucesso (2xx);
//   • reenvio já concluído: devolve a MESMA resposta (cabeçalho `Idempotent-Replay: true`), sem repetir nada;
//   • reenvio enquanto o 1º ainda roda: 409 (o cliente tenta de novo em instantes);
//   • falha (4xx/5xx): a chave é liberada, para o cliente poder repetir depois de corrigir.
const { IdempotencyKey } = require('../models');

const KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

async function idempotent(req, res, next) {
  const raw = req.get('Idempotency-Key') || req.body?.client_op_id;
  if (raw === undefined || raw === null || raw === '') return next();
  const key = String(raw);
  if (!KEY_RE.test(key)) return res.status(400).json({ error: 'Idempotency-Key inválida (8 a 128 caracteres: letras, números, . _ : -).' });
  const user_id = String(req.user?.id || req.user?._id || 'anon');
  try {
    await IdempotencyKey.create({ user_id, key, method: req.method, path: req.originalUrl.split('?')[0] });
  } catch (e) {
    if (e.code !== 11000) return next(e);
    const prev = await IdempotencyKey.findOne({ user_id, key }).lean();
    if (prev && (prev.method !== req.method || prev.path !== req.originalUrl.split('?')[0])) {
      return res.status(422).json({ error: 'Esta Idempotency-Key já foi usada em outra operação.' });
    }
    if (prev?.state === 'done') return res.set('Idempotent-Replay', 'true').status(prev.status).json(prev.body);
    return res.status(409).json({ error: 'Este lançamento ainda está sendo processado. Aguarde um instante.' });
  }

  const send = res.json.bind(res);
  res.json = (body) => {
    const ok = res.statusCode >= 200 && res.statusCode < 300;
    const done = ok
      ? IdempotencyKey.updateOne({ user_id, key }, { state: 'done', status: res.statusCode, body })
      : IdempotencyKey.deleteOne({ user_id, key });
    // grava ANTES de responder: o reenvio imediato já encontra o resultado
    done.then(() => send(body), () => send(body));
    return res;
  };
  return next();
}

module.exports = { idempotent };
