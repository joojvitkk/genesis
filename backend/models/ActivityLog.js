const mongoose = require('mongoose');

const ActivityLogSchema = new mongoose.Schema({
  action: { type: String, required: true },
  category: { type: String, enum: ['inventory', 'tournament', 'chip_race', 'chip_case', 'system'], required: true },
  details: { type: String },
  user_name: { type: String },
  user_email: { type: String },
  related_id: { type: String },
  changes: [{ field: String, from: mongoose.Schema.Types.Mixed, to: mongoose.Schema.Types.Mixed }], // P5 — diff
}, { timestamps: true });

ActivityLogSchema.index({ category: 1, createdAt: -1 });
ActivityLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ActivityLog', ActivityLogSchema);
