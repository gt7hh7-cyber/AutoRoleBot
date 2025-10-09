// index.js
// AutoRoleBot - Dashboard + Role Swap minimal system
// Requires env vars: DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, DASHBOARD_URL, BOT_OWNER_ID

const express = require('express');
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, Events, EmbedBuilder } = require('discord.js');

// ---- Environment ----
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
let DASHBOARD_URL = process.env.DASHBOARD_URL || '';
const BOT_OWNER_ID = process.env.BOT_OWNER_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !DASHBOARD_URL || !BOT_OWNER_ID) {
  console.error('❌ Missing one or more environment variables. Required: DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, DASHBOARD_URL, BOT_OWNER_ID');
  process.exit(1);
}

// Normalize DASHBOARD_URL to not include trailing slash and ensure protocol for links
DASHBOARD_URL = DASHBOARD_URL.replace(/\/+$/, '');
const DASHBOARD_BASE = DASHBOARD_URL.startsWith('http://') || DASHBOARD_URL.startsWith('https://') ? DASHBOARD_URL : `https://${DASHBOARD_URL}`;

// ---- Config file ----
const CONFIG_PATH = path.join(__dirname, 'config.json');
let config = { roleSwapRules: [] }; // each: { guildId, whenAdded, removeRole }

try {
  if (fs.existsSync(CONFIG_PATH)) {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    config = JSON.parse(raw || '{}');
    if (!Array.isArray(config.roleSwapRules)) config.roleSwapRules = [];
    console.log('✅ Loaded config.json');
  } else {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log('✅ Created config.json');
  }
} catch (err) {
  console.error('❌ Error reading/writing config.json', err);
  process.exit(1);
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log('💾 Saved config.json');
  } catch (err) {
    console.error('❌ Failed to save config.json', err);
  }
}

// ---- Discord client ----
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// Register commands (guild-scoped for quick updates)
const commands = [
  new SlashCommandBuilder().setName('dashboard').setDescription('Show dashboard links (Owner & Server)'),
  new SlashCommandBuilder().setName('listswaps').setDescription('List role-swap rules for this server'),
  new SlashCommandBuilder()
    .setName('addswap')
    .setDescription('Add a role-swap rule for this server')
    .addStringOption(o => o.setName('whenadded').setDescription('Role ID that triggers').setRequired(true))
    .addStringOption(o => o.setName('removerole').setDescription('Role ID to remove').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('removeswap')
    .setDescription('Remove a role-swap rule by index for this server')
    .addIntegerOption(o => o.setName('index').setDescription('Rule number from /listswaps').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
  try {
    console.log('⏳ Registering commands...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Commands registered!');
  } catch (err) {
    console.error('❌ Error registering commands', err);
  }
}

// ---- Role swap behavior ----
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  try {
    if (!Array.isArray(config.roleSwapRules)) return;
    const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    if (!addedRoles.size) return;

    for (const [roleId] of addedRoles) {
      const rules = config.roleSwapRules.filter(r => r.guildId === newMember.guild.id && r.whenAdded === roleId);
      for (const rule of rules) {
        if (newMember.roles.cache.has(rule.removeRole)) {
          await newMember.roles.remove(rule.removeRole).catch(e => console.error('Failed to remove role:', e));
          console.log(`🔄 Removed ${rule.removeRole} from ${newMember.user.tag} in ${newMember.guild.name}`);
        }
      }
    }
  } catch (err) {
    console.error('Error in GuildMemberUpdate:', err);
  }
});

// ---- Interaction handler ----
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    const name = interaction.commandName;
    if (name === 'dashboard') {
      const ownerUrl = `${DASHBOARD_BASE}/dashboard/owner?userId=${encodeURIComponent(interaction.user.id)}`;
      const serverUrl = interaction.guild
        ? `${DASHBOARD_BASE}/dashboard/server?guildId=${encodeURIComponent(interaction.guild.id)}&userId=${encodeURIComponent(interaction.user.id)}`
        : `${DASHBOARD_BASE}/dashboard/server?userId=${encodeURIComponent(interaction.user.id)}`;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Owner Dashboard').setStyle(ButtonStyle.Link).setURL(ownerUrl),
        new ButtonBuilder().setLabel('Server Dashboard').setStyle(ButtonStyle.Link).setURL(serverUrl)
      );

      await interaction.reply({ content: 'Open dashboard:', components: [row], ephemeral: true });
      return;
    }

    if (name === 'listswaps') {
      const guildId = interaction.guild?.id;
      if (!guildId) return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
      const rules = config.roleSwapRules.filter(r => r.guildId === guildId);
      if (!rules.length) return interaction.reply({ content: 'No rules set for this server.', ephemeral: true });
      const list = rules.map((r, i) => `${i + 1}. When <@&${r.whenAdded}> added → remove <@&${r.removeRole}> (IDs ${r.whenAdded} → ${r.removeRole})`).join('\n');
      return interaction.reply({ content: `📋 Role swaps:\n${list}`, ephemeral: true });
    }

    if (name === 'addswap') {
      const guildId = interaction.guild?.id;
      if (!guildId) return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
      const whenAdded = interaction.options.getString('whenadded');
      const removeRole = interaction.options.getString('removerole');

      // validate roles exist
      const roleA = interaction.guild.roles.cache.get(whenAdded);
      const roleB = interaction.guild.roles.cache.get(removeRole);
      if (!roleA || !roleB) return interaction.reply({ content: 'One or both role IDs are invalid in this server.', ephemeral: true });

      config.roleSwapRules.push({ guildId, whenAdded, removeRole });
      saveConfig();
      return interaction.reply({ content: `✅ Added rule: when <@&${whenAdded}> added → remove <@&${removeRole}>`, ephemeral: true });
    }

    if (name === 'removeswap') {
      const guildId = interaction.guild?.id;
      if (!guildId) return interaction.reply({ content: 'Use this command inside a server.', ephemeral: true });
      const idx = interaction.options.getInteger('index');
      const rules = config.roleSwapRules.filter(r => r.guildId === guildId);
      if (idx < 1 || idx > rules.length) return interaction.reply({ content: 'Invalid index', ephemeral: true });

      const toRemove = rules[idx - 1];
      config.roleSwapRules = config.roleSwapRules.filter(r => !(r.guildId === guildId && r.whenAdded === toRemove.whenAdded && r.removeRole === toRemove.removeRole));
      saveConfig();
      return interaction.reply({ content: `🗑️ Removed rule #${idx}`, ephemeral: true });
    }
  } catch (err) {
    console.error('Interaction error:', err);
    if (interaction && !interaction.replied) {
      try { await interaction.reply({ content: '❌ An error occurred.', ephemeral: true }); } catch {}
    }
  }
});

// ---- Express app (dashboard) ----
const app = express();
const PORT = process.env.PORT || 10000;
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// basic root
app.get('/', (req, res) => {
  res.send(`<html><body style="font-family:Arial;text-align:center;padding:40px;"><h1>AutoRoleBot</h1><p>Use the /dashboard command in Discord to get links.</p></body></html>`);
});

// public dashboard chooser (not used by the slash command but handy)
app.get('/dashboard', (req, res) => {
  res.send(`<html><body style="font-family:Arial;text-align:center;padding:40px;"><h1>Dashboard</h1>
    <p><a href="/dashboard/owner">Owner dashboard</a> | <a href="/dashboard/server">Server dashboard</a></p>
    </body></html>`);
});

// API status (live data) — polled by pages
app.get('/api/status', (req, res) => {
  const uptime = process.uptime();
  const mem = process.memoryUsage();
  res.json({
    botOnline: client && client.user ? true : false,
    botTag: client.user?.tag || null,
    guildCount: client.guilds.cache.size,
    uptimeSeconds: Math.floor(uptime),
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed
    }
  });
});

// Owner page (only allowed if query userId matches BOT_OWNER_ID)
app.get('/dashboard/owner', (req, res) => {
  const userId = req.query.userId;
  if (!userId || userId !== BOT_OWNER_ID) {
    return res.status(403).send('<h2>Access denied</h2><p>This page is for the bot owner only.</p>');
  }

  res.send(`
    <html>
      <head>
        <title>Owner Dashboard</title>
        <style>
          body{font-family:Arial;background:#0d1117;color:#eee;padding:30px}
          .card{background:#111217;padding:20px;border-radius:10px;display:inline-block;min-width:320px}
          pre { background:#0b0b0b;padding:12px;border-radius:8px; color:#9ad8ff; text-align:left; overflow:auto; max-height:300px;}
          button{background:#5865f2;color:white;border:none;padding:8px 12px;border-radius:6px;cursor:pointer}
        </style>
      </head>
      <body>
        <div class="card">
          <h2>🔐 Owner Dashboard</h2>
          <div id="info">Loading live info...</div>
          <p><button onclick="fetch('/api/reload?userId=${encodeURIComponent(userId)}').then(()=>alert('Reloaded config'))">Reload config</button></p>
          <h3>All Role-Swap Rules</h3>
          <pre id="rules">${JSON.stringify(config.roleSwapRules, null, 2)}</pre>
        </div>
        <script>
          async function update(){
            try{
              const s = await fetch('/api/status'); 
              const j = await s.json();
              document.getElementById('info').innerHTML = 
                '<b>Bot:</b> ' + (j.botTag || 'offline') + '<br>' +
                '<b>Guilds:</b> ' + j.guildCount + '<br>' +
                '<b>Uptime:</b> ' + Math.floor(j.uptimeSeconds) + 's<br>' +
                '<b>Memory:</b> ' + Math.round(j.memory.heapUsed/1024/1024) + ' MB';
            }catch(e){
              document.getElementById('info').innerText = 'Failed to load status';
            }
          }
          update();
          setInterval(update, 5000);
        </script>
      </body>
    </html>
  `);
});

// endpoint to reload config (owner only)
app.get('/api/reload', (req, res) => {
  const userId = req.query.userId;
  if (!userId || userId !== BOT_OWNER_ID) return res.status(403).send('Access denied');
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return res.json({ ok: true, message: 'Config reloaded' });
  } catch (err) {
    console.error('Failed to reload config:', err);
    return res.status(500).json({ ok: false, error: 'failed' });
  }
});

// Server dashboard -- requires guildId & userId in query (button provides them)
app.get('/dashboard/server', async (req, res) => {
  try {
    const guildId = req.query.guildId;
    const userId = req.query.userId;
    if (!userId) return res.status(400).send('Missing userId');
    if (!guildId) return res.status(400).send('Missing guildId');

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).send('<p>Bot is not in that server.</p>');

    let member;
    try {
      member = await guild.members.fetch(userId);
    } catch {
      return res.status(403).send('<p>You must be a member of the server.</p>');
    }

    if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return res.status(403).send('<p>You need Manage Server permission to use this page.</p>');
    }

    // rules for this guild
    const rules = config.roleSwapRules.filter(r => r.guildId === guildId);
    const rulesHtml = rules.length ? rules.map((r,i)=>`<li>${i+1}. When <strong>${r.whenAdded}</strong> added → remove <strong>${r.removeRole}</strong></li>`).join('') : '<li>No rules</li>';

    res.send(`
      <html>
        <head>
          <title>Server Dashboard - ${escapeHtml(guild.name)}</title>
          <style> body{font-family:Arial;background:#071019;color:#eef;padding:24px} .card{background:#071826;padding:18px;border-radius:10px;display:inline-block} </style>
        </head>
        <body>
          <div class="card">
            <h2>🛡 Server Dashboard — ${escapeHtml(guild.name)}</h2>
            <p>Viewing as ${escapeHtml(member.user.tag)}</p>
            <h3>Role Swap Rules</h3>
            <ul>${rulesHtml}</ul>

            <h3>Add Rule</h3>
            <form method="POST" action="/server/add">
              <input type="hidden" name="guildId" value="${escapeHtml(guildId)}"/>
              <input type="hidden" name="userId" value="${escapeHtml(userId)}"/>
              <label>When Role ID: <input name="whenAdded" required/></label><br/><br/>
              <label>Remove Role ID: <input name="removeRole" required/></label><br/><br/>
              <button type="submit">Add Swap</button>
            </form>

            <h3>Remove Rule</h3>
            <form method="POST" action="/server/remove">
              <input type="hidden" name="guildId" value="${escapeHtml(guildId)}"/>
              <input type="hidden" name="userId" value="${escapeHtml(userId)}"/>
              <label>Rule Index: <input name="index" type="number" min="1" required/></label>
              <button type="submit">Remove</button>
            </form>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('/dashboard/server error', err);
    res.status(500).send('Server error');
  }
});

// POST add rule
app.post('/server/add', async (req, res) => {
  try {
    const { guildId, userId, whenAdded, removeRole } = req.body;
    if (!guildId || !userId || !whenAdded || !removeRole) return res.status(400).send('Missing fields');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).send('Bot not in guild');

    let member;
    try { member = await guild.members.fetch(userId); } catch { return res.status(403).send('Not a member'); }
    if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) return res.status(403).send('No permission');

    config.roleSwapRules.push({ guildId, whenAdded, removeRole });
    saveConfig();
    return res.redirect(`/dashboard/server?guildId=${encodeURIComponent(guildId)}&userId=${encodeURIComponent(userId)}`);
  } catch (err) {
    console.error('/server/add err', err);
    res.status(500).send('Error');
  }
});

// POST remove rule
app.post('/server/remove', async (req, res) => {
  try {
    const { guildId, userId, index } = req.body;
    if (!guildId || !userId || !index) return res.status(400).send('Missing fields');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).send('Bot not in guild');

    let member;
    try { member = await guild.members.fetch(userId); } catch { return res.status(403).send('Not a member'); }
    if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) return res.status(403).send('No permission');

    const rules = config.roleSwapRules.filter(r => r.guildId === guildId);
    const idx = parseInt(index, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= rules.length) return res.status(400).send('Invalid index');

    const toRemove = rules[idx];
    config.roleSwapRules = config.roleSwapRules.filter(r => !(r.guildId === guildId && r.whenAdded === toRemove.whenAdded && r.removeRole === toRemove.removeRole));
    saveConfig();
    return res.redirect(`/dashboard/server?guildId=${encodeURIComponent(guildId)}&userId=${encodeURIComponent(userId)}`);
  } catch (err) {
    console.error('/server/remove err', err);
    res.status(500).send('Error');
  }
});

// ---- Start server and login ----
app.listen(PORT, () => console.log(`🌐 Express server running on port ${PORT}`));
registerCommands();
client.login(TOKEN).catch(err => {
  console.error('Failed to login bot:', err);
  process.exit(1);
});

// ---- Utilities ----
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
