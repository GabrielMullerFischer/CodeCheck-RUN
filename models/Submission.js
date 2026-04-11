const mongoose = require('mongoose');

const SubmissionSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    userName: { type: String },
    activityId: { type: String, required: true },
    codePath: { type: String, required: true },
    status: { 
        type: String, 
        enum: ['Accepted', 'Wrong Answer', 'Compilation Error', 'Runtime Error', 'Pending'],
        default: 'Pending'
    },
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