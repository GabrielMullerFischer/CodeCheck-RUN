const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_DB_URI);
    } catch (error) {
        console.error('❌ Erro MongoDB:', error.message);
        process.exit(1);
    }
};

module.exports = { connectDB };