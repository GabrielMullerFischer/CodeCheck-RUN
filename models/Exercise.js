const mongoose = require('mongoose');

const ExerciseSchema = new mongoose.Schema({
    title: { 
        type: String, 
        required: true, 
        trim: true 
    },
    description: { 
        type: String, 
        required: true 
    },
    tests: [{
        input: { type: String, default: '' },
        output: { type: String, required: true }
    }],
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

module.exports = mongoose.model('Exercise', ExerciseSchema);