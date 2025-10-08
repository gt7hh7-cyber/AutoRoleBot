// ===== AutoRoleBot Updated Index.js =====
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');
const express = require('express');
const fs = require('fs');
const http = require('http');
const socketio = require('socket.io');

// ---------- CONFIG ----------
const CONFIG_PATH = './config.json';
let config = { roleSwapRules: [] };
if (fs.existsSync(CONFIG_PATH)) {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  console.log('✅ Loaded existing configuration from config.json');
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log('💾 Configuration saved');
}

// ---------- DISCORD CLIENT ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember],
});

// ---------- EXPRESS + SOCKET ----------
const app = express();
const server = http.createServer(app);
const io = socketio(server);

app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => res.send('✅ AutoRoleBot is running!'));

app.get('/dashboard', (req, res) => {
  const html = `
    <html>
      <head>
        <title>AutoRoleBot Dashboard</title>
        <style>
          body { font-family: Arial; background: #111; color: #eee; text-align: center; padding: 50px; }
          .card { background: #222; padding: 20px; border-radius: 10px; display: inline-block; }
          button { background: #5865F2; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>AutoRoleBot Dashboard</h1>
          <p>Bot is online as <b>${client.user?.tag || 'Loading...'}</b></p>
          <p>Guilds: ${client.guilds.cache.size}</p>
          <p>Owner: <b>${process.env.BOT_OWNER_ID || 'Unknown'}</b></p>
          <button onclick="location.reload()">Refresh</button>
        </div>
      </body>
    </html>
  `;
  res.send(html);
});

// ---------- DISCORD COMMANDS ----------
const commands = [
  new SlashCommandBuilder()
    .setName('addswap')
    .setDescription('Add a new role swap rule')
    .addStringOption(opt => opt.setName('whenadded').setDescription('Role to trigger swap').setRequired(true))
    .addStringOption(opt => opt.setName('removerole').setDescription('Role to remove').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('listswaps')
    .setDescription('List all current role swap rules'),

  new SlashCommandBuilder()
    .setName('removeswap')
    .setDescription('Remove a role swap rule by role ID')
    .addStringOption(opt => opt.setName('roleid').setDescription('The role ID to remove').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('View the bot dashboard'),
];

// ---------- REGISTER COMMANDS ----------
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    console.log('⏳ Registering commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
      { body: commands.map(c => c.toJSON()) }
    );
    console.log('✅ Commands registered!');
  } catch (err) {
    console.error('❌ Error registering commands:', err);
  }
}

// ---------- DISCORD EVENTS ----------
client.once(Events.ClientReady, () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'addswap') {
    const whenAdded = interaction.options.getString('whenadded');
    const removeRole = interaction.options.getString('removerole');
    config.roleSwapRules.push({ whenAdded, removeRole });
    saveConfig();
    await interaction.reply({ content: `✅ Added swap: when ${whenAdded} is added, remove ${removeRole}`, ephemeral: true });
  }

  else if (commandName === 'listswaps') {
    const swaps = config.roleSwapRules.map(r => `🌀 When added: ${r.whenAdded} → Remove: ${r.removeRole}`).join('\n') || 'No swaps set.';
    await interaction.reply({ content: swaps, ephemeral: true });
  }

  else if (commandName === 'removeswap') {
    const roleId = interaction.options.getString('roleid');
    config.roleSwapRules = config.roleSwapRules.filter(r => r.whenAdded !== roleId);
    saveConfig();
    await interaction.reply({ content: `🗑️ Removed swap for role ${roleId}`, ephemeral: true });
  }

  else if (commandName === 'dashboard') {
    const dashboardUrl = `https://${process.env.DASHBOARD_URL}/dashboard`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Open Dashboard')
        .setStyle(ButtonStyle.Link)
        .setURL(dashboardUrl)
    );
    await interaction.reply({
      content: 'Click below to open the dashboard:',
      components: [row],
      ephemeral: true
    });
  }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
  for (const [id] of addedRoles) {
    for (const rule of config.roleSwapRules) {
      if (rule.whenAdded === id && newMember.roles.cache.has(rule.removeRole)) {
        await newMember.roles.remove(rule.removeRole);
        console.log(`🔄 Removed role ${rule.removeRole} from ${newMember.user.tag}`);
      }
    }
  }
});

// ---------- STARTUP ----------
server.listen(10000, () => console.log('🌐 Express server running on port 10000'));
client.login(process.env.DISCORD_BOT_TOKEN);
registerCommands();
