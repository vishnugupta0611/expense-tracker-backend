const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const DriveItem = require('../models/DriveItem');
const User = require('../models/User');
const https = require('https');
const crypto = require('crypto');

// ── Cloudinary upload (any resource type) ────────────────────────────────────
const uploadToCloudinary = (base64Data, mimeType, folder) => {
  return new Promise((resolve, reject) => {
    const cloudName  = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey     = process.env.CLOUDINARY_API_KEY;
    const apiSecret  = process.env.CLOUDINARY_API_SECRET;
    const timestamp  = Math.floor(Date.now() / 1000);

    let resourceType = 'raw';
    if (mimeType.startsWith('image/')) resourceType = 'image';
    else if (mimeType.startsWith('video/')) resourceType = 'video';

    // Signature: sorted params alphabetically, appended with secret
    const sigStr = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash('sha1').update(sigStr).digest('hex');

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
      path: `/v1_1/${cloudName}/${resourceType}/upload`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': bodyLen,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const p = JSON.parse(data);
          console.log('Cloudinary drive upload status:', res.statusCode);
          if (p.secure_url) resolve({ url: p.secure_url, publicId: p.public_id, size: p.bytes || 0 });
          else {
            console.error('Cloudinary drive error:', JSON.stringify(p));
            reject(new Error(p.error?.message || 'Upload failed'));
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body, 'utf8');
    req.end();
  });
};

// Helper: check access (owner or member)
const hasAccess = (item, userId) => {
  const uid = userId.toString();
  return item.ownerId.toString() === uid ||
    item.members.some(m => m.toString() === uid);
};

// GET /api/drive/upload-signature — signed params for direct browser upload
router.get('/upload-signature', auth, (req, res) => {
  try {
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const apiKey    = process.env.CLOUDINARY_API_KEY;
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const timestamp = Math.floor(Date.now() / 1000);
    const folder    = `spendly_drive/${req.userId}`;

    const sigStr    = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash('sha1').update(sigStr).digest('hex');

    res.json({ timestamp, signature, apiKey, cloudName, folder });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate signature' });
  }
});

// ── GET /api/drive?parentId=xxx  list items in a folder (or root) ─────────────
// For the owner: show items in that folder
// For members: shared items always appear at root (parentId=null view)
router.get('/', auth, async (req, res) => {
  try {
    const { parentId = null } = req.query;
    const uid = req.userId;

    let query;
    if (!parentId) {
      // Root view: own root items + items shared directly with this user
      query = {
        $or: [
          { ownerId: uid, parentId: null },
          { members: uid },           // shared items appear at root for members
        ],
      };
    } else {
      // Inside a folder: only items the user can access
      query = {
        parentId,
        $or: [{ ownerId: uid }, { members: uid }],
      };
    }

    const items = await DriveItem.find(query)
      .select('-passwordHash')        // never send hash to client
      .sort({ type: -1, name: 1 });
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list items' });
  }
});

// ── GET /api/drive/breadcrumb?id=xxx  get ancestor chain ─────────────────────
router.get('/breadcrumb', auth, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.json({ crumbs: [] });
    const crumbs = [];
    let current = await DriveItem.findById(id).select('name parentId isLocked');
    while (current) {
      crumbs.unshift({ _id: current._id, name: current.name });
      if (!current.parentId) break;
      current = await DriveItem.findById(current.parentId).select('name parentId isLocked');
    }
    res.json({ crumbs });
  } catch (e) {
    res.status(500).json({ error: 'Failed to get breadcrumb' });
  }
});

// ── POST /api/drive/folder  create folder ────────────────────────────────────
router.post('/folder', auth, async (req, res) => {
  try {
    const { name, parentId = null } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const folder = await DriveItem.create({
      ownerId: req.userId,
      members: [],
      name: name.trim(),
      type: 'folder',
      parentId: parentId || null,
    });
    res.status(201).json({ item: folder });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// ── POST /api/drive/save-file  save file metadata after direct browser upload ──
router.post('/save-file', auth, async (req, res) => {
  try {
    const { name, url, publicId, mimeType, size, parentId = null } = req.body;
    if (!name || !url) return res.status(400).json({ error: 'name and url required' });
    const item = await DriveItem.create({
      ownerId: req.userId,
      members: [],
      name,
      type: 'file',
      parentId: parentId || null,
      url,
      mimeType: mimeType || '',
      size: size || 0,
      publicId: publicId || '',
    });
    res.status(201).json({ item });
  } catch (e) {
    console.error('Save file error:', e.message);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

// ── POST /api/drive/upload  upload file (legacy — kept for compatibility) ──────
router.post('/upload', auth, async (req, res) => {
  try {
    const { base64, mimeType, name, parentId = null, size = 0 } = req.body;
    if (!base64 || !mimeType || !name) return res.status(400).json({ error: 'base64, mimeType, name required' });

    const folder = `spendly_drive/${req.userId}`;
    const { url, publicId, size: cloudSize } = await uploadToCloudinary(base64, mimeType, folder, name);

    const item = await DriveItem.create({
      ownerId: req.userId,
      members: [],
      name,
      type: 'file',
      parentId: parentId || null,
      url,
      mimeType,
      size: cloudSize || size,
      publicId,
    });
    res.status(201).json({ item });
  } catch (e) {
    console.error('Drive upload error:', e.message);
    res.status(500).json({ error: 'Upload failed', detail: e.message });
  }
});

// ── PATCH /api/drive/:id/rename ───────────────────────────────────────────────
router.patch('/:id/rename', auth, async (req, res) => {
  try {
    const { name } = req.body;
    const item = await DriveItem.findById(req.params.id);
    if (!item || !hasAccess(item, req.userId)) return res.status(404).json({ error: 'Not found' });
    item.name = name.trim();
    item.updatedAt = new Date();
    await item.save();
    res.json({ item });
  } catch (e) {
    res.status(500).json({ error: 'Rename failed' });
  }
});

// ── POST /api/drive/:id/members  add member by username ──────────────────────
router.post('/:id/members', auth, async (req, res) => {
  try {
    const { usernames } = req.body; // array of usernames
    const item = await DriveItem.findById(req.params.id);
    if (!item || item.ownerId.toString() !== req.userId.toString())
      return res.status(403).json({ error: 'Only owner can add members' });

    const emails = usernames.map(u => u.includes('@') ? u : `${u}@spendly.app`);
    const users = await User.find({ email: { $in: emails } });
    users.forEach(u => {
      if (!item.members.some(m => m.toString() === u._id.toString()))
        item.members.push(u._id);
    });
    await item.save();
    res.json({ item });
  } catch (e) {
    res.status(500).json({ error: 'Failed to add members' });
  }
});

// ── POST /api/drive/:id/lock  set/update folder password ─────────────────────
router.post('/:id/lock', auth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 1) return res.status(400).json({ error: 'Password required' });
    const item = await DriveItem.findById(req.params.id);
    if (!item || item.ownerId.toString() !== req.userId.toString())
      return res.status(403).json({ error: 'Only owner can lock' });
    if (item.type !== 'folder') return res.status(400).json({ error: 'Only folders can be locked' });
    await item.setPassword(password);
    await item.save();
    res.json({ isLocked: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to lock folder' });
  }
});

// ── POST /api/drive/:id/unlock  remove password ───────────────────────────────
router.post('/:id/unlock', auth, async (req, res) => {
  try {
    const { password } = req.body;
    const item = await DriveItem.findById(req.params.id);
    if (!item || item.ownerId.toString() !== req.userId.toString())
      return res.status(403).json({ error: 'Only owner can unlock' });
    if (!item.isLocked) return res.json({ isLocked: false });
    const ok = await item.checkPassword(password);
    if (!ok) return res.status(401).json({ error: 'Wrong password' });
    item.isLocked = false;
    item.passwordHash = '';
    await item.save();
    res.json({ isLocked: false });
  } catch (e) {
    res.status(500).json({ error: 'Failed to unlock folder' });
  }
});

// ── POST /api/drive/:id/verify  verify password to open locked folder ─────────
router.post('/:id/verify', auth, async (req, res) => {
  try {
    const { password } = req.body;
    const item = await DriveItem.findById(req.params.id);
    if (!item || !hasAccess(item, req.userId)) return res.status(404).json({ error: 'Not found' });
    if (!item.isLocked) return res.json({ ok: true });
    const ok = await item.checkPassword(password);
    if (!ok) return res.status(401).json({ error: 'Wrong password' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ── DELETE /api/drive/:id ─────────────────────────────────────────────────────
router.delete('/:id', auth, async (req, res) => {
  try {
    const item = await DriveItem.findById(req.params.id);
    if (!item || item.ownerId.toString() !== req.userId.toString())
      return res.status(403).json({ error: 'Only owner can delete' });
    // If folder, delete all children recursively
    if (item.type === 'folder') {
      await deleteRecursive(item._id);
    }
    await item.deleteOne();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

const deleteRecursive = async (parentId) => {
  const children = await DriveItem.find({ parentId });
  for (const child of children) {
    if (child.type === 'folder') await deleteRecursive(child._id);
    await child.deleteOne();
  }
};

module.exports = router;
