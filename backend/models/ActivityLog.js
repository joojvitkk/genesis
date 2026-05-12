const mongoose = require('mongoose');

const ActivityLogSchema = new mongoose.Schema({
  action: { type: String, required: true },
  category: { type: String, enum: ['inventory', 'tournament', 'chip_race', 'chip_case', 'system'], required: true },
  details: { type: String },
  user_name: { type: String },
  user_email: { type: String },
  related_id: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('ActivityLog', ActivityLogSchema);
