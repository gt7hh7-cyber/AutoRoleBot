// index.js
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  Events,
  EmbedBuilder
} = require('discord.js');

// -------------------- ENV & CHECKS --------------------
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const DASHBOARD_URL = process.env.DASHBOARD_URL; // e.g. autorolebot-had1.onrender.com
const BOT_OWNER_ID = process.env.BOT_OWNER_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !DASHBOARD_URL || !BOT_OWNER_ID) {
  console.error('❌ Missing one or more required environment variables:');
  console.error('   DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, DASHBOARD_URL, BOT_OWNER_ID');
  process.exit(1);
}

// -------------------- CONFIG --------------------
const CONFIG_PATH = path.join(__dirname, 'config.json');
let config = { roleSwapRules: [] };
try {
  if (fs.existsSync(CONFIG_PATH)) {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    console.log('✅ Loaded config.json');
  } else {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log('✅ Created default config.json');
  }
} catch (err) {
  console.error('❌ Failed reading/writing config.json', err);
  process.exit(1);
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log('💾 Saved config.json');
}

// -------------------- DISCORD CLIENT --------------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once(Events.ClientReady, () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
});

// Role-swap logic: when a member receives a role, remove another role if rule matches
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  try {
    if (!Array.isArray(config.roleSwapRules)) return;
    const added = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    if (!added.size) return;

    for (const [roleId] of added) {
      // find rules for this guild & whenAdded
      const rules = config.roleSwapRules.filter(r => r.guildId === newMember.guild.id && r.whenAdded === roleId);
      for (const rule of rules) {
        const toRemove = newMember.guild.roles.cache.get(rule.removeRole);
        if (toRemove && newMember.roles.cache.has(rule.removeRole)) {
          await newMember.roles.remove(toRemove).catch(e => console.error('Failed to remove role:', e));
          console.log(`🔄 Removed role ${rule.removeRole} from ${newMember.user.tag} in ${newMember.guild.name}`);
        }
      }
    }
  } catch (err) {
    console.error('Error in GuildMemberUpdate handler:', err);
  }
});

// -------------------- SLASH COMMANDS --------------------
const commands = [
  new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Get dashboard links (Owner & Server)'),

  new SlashCommandBuilder()
    .setName('listswaps')
    .setDescription('List role-swap rules for this server'),

  new SlashCommandBuilder()
    .setName('addswap')
    .setDescription('Add a role-swap rule for this server')
    .addStringOption(opt => opt.setName('whenadded').setDescription('Role ID that triggers').setRequired(true))
    .addStringOption(opt => opt.setName('removerole').setDescription('Role ID to remove').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('removeswap')
    .setDescription('Remove a role-swap rule by index for this server')
    .addIntegerOption(opt => opt.setName('index').setDescription('Rule index from /listswaps').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
  try {
    console.log('⏳ Registering commands...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Commands registered!');
  } catch (err) {
    console.error('❌ Failed registering commands', err);
  }
}

// Interaction handler
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    const name = interaction.commandName;

    if (name === 'dashboard') {
      // Build URLs containing userId and guildId (fast-check approach)
      const ownerUrl = `https://${DASHBOARD_URL}/owner?userId=${encodeURIComponent(interaction.user.id)}`;
      const serverUrl = interaction.guild
        ? `https://${DASHBOARD_URL}/server?guildId=${encodeURIComponent(interaction.guild.id)}&userId=${encodeURIComponent(interaction.user.id)}`
        : `https://${DASHBOARD_URL}/server?userId=${encodeURIComponent(interaction.user.id)}`;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Owner Dashboard').setStyle(ButtonStyle.Link).setURL(ownerUrl),
        new ButtonBuilder().setLabel('Server Dashboard').setStyle(ButtonStyle.Link).setURL(serverUrl)
      );

      await interaction.reply({ content: 'Click a dashboard button below:', components: [row], ephemeral: true });
      return;
    }

    if (name === 'listswaps') {
      const guildId = interaction.guild?.id;
      if (!guildId) return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
      const rules = config.roleSwapRules.filter(r => r.guildId === guildId);
      if (!rules.length) return interaction.reply({ content: 'No role-swap rules configured for this server.', ephemeral: true });
      const list = rules.map((r, i) => `${i + 1}. When <@&${r.whenAdded}> added → remove <@&${r.removeRole}> (IDs: ${r.whenAdded} → ${r.removeRole})`).join('\n');
      return interaction.reply({ content: `📋 Role swaps for this server:\n${list}`, ephemeral: true });
    }

    if (name === 'addswap') {
      const guildId = interaction.guild?.id;
      if (!guildId) return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
      const whenAdded = interaction.options.getString('whenadded');
      const removeRole = interaction.options.getString('removerole');

      // Basic validation: check roles exist
      const roleA = interaction.guild.roles.cache.get(whenAdded);
      const roleB = interaction.guild.roles.cache.get(removeRole);
      if (!roleA || !roleB) return interaction.reply({ content: 'One or both role IDs are invalid in this server.', ephemeral: true });

      config.roleSwapRules.push({ guildId, whenAdded, removeRole });
      saveConfig();
      await interaction.reply({ content: `✅ Added rule: when <@&${whenAdded}> is added → remove <@&${removeRole}>`, ephemeral: true });
      return;
    }

    if (name === 'removeswap') {
      const guildId = interaction.guild?.id;
      if (!guildId) return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
      const idx = interaction.options.getInteger('index');
      const rules = config.roleSwapRules.filter(r => r.guildId === guildId);
      if (idx < 1 || idx > rules.length) return interaction.reply({ content: 'Invalid index.', ephemeral: true });

      // remove specific rule (must find and remove the correct instance)
      const toRemove = rules[idx - 1];
      config.roleSwapRules = config.roleSwapRules.filter(r => !(r.guildId === guildId && r.whenAdded === toRemove.whenAdded && r.removeRole === toRemove.removeRole));
      saveConfig();
      await interaction.reply({ content: `🗑️ Removed rule #${idx} for this server.`, ephemeral: true });
      return;
    }
  } catch (err) {
    console.error('Interaction handler error:', err);
    if (interaction && !interaction.replied) {
      try { await interaction.reply({ content: '❌ Error handling command.', ephemeral: true }); } catch {}
    }
  }
});

// -------------------- EXPRESS DASHBOARD --------------------
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 10000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Root: simple info
app.get('/', (req, res) => {
  res.send(`<html><body><h2>AutoRoleBot</h2><p>Visit <a href="/dashboard">/dashboard</a> via the Discord command.</p></body></html>`);
});

// Owner page: only if query userId === BOT_OWNER_ID
app.get('/owner', (req, res) => {
  const userId = req.query.userId;
  if (!userId || userId !== BOT_OWNER_ID) {
    return res.status(403).send('<h2>Access Denied</h2><p>This page is owner-only.</p>');
  }

  // Owner page HTML
  const html = `
    <html>
      <head><title>Owner Dashboard</title></head>
      <body style="font-family:Arial; background:#111; color:#eee; text-align:center; padding:30px;">
        <h1>🔐 Owner Dashboard</h1>
        <p>Welcome, owner <strong>${userId}</strong></p>
        <p>Bot: ${client.user ? client.user.tag : 'loading...'}</p>
        <p>Guilds: ${client.guilds.cache.size}</p>
        <form method="POST" action="/owner/reload">
          <input type="hidden" name="userId" value="${userId}" />
          <button type="submit">Reload Config</button>
        </form>
        <hr/>
        <h3>All Role-Swap Rules (all guilds)</h3>
        <pre style="text-align:left; display:inline-block; background:#222; padding:12px; border-radius:8px;">${JSON.stringify(config.roleSwapRules, null, 2)}</pre>
      </body>
    </html>
  `;
  res.send(html);
});

// Owner reload endpoint
app.post('/owner/reload', (req, res) => {
  const userId = req.body.userId;
  if (!userId || userId !== BOT_OWNER_ID) return res.status(403).send('Access denied');
  // reload config from disk
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      res.send('<p>Config reloaded. <a href="/owner?userId=' + encodeURIComponent(userId) + '">Back</a></p>');
    } else {
      res.send('<p>No config file found.</p>');
    }
  } catch (err) {
    console.error('Failed to reload config:', err);
    res.status(500).send('Failed to reload');
  }
});

// Server dashboard: requires guildId & userId in query.
// We'll verify that userId is a member of guildId and has Manage Guild permission.
app.get('/server', async (req, res) => {
  try {
    const { guildId, userId } = req.query;
    if (!guildId || !userId) return res.status(400).send('<p>Missing guildId or userId</p>');

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).send('<p>Bot is not in that guild.</p>');

    // fetch member
    let member;
    try {
      member = await guild.members.fetch(userId);
    } catch {
      return res.status(403).send('<p>You must be a member of this server.</p>');
    }

    // check Manage Server permission
    if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return res.status(403).send('<p>Insufficient permissions. You must have Manage Server.</p>');
    }

    // Build HTML showing rules for this guild plus add/remove form
    const rules = config.roleSwapRules.filter(r => r.guildId === guildId);
    const rulesHtml = rules.length ? rules.map((r, i) => `<li>${i+1}. When <strong>${r.whenAdded}</strong> added → remove <strong>${r.removeRole}</strong> (IDs)</li>`).join('') : '<li>No rules</li>';

    const html = `
      <html>
        <head><title>Server Dashboard - ${guild.name}</title></head>
        <body style="font-family:Arial; background:#0f1720; color:#eee; padding:24px;">
          <h1>🛡️ Server Dashboard</h1>
          <h2>${guild.name}</h2>
          <p>Viewing as: ${member.user.tag} (${userId})</p>

          <h3>Role Swap Rules</h3>
          <ul>${rulesHtml}</ul>

          <h3>Add Rule</h3>
          <form method="POST" action="/server/add">
            <input type="hidden" name="guildId" value="${guildId}" />
            <input type="hidden" name="userId" value="${userId}" />
            <label>When Role ID: <input name="whenAdded" required /></label><br/><br/>
            <label>Remove Role ID: <input name="removeRole" required /></label><br/><br/>
            <button type="submit">Add Swap</button>
          </form>

          <h3>Remove Rule (by index)</h3>
          <form method="POST" action="/server/remove">
            <input type="hidden" name="guildId" value="${guildId}" />
            <input type="hidden" name="userId" value="${userId}" />
            <label>Rule Index: <input name="index" type="number" min="1" required /></label>
            <button type="submit">Remove</button>
          </form>

          <p><a href="/server?guildId=${guildId}&userId=${userId}">Refresh</a></p>
        </body>
      </html>
    `;
    res.send(html);
  } catch (err) {
    console.error('/server error:', err);
    res.status(500).send('Server error');
  }
});

// POST add rule (server)
app.post('/server/add', async (req, res) => {
  try {
    const { guildId, userId, whenAdded, removeRole } = req.body;
    if (!guildId || !userId || !whenAdded || !removeRole) return res.status(400).send('Missing fields');

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).send('Bot not in guild');

    let member;
    try { member = await guild.members.fetch(userId); } catch { return res.status(403).send('Not a member'); }
    if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) return res.status(403).send('No permission');

    // Optional: ensure roles exist in guild
    if (!guild.roles.cache.has(whenAdded) || !guild.roles.cache.has(removeRole)) {
      // Still allow adding but warn
      console.log('Warning: role IDs may not exist in guild');
    }

    config.roleSwapRules.push({ guildId, whenAdded, removeRole });
    saveConfig();
    return res.redirect(`/server?guildId=${encodeURIComponent(guildId)}&userId=${encodeURIComponent(userId)}`);
  } catch (err) {
    console.error('/server/add error:', err);
    res.status(500).send('Error');
  }
});

// POST remove rule (server)
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
    return res.redirect(`/server?guildId=${encodeURIComponent(guildId)}&userId=${encodeURIComponent(userId)}`);
  } catch (err) {
    console.error('/server/remove error:', err);
    res.status(500).send('Error');
  }
});

// -------------------- START SERVER & LOGIN --------------------
server.listen(PORT, () => {
  console.log(`🌐 Express server running on port ${PORT}`);
});

// Register commands and login
registerCommands();
client.login(TOKEN).catch(err => {
  console.error('Failed to login bot:', err);
  process.exit(1);
});
