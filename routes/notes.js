const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Note = require('../models/Note');
const https = require('https');
const crypto = require('crypto');

// Signed upload to Cloudinary using API key + secret (no upload preset needed)
const uploadToCloudinary = (base64Data, mimeType) => {
  return new Promise((resolve, reject) => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = 'spendly_notes';

    // Build signature: sign "folder=...&timestamp=..." with secret
    const sigStr = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash('sha1').update(sigStr).digest('hex');

    const dataUri = `data:${mimeType};base64,${base64Data}`;
    const body = JSON.stringify({
      file: dataUri,
      api_key: apiKey,
      timestamp,
      signature,
      folder,
    });

    const options = {
      hostname: 'api.cloudinary.com',
      path: `/v1_1/${cloudName}/image/upload`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.secure_url) resolve(parsed.secure_url);
          else reject(new Error(parsed.error?.message || 'Upload failed'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
};

// GET /api/notes/public/:id — read-only, no auth required
router.get('/public/:id', async (req, res) => {
  try {
    const note = await Note.findById(req.params.id).select('title blocks updatedAt');
    if (!note) return res.status(404).json({ error: 'Note not found' });
    res.json({ note });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch note' });
  }
});

// GET /api/notes — list all notes (title + id + updatedAt)
router.get('/', auth, async (req, res) => {
  try {
    const notes = await Note.find({ userId: req.userId })
      .select('title updatedAt createdAt')
      .sort({ updatedAt: -1 });
    res.json({ notes });
  } catch (e) {
    console.error('Get notes error:', e.message);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// GET /api/notes/:id — full note
router.get('/:id', auth, async (req, res) => {
  try {
    const note = await Note.findOne({ _id: req.params.id, userId: req.userId });
    if (!note) return res.status(404).json({ error: 'Note not found' });
    res.json({ note });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch note' });
  }
});

// POST /api/notes — create
router.post('/', auth, async (req, res) => {
  try {
    const note = await Note.create({
      userId: req.userId,
      title: 'Untitled',
      blocks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    res.status(201).json({ note });
  } catch (e) {
    console.error('Create note error:', e.message, e.errors);
    res.status(500).json({ error: 'Failed to create note', detail: e.message });
  }
});

// PUT /api/notes/:id — save blocks + title
router.put('/:id', auth, async (req, res) => {
  try {
    const { title, blocks } = req.body;
    const note = await Note.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { title, blocks, updatedAt: new Date() },
      { new: true }
    );
    if (!note) return res.status(404).json({ error: 'Note not found' });
    res.json({ note });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save note' });
  }
});

// DELETE /api/notes/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    await Note.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// POST /api/notes/upload-image — upload image to Cloudinary
router.post('/upload-image', auth, async (req, res) => {
  try {
    const { base64, mimeType } = req.body;
    if (!base64 || !mimeType) return res.status(400).json({ error: 'base64 and mimeType required' });
    const url = await uploadToCloudinary(base64, mimeType);
    res.json({ url });
  } catch (e) {
    console.error('Cloudinary upload error:', e);
    res.status(500).json({ error: 'Image upload failed' });
  }
});

module.exports = router;
