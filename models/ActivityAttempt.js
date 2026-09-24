const mongoose = require('mongoose');

const ActivityAttemptSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    activityId: { type: String, required: true },
    startedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true }
}, { timestamps: true });

ActivityAttemptSchema.index({ userId: 1, activityId: 1 }, { unique: true });

module.exports = mongoose.model('ActivityAttempt', ActivityAttemptSchema);