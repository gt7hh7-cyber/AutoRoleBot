const { Client, GatewayIntentBits, Partials, Events, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

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
  if (customEmojiMatch) return customEmojiMatch[2];
  return emojiInput;
}

// Define your slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('set-welcome-role')
    .setDescription('Set the role that new members automatically receive')
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('The role to assign to new members')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  // Add your other commands here, similar to above...
].map(cmd => cmd.toJSON());

async function registerCommandsForGuild(guildId, clientId) {
  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    return true;
  } catch (error) {
    console.error(`Failed to register commands for guild ${guildId}:`, error.message);
    return false;
  }
}

client.once(Events.ClientReady, async c => {
  console.log(`Bot online as ${c.user.tag}`);
  for (const guild of c.guilds.cache.values()) {
    await registerCommandsForGuild(guild.id, c.user.id);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  if (commandName === 'set-welcome-role') {
    await interaction.deferReply({ ephemeral: true });
    const role = interaction.options.getRole('role');
    config.welcomeRoleId = role.id;

    const embed = new EmbedBuilder()
      .setColor(0x00FF88)
      .setTitle('Welcome Role Configured')
      .setDescription(`New members will automatically receive: <@&${role.id}>`)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    console.log(`Welcome role set to: ${role.name}`);
  }

  // Add other command handlers here (remove-welcome-role, add-swap, reaction-role, etc.)
});

client.on(Events.GuildMemberAdd, async member => {
  if (!config.welcomeRoleId) return;
  try {
    const role = member.guild.roles.cache.get(config.welcomeRoleId);
    if (role) await member.roles.add(role);
  } catch (err) {
    console.error('Error assigning welcome role:', err.message);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);