const mongoose = require('mongoose');

const ActivityConfigSchema = new mongoose.Schema({
    activityId: { 
        type: String, 
        required: true, 
        unique: true 
    },
    listId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'ExerciseList' 
    },
    updatedAt: { 
        type: Date, 
        default: Date.now 
    }
});

module.exports = mongoose.model('ActivityConfig', ActivityConfigSchema);