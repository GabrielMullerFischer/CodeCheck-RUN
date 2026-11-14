const mongoose = require('mongoose');

const ExerciseSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    authorId: { type: String, default: 'sistema' },
    authorName: { type: String, default: 'Professor' },
    courseId: { type: String, default: null, index: true },
    isPublic: { type: Boolean, default: true },
    timeLimit: { type: Number, default: 5000 },
    isArchived: { type: Boolean, default: false },
    exerciseMode: {
        type: String,
        enum: ['main_default', 'main_custom', 'function'],
        default: 'main_default'
    },
    templateCode: { type: String, default: null },
    functionSignature: { type: String, default: null },
    floatPrecision: { type: Number, default: 2 },
    tests: [{
        input: { type: String, default: '' },
        output: { type: String, default: '' },
        isVisible: { type: Boolean, default: false }
    }],
    createdAt: { type: Date, default: Date.now }
});

ExerciseSchema.index({ authorId: 1, isArchived: 1 });
ExerciseSchema.index({ isPublic: 1, isArchived: 1 });
ExerciseSchema.index({ title: 1, authorId: 1, courseId: 1 });

module.exports = mongoose.model('Exercise', ExerciseSchema);