const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 45 * 1024 * 1024 }, // 45MB max (Telegram bot upload limit is 50MB)
});

const TelegramBot = require("node-telegram-bot-api").TelegramBot || require("node-telegram-bot-api");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8673342759:AAHnr4yK7SxP_8Be8fNL_pSogjgQBJvQN4Y";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ? Number(process.env.TELEGRAM_CHAT_ID) : -1004372616004;

let bot = null;
try {
  bot = new TelegramBot(TOKEN, { polling: false });
  bot.on("error", (err) => console.error("Telegram bot error:", err.message));
} catch (e) {
  console.error("Failed to initialize TelegramBot:", e.message);
}

const filesJsonPath = path.join(__dirname, "telegram-files.json");

function getStoredFiles() {
  try {
    if (fs.existsSync(filesJsonPath)) {
      const data = fs.readFileSync(filesJsonPath, "utf8");
      return JSON.parse(data) || [];
    }
  } catch (err) {
    console.error("Error reading telegram-files.json:", err.message);
  }
  return [];
}

function saveStoredFiles(files) {
  try {
    fs.writeFileSync(filesJsonPath, JSON.stringify(files, null, 2));
  } catch (err) {
    console.error("Error writing telegram-files.json:", err.message);
  }
}

// @route   GET /api/telegram-bot/status
// @desc    Check bot connectivity & chat access
router.get("/status", async (req, res) => {
  if (!bot) {
    return res.status(500).json({ ok: false, error: "Telegram bot not initialized" });
  }
  try {
    const me = await bot.getMe();
    const chat = await bot.getChat(CHAT_ID);
    res.json({
      ok: true,
      bot: { id: me.id, username: me.username, firstName: me.first_name },
      channel: { id: chat.id, title: chat.title, inviteLink: chat.invite_link },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// @route   GET /api/telegram-bot/files
// @desc    Get all shared files history
router.get("/files", (req, res) => {
  try {
    const files = getStoredFiles();
    res.json({ success: true, files: files.reverse() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

async function sendBufferToTelegram(buffer, fileName, mimeType, caption = "") {
  let msg = null;
  const isImage = mimeType && mimeType.startsWith("image/") && !mimeType.includes("svg");

  const sendOptions = {};
  if (caption) sendOptions.caption = caption;

  const fileOptions = {
    filename: fileName || "file",
    contentType: mimeType || "application/octet-stream",
  };

  if (isImage) {
    try {
      msg = await bot.sendPhoto(CHAT_ID, buffer, sendOptions, fileOptions);
    } catch (photoErr) {
      console.warn("sendPhoto fallback to sendDocument:", photoErr.message);
    }
  }

  if (!msg) {
    msg = await bot.sendDocument(CHAT_ID, buffer, sendOptions, fileOptions);
  }

  let fileId = null;
  let fileSize = buffer.length;

  if (msg.photo && msg.photo.length > 0) {
    const highestPhoto = msg.photo[msg.photo.length - 1];
    fileId = highestPhoto.file_id;
    fileSize = highestPhoto.file_size;
  } else if (msg.document) {
    fileId = msg.document.file_id;
    fileSize = msg.document.file_size;
  } else if (msg.video) {
    fileId = msg.video.file_id;
    fileSize = msg.video.file_size;
  }

  let filePath = "";
  let url = "";

  if (fileId) {
    try {
      const telegramFile = await bot.getFile(fileId);
      filePath = telegramFile.file_path;
      url = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`;
    } catch (fileErr) {
      console.error("Could not fetch file_path from Telegram:", fileErr.message);
    }
  }

  const result = {
    messageId: msg.message_id,
    fileId,
    fileName: fileName || "file",
    mimeType: mimeType || "application/octet-stream",
    fileSize,
    filePath,
    url,
    caption: caption || undefined,
    date: msg.date || Math.floor(Date.now() / 1000),
  };

  const existing = getStoredFiles();
  existing.push(result);
  saveStoredFiles(existing);

  return result;
}

// @route   POST /api/telegram-bot/upload
// @desc    Upload files via multipart/form-data to Telegram Channel
router.post("/upload", upload.array("files"), async (req, res) => {
  if (!bot) {
    return res.status(500).json({ success: false, error: "Telegram Bot is not initialized" });
  }

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, error: "No files uploaded" });
  }

  try {
    const results = await Promise.all(
      req.files.map((file) =>
        sendBufferToTelegram(file.buffer, file.originalname, file.mimetype)
      )
    );

    res.json({ success: true, files: results });
  } catch (err) {
    console.error("Telegram upload error:", err);
    res.status(500).json({
      success: false,
      error: err.message || "Failed to upload file to Telegram",
    });
  }
});

// @route   POST /api/telegram-bot/upload-url
// @desc    Download a file from public URL and upload directly to Telegram
router.post("/upload-url", async (req, res) => {
  if (!bot) {
    return res.status(500).json({ success: false, error: "Telegram Bot is not initialized" });
  }

  const { fileUrl, fileName, caption } = req.body;
  if (!fileUrl) {
    return res.status(400).json({ success: false, error: "fileUrl is required" });
  }

  try {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file from URL (status ${response.status})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get("content-type") || "application/octet-stream";

    let name = fileName;
    if (!name) {
      try {
        const parsedUrl = new URL(fileUrl);
        const base = path.basename(parsedUrl.pathname);
        name = base || "downloaded-file";
      } catch {
        name = "downloaded-file";
      }
    }

    const result = await sendBufferToTelegram(buffer, name, contentType, caption);
    res.json({ success: true, file: result });
  } catch (err) {
    console.error("Telegram upload-url error:", err);
    res.status(500).json({ success: false, error: err.message || "Failed to upload file from URL" });
  }
});

// @route   POST /api/telegram-bot/upload-text
// @desc    Upload text/code/notes as a file to Telegram
router.post("/upload-text", async (req, res) => {
  if (!bot) {
    return res.status(500).json({ success: false, error: "Telegram Bot is not initialized" });
  }

  const { content, fileName, caption } = req.body;
  if (content === undefined || content === null) {
    return res.status(400).json({ success: false, error: "content is required" });
  }

  try {
    const buffer = Buffer.from(String(content), "utf8");
    const name = fileName || `document-${Date.now()}.txt`;
    const mimeType = name.endsWith(".json")
      ? "application/json"
      : name.endsWith(".md")
      ? "text/markdown"
      : "text/plain";

    const result = await sendBufferToTelegram(buffer, name, mimeType, caption);
    res.json({ success: true, file: result });
  } catch (err) {
    console.error("Telegram upload-text error:", err);
    res.status(500).json({ success: false, error: err.message || "Failed to upload text document" });
  }
});

// @route   POST /api/telegram-bot/send-message
// @desc    Post a message directly to the Telegram Channel
router.post("/send-message", async (req, res) => {
  if (!bot) {
    return res.status(500).json({ success: false, error: "Telegram Bot is not initialized" });
  }

  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ success: false, error: "message is required" });
  }

  try {
    const msg = await bot.sendMessage(CHAT_ID, message);
    res.json({ success: true, messageId: msg.message_id, date: msg.date });
  } catch (err) {
    console.error("Telegram send-message error:", err);
    res.status(500).json({ success: false, error: err.message || "Failed to send message" });
  }
});

module.exports = router;