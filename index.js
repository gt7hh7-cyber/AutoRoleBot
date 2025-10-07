const { Client, GatewayIntentBits, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
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
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🌐 Express server running on port ${PORT}`));

// ---------- SLASH COMMANDS ----------
const commands = [
  new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Open the bot dashboard'),

  new SlashCommandBuilder()
    .setName('listswaps')
    .setDescription('List all role swap rules'),

  new SlashCommandBuilder()
    .setName('addswap')
    .setDescription('Add a new role swap')
    .addStringOption(option => option.setName('whenadded').setDescription('Role to trigger removal').setRequired(true))
    .addStringOption(option => option.setName('removerole').setDescription('Role to remove').setRequired(true)),

  new SlashCommandBuilder()
    .setName('removeswap')
    .setDescription('Remove a role swap by index')
    .addIntegerOption(option => option.setName('index').setDescription('Index of swap rule').setRequired(true))
].map(cmd => cmd.toJSON());

// Register commands with your guild
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
(async () => {
  try {
    console.log(`⏳ Registering commands for guild ${process.env.DISCORD_GUILD_ID}...`);
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
      { body: commands },
    );
    console.log(`✅ Commands registered for guild ${process.env.DISCORD_GUILD_ID}`);
  } catch (err) {
    console.error(err);
  }
})();

// ---------- EVENTS ----------
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

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

  // Handle slash commands
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'dashboard') {
      const embed = new EmbedBuilder()
        .setTitle('🤖 Bot Dashboard')
        .setDescription('Welcome to the AutoRoleBot Dashboard! Click the button below to visit it.')
        .setColor(0x00FFFF)
        .setThumbnail(client.user.displayAvatarURL())
        .addFields(
          { name: 'Role Swaps Configured', value: `${config.roleSwapRules.length}`, inline: true },
          { name: 'Bot Status', value: '🟢 Online', inline: true },
        )
        .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('Open Dashboard')
            .setStyle(ButtonStyle.Link)
            .setURL('https://your-dashboard-link.com') // Replace with your actual dashboard URL
        );

      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    if (commandName === 'listswaps') {
      if (!config.roleSwapRules.length) return interaction.reply({ content: 'No role swap rules defined.', ephemeral: true });
      const list = config.roleSwapRules.map((r, i) => `${i + 1}. When role <@&${r.whenAdded}> is added, remove <@&${r.removeRole}>`).join('\n');
      await interaction.reply({ content: list, ephemeral: true });
    }

    if (commandName === 'addswap') {
      const whenAdded = interaction.options.getString('whenadded');
      const removeRole = interaction.options.getString('removerole');
      config.roleSwapRules.push({ whenAdded, removeRole });
      saveConfig();
      await interaction.reply({ content: `Added swap: <@&${whenAdded}> → remove <@&${removeRole}>`, ephemeral: true });
    }

    if (commandName === 'removeswap') {
      const index = interaction.options.getInteger('index') - 1;
      if (index < 0 || index >= config.roleSwapRules.length) return interaction.reply({ content: 'Invalid index.', ephemeral: true });
      const removed = config.roleSwapRules.splice(index, 1)[0];
      saveConfig();
      await interaction.reply({ content: `Removed swap: <@&${removed.whenAdded}> → <@&${removed.removeRole}>`, ephemeral: true });
    }
  }
});

// ---------- LOGIN ----------
client.login(process.env.DISCORD_BOT_TOKEN);
