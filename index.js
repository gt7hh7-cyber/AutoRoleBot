// ---------- IMPORTS ----------
const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder } = require('discord.js');
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
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// ---------- EXPRESS SERVER ----------
const app = express();
app.use(express.json());

app.get('/', (req, res) => res.send('RoleSwapBot is running!'));

// ---------- SLASH COMMAND REGISTRATION ----------
const commands = [
  new SlashCommandBuilder()
    .setName('addswap')
    .setDescription('Add a role swap rule')
    .addRoleOption(option => option.setName('whenadded').setDescription('Role to add').setRequired(true))
    .addRoleOption(option => option.setName('removerole').setDescription('Role to remove').setRequired(true))
].map(command => command.toJSON());

// Register slash commands per guild (replace YOUR_GUILD_ID)
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  try {
    console.log('🚀 Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Slash commands registered');
  } catch (error) {
    console.error(error);
  }
})();

// ---------- EVENTS ----------
client.once(Events.ClientReady, () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'addswap') {
    const whenAdded = interaction.options.getRole('whenadded').id;
    const removeRole = interaction.options.getRole('removerole').id;

    config.roleSwapRules.push({ whenAdded, removeRole });
    saveConfig();

    await interaction.reply({ content: `🔄 Added swap: <@&${whenAdded}> → remove <@&${removeRole}>`, ephemeral: true });
  }
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

// ---------- EXPRESS ENDPOINTS ----------
app.post('/add-swap', (req, res) => {
  const { whenAdded, removeRole } = req.body;
  if (!whenAdded || !removeRole) return res.status(400).send('Missing whenAdded or removeRole');

  config.roleSwapRules.push({ whenAdded, removeRole });
  saveConfig();
  res.send(`Added swap: ${whenAdded} → remove ${removeRole}`);
});

app.get('/swaps', (req, res) => res.json(config.roleSwapRules));

// ---------- START SERVER ----------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🌐 Express server running on port ${PORT}`));

// ---------- LOGIN BOT ----------
client.login(process.env.DISCORD_BOT_TOKEN);
