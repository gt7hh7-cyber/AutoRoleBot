// ------------------- IMPORTS -------------------
const { Client, GatewayIntentBits, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');
const express = require('express');

// ------------------- CONFIG -------------------
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

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('💾 Configuration saved to config.json');
  } catch (err) {
    console.error('❌ Failed to save config.json:', err);
  }
}

// ------------------- DISCORD CLIENT -------------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once(Events.ClientReady, () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (!Array.isArray(config.roleSwapRules)) return;
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
  await interaction.deferReply({ ephemeral: true });

  if (interaction.commandName === 'add-swap') {
    const whenAdded = interaction.options.getRole('when_added');
    const removeRole = interaction.options.getRole('remove_role');
    config.roleSwapRules.push({ whenAdded: whenAdded.id, removeRole: removeRole.id });
    saveConfig();
    await interaction.editReply(`🔄 Role swap added: ${whenAdded.name} → Remove ${removeRole.name}`);
  } else if (interaction.commandName === 'remove-swap') {
    const index = interaction.options.getInteger('number') - 1;
    if (index < 0 || index >= config.roleSwapRules.length)
      return await interaction.editReply('❌ Invalid rule number');
    const removed = config.roleSwapRules.splice(index, 1)[0];
    saveConfig();
    await interaction.editReply(`🗑️ Removed swap: ${removed.whenAdded} → ${removed.removeRole}`);
  }
});

// ------------------- LOGIN -------------------
const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('❌ DISCORD_BOT_TOKEN environment variable is not set!');
  process.exit(1);
}
client.login(token);

// ------------------- EXPRESS SERVER -------------------
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('🤖 RoleSwapBot is running!');
});

app.listen(PORT, () => {
  console.log(`🌐 Express server running on port ${PORT}`);
});
