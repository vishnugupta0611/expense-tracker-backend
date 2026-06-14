const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
  getProfile,
  updateProfile,
  getHistory,
  getJobs,
  createJob,
  updateJob,
  deleteJob,
  searchByTerm,
  searchByUrl,
  getWhatsAppStatus,
  connectWhatsApp,
  disconnectWhatsApp,
  triggerManualApply,
  uploadResume,
  deleteResume,
  generateJobOutreach,
  generateManualDraft,
  getTasks,
  createTask,
  toggleTask,
  deleteTask,
  sendJobWhatsApp,
  deepScrapeJob,
} = require('../controllers/jobController');

// All routes require authentication
router.use(auth);

// Profile routes
router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.post('/profile/manual-draft', generateManualDraft);

// Resumes management routes
router.post('/profile/resume/upload', upload.single('resume'), uploadResume);
router.delete('/profile/resume/:resumeId', deleteResume);

// Search history route
router.get('/history', getHistory);

// Exa search endpoints
router.get('/search/term', searchByTerm);
router.post('/search/url', searchByUrl);

// WhatsApp Web state
router.get('/whatsapp/status', getWhatsAppStatus);
router.post('/whatsapp/connect', connectWhatsApp);
router.post('/whatsapp/disconnect', disconnectWhatsApp);

// Manual apply trigger
router.post('/trigger-apply', triggerManualApply);

// Single-job AI outreach generation
router.post('/:id/generate', generateJobOutreach);
router.post('/:id/send-whatsapp', sendJobWhatsApp);
router.post('/:id/deep-scrape', deepScrapeJob);

// Automated scheduler tasks
router.get('/tasks', getTasks);
router.post('/tasks', createTask);
router.patch('/tasks/:id', toggleTask);
router.delete('/tasks/:id', deleteTask);

// Jobs CRUD
router.get('/', getJobs);
router.post('/', createJob);
router.put('/:id', updateJob);
router.delete('/:id', deleteJob);

module.exports = router;
