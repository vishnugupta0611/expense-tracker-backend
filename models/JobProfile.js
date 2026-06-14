const mongoose = require('mongoose');

const jobProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  userName: {
    type: String,
  },
  userEmail: {
    type: String,
  },
  userPhone: {
    type: String,
  },
  targetRoles: [{
    type: String,
  }],
  experienceLevel: {
    type: String,
    enum: ['fresher', 'experienced'],
    default: 'fresher',
  },
  targetLocation: {
    type: String,
  },
  resumeText: {
    type: String,
  },
  resumes: [{
    name: { type: String, required: true },
    summary: { type: String, required: true },
    skills: [{ type: String }],
  }],
  exaApiKey: {
    type: String,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('JobProfile', jobProfileSchema);
