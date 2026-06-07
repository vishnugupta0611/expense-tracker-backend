const crypto = require('crypto');
const FamilyPost = require('../models/FamilyPost');
const cloudinary = require('cloudinary').v2;
const dotenv = require('dotenv');
const admin = require('../config/firebase');
const User = require('../models/User');
dotenv.config();
const streamifier = require('streamifier');
const isUserInFamily = (user, familyKey) => user.familyKey && user.familyKey === familyKey;

const sendFCMNotification = async (fcmToken, title, body, imageUrl = null) => {
  if (!fcmToken) {
    console.warn('No FCM token provided for notification');
    return;
  }

  try {
    const message = {
      token: fcmToken,
      notification: {
        title,
        body,
      },
    };

    if (imageUrl) {
      message.webpush = {
        notification: {
          image: imageUrl,
          icon: imageUrl,
          requireInteraction: true,
        },
      };
    }

    const response = await admin.messaging().send(message);
    console.log('Notification sent:', response);
  } catch (err) {
    console.error('FCM notification error:', err.message);
  }
};

const extractPublicIdFromUrl = (url) => {
  // Extract public_id from Cloudinary URL
  // Format: https://res.cloudinary.com/<cloud>/image|video/upload/v<version>/<folder>/<public_id>.<ext>
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
  return match ? match[1] : null;
};

const deleteFromCloudinary = async (imageUrls) => {
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });

    const deletePromises = imageUrls.map((url) => {
      const publicId = extractPublicIdFromUrl(url);
      if (!publicId) return Promise.resolve();
      return cloudinary.uploader.destroy(publicId).catch((err) => {
        console.warn(`Failed to delete ${publicId} from Cloudinary:`, err.message);
      });
    });

    await Promise.all(deletePromises);
  } catch (error) {
    console.error('Cloudinary delete error:', error);
  }
};


const upload_tocloudinary = async (files) => {
  try {
    const cloudName  = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey     = process.env.CLOUDINARY_API_KEY;
    const apiSecret  = process.env.CLOUDINARY_API_SECRET; 


    cloudinary.config({ 
      cloud_name: cloudName, 
      api_key: apiKey, 
      api_secret: apiSecret,
      secure: true
    });



    const uploadOne = (file) => new Promise((resolve, reject) => {
      const folder = file.mimetype && file.mimetype.startsWith('video') ? 'family_videos' : 'family_images';
      const opts = { resource_type: 'auto', folder };
      const uploadStream = cloudinary.uploader.upload_stream(opts, (error, result) => {
        if (error) return reject(error);
        return resolve(result.secure_url || result);
      });
      streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });

    const results = await Promise.all(files.map(f => uploadOne(f)));
    return results;
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error('Failed to upload image to Cloudinary');
  }
}

const createFamilyPost = async (req, res) => {
  try {
    //accessing data through form

    //give me form style accessing data
  console.log(req.body)
    const { text, familyKey, frametype, frameType } = req.body;
    const selectedFrameType = frameType || frametype;
    const files = req.files; // multer.memoryStorage => files are in req.files (array)

    console.log('New Family Post:', { text, files: files && files.length, familyKey, frameType: selectedFrameType });

    if (!text || !files || files.length === 0 || !familyKey || !selectedFrameType) {
      return res.status(400).json({ error: 'Text, files, familyKey and frameType are required' });
    }

    const uploadedMedia = await upload_tocloudinary(files);
    console.log('Uploaded Media URLs:', uploadedMedia);

   //lwts check by sending notification to yourself using firebase admin sdk
   //i have my own fcm token
 
    // const response = await admin.messaging().send(message);

// console.log("Notification sent:", response);

    if (!isUserInFamily(req.user, familyKey)) {
      return res.status(403).json({ error: 'You are not a member of this family' });
    }

    const post = new FamilyPost({
      text,
      image: uploadedMedia,
      familyKey,
      frameType: selectedFrameType,
      userId: req.userId,
    });

    await post.save();
    await post.populate('userId', 'name email avatar');

    // Send notifications to all family members (including self for post confirmation)
    try {
      const familyMembers = await User.find({ familyKey }).select('fcmtoken _id');
      const posterToken = familyMembers.find(m => m._id.toString() === req.userId.toString())?.fcmtoken;

      // Self notification — "post posted successfully"
      if (posterToken) {
        sendFCMNotification(
          posterToken,
          '✅ Post shared!',
          'Your post was posted successfully',
          uploadedMedia[0]
        );
      }

      // Notify other family members
      familyMembers.forEach((member) => {
        if (member.fcmtoken && member._id.toString() !== req.userId.toString()) {
          sendFCMNotification(
            member.fcmtoken,
            `📸 ${post.userId.name} shared a post`,
            text || 'Shared a new family post',
            uploadedMedia[0]
          );
        }
      });
    } catch (err) {
      console.error('Failed to send post notifications:', err.message);
    }

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

    // Send notification to post creator if liked
    if (liked) {
      try {
        const postCreator = await User.findById(post.userId).select('fcmtoken name');
        const likedByUser = await User.findById(req.userId).select('name avatar');
        if (postCreator?.fcmtoken) {
          sendFCMNotification(
            postCreator.fcmtoken,
            `❤️ ${likedByUser?.name || 'Someone'} liked your post`,
            'Your post got a like!'
          );
        }
      } catch (err) {
        console.error('Failed to send like notification:', err.message);
      }
    }

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

    // Send notification to post creator
    try {
      const postCreator = await User.findById(post.userId).select('fcmtoken name');
      const commentedByUser = await User.findById(req.userId).select('name avatar');
      if (postCreator?.fcmtoken) {
        sendFCMNotification(
          postCreator.fcmtoken,
          `💬 ${commentedByUser?.name || 'Someone'} commented on your post`,
          text || 'New comment on your post'
        );
      }
    } catch (err) {
      console.error('Failed to send comment notification:', err.message);
    }

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
    const limit = Math.min(Number(req.query.limit) || 5, 20);
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    if (!isUserInFamily(req.user, familyKey)) {
      return res.status(403).json({ error: 'You are not a member of this family' });
    }

    const posts = await FamilyPost.find({ familyKey })
      .populate('userId', 'name email avatar')
      .populate('comments.userId', 'name email avatar')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit + 1);

    const hasMore = posts.length > limit;

    res.json({ posts: posts.slice(0, limit), hasMore, nextSkip: skip + Math.min(posts.length, limit) });
  } catch (error) {
    console.error('Get family posts error:', error);
    res.status(500).json({ error: 'Failed to get family posts' });
  }
};


const getownposts=async (req,res)=>{
    try {

      console.log("User ID from auth middleware:", req.user._id);

      console.log("Getting posts for user:", req.user._id);
    
      const posts=await FamilyPost.find({userId:req.user._id})
      .populate('userId', 'name email avatar')
      .populate('comments.userId', 'name email avatar')
      .sort({ createdAt: -1 });
      return res.status(200).json({posts})

    } catch (error) { 
    return res.status(500).json({ error: 'Failed to get family posts' });
    }
 

}

const deletePost = async (req, res) => {
  try {
    const { postId } = req.params;

    const post = await FamilyPost.findById(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Check if user is post owner
    if (post.userId.toString() !== req.userId.toString()) {
      return res.status(403).json({ error: 'You can only delete your own posts' });
    }

    if (!isUserInFamily(req.user, post.familyKey)) {
      return res.status(403).json({ error: 'You are not a member of this family' });
    }

    // Delete media from Cloudinary
    if (Array.isArray(post.image) && post.image.length > 0) {
      await deleteFromCloudinary(post.image);
    }

    await FamilyPost.findByIdAndDelete(postId);

    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
};

module.exports = {
  createFamilyPost,
  fluctuateLike,
  createComment,
  getTopFamilyPosts,
  getownposts,
  deletePost,
};
