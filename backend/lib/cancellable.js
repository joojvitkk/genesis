/**
 * Plugin de CANCELAMENTO (G11, spec §18.3): registros operacionais (entradas, eliminações) nunca são apagados —
 * são CANCELADOS com motivo, quem e quando. Toda consulta ignora os cancelados por padrão; para incluí-los:
 * `Model.find(...).setOptions({ withCancelled: true })`. Apagar (delete*) é bloqueado no schema.
 */
module.exports = function cancellablePlugin(schema) {
  schema.add({
    status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
    cancelled_at: { type: Date, default: null },
    cancelled_by: { type: String },
    cancel_reason: { type: String },
  });
  schema.index({ status: 1 });

  const applyFilter = function () {
    if (this.getOptions().withCancelled) return;
    const q = this.getQuery();
    if (q.status === undefined) this.where({ status: { $ne: 'cancelled' } });
  };
  ['find', 'findOne', 'findOneAndUpdate', 'count', 'countDocuments', 'updateMany', 'updateOne']
    .forEach((op) => schema.pre(op, applyFilter));

  const blocked = () => { throw new Error('Registros não são apagados: cancele com motivo.'); };
  ['deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove'].forEach((op) => schema.pre(op, blocked));
  schema.pre('deleteOne', { document: true, query: false }, blocked);

  /** Cancela o documento (exige motivo). */
  schema.methods.cancel = function ({ user, reason } = {}) {
    if (!String(reason || '').trim()) throw Object.assign(new Error('Informe o motivo do cancelamento.'), { status: 400 });
    this.status = 'cancelled';
    this.cancelled_at = new Date();
    this.cancelled_by = user?.name || user?.email || 'Sistema';
    this.cancel_reason = String(reason).trim();
    return this.save();
  };

  /** Cancela vários de uma vez (mesmo motivo). */
  schema.statics.cancelMany = function (filter, { user, reason } = {}) {
    return this.updateMany(filter, { $set: { status: 'cancelled', cancelled_at: new Date(), cancelled_by: user?.name || user?.email || 'Sistema', cancel_reason: reason } });
  };
};
