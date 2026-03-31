const express = require('express');
const router  = express.Router();
const https   = require('https');
const auth    = require('../middleware/auth');
const Word    = require('../models/Word');

// ── Gemini helper ─────────────────────────────────────────────────────────────
const gemini = (prompt) => new Promise((resolve, reject) => {
  const key  = process.env.GEMINI_API_KEY;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 512 },
  });

  const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', c => { data += c; });
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) resolve(text);
        else reject(new Error(parsed.error?.message || 'No response from Gemini'));
      } catch (e) { reject(e); }
    });
  });
  req.on('error', reject);
  req.write(body);
  req.end();
});

// POST /api/words/define — get definition for a word (used in add form)
router.post('/define', auth, async (req, res) => {
  try {
    const { word } = req.body;
    if (!word?.trim()) return res.status(400).json({ error: 'word required' });

    const prompt = `For the English word "${word.trim()}", respond in exactly this format and nothing else:
<Hindi word> : <one clear English definition sentence>

Example for "bad": bura : having qualities that are unpleasant, harmful, or below an acceptable standard.`;

    const raw = await gemini(prompt);
    res.json({ definition: raw.trim() });
  } catch (e) {
    console.error('Define error:', e.message);
    res.status(500).json({ error: 'AI request failed', detail: e.message });
  }
});

// GET /api/words — list all words for user
router.get('/', auth, async (req, res) => {
  try {
    const words = await Word.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json({ words });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch words' });
  }
});

// POST /api/words — add word
router.post('/', auth, async (req, res) => {
  try {
    const { word, definition } = req.body;
    if (!word?.trim() || !definition?.trim())
      return res.status(400).json({ error: 'word and definition required' });
    const w = await Word.create({ userId: req.userId, word: word.trim(), definition: definition.trim() });
    res.status(201).json({ word: w });
  } catch (e) {
    res.status(500).json({ error: 'Failed to add word' });
  }
});

// DELETE /api/words/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    await Word.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete word' });
  }
});

// POST /api/words/:id/ai — get Hindi meaning + 5 sentences from Gemini
router.post('/:id/ai', auth, async (req, res) => {
  try {
    const w = await Word.findOne({ _id: req.params.id, userId: req.userId });
    if (!w) return res.status(404).json({ error: 'Word not found' });

    const prompt = `You are a vocabulary assistant. For the English word "${w.word}" (definition: "${w.definition}"), respond ONLY in this exact JSON format with no extra text:
{
  "hindi": "<Hindi meaning in 1-3 words>",
  "sentences": [
    { "level": "easy",   "text": "<simple sentence>" },
    { "level": "easy",   "text": "<simple sentence>" },
    { "level": "medium", "text": "<moderate sentence>" },
    { "level": "medium", "text": "<moderate sentence>" },
    { "level": "hard",   "text": "<complex sentence>" }
  ]
}`;

    const raw = await gemini(prompt);
    // Extract JSON from response (Gemini sometimes wraps in markdown)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Invalid AI response' });
    const result = JSON.parse(jsonMatch[0]);
    res.json(result);
  } catch (e) {
    console.error('AI error:', e.message);
    res.status(500).json({ error: 'AI request failed', detail: e.message });
  }
});

module.exports = router;
