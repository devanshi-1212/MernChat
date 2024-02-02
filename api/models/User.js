const mongoose = require('mongoose');

//define schema for user
const UserSchema = new mongoose.Schema({
    username: {type: String, unique: true},
    password: String,
}, {timestamps: true});

//define model with model name as 'User' (1st param)
const UserModel = mongoose.model('User', UserSchema);
module.exports = UserModel;