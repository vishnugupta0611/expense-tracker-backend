const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  createFamilyPost,
  fluctuateLike,
  createComment,
  getTopFamilyPosts,
} = require('../controllers/familyPostController');
const { getbanner, create_banner } = require('../controllers/use_redis');


router.post('/', auth, createFamilyPost);
router.patch('/:postId/fluctuate-like', auth, fluctuateLike);
router.post('/:postId/comments', auth, createComment);
router.get('/family/:familyKey/top', auth, getTopFamilyPosts);
router.post('/create_banner',create_banner)
router.post('/getbanner',getbanner)
module.exports = router;
