const { Client, GatewayIntentBits, Events } = require('discord.js');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

// ---------- CONFIG ----------
const configPath = './config.json';
let config = { roleSwapRules: [] };

if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath));
    console.log('✅ Loaded config.json');
  } catch (err) {
    console.error('❌ Failed to load config.json:', err);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('💾 Saved config.json');
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

// ---------- EXPRESS & SOCKET.IO SERVER ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- DASHBOARD HTML ----------
function renderDashboardHTML(title, bodyContent) {
  return `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8">
      <title>${title}</title>
      <style>
        body { font-family: Arial, sans-serif; background: #121212; color: #fff; margin: 0; padding: 0; }
        header { background: #1e1e1e; padding: 20px; text-align: center; }
        main { padding: 20px; max-width: 900px; margin: auto; }
        h1 { color: #f39c12; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th, td { padding: 12px; border-bottom: 1px solid #444; text-align: left; }
        th { background-color: #222; }
        tr:hover { background-color: #2a2a2a; }
        button { padding: 8px 16px; margin: 4px; border: none; border-radius: 4px; cursor: pointer; background-color: #f39c12; color: #000; }
        button:hover { background-color: #e67e22; }
        form { display: inline; }
        a { color: #f39c12; text-decoration: none; }
        a:hover { text-decoration: underline; }
      </style>
      <script src="/socket.io/socket.io.js"></script>
    </head>
    <body>
      <header><h1>${title}</h1></header>
      <main>${bodyContent}</main>
      <script>
        const socket = io();

        socket.on('updateSwaps', data => {
          const tableBody = document.querySelector('#swapsTable tbody');
          if (!tableBody) return;

          tableBody.innerHTML = '';
          data.forEach(s => {
            const row = document.createElement('tr');
            row.innerHTML = \`
              <td>\${s.whenAdded}</td>
              <td>\${s.removeRole}</td>
              <td>
                <form method="POST" action="/remove-swap">
                  <input type="hidden" name="whenAdded" value="\${s.whenAdded}">
                  <input type="hidden" name="guildId" value="\${s.guildId}">
                  <button type="submit">Remove</button>
                </form>
              </td>
            \`;
            tableBody.appendChild(row);
          });
        });
      </script>
    </body>
  </html>`;
}

// ---------- DASHBOARD ROUTES ----------
// Bot Owner Dashboard
app.get('/owner-dashboard', (req, res) => {
  if (req.query.ownerId !== process.env.OWNER_ID) return res.status(403).send('Forbidden');

  let guildsHtml = '<ul>';
  client.guilds.cache.forEach(g => {
    guildsHtml += `<li>${g.name} - <a href="/server-dashboard?guildId=${g.id}&ownerId=${req.query.ownerId}">Open Dashboard</a></li>`;
  });
  guildsHtml += '</ul>';

  res.send(renderDashboardHTML('Bot Owner Dashboard', guildsHtml));
});

// Server Admin Dashboard (limited)
app.get('/server-dashboard', (req, res) => {
  const { guildId, ownerId } = req.query;
  if (!guildId) return res.status(400).send('Guild ID required');

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return res.status(404).send('Guild not found');

  let swapsHtml = '<table id="swapsTable"><thead><tr><th>When Added Role ID</th><th>Remove Role ID</th><th>Actions</th></tr></thead><tbody>';
  config.roleSwapRules.filter(r => r.guildId === guildId).forEach(s => {
    swapsHtml += `<tr>
      <td>${s.whenAdded}</td>
      <td>${s.removeRole}</td>
      <td>
        <form method="POST" action="/remove-swap">
          <input type="hidden" name="guildId" value="${guildId}">
          <input type="hidden" name="whenAdded" value="${s.whenAdded}">
          <button type="submit">Remove</button>
        </form>
      </td>
    </tr>`;
  });
  swapsHtml += '</tbody></table>';

  swapsHtml += `
    <form method="POST" action="/add-swap">
      <input type="hidden" name="guildId" value="${guildId}">
      <input name="whenAdded" placeholder="Role ID to watch" required>
      <input name="removeRole" placeholder="Role ID to remove" required>
      <button type="submit">Add Swap</button>
    </form>
    <br>
    <a href="/owner-dashboard?ownerId=${ownerId}">Back to Owner Dashboard</a>
  `;

  res.send(renderDashboardHTML(`${guild.name} Dashboard`, swapsHtml));
});

// ---------- ADD/REMOVE SWAPS ----------
app.post('/add-swap', (req, res) => {
  const { guildId, whenAdded, removeRole } = req.body;
  if (!guildId || !whenAdded || !removeRole) return res.status(400).send('Missing fields');

  config.roleSwapRules.push({ guildId, whenAdded, removeRole });
  saveConfig();
  io.emit('updateSwaps', config.roleSwapRules);
  res.redirect(`/server-dashboard?guildId=${guildId}&ownerId=${process.env.OWNER_ID}`);
});

app.post('/remove-swap', (req, res) => {
  const { guildId, whenAdded } = req.body;
  config.roleSwapRules = config.roleSwapRules.filter(r => r.whenAdded !== whenAdded || r.guildId !== guildId);
  saveConfig();
  io.emit('updateSwaps', config.roleSwapRules);
  res.redirect(`/server-dashboard?guildId=${guildId}&ownerId=${process.env.OWNER_ID}`);
});

// ---------- TEST ROUTE ----------
app.get('/', (req, res) => res.send(renderDashboardHTML('RoleSwapBot', `<p>Bot is running! Go to <a href="/owner-dashboard?ownerId=${process.env.OWNER_ID}">Owner Dashboard</a></p>`)));

// ---------- START SERVER ----------
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🌐 Express server running on port ${PORT}`));

// ---------- LOGIN BOT ----------
client.login(process.env.DISCORD_BOT_TOKEN);
