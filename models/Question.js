const mongoose = require('mongoose');

const TestSchema = new mongoose.Schema({
    input: { type: String, required: true },
    output: { type: String, required: true },
    isPublic: { type: Boolean, default: true }
});

const QuestionSchema = new mongoose.Schema({
    activityId: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    professorId: { type: String },
    tests: [TestSchema],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Question', QuestionSchema);