const { Redis } = require("@upstash/redis");
require("dotenv").config();
let UPSTASH_REDIS_REST_URL="https://upright-grackle-141031.upstash.io"
let UPSTASH_REDIS_REST_TOKEN="gQAAAAAAAibnAAIgcDJiMmQzYmIwMDc0YTc0YTUzODE1ZTYxOGJlMjlhYzFiYg"
const redis = new Redis({
  url: UPSTASH_REDIS_REST_URL,
  token: UPSTASH_REDIS_REST_TOKEN,
});

module.exports = redis;