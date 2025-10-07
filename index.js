// ---------- IMPORTS ----------
const { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes, ButtonBuilder, ButtonStyle, ActionRowBuilder, InteractionType } = require('discord.js');
const fs = require('fs');
const express = require('express');

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
  new SlashCommandBuilder()
    .setName('listswaps')
    .setDescription('List all role swap rules'),
  new SlashCommandBuilder()
    .setName('removeswap')
    .setDescription('Remove a role swap rule')
    .addStringOption(option => option.setName('role').setDescription('Role ID to remove').setRequired(true)),
  new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Open the bot dashboard')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
(async () => {
  try {
    console.log('⏳ Registering commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Commands registered');
  } catch (err) {
    console.error(err);
  }
})();

// ---------- BOT EVENTS ----------
client.once(Events.ClientReady, () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
});

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

// ---------- INTERACTIONS ----------
client.on('interactionCreate', async interaction => {
  if (interaction.type !== InteractionType.ApplicationCommand) return;

  if (interaction.commandName === 'listswaps') {
    if (!config.roleSwapRules.length) return interaction.reply({ content: 'No swaps defined', ephemeral: true });
    const list = config.roleSwapRules.map(r => `${r.whenAdded} → remove ${r.removeRole}`).join('\n');
    return interaction.reply({ content: `Current swaps:\n${list}`, ephemeral: true });
  }

  if (interaction.commandName === 'removeswap') {
    const roleId = interaction.options.getString('role');
    const index = config.roleSwapRules.findIndex(r => r.whenAdded === roleId);
    if (index === -1) return interaction.reply({ content: 'Rule not found', ephemeral: true });
    config.roleSwapRules.splice(index, 1);
    saveConfig();
    return interaction.reply({ content: `Removed rule for role ${roleId}`, ephemeral: true });
  }

  if (interaction.commandName === 'dashboard') {
    // Check bot owner
    const isOwner = interaction.user.id === process.env.BOT_OWNER_ID;
    if (!isOwner && !interaction.member.permissions.has('Administrator')) {
      return interaction.reply({ content: 'You do not have permission to access the dashboard', ephemeral: true });
    }

    const button = new ButtonBuilder()
      .setLabel('Go to Dashboard')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://${process.env.DASHBOARD_URL}`); // set your dashboard domain

    const row = new ActionRowBuilder().addComponents(button);

    return interaction.reply({ content: 'Open the bot dashboard:', components: [row], ephemeral: true });
  }
});

// ---------- EXPRESS SERVER ----------
const app = express();
app.use(express.json());

// Home route
app.get('/', (req, res) => res.send('RoleSwapBot is running!'));

// Dashboard page (for bot owner)
app.get('/dashboard', (req, res) => {
  // Optionally verify owner by query or auth
  res.send(`
    <html>
      <head><title>RoleSwapBot Dashboard</title></head>
      <body>
        <h1>RoleSwapBot Dashboard</h1>
        <p>Manage your bot here.</p>
        <h2>Role Swap Rules</h2>
        <ul>
          ${config.roleSwapRules.map(r => `<li>${r.whenAdded} → remove ${r.removeRole}</li>`).join('')}
        </ul>
        <p>Visit <a href="/">Home</a></p>
      </body>
    </html>
  `);
});

// Add swap API route
app.post('/add-swap', (req, res) => {
  const { whenAdded, removeRole } = req.body;
  if (!whenAdded || !removeRole) return res.status(400).send('Missing whenAdded or removeRole');

  config.roleSwapRules.push({ whenAdded, removeRole });
  saveConfig();
  res.send(`Added swap: ${whenAdded} → remove ${removeRole}`);
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🌐 Express server running on port ${PORT}`));

// ---------- LOGIN BOT ----------
client.login(process.env.DISCORD_BOT_TOKEN);
