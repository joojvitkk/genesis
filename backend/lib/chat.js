// Regras do chat compartilhadas entre as rotas HTTP e o socket.
// Reações (o front desenha um ícone para cada chave); cada usuário tem no máximo UMA por mensagem.
const REACTION_KINDS = ['like', 'love', 'funny', 'surprise', 'thanks', 'done'];

// Quem enviou a mensagem e o administrador podem ver quem a visualizou; para os demais o rastro de leitura é removido.
function publicMessage(msg, user) {
  const o = typeof msg.toObject === 'function' ? msg.toObject() : { ...msg };
  const privileged = user && (user.role === 'admin' || user.email === o.sender_email);
  o.read_count = privileged ? (o.read_by || []).length : undefined;
  delete o.read_by;
  return o;
}

module.exports = { REACTION_KINDS, publicMessage };
