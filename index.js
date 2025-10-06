// index.js
const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const express = require('express');

// ---------- CONFIG ----------
const configPath = './config.json';
let config = { roleSwapRules: [] };
if (fs.existsSync(configPath)) {
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); console.log('✅ Loaded config.json'); }
  catch (e) { console.error('❌ Failed reading config.json', e); }
}
function saveConfig() {
  try { fs.writeFileSync(configPath, JSON.stringify(config, null, 2)); console.log('💾 Saved config.json'); }
  catch (e) { console.error('❌ Failed saving config.json', e); }
}

// ---------- DISCORD CLIENT ----------
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

// ---------- SLASH COMMANDS (define) ----------
const commands = [
  new SlashCommandBuilder()
    .setName('addswap')
    .setDescription('Add a role swap rule (requires Manage Roles)')
    .addRoleOption(opt => opt.setName('whenadded').setDescription('Trigger role').setRequired(true))
    .addRoleOption(opt => opt.setName('removerole').setDescription('Role to remove').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('removeswap')
    .setDescription('Remove swap by number (requires Manage Roles)')
    .addIntegerOption(opt => opt.setName('number').setDescription('Swap number to remove').setRequired(true).setMinValue(1))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('listswaps')
    .setDescription('List all configured role swaps')
].map(c => c.toJSON());

// ---------- REGISTER COMMANDS (per guild) ----------
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

async function registerCommandsForGuild(guildId) {
  if (!process.env.DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN not set');
  try {
    console.log(`⏳ Registering commands for guild ${guildId}...`);
    await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID || client.user.id, guildId), { body: commands });
    console.log(`✅ Commands registered for guild ${guildId}`);
  } catch (err) {
    console.error(`❌ Failed to register commands for guild ${guildId}:`, err);
  }
}

// ---------- EVENT: READY ----------
client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  // Register commands to either the specified GUILD_ID or to every guild the bot is in
  const guildId = process.env.GUILD_ID;
  if (guildId) {
    await registerCommandsForGuild(guildId);
  } else {
    for (const g of client.guilds.cache.values()) {
      await registerCommandsForGuild(g.id).catch(()=>{});
    }
  }
});

// ---------- INTERACTION HANDLING ----------
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (!interaction.isChatInputCommand()) return;

    // quick logging to help debug
    console.log(`🔔 Interaction: ${interaction.commandName} from ${interaction.user.tag} in ${interaction.guild?.id}`);

    if (interaction.commandName === 'addswap') {
      await interaction.deferReply({ ephemeral: true });

      // permission check: user must have ManageRoles
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.editReply('❌ You need Manage Roles permission to add swaps.');
      }

      const whenAddedRole = interaction.options.getRole('whenadded');
      const removeRole = interaction.options.getRole('removerole');

      // sanity checks: roles must exist and bot must be able to manage roles
      const botMember = await interaction.guild.members.fetchMe();
      if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.editReply('❌ I need the "Manage Roles" permission to perform swaps.');
      }
      // role hierarchy: bot role must be higher than the role it will remove
      const botHighest = botMember.roles.highest.position;
      if (botHighest <= interaction.guild.roles.cache.get(removeRole.id).position) {
        return interaction.editReply('❌ My role must be higher than the role I should remove. Move my role above that role in server settings.');
      }

      config.roleSwapRules = config.roleSwapRules || [];
      config.roleSwapRules.push({
        whenAdded: whenAddedRole.id,
        removeRole: removeRole.id,
        whenAddedName: whenAddedRole.name,
        removeRoleName: removeRole.name
      });
      saveConfig();
      return interaction.editReply(`✅ Added swap: ${whenAddedRole.name} → remove ${removeRole.name}`);
    }

    if (interaction.commandName === 'removeswap') {
      await interaction.deferReply({ ephemeral: true });
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.editReply('❌ You need Manage Roles permission to remove swaps.');
      }
      const index = interaction.options.getInteger('number') - 1;
      if (!config.roleSwapRules || index < 0 || index >= config.roleSwapRules.length) {
        return interaction.editReply('❌ Invalid swap number.');
      }
      const removed = config.roleSwapRules.splice(index, 1)[0];
      saveConfig();
      return interaction.editReply(`🗑️ Removed swap: ${removed.whenAddedName} → remove ${removed.removeRoleName}`);
    }

    if (interaction.commandName === 'listswaps') {
      await interaction.deferReply({ ephemeral: true });
      if (!config.roleSwapRules || config.roleSwapRules.length === 0) {
        return interaction.editReply('⚠️ No role swaps configured.');
      }
      const list = config.roleSwapRules.map((r, i) => `${i + 1}. ${r.whenAddedName || r.whenAdded} → remove ${r.removeRoleName || r.removeRole}`).join('\n');
      return interaction.editReply(`🔄 Role swaps:\n${list}`);
    }

  } catch (err) {
    console.error('❌ Interaction handler error:', err);
    if (interaction && interaction.deferred) {
      await interaction.editReply('❌ An error occurred handling the command.');
    } else if (interaction && interaction.replied === false) {
      try { await interaction.reply({ content: '❌ An error occurred.', ephemeral: true }); } catch(e){}
    }
  }
});

// ---------- ROLE SWAP (on role add) ----------
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  try {
    if (!config.roleSwapRules || !Array.isArray(config.roleSwapRules)) return;
    const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    if (addedRoles.size === 0) return;

    for (const [id] of addedRoles) {
      for (const rule of config.roleSwapRules) {
        if (rule.whenAdded === id && newMember.roles.cache.has(rule.removeRole)) {
          const roleToRemove = newMember.guild.roles.cache.get(rule.removeRole);
          if (!roleToRemove) continue;
          // ensure bot permission & hierarchy before removing
          const botMember = await newMember.guild.members.fetchMe();
          if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            console.warn('Bot missing Manage Roles permission — cannot remove role');
            continue;
          }
          if (botMember.roles.highest.position <= roleToRemove.position) {
            console.warn('Bot role not high enough to remove role:', roleToRemove.id);
            continue;
          }

          await newMember.roles.remove(roleToRemove).catch(e => console.error('❌ Failed to remove role:', e));
          console.log(`🔄 Removed ${roleToRemove.name} from ${newMember.user.tag} (trigger ${id})`);
        }
      }
    }
  } catch (e) {
    console.error('❌ GuildMemberUpdate handler error:', e);
  }
});

// ---------- EXPRESS API ----------
const app = express();
app.use(express.json());
app.get('/', (req, res) => res.send('RoleSwapBot is running'));

app.post('/add-swap', (req, res) => {
  const { whenAdded, removeRole } = req.body;
  if (!whenAdded || !removeRole) return res.status(400).send('Missing whenAdded or removeRole');
  config.roleSwapRules = config.roleSwapRules || [];
  config.roleSwapRules.push({ whenAdded, removeRole });
  saveConfig();
  return res.send('Added');
});
app.get('/swaps', (req, res) => res.json(config.roleSwapRules));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🌐 Express server running on port ${PORT}`));

// ---------- START LOGON ----------
if (!process.env.DISCORD_BOT_TOKEN) {
  console.error('❌ Missing DISCORD_BOT_TOKEN env variable');
  process.exit(1);
}
client.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
  console.error('❌ client.login failed:', err);
});
