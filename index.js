const { Client, GatewayIntentBits, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');

// Load config or create default
let config = {
  roleSwapRules: []
};

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
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('💾 Configuration saved');
  } catch (err) {
    console.error('❌ Failed to save config.json:', err);
  }
}

// Create client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// Handle role swaps
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));

  for (const [addedRoleId] of addedRoles) {
    for (const rule of config.roleSwapRules) {
      if (rule.whenAdded === addedRoleId && newMember.roles.cache.has(rule.removeRole)) {
        const roleToRemove = newMember.guild.roles.cache.get(rule.removeRole);
        if (roleToRemove) {
          await newMember.roles.remove(roleToRemove);
          console.log(`🔄 Removed role ${roleToRemove.name} from ${newMember.user.tag}`);
        }
      }
    }
  }
});

// Simple slash commands to add/remove/view swaps
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  await interaction.deferReply({ ephemeral: true });

  if (commandName === 'add-swap') {
    const whenAdded = interaction.options.getRole('when_added');
    const removeRole = interaction.options.getRole('remove_role');

    config.roleSwapRules.push({
      whenAdded: whenAdded.id,
      removeRole: removeRole.id,
      whenAddedName: whenAdded.name,
      removeRoleName: removeRole.name
    });

    saveConfig();
    await interaction.editReply(`✅ Added swap: ${whenAdded.name} → remove ${removeRole.name}`);
  }

  else if (commandName === 'remove-swap') {
    const index = interaction.options.getInteger('number') - 1;
    if (index < 0 || index >= config.roleSwapRules.length) {
      return await interaction.editReply('❌ Invalid swap number');
    }
    const removed = config.roleSwapRules.splice(index, 1)[0];
    saveConfig();
    await interaction.editReply(`🗑️ Removed swap: ${removed.whenAddedName} → ${removed.removeRoleName}`);
  }

  else if (commandName === 'list-swaps') {
    if (config.roleSwapRules.length === 0) return await interaction.editReply('No role swaps set.');

    let text = '';
    config.roleSwapRules.forEach((rule, i) => {
      text += `${i + 1}. ${rule.whenAddedName} → remove ${rule.removeRoleName}\n`;
    });
    await interaction.editReply(text);
  }
});

// Login
const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('❌ DISCORD_BOT_TOKEN not set!');
  process.exit(1);
}
client.login(token);
