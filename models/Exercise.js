const mongoose = require('mongoose');

const ExerciseSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    authorId: { type: String, default: 'sistema' },
    authorName: { type: String, default: 'Professor' },
    isPublic: { type: Boolean, default: true },
    timeLimit: { type: Number, default: 1000 },
    tests: [{
        input: { type: String, required: true },
        output: { type: String, required: true }
    }],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Exercise', ExerciseSchema);