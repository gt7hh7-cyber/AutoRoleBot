const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, Partials, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');

// Load config from file or use default
let config = {
  welcomeRoleId: null,
  roleSwapRules: [],
  reactionRoles: {},
};

if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath));
    console.log('✅ Loaded existing configuration from config.json');
  } catch (err) {
    console.error('❌ Failed to load config.json:', err);
  }
}

// Helper to save config to file
function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('💾 Configuration saved to config.json');
  } catch (err) {
    console.error('❌ Failed to save config.json:', err);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// ------------------- COMMANDS -------------------
const commands = [
  new SlashCommandBuilder()
    .setName('set-welcome-role')
    .setDescription('Set the role that new members automatically receive')
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('The role to assign to new members')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('remove-welcome-role')
    .setDescription('Remove the welcome role (stop auto-assigning roles to new members)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('add-swap')
    .setDescription('Automatically remove a role when another role is added')
    .addRoleOption(option =>
      option.setName('when_added')
        .setDescription('When this role is added...')
        .setRequired(true))
    .addRoleOption(option =>
      option.setName('remove_role')
        .setDescription('...automatically remove this role')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('remove-swap')
    .setDescription('Remove a role swap')
    .addIntegerOption(option =>
      option.setName('number')
        .setDescription('The swap number to remove (use /view-config to see numbers)')
        .setRequired(true)
        .setMinValue(1))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('view-config')
    .setDescription('View current auto-role configuration')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('reaction-role')
    .setDescription('Create a reaction role message')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel to send the message in')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('message')
        .setDescription('The message text')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('emoji')
        .setDescription('Emoji to react with')
        .setRequired(true))
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('Role to give when emoji is clicked')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('add-reaction')
    .setDescription('Add another emoji + role to an existing reaction role message')
    .addStringOption(option =>
      option.setName('message_id')
        .setDescription('ID of the reaction role message')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('emoji')
        .setDescription('Emoji to add')
        .setRequired(true))
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('Role to give for this emoji')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('list-reactions')
    .setDescription('View all reaction role messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('remove-reaction')
    .setDescription('Delete a reaction role message')
    .addStringOption(option =>
      option.setName('message_id')
        .setDescription('ID of the message to remove')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
].map(c => c.toJSON());

// Register commands
async function registerCommandsForGuild(guildId, clientId) {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );
    return true;
  } catch (err) {
    console.error(`❌ Failed to register commands for guild ${guildId}:`, err.message);
    return false;
  }
}

// ------------------- EVENTS -------------------
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Bot is online as ${c.user.tag}`);
  console.log(`📋 Monitoring ${c.guilds.cache.size} server(s)`);

  console.log('🔄 Registering slash commands for all servers...');
  let successCount = 0;
  let failCount = 0;

  for (const guild of c.guilds.cache.values()) {
    const success = await registerCommandsForGuild(guild.id, c.user.id);
    if (success) successCount++;
    else failCount++;
  }

  console.log(`✅ Commands registered: ${successCount} succeeded, ${failCount} failed`);
  console.log('⚙️ Auto-RoleBot is ready and persistent!');
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (config.welcomeRoleId) {
    const role = member.guild.roles.cache.get(config.welcomeRoleId);
    if (role) await member.roles.add(role);
  }
});

// Role swap logic
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
  for (const [roleId] of addedRoles) {
    for (const rule of config.roleSwapRules) {
      if (rule.whenAdded === roleId) {
        const roleToRemove = newMember.guild.roles.cache.get(rule.removeRole);
        if (roleToRemove && newMember.roles.cache.has(roleToRemove.id)) {
          await newMember.roles.remove(roleToRemove);
        }
      }
    }
  }
});

// Reaction role logic
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch();

  const messageData = config.reactionRoles[reaction.message.id];
  if (!messageData) return;

  const emojiKey = reaction.emoji.id || reaction.emoji.name;
  const roleId = messageData.reactions[emojiKey];
  if (!roleId) return;

  const member = await reaction.message.guild.members.fetch(user.id);
  const role = reaction.message.guild.roles.cache.get(roleId);
  if (role && !member.roles.cache.has(role.id)) await member.roles.add(role);
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch();

  const messageData = config.reactionRoles[reaction.message.id];
  if (!messageData) return;

  const emojiKey = reaction.emoji.id || reaction.emoji.name;
  const roleId = messageData.reactions[emojiKey];
  if (!roleId) return;

  const member = await reaction.message.guild.members.fetch(user.id);
  const role = reaction.message.guild.roles.cache.get(roleId);
  if (role && member.roles.cache.has(role.id)) await member.roles.remove(role);
});

// ------------------- INTERACTION HANDLING -------------------
// Handles all slash commands including welcome, swap, reaction roles
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;
  await interaction.deferReply({ ephemeral
