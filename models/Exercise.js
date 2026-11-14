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
    tests: [{
        input: { type: String, default: '' },
        output: { type: String, default: '' },
        isVisible: { type: Boolean, default: false }
    }],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Exercise', ExerciseSchema);