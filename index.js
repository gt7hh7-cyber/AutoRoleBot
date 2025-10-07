const { Client, GatewayIntentBits, Events, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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

// ---------- ENV VARIABLES ----------
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const OWNER_ID = process.env.OWNER_ID; // Your Discord ID

// ---------- DISCORD CLIENT ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// ---------- EVENTS ----------
client.once(Events.ClientReady, () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
});

// Role swap logic
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

// Homepage
app.get('/', (req, res) => res.send('RoleSwapBot is running!'));

// ---------- DASHBOARDS ----------

// Server dashboard (admin-only)
app.get('/dashboard/server/:guildId', async (req, res) => {
  const guildId = req.params.guildId;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return res.send('❌ Guild not found');

  // Only admins or owner can access
  // Here we just allow bot owner or guild owner
  const owner = await guild.fetchOwner();
  if (req.query.userId !== OWNER_ID && req.query.userId !== owner.id) {
    return res.send('❌ You do not have permission to access this dashboard');
  }

  const swaps = config.roleSwapRules.map(rule => `<li>${rule.whenAdded} → remove ${rule.removeRole}</li>`).join('');
  res.send(`
    <h1>Server Dashboard - ${guild.name}</h1>
    <ul>${swaps}</ul>
    <p>Add/Remove role swaps via Discord commands</p>
  `);
});

// Bot owner dashboard
app.get('/dashboard/bot', (req, res) => {
  if (req.query.userId !== OWNER_ID) return res.send('❌ Access denied');

  const guilds = client.guilds.cache.map(g => `<li>${g.name} (${g.id})</li>`).join('');
  res.send(`
    <h1>Bot Owner Dashboard</h1>
    <h2>Connected Guilds</h2>
    <ul>${guilds}</ul>
    <p>Manage role swaps using Discord commands</p>
  `);
});

// ---------- DISCORD COMMANDS ----------
const commands = [
  {
    name: 'dashboard',
    description: 'Get a link to the bot dashboard',
  },
  {
    name: 'listswaps',
    description: 'List all role swaps',
  },
  {
    name: 'removeswap',
    description: 'Remove a role swap',
    options: [
      {
        name: 'whenadded',
        type: 3, // STRING
        description: 'Role ID that triggers removal',
        required: true,
      },
    ],
  },
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log(`⏳ Registering commands for guild ${GUILD_ID}...`);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log(`✅ Commands registered for guild ${GUILD_ID}`);
  } catch (err) {
    console.error(err);
  }
})();

// ---------- INTERACTIONS ----------
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'dashboard') {
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setLabel('Server Dashboard')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://yourbot.onrender.com/dashboard/server/${interaction.guildId}?userId=${interaction.user.id}`),
        new ButtonBuilder()
          .setLabel('Bot Owner Dashboard')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://yourbot.onrender.com/dashboard/bot?userId=${interaction.user.id}`)
      );
    await interaction.reply({ content: 'Choose your dashboard:', components: [row], ephemeral: true });
  }

  if (commandName === 'listswaps') {
    if (!config.roleSwapRules.length) {
      await interaction.reply('No role swaps configured.');
    } else {
      const list = config.roleSwapRules.map(r => `${r.whenAdded} → remove ${r.removeRole}`).join('\n');
      await interaction.reply(`Current swaps:\n${list}`);
    }
  }

  if (commandName === 'removeswap') {
    const roleId = interaction.options.getString('whenadded');
    const index = config.roleSwapRules.findIndex(r => r.whenAdded === roleId);
    if (index === -1) {
      await interaction.reply('Role swap not found.');
    } else {
      config.roleSwapRules.splice(index, 1);
      saveConfig();
      await interaction.reply(`Removed swap for role ${roleId}`);
    }
  }
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🌐 Express server running on port ${PORT}`));

// ---------- LOGIN BOT ----------
client.login(TOKEN);
