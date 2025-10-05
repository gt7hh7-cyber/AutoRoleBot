// ---------------- IMPORTS ----------------
const { Client, GatewayIntentBits, Events } = require('discord.js');
const fs = require('fs');
const express = require('express');

// ---------------- CONFIG ----------------
const configPath = './config.json';
let config = { roleSwapRules: [] };

if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath));
    console.log('✅ Loaded existing configuration from config.json');
  } catch (err) {
    console.error('❌ Failed to load config.json:', err);
  }
}

// ---------------- SAVE CONFIG ----------------
function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('💾 Configuration saved.');
}

// ---------------- CLIENT ----------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// ---------------- BOT TOKEN ----------------
// Replace this with your actual bot token:
const BOT_TOKEN = 'PASTE_YOUR_BOT_TOKEN_HERE';

// ---------------- EVENTS ----------------
client.once(Events.ClientReady, () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (!config.roleSwapRules || config.roleSwapRules.length === 0) return;

  const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));

  for (const [id] of addedRoles) {
    for (const rule of config.roleSwapRules) {
      if (rule.whenAdded === id && newMember.roles.cache.has(rule.removeRole)) {
        const roleToRemove = newMember.guild.roles.cache.get(rule.removeRole);
        if (roleToRemove) {
          await newMember.roles.remove(roleToRemove);
          console.log(`🔄 Removed role ${roleToRemove.name} from ${newMember.user.tag}`);
        }
      }
    }
  }
});

// ---------------- EXPRESS SERVER ----------------
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('RoleSwapBot is running.'));
app.listen(PORT, () => console.log(`🌐 Express server running on port ${PORT}`));

// ---------------- LOGIN ----------------
client.login(BOT_TOKEN).catch(err => console.error('❌ Failed to login:', err));
