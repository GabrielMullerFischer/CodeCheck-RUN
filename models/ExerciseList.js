const mongoose = require('mongoose');

const ExerciseListSchema = new mongoose.Schema({
    title: { type: String, required: true },
    authorId: { type: String, default: 'sistema' },
    authorName: { type: String, default: 'Professor' },
    isPublic: { type: Boolean, default: true },
    exercises: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Exercise' }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ExerciseList', ExerciseListSchema);