const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, Partials, EmbedBuilder } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const config = {
  welcomeRoleId: null,
  roleSwapRules: [],
  reactionRoles: {},
};

function parseEmojiKey(emojiInput) {
  const customEmojiMatch = emojiInput.match(/<a?:(\w+):(\d+)>/);
  if (customEmojiMatch) {
    return customEmojiMatch[2];
  }
  return emojiInput;
}

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
].map(command => command.toJSON());

async function registerCommandsForGuild(guildId, clientId) {
  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );
    return true;
  } catch (error) {
    console.error(`❌ Failed to register commands for guild ${guildId}:`, error.message);
    return false;
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Bot is online as ${c.user.tag}`);
  console.log(`📋 Monitoring ${c.guilds.cache.size} server(s)`);

  console.log('🔄 Registering slash commands for all servers...');
  let successCount = 0;
  let failCount = 0;

  for (const guild of c.guilds.cache.values()) {
    const success = await registerCommandsForGuild(guild.id, c.user.id);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log(`✅ Commands registered: ${successCount} succeeded, ${failCount} failed`);
  console.log(`\n⚙️ Auto-Role Configuration:`);
  console.log(`   Welcome Role: ${config.welcomeRoleId || 'Not configured'}`);
  console.log(`   Role Swaps: ${config.roleSwapRules.length} swap(s)`);
});

client.on(Events.GuildCreate, async (guild) => {
  console.log(`🆕 Bot joined new server: ${guild.name}`);
  const success = await registerCommandsForGuild(guild.id, client.user.id);
  if (success) console.log(`✅ Commands registered for ${guild.name}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;
  try {
    // Command handling logic here (set-welcome-role, remove-welcome-role, etc.)
    // You can paste the full command handling logic from your previous code here
  } catch (error) {
    console.error(`❌ Error handling command ${commandName}:`, error.message);
  }
});

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('❌ DISCORD_BOT_TOKEN not set!');
  process.exit(1);
}

client.login(token).catch((error) => {
  console.error('❌ Failed to login:', error.message);
  process.exit(1);
});
