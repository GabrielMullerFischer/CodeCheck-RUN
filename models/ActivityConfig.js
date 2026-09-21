const mongoose = require('mongoose');

const ActivityConfigSchema = new mongoose.Schema({
    activityId: { type: String, required: true, unique: true },
    listId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExerciseList' },
    isEvaluative: { type: Boolean, default: false },
    maxAttempts: { type: Number, default: 3 },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ActivityConfig', ActivityConfigSchema);