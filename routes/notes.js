const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Note = require('../models/Note');
const https = require('https');
const crypto = require('crypto');

// Signed upload to Cloudinary using API key + secret
const uploadToCloudinary = (base64Data, mimeType) => {
  return new Promise((resolve, reject) => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey    = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    const timestamp = Math.floor(Date.now() / 1000);
    const folder    = 'spendly_notes';

    // Signature: alphabetically sorted params (excluding api_key, file, resource_type)
    // joined as "key=value&key=value" then appended with secret
    const sigStr = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash('sha1').update(sigStr).digest('hex');

    // Use multipart form-data style via JSON body (Cloudinary supports this)
    const payload = {
      file: `data:${mimeType};base64,${base64Data}`,
      api_key: apiKey,
      timestamp: String(timestamp),
      signature,
      folder,
    };
    const body = JSON.stringify(payload);
    const bodyLen = Buffer.byteLength(body, 'utf8');

    const options = {
      hostname: 'api.cloudinary.com',
      path: `/v1_1/${cloudName}/image/upload`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': bodyLen,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          console.log('Cloudinary response status:', res.statusCode);
          if (parsed.secure_url) resolve(parsed.secure_url);
          else {
            console.error('Cloudinary error body:', JSON.stringify(parsed));
            reject(new Error(parsed.error?.message || 'Upload failed'));
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body, 'utf8');
    req.end();
  });
};

// POST /api/notes/upload-image — upload image to Cloudinary
// MUST be before /:id routes
router.post('/upload-image', auth, async (req, res) => {
  try {
    const { base64, mimeType } = req.body;
    if (!base64 || !mimeType) return res.status(400).json({ error: 'base64 and mimeType required' });
    console.log('Upload request — mimeType:', mimeType, 'base64 length:', base64.length);
    const url = await uploadToCloudinary(base64, mimeType);
    console.log('Upload success:', url);
    res.json({ url });
  } catch (e) {
    console.error('Cloudinary upload error:', e.message);
    res.status(500).json({ error: 'Image upload failed', detail: e.message });
  }
});

// GET /api/notes/upload-signature — returns a signed params object for direct browser upload
router.get('/upload-signature', auth, (req, res) => {
  try {
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const apiKey    = process.env.CLOUDINARY_API_KEY;
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const timestamp = Math.floor(Date.now() / 1000);
    const folder    = 'spendly_notes';

    const sigStr    = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
    const signature = require('crypto').createHash('sha1').update(sigStr).digest('hex');

    res.json({ timestamp, signature, apiKey, cloudName, folder });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate signature' });
  }
});

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

module.exports = router;
