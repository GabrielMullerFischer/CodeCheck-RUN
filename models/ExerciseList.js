const mongoose = require('mongoose');

const ExerciseListSchema = new mongoose.Schema({
    title: { 
        type: String, 
        required: true, 
        trim: true 
    },
    exercises: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Exercise' 
    }],
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

module.exports = mongoose.model('ExerciseList', ExerciseListSchema);