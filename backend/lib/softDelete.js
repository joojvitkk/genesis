/**
 * Plugin de soft-delete para Mongoose.
 * - adiciona o campo `deleted_at` (Date | null)
 * - toda query find* passa a filtrar `deleted_at: null` automaticamente
 * - para incluir removidos: Model.find(...).setOptions({ withDeleted: true })
 * - `doc.softDelete()` e `Model.softDeleteById(id)` marcam sem apagar
 */
module.exports = function softDeletePlugin(schema) {
  schema.add({ deleted_at: { type: Date, default: null } });
  schema.index({ deleted_at: 1 });

  const applyFilter = function () {
    if (this.getOptions().withDeleted) return;
    const q = this.getQuery();
    if (q.deleted_at === undefined) this.where({ deleted_at: null });
  };

  ['find', 'findOne', 'findOneAndUpdate', 'count', 'countDocuments', 'updateMany', 'updateOne']
    .forEach((op) => schema.pre(op, applyFilter));

  schema.methods.softDelete = function () {
    this.deleted_at = new Date();
    return this.save();
  };

  schema.statics.softDeleteById = function (id) {
    return this.findByIdAndUpdate(id, { deleted_at: new Date() }, { new: true });
  };
};
