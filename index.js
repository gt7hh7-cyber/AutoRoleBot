const { Client, GatewayIntentBits, Events } = require('discord.js');
const fs = require('fs');
const express = require('express');
const app = express();

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

// ---------- EXPRESS SERVER ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Dashboard homepage
app.get('/', (req, res) => {
  const swapsHtml = config.roleSwapRules.map(rule =>
    `<tr><td>${rule.whenAdded}</td><td>${rule.removeRole}</td></tr>`
  ).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>RoleSwapBot Dashboard</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body class="bg-light">
      <div class="container py-5">
        <h1 class="mb-4">RoleSwapBot Dashboard</h1>

        <h3>Current Role Swaps</h3>
        <table class="table table-striped">
          <thead>
            <tr>
              <th>Role Added (ID)</th>
              <th>Role to Remove (ID)</th>
            </tr>
          </thead>
          <tbody>
            ${swapsHtml || '<tr><td colspan="2">No swaps configured yet</td></tr>'}
          </tbody>
        </table>

        <hr>
        <h3>Add Swap</h3>
        <form method="POST" action="/add-swap" class="mb-4">
          <div class="mb-3">
            <label class="form-label">Role Added (ID):</label>
            <input type="text" name="whenAdded" class="form-control" required>
          </div>
          <div class="mb-3">
            <label class="form-label">Role to Remove (ID):</label>
            <input type="text" name="removeRole" class="form-control" required>
          </div>
          <button type="submit" class="btn btn-primary">Add Swap</button>
        </form>

        <hr>
        <h3>Test Role Swap</h3>
        <form method="POST" action="/test-swap">
          <div class="mb-3">
            <label class="form-label">Role Added (ID):</label>
            <input type="text" name="roleAddedId" class="form-control" required>
          </div>
          <div class="mb-3">
            <label class="form-label">Test Member Name/ID:</label>
            <input type="text" name="testMember" class="form-control" required>
          </div>
          <button type="submit" class="btn btn-secondary">Run Test</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

// Add a role swap rule
app.post('/add-swap', (req, res) => {
  const { whenAdded, removeRole } = req.body;
  if (!whenAdded || !removeRole) return res.status(400).send('Missing whenAdded or removeRole');

  config.roleSwapRules.push({ whenAdded, removeRole });
  saveConfig();
  res.redirect('/');
});

// Test role swap without changing roles
app.post('/test-swap', (req, res) => {
  const { roleAddedId, testMember } = req.body;
  if (!roleAddedId || !testMember) return res.status(400).send('Missing roleAddedId or testMember');

  const swapsTriggered = config.roleSwapRules.filter(rule => rule.whenAdded === roleAddedId);

  if (swapsTriggered.length === 0) {
    return res.send(`No swaps triggered for role ID ${roleAddedId}<br><a href="/">Back</a>`);
  }

  const results = swapsTriggered.map(rule =>
    `If role ${roleAddedId} was added, role ${rule.removeRole} would be removed.`
  );

  res.send(`
    <h3>Test Results for Member ${testMember}</h3>
    <ul>
      ${results.map(r => `<li>${r}</li>`).join('')}
    </ul>
    <a href="/">Back to dashboard</a>
  `);
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🌐 Express server running on port ${PORT}`));

// ---------- LOGIN BOT ----------
const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('❌ No token found in DISCORD_BOT_TOKEN');
} else {
  client.login(token);
}
