const express = require("express");
const router = express.Router();
const multer = require("multer");

const storage = multer.memoryStorage();

const upload = multer({
  storage,
});


const TOKEN = "8673342759:AAE-VebOggMbJKyKULfuKZ_guFEw1saPgXk";

const { TelegramBot } = require("node-telegram-bot-api");

const bot = new TelegramBot(TOKEN, { polling: true });

console.log("Bot Started...");

bot.on("channel_post", (msg) => {
    console.log(msg);
});

bot.sendMessage(-1004372616004, "🚀 Telegram Cloud Connected fk");



const fs = require("fs");

const path = require("path");



router.post("/upload", upload.array("files"), async (req, res) => {
  try {
     console.log("Files received:", req.files);    
    const results = await Promise.all(
      req.files.map(async (file) => {

        const msg = await bot.sendPhoto(
          -1004372616004,
          file.buffer
        );

        // Highest resolution photo
        const photo = msg.photo[msg.photo.length - 1];

        // Get file_path
        const telegramFile = await bot.getFile(photo.file_id);

        return {
          messageId: msg.message_id,
          fileId: photo.file_id,
          uniqueFileId: photo.file_unique_id,
          fileName: file.originalname,
          mimeType: file.mimetype,
          fileSize: photo.file_size,
          filePath: telegramFile.file_path,
          url: `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${telegramFile.file_path}`,
          date: msg.date
        };
      })
    );

    const filePath = path.join(__dirname, "telegram-files.json");

    let existing = [];

    if (fs.existsSync(filePath)) {
      existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
    }

    existing.push(...results);

    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
console.log(results)
    res.json(results);

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

async function test(){
const file = await bot.getFile(
  "AgACAgUAAyEGAAMBBKDTRAADTGpBYBX753_eyasBmHQRyAZqflykAAJfEWsb1s8IVpStFmGm2IgaAQADAgADeQADPAQ"
);

console.log("hello")
console.log(file);

}
test()

module.exports = router;


module.exports = router;    