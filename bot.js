"use strict";

// ================== IMPORTS ==================
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const mysql = require("mysql2/promise");
const si = require("systeminformation");


// ================== CONFIG ==================
const BOT_TOKEN = "INSTER_BOT_TOKEN_HERE";
const UPTIME_KEY = "UPTIME_ROBOT_API_KEY";
const STATUS_CHANNEL_ID = "DISCORD_CHANNEL_NUMERICAL_CODE";

// Database connection (AzerothCore)
const dbConfig = {
  host: "127.0.0.1",
  user: "acore",
  password: "acore",
  database: "acore_characters"
};

// Refresh interval (milliseconds)
const REFRESH_INTERVAL = 60000; // 1 minute
// ============================================

// Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ========== HELPER FUNCTIONS ==========

// Get server online/offline status & uptime
async function getServerStatus() {
  try {
    const res = await fetch("https://api.uptimerobot.com/v2/getMonitors", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `api_key=${UPTIME_KEY}&format=json&logs=1&logs_limit=50`
    });

    const data = await res.json();
    const monitor = data.monitors[0];

    let uptime = "N/A";

    if (monitor.status === 2 && Array.isArray(monitor.logs)) {
      const lastUpLog = monitor.logs.find(log => log.type === 1); // find last UP
      if (lastUpLog) {
        const start = lastUpLog.datetime * 1000;
        const diff = Date.now() - start;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const minutes = Math.floor((diff / (1000 * 60)) % 60);
        uptime = `${days}d ${hours}h ${minutes}m`;
      }
    }

    return {
      online: monitor.status === 2,
      uptime
    };
  } catch (err) {
    console.error("UptimeRobot error:", err);
    return { online: false, uptime: "N/A" };
  }
}

// Get system CPU and RAM usage
async function getSystemUsage() {
  try {
    const cpu = await si.currentLoad();
    const mem = await si.mem();
    const cpuPercent = cpu.currentLoad.toFixed(1);
    const ramPercent = ((mem.active / mem.total) * 100).toFixed(1);
    return `CPU ${cpuPercent}% | RAM ${ramPercent}%`;
  } catch (err) {
    console.error("System info error:", err);
    return "CPU N/A | RAM N/A";
  }
}

// Get online players with level
async function getPlayersOnline() {
  try {
    const db = await mysql.createConnection(dbConfig);
    const [rows] = await db.query(
      "SELECT name, level FROM characters WHERE online > 0 ORDER BY level DESC"
    );
    await db.end();
    return rows;
  } catch (err) {
    console.error("Database error:", err);
    return [];
  }
}

// Update the embed in Discord
let statusMessageId = null; // stores message ID to edit instead of posting a new one

let lastChannelStatus = null; // cache to avoid unnecessary renames

// Rename the status channel to show 🟢/🔴 prefix (no space) based on server status
async function updateStatusChannelName(channel, isOnline) {
  try {
    // Only attempt on guild text/announcement channels that can be managed
    if (!channel || !channel.guild || typeof channel.setName !== "function") return;

    const desiredName = `${isOnline ? "🟢" : "🔴"}server-status`;

    // Avoid rate limits: only rename when the state actually changes OR name is wrong
    if (lastChannelStatus === isOnline && channel.name === desiredName) return;

    // Check manageable (bot has permission + role hierarchy allows)
    if (!channel.manageable) {
      console.warn("⚠️ I can’t rename the channel (missing Manage Channels or role hierarchy issue).");
      return;
    }

    if (channel.name !== desiredName) {
      await channel.setName(desiredName, "Update server status indicator");
    }

    lastChannelStatus = isOnline;
  } catch (err) {
    console.error("Error renaming status channel:", err);
  }
}


async function updateStatusEmbed() {
  try {
    const channel = await client.channels.fetch(STATUS_CHANNEL_ID);
    const status = await getServerStatus();
    await updateStatusChannelName(channel, status.online);
    const players = await getPlayersOnline();
    const systemUsage = await getSystemUsage();

    const embed = new EmbedBuilder()
      .setTitle("🛡️ WoW Server Status")
      .setColor(status.online ? 0x2ecc71 : 0xe74c3c) // green/red
      .addFields(
        { name: "Status", value: status.online ? "🟢 ONLINE" : "🔴 OFFLINE", inline: true },
        { name: "Online", value: `${players.length}`, inline: true },
        { name: "Uptime", value: status.uptime, inline: true },
        { name: "System Usage", value: systemUsage, inline: false },
        {
          name: "Online Players",
          value: players.map(p => `${p.name} (${p.level})`).join("\n") || "No players online",
          inline: false
        }
      )
      .setTimestamp();

    // Edit existing message or send new one
    if (statusMessageId) {
      try {
        const msg = await channel.messages.fetch(statusMessageId);
        await msg.edit({ embeds: [embed] });
      } catch {
        const msg = await channel.send({ embeds: [embed] });
        statusMessageId = msg.id;
      }
    } else {
      const msg = await channel.send({ embeds: [embed] });
      statusMessageId = msg.id;
    }
  } catch (err) {
    console.error("Error updating status embed:", err);
  }
}


// ========== BOT EVENTS ==========

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  // Initial embed
  await updateStatusEmbed();
  // Refresh interval
  setInterval(updateStatusEmbed, REFRESH_INTERVAL);
});

// Optional command to force refresh (can be removed if not needed)
client.on("messageCreate", async msg => {
  if (msg.content === "!refresh") {
    await updateStatusEmbed();
    msg.reply("✅ Status embed refreshed.");
  }
});


// Login
client.login(BOT_TOKEN);
