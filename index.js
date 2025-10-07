const { Client, GatewayIntentBits, Events, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const express = require('express');
const path = require('path');

// ---------- CONFIG ----------
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

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('💾 Configuration saved');
  } catch (err) {
    console.error('❌ Failed to save config.json:', err);
  }
}

// ---------- DISCORD CLIENT ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once(Events.ClientReady, () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
});

// ---------- ROLE SWAP EVENT ----------
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (!config.roleSwapRules || !Array.isArray(config.roleSwapRules)) return;

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

// ---------- EXPRESS SERVER ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // optional for CSS/JS if you add

// Home
app.get('/', (req, res) => res.send('<h1>RoleSwapBot is running!</h1>'));

// Add a role swap rule
app.post('/add-swap', (req, res) => {
  const { whenAdded, removeRole } = req.body;
  if (!whenAdded || !removeRole) return res.status(400).send('Missing whenAdded or removeRole');

  config.roleSwapRules.push({ whenAdded, removeRole });
  saveConfig();
  res.send(`Added swap: ${whenAdded} → remove ${removeRole}`);
});

// List role swaps
app.get('/swaps', (req, res) => res.json(config.roleSwapRules));

// Dashboard GUI
app.get('/dashboard', (req, res) => {
  const rulesHTML = config.roleSwapRules.map(rule => `<li>When added: <b>${rule.whenAdded}</b> → Remove: <b>${rule.removeRole}</b></li>`).join('');
  res.send(`
    <html>
    <head>
      <title>RoleSwapBot Dashboard</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f4f4f4; }
        h1 { color: #333; }
        ul { padding-left: 20px; }
        .button { padding: 10px 20px; background: #5865F2; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; }
        .button:hover { background: #4752c4; }
        .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <h1>RoleSwapBot Dashboard</h1>
      <div class="card">
        <h2>Bot Status</h2>
        <p><b>${client.user ? client.user.tag : 'Offline'}</b></p>
      </div>
      <div class="card">
        <h2>Role Swap Rules</h2>
        <ul>${rulesHTML || '<li>No rules set yet.</li>'}</ul>
      </div>
      <div class="card">
        <h2>Bot Website</h2>
        <button class="button" onclick="window.open('https://autorolebot-hygq.onrender.com', '_blank')">Go to Bot Dashboard</button>
      </div>
    </body>
    </html>
  `);
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🌐 Express server running on port ${PORT}`));

// ---------- LOGIN BOT ----------
const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('❌ DISCORD_BOT_TOKEN environment variable not set!');
  process.exit(1);
}
client.login(token);
