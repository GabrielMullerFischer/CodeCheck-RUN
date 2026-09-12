const mongoose = require('mongoose');

const SubmissionSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    userName: { type: String, default: 'Aluno' },
    activityId: { type: String, required: true },
    exerciseId: { type: String, required: true },
    codePath: { type: String, required: true },
    status: { 
        type: String, 
        enum: ['Accepted', 'Wrong Answer', 'Compilation Error', 'Runtime Error', 'Time Limit', 'Pending'],
        default: 'Pending'
    },
    isAccepted: { type: Boolean, default: false },
    executionTime: { type: Number, default: null },
    compilationDetails: { type: String },
    testResults: [{
        testIndex: Number,
        passed: Boolean,
        got: String,
        expected: String
    }],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Submission', SubmissionSchema);