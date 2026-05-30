const crypto = require('crypto');
const FamilyPost = require('../models/FamilyPost');

const isUserInFamily = (user, familyKey) => user.familyKey && user.familyKey === familyKey;

const createFamilyPost = async (req, res) => {
  try {
    const { text, image, familyKey } = req.body;

    if (!text || !image || !familyKey) {
      return res.status(400).json({ error: 'Text, image and familyKey are required' });
    }

    if (!isUserInFamily(req.user, familyKey)) {
      return res.status(403).json({ error: 'You are not a member of this family' });
    }

    const post = new FamilyPost({
      text,
      image,
      familyKey,
      userId: req.userId,
    });

    await post.save();
    await post.populate('userId', 'name email avatar');

    res.status(201).json({ post });
  } catch (error) {
    console.error('Create family post error:', error);
    res.status(500).json({ error: 'Failed to create family post' });
  }
};

const fluctuateLike = async (req, res) => {
  try {
    const post = await FamilyPost.findById(req.params.postId);

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (!isUserInFamily(req.user, post.familyKey)) {
      return res.status(403).json({ error: 'You are not a member of this family' });
    }

    const likeIndex = post.likes.findIndex(like => like.userId.toString() === req.userId.toString());
    const liked = likeIndex === -1;

    if (liked) {
      post.likes.push({ userId: req.userId });
    } else {
      post.likes.splice(likeIndex, 1);
    }

    await post.save();

    res.json({
      message: liked ? 'Post liked' : 'Post unliked',
      liked,
      likesCount: post.likes.length,
      likes: post.likes,
    });
  } catch (error) {
    console.error('Fluctuate like error:', error);
    res.status(500).json({ error: 'Failed to update like' });
  }
};

const createComment = async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Comment text is required' });
    }

    const post = await FamilyPost.findById(req.params.postId);

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (!isUserInFamily(req.user, post.familyKey)) {
      return res.status(403).json({ error: 'You are not a member of this family' });
    }

    post.comments.push({
      commentId: `comment_${crypto.randomBytes(5).toString('hex')}`,
      userId: req.userId,
      text,
    });

    await post.save();
    await post.populate('comments.userId', 'name email avatar');

    res.status(201).json({
      comment: post.comments[post.comments.length - 1],
      comments: post.comments,
    });
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
};

const getTopFamilyPosts = async (req, res) => {
  try {
    const { familyKey } = req.params;

    if (!isUserInFamily(req.user, familyKey)) {
      return res.status(403).json({ error: 'You are not a member of this family' });
    }

    const posts = await FamilyPost.find({ familyKey })
      .populate('userId', 'name email avatar')
      .populate('comments.userId', 'name email avatar')
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({ posts });
  } catch (error) {
    console.error('Get family posts error:', error);
    res.status(500).json({ error: 'Failed to get family posts' });
  }
};

module.exports = {
  createFamilyPost,
  fluctuateLike,
  createComment,
  getTopFamilyPosts,
};
