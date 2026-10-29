// Redis / Banner feature temporarily disabled
// Uncomment when Upstash Redis is back online

// const redis = require("../config/redis");
// const Banner = require("../models/Banner");

// async function testRedis() {
//   await redis.set("name", "Vishnu");
//   const value = await redis.get("name");
//   console.log(value);
//   let latest_joke = await redis.get("latest_joke");
//   console.log("Latest Joke:", latest_joke);
//   await redis.del("name");
//   await redis.del("latest_joke");
// }
// testRedis();

// const getbanner = async (req, res) => {
//   try {
//     const { familyKey } = req.body;
//     const banner_in_redis = await redis.get(`family:${familyKey}:banner`);
//     if (banner_in_redis) {
//       return res.json({ banner: banner_in_redis, source: "redis" });
//     }
//     const banner = await Banner.findOne({ familyKey }).sort({ createdAt: -1 });
//     if (!banner) {
//       return res.status(404).json({ error: "No banner found for this family" });
//     }
//     await redis.set(`family:${familyKey}:banner`, JSON.stringify(banner));
//     return res.status(200).json({ banner, source: "mongodb" });
//   } catch (error) {
//     res.status(500).json({ error: "Failed to get banner" });
//   }
// };

// const create_banner = async (req, res) => {
//   try {
//     const { familyKey, imageUrl, text } = req.body;
//     if (!familyKey || !imageUrl || !text) {
//       return res.status(400).json({ error: "Family key, image URL and text are required" });
//     }
//     const banner = new Banner({ familyKey, imageUrl, text });
//     await banner.save();
//     res.status(201).json({ banner, message: "Banner created successfully" });
//   } catch (error) {
//     res.status(500).json({ error: "Failed to create banner" });
//   }
// };

// module.exports = { create_banner, getbanner };

// module.exports = {};
