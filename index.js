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
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// ------------------- COMMANDS -------------------
const commands = [
  new SlashCommandBuilder()
    .setName('set-welcome-role')
    .setDescription('Set the role that new members automatically receive')
    .addRoleOption(option => option.setName('role').setDescription('Role to assign').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('remove-welcome-role')
    .setDescription('Remove the welcome role (stop auto-assigning roles)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

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
    .setDescription('View current auto-role configuration')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('reaction-role')
    .setDescription('Create a reaction role message')
    .addChannelOption(option => option.setName('channel').setDescription('Target channel').setRequired(true))
    .addStringOption(option => option.setName('message').setDescription('Message text').setRequired(true))
    .addStringOption(option => option.setName('emoji').setDescription('Emoji to react with').setRequired(true))
    .addRoleOption(option => option.setName('role').setDescription('Role to assign').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('add-reaction')
    .setDescription('Add another emoji + role to an existing reaction role message')
    .addStringOption(option => option.setName('message_id').setDescription('Message ID').setRequired(true))
    .addStringOption(option => option.setName('emoji').setDescription('Emoji to add').setRequired(true))
    .addRoleOption(option => option.setName('role').setDescription('Role to assign').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('list-reactions')
    .setDescription('View all reaction role messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('remove-reaction')
    .setDescription('Delete a reaction role message')
    .addStringOption(option => option.setName('message_id').setDescription('Message ID to remove').setRequired(true))
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

client.on(Events.GuildMemberAdd, async (member) => {
  if (config.welcomeRoleId) {
    const role = member.guild.roles.cache.get(config.welcomeRoleId);
    if (role) await member.roles.add(role);
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

  // --- Welcome Role Commands ---
  if (commandName === 'set-welcome-role') {
    const role = interaction.options.getRole('role');
    config.welcomeRoleId = role.id;
    saveConfig();
    await interaction.editReply({ content: `✅ Welcome role set to ${role.name}` });
  } else if (commandName === 'remove-welcome-role') {
    config.welcomeRoleId = null;
    saveConfig();
    await interaction.editReply({ content: `🗑️ Welcome role removed` });
  }

  // --- Role Swap Commands ---
  else if (commandName === 'add-swap') {
    const whenAdded = interaction.options.getRole('when_added');
    const removeRole = interaction.options.getRole('remove_role');
    config.roleSwapRules.push({ whenAdded: whenAdded.id, removeRole: removeRole.id, whenAddedName: whenAdded.name, removeRoleName: removeRole.name });
    saveConfig();
    await interaction.editReply({ content: `🔄 Role swap added: ${whenAdded.name} → Remove ${removeRole.name}` });
  } else if (commandName === 'remove-swap') {
    const index = interaction.options.getInteger('number') - 1;
    if (index < 0 || index >= config.roleSwapRules.length) return await interaction.editReply({ content: '❌ Invalid rule number' });
    const removed = config.roleSwapRules.splice(index, 1)[0];
    saveConfig();
    await interaction.editReply({ content: `🗑️ Removed swap: ${removed.whenAddedName} → Remove ${removed.removeRoleName}` });
  }

  else if (commandName === 'view-config') {
    let text = `👋 Welcome Role: ${config.welcomeRoleId ? `<@&${config.welcomeRoleId}>` : 'Not set'}\n`;
    text += `🔄 Role Swaps: ${config.roleSwapRules.length}\n⭐ Reaction Roles: ${Object.keys(config.reactionRoles).length}`;
    await interaction.editReply({ content: text });
  }

  // --- Reaction Role Commands ---
  else if (commandName === 'reaction-role') {
    const channel = interaction.options.getChannel('channel');
    const messageText = interaction.options.getString('message');
    const emojiInput = interaction.options.getString('emoji');
    const role = interaction.options.getRole('role');

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎭 Reaction Role')
      .setDescription(messageText)
      .addFields({ name: `${emojiInput} = ${role.name}`, value: `<@&${role.id}>` })
      .setFooter({ text: 'React to get your role!' });

    const sentMessage = await channel.send({ embeds: [embed] });
    await sentMessage.react(emojiInput);

    config.reactionRoles[sentMessage.id]
