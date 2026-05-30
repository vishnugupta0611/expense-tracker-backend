const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  createFamilyPost,
  fluctuateLike,
  createComment,
  getTopFamilyPosts,
} = require('../controllers/familyPostController');

router.post('/', auth, createFamilyPost);
router.patch('/:postId/fluctuate-like', auth, fluctuateLike);
router.post('/:postId/comments', auth, createComment);
router.get('/family/:familyKey/top', auth, getTopFamilyPosts);

module.exports = router;
