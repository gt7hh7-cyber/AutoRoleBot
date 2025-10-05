const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');

// Load config from file or use default
let config = { roleSwapRules: [] };
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath));
    console.log('✅ Loaded existing configuration from config.json');
  } catch (err) {
    console.error('❌ Failed to load config.json:', err);
  }
}

// Helper to save config
function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('💾 Configuration saved to config.json');
  } catch (err) {
    console.error('❌ Failed to save config.json:', err);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// ------------------- COMMANDS -------------------
const commands = [
  new SlashCommandBuilder()
    .setName('add-swap')
    .setDescription('Automatically remove a role when another role is added')
    .addRoleOption(option => option.setName('when_added').setDescription('Trigger role').setRequired(true))
    .addRoleOption(option => option.setName('remove_role').setDescription('Role to remove').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('remove-swap')
    .setDescription('Remove a role swap')
    .addIntegerOption(option => option.setName('number').setDescription('Rule number to remove').setRequired(true).setMinValue(1))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('view-config')
    .setDescription('View current role swap rules')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
].map(c => c.toJSON());

// ------------------- REGISTER COMMANDS -------------------
async function registerCommandsForGuild(guildId, clientId) {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    return true;
  } catch (err) {
    console.error(`❌ Failed to register commands for guild ${guildId}:`, err.message);
    return false;
  }
}

// ------------------- EVENTS -------------------
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Bot online as ${c.user.tag}`);
  for (const guild of c.guilds.cache.values()) {
    await registerCommandsForGuild(guild.id, c.user.id);
  }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
  for (const [id] of addedRoles) {
    for (const rule of config.roleSwapRules) {
      if (rule.whenAdded === id && newMember.roles.cache.has(rule.removeRole)) {
        const roleToRemove = newMember.guild.roles.cache.get(rule.removeRole);
        if (roleToRemove) await newMember.roles.remove(roleToRemove);
      }
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;
  await interaction.deferReply({ ephemeral: true });

  if (commandName === 'add-swap') {
    const whenAdded = interaction.options.getRole('when_added');
    const removeRole = interaction.options.getRole('remove_role');
    config.roleSwapRules.push({ whenAdded: whenAdded.id, removeRole: removeRole.id, whenAddedName: whenAdded.name, removeRoleName: removeRole.name });
    saveConfig();
    await interaction.editReply({ content: `🔄 Role swap added: ${whenAdded.name} → Remove ${removeRole.name}` });
  }

  else if (commandName === 'remove-swap') {
    const index = interaction.options.getInteger('number') - 1;
    if (index < 0 || index >= config.roleSwapRules.length) return await interaction.editReply({ content: '❌ Invalid rule number' });
    const removed = config.roleSwapRules.splice(index, 1)[0];
    saveConfig();
    await interaction.editReply({ content: `🗑️ Removed swap: ${removed.whenAddedName} → Remove ${removed.removeRoleName}` });
  }

  else if (commandName === 'view-config') {
    let text = `🔄 Role Swap Rules (${config.roleSwapRules.length}):\n`;
    config.roleSwapRules.forEach((rule, i) => {
      text += `${i + 1}. ${rule.whenAddedName} → Remove ${rule.removeRoleName}\n`;
    });
    await interaction.editReply({ content: text || 'No role swaps configured.' });
  }
});

// ------------------- LOGIN -------------------
const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('❌ DISCORD_BOT_TOKEN environment variable is not set!');
  process.exit(1);
}
client.login(token);
