// index.js
const { Client, GatewayIntentBits, Events, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000;

// ---------- CONFIG ----------
const configPath = path.join(__dirname, 'config.json');
let config = { roleSwapRules: [] };

if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath));
    console.log('✅ Loaded existing configuration from config.json');
  } catch (err) {
    console.error('❌ Failed to load config.json:', err);
  }
}

// Save config helper
function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('💾 Configuration saved');
}

// ---------- CLIENT ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// ---------- COMMANDS ----------
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
    .setName('list-swaps')
    .setDescription('View all role swaps')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
].map(c => c.toJSON());

// Register commands for a guild
const { REST, Routes } = require('discord.js');
async function registerCommandsForGuild(guildId, clientId) {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log(`✅ Commands registered for guild ${guildId}`);
  } catch (err) {
    console.error(`❌ Failed to register commands: ${err.message}`);
  }
}

// ---------- EVENTS ----------
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Bot online as ${c.user.tag}`);
  for (const guild of c.guilds.cache.values()) {
    await registerCommandsForGuild(guild.id, c.user.id);
  }
});

// Role swap logic
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (!config.roleSwapRules?.length) return;
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

// Interaction commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;
  await interaction.deferReply({ ephemeral: true });

  if (commandName === 'add-swap') {
    const whenAdded = interaction.options.getRole('when_added');
    const removeRole = interaction.options.getRole('remove_role');
    if (!config.roleSwapRules) config.roleSwapRules = [];
    config.roleSwapRules.push({ whenAdded: whenAdded.id, removeRole: removeRole.id });
    saveConfig();
    await interaction.editReply(`✅ Role swap added: ${whenAdded.name} → Remove ${removeRole.name}`);
  } else if (commandName === 'remove-swap') {
    const index = interaction.options.getInteger('number') - 1;
    if (!config.roleSwapRules || index < 0 || index >= config.roleSwapRules.length) {
      return interaction.editReply('❌ Invalid swap number');
    }
    const removed = config.roleSwapRules.splice(index, 1)[0];
    saveConfig();
    await interaction.editReply(`🗑️ Removed swap: ${removed.whenAdded} → ${removed.removeRole}`);
  } else if (commandName === 'list-swaps') {
    if (!config.roleSwapRules || !config.roleSwapRules.length) {
      return interaction.editReply('No swaps set.');
    }
    let text = '🔄 Role Swaps:\n';
    config.roleSwapRules.forEach((rule, i) => {
      text += `${i + 1}. ${rule.whenAdded} → Remove ${rule.removeRole}\n`;
    });
    await interaction.editReply(text);
  }
});

// ---------- LOGIN ----------
client.login(process.env.DISCORD_BOT_TOKEN);

// ---------- EXPRESS ----------
app.get('/', (req, res) => res.send('RoleSwapBot is running.'));
app.listen(PORT, () => console.log(`🌐 Express server running on port ${PORT}`));
