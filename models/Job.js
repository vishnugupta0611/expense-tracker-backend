const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  company: {
    type: String,
    required: true,
  },
  url: {
    type: String,
  },
  description: {
    type: String,
  },
  category: {
    type: String,
    default: 'Other',
  },
  contactNumber: {
    type: String,
  },
  contactEmail: {
    type: String,
  },
  contactNumbers: [{
    type: String,
  }],
  contactEmails: [{
    type: String,
  }],
  status: {
    type: String,
    enum: ['to-apply', 'applied', 'manual-review'],
    default: 'to-apply',
  },
  appliedAt: {
    type: Date,
  },
  notes: {
    type: String,
  },
  aiWhatsAppMsg: {
    type: String,
  },
  aiEmailSubject: {
    type: String,
  },
  aiEmailBody: {
    type: String,
  },
  appliedResumeId: {
    type: mongoose.Schema.Types.ObjectId,
  },
  appliedResumeName: {
    type: String,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Job', jobSchema);
