const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  createFamilyPost,
  fluctuateLike,
  createComment,
  getTopFamilyPosts,
  getownposts,
  deletePost,
} = require('../controllers/familyPostController');
const { getbanner, create_banner } = require('../controllers/use_redis');
const upload = require('../middleware/upload');


// Expect multiple files under the field name 'image'
router.post('/', auth, upload.array('image'), createFamilyPost);
router.patch('/:postId/fluctuate-like', auth, fluctuateLike);
router.post('/:postId/comments', auth, createComment);
router.delete('/:postId', auth, deletePost);
router.get('/family/:familyKey/top', auth, getTopFamilyPosts);
router.post('/create_banner',create_banner)
router.post('/getbanner',getbanner)
router.get('/getownposts',auth,getownposts)
module.exports = router;
