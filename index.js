// ---------- IMPORTS ----------
const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

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
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

// ---------- SLASH COMMANDS ----------
const commands = [
  new SlashCommandBuilder().setName('listswaps').setDescription('List all role swap rules'),
  new SlashCommandBuilder().setName('addswap').setDescription('Add a role swap rule')
    .addStringOption(option => option.setName('whenadded').setDescription('Role ID added').setRequired(true))
    .addStringOption(option => option.setName('removerole').setDescription('Role ID to remove').setRequired(true)),
  new SlashCommandBuilder().setName('removeswap').setDescription('Remove a role swap rule')
    .addStringOption(option => option.setName('index').setDescription('Index of rule').setRequired(true)),
  new SlashCommandBuilder().setName('dashboard').setDescription('Open the bot dashboard'),
  new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
  new SlashCommandBuilder().setName('botinfo').setDescription('Get info about the bot'),
  new SlashCommandBuilder().setName('serverinfo').setDescription('Get info about this server')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  try {
    console.log('⏳ Registering commands...');
    await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log('✅ Commands registered!');
  } catch (err) {
    console.error(err);
  }
})();

// ---------- EVENTS ----------
client.once(Events.ClientReady, () => console.log(`✅ Bot online as ${client.user.tag}`));

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

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

  // ---------- SLASH COMMAND RESPONSES ----------
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'ping') return interaction.reply({ content: `🏓 Pong! Latency: ${client.ws.ping}ms`, ephemeral: true });
    
    if (commandName === 'botinfo') {
      return interaction.reply({ content: `🤖 Bot: ${client.user.tag}\nID: ${client.user.id}`, ephemeral: true });
    }

    if (commandName === 'serverinfo') {
      return interaction.reply({ content: `🛡️ Server: ${interaction.guild.name}\nMembers: ${interaction.guild.memberCount}\nID: ${interaction.guild.id}`, ephemeral: true });
    }

    if (commandName === 'listswaps') {
      if (!config.roleSwapRules.length) return interaction.reply({ content: 'No role swaps configured', ephemeral: true });
      const list = config.roleSwapRules.map((r, i) => `${i + 1}: ${r.whenAdded} → remove ${r.removeRole}`).join('\n');
      return interaction.reply({ content: `📄 Role swaps:\n${list}`, ephemeral: true });
    }

    if (commandName === 'addswap') {
      const whenAdded = interaction.options.getString('whenadded');
      const removeRole = interaction.options.getString('removerole');
      config.roleSwapRules.push({ whenAdded, removeRole });
      saveConfig();
      return interaction.reply({ content: `✅ Added swap: ${whenAdded} → remove ${removeRole}`, ephemeral: true });
    }

    if (commandName === 'removeswap') {
      const index = parseInt(interaction.options.getString('index'), 10) - 1;
      if (index < 0 || index >= config.roleSwapRules.length) return interaction.reply({ content: '❌ Invalid index', ephemeral: true });
      const removed = config.roleSwapRules.splice(index, 1)[0];
      saveConfig();
      return interaction.reply({ content: `🗑️ Removed swap: ${removed.whenAdded} → remove ${removed.removeRole}`, ephemeral: true });
    }

    if (commandName === 'dashboard') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Open Dashboard').setStyle(ButtonStyle.Link).setURL('https://your-dashboard-url.com')
      );
      return interaction.reply({ content: '🚀 Click the button to open the bot dashboard', components: [row], ephemeral: true });
    }
  }

  // ---------- BUTTON INTERACTIONS ----------
  if (interaction.isButton()) {
    return interaction.reply({ content: 'Button clicked!', ephemeral: true });
  }
});

// ---------- EXPRESS SERVER + DASHBOARD ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public')); // serve static HTML/CSS/JS for dashboard

app.get('/', (req, res) => res.send('RoleSwapBot server running!'));

// Bot dashboard endpoint
app.get('/dashboard', (req, res) => {
  res.sendFile(__dirname + '/public/dashboard.html');
});

// Live update socket
io.on('connection', socket => {
  console.log('🔌 Dashboard client connected');
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🌐 Express server running on port ${PORT}`));

// ---------- LOGIN BOT ----------
client.login(process.env.DISCORD_BOT_TOKEN);
