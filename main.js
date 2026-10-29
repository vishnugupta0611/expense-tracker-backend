const TelegramBot = require("node-telegram-bot-api");

const TOKEN = "8673342759:AAE-VebOggMbJKyKULfuKZ_guFEw1saPgXk";

const bot = new TelegramBot(TOKEN, { polling: true });

console.log("Bot Started...");