// ---------------- IMPORTS ----------------
const { Client, GatewayIntentBits, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, Routes } = require('discord.js');
const fs = require('fs');
const express = require('express');
const { REST } = require('@discordjs/rest');
require('dotenv').config(); // for DISCORD_BOT_TOKEN

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

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('💾 Saved config.json');
  } catch (err) {
    console.error('❌ Failed to save config.json:', err);
  }
}

// ---------------- DISCORD CLIENT ----------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// ---------------- EXPRESS SERVER ----------------
const app = express();
app.use(express.json());

app.get('/', (req, res) => res.send('RoleSwapBot is running!'));

// Dashboard page
app.get('/dashboard', (req, res) => {
  const swapsHtml = config.roleSwapRules.map(r => `<li>When Added: ${r.whenAdded} → Remove: ${r.removeRole}</li>`).join('');
  const uptime = process.uptime();
  const html = `
    <html>
      <head><title>RoleSwapBot Dashboard</title></head>
      <body>
        <h1>RoleSwapBot Dashboard</h1>
        <p>Uptime: ${Math.floor(uptime)} seconds</p>
        <p>Total Role Swaps: ${config.roleSwapRules.length}</p>
        <ul>${swapsHtml}</ul>
      </body>
    </html>
  `;
  res.send(html);
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🌐 Express server running on port ${PORT}`));

// ---------------- ROLE SWAP HANDLER ----------------
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

// ---------------- COMMANDS ----------------
const commands = [
  new SlashCommandBuilder().setName('addswap').setDescription('Add a role swap')
    .addStringOption(o => o.setName('whenadded').setDescription('Role ID to trigger').setRequired(true))
    .addStringOption(o => o.setName('removerole').setDescription('Role ID to remove').setRequired(true)),
  new SlashCommandBuilder().setName('listswaps').setDescription('List all role swaps'),
  new SlashCommandBuilder().setName('removeswap').setDescription('Remove a role swap by index')
    .addIntegerOption(o => o.setName('index').setDescription('Index of swap').setRequired(true)),
  new SlashCommandBuilder().setName('dashboard').setDescription('Open the bot dashboard'),
].map(cmd => cmd.toJSON());

// Register commands
client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot online as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
      { body: commands }
    );
    console.log(`✅ Commands registered for guild ${process.env.GUILD_ID}`);
  } catch (err) {
    console.error('❌ Error registering commands:', err);
  }
});

// Handle commands
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

  // ---------------- SLASH COMMANDS ----------------
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'addswap') {
      const whenAdded = interaction.options.getString('whenadded');
      const removeRole = interaction.options.getString('removerole');
      config.roleSwapRules.push({ whenAdded, removeRole });
      saveConfig();
      await interaction.reply({ content: `Added swap: ${whenAdded} → remove ${removeRole}`, ephemeral: true });

    } else if (commandName === 'listswaps') {
      if (config.roleSwapRules.length === 0) {
        await interaction.reply({ content: 'No role swaps configured.', ephemeral: true });
      } else {
        const list = config.roleSwapRules.map((r, i) => `${i}: When Added ${r.whenAdded} → Remove ${r.removeRole}`).join('\n');
        await interaction.reply({ content: list, ephemeral: true });
      }

    } else if (commandName === 'removeswap') {
      const index = interaction.options.getInteger('index');
      if (index < 0 || index >= config.roleSwapRules.length) {
        return interaction.reply({ content: 'Invalid index.', ephemeral: true });
      }
      const removed = config.roleSwapRules.splice(index, 1)[0];
      saveConfig();
      await interaction.reply({ content: `Removed swap: ${removed.whenAdded} → remove ${removed.removeRole}`, ephemeral: true });

    } else if (commandName === 'dashboard') {
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('Go to Dashboard')
            .setStyle(ButtonStyle.Link)
            .setURL(`${process.env.DASHBOARD_URL || `http://localhost:${PORT}/dashboard`}`)
        );
      await interaction.reply({ content: 'Click the button below to open the dashboard:', components: [row], ephemeral: true });
    }
  }
});

// ---------------- LOGIN ----------------
client.login(process.env.DISCORD_BOT_TOKEN);
