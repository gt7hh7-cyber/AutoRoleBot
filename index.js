// index.js - Full bot + OAuth2 dashboard for RoleSwapBot
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs');
const fetch = global.fetch; // Node 18+ has global fetch
const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder
} = require('discord.js');

// ---------- CONFIG / ENV ----------
const {
  DISCORD_BOT_TOKEN,
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  OAUTH_CALLBACK_URL,
  SESSION_SECRET,
  PORT = 10000
} = process.env;

if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !OAUTH_CALLBACK_URL || !SESSION_SECRET) {
  console.error('❌ Missing required environment variables. Set DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, OAUTH_CALLBACK_URL, SESSION_SECRET.');
  process.exit(1);
}

const CONFIG_PATH = './config.json';
let config = { roleSwapRules: {} }; // { roleSwapRules: { [guildId]: [ {whenAdded, removeRole}, ... ] } }
if (fs.existsSync(CONFIG_PATH)) {
  try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); console.log('✅ Loaded config.json'); }
  catch (e) { console.error('❌ Failed to parse config.json, starting fresh', e); }
}
function saveConfig() {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); console.log('💾 Saved config.json'); }
  catch (e) { console.error('❌ Failed to save config.json', e); }
}

// ---------- DISCORD CLIENT ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// Role swap logic: when a role is added, check for rules in that guild
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  try {
    const guildId = newMember.guild.id;
    const rules = (config.roleSwapRules && config.roleSwapRules[guildId]) || [];
    if (!Array.isArray(rules) || rules.length === 0) return;

    const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    if (addedRoles.size === 0) return;

    for (const [addedRoleId] of addedRoles) {
      for (const rule of rules) {
        if (rule.whenAdded === addedRoleId && newMember.roles.cache.has(rule.removeRole)) {
          const roleToRemove = newMember.guild.roles.cache.get(rule.removeRole);
          if (!roleToRemove) continue;
          const botMember = await newMember.guild.members.fetchMe();
          if (!botMember.permissions.has('ManageRoles')) {
            console.warn('Bot missing Manage Roles; cannot remove role');
            continue;
          }
          if (botMember.roles.highest.position <= roleToRemove.position) {
            console.warn('Bot role not high enough to remove role:', roleToRemove.id);
            continue;
          }
          await newMember.roles.remove(roleToRemove).catch(err => console.error('Failed to remove role:', err));
          console.log(`🔄 Removed role ${roleToRemove.name} from ${newMember.user.tag} in ${newMember.guild.name}`);
        }
      }
    }
  } catch (err) {
    console.error('Error in GuildMemberUpdate handler:', err);
  }
});

client.once(Events.ClientReady, () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
});

// ---------- EXPRESS + SESSIONS + OAUTH ----------
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set('trust proxy', 1); // if behind a proxy like Render

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' ? true : false }
}));

// ---------- HELPERS ----------
const OAUTH_BASE = 'https://discord.com/api/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const API_BASE = 'https://discord.com/api';

function oauthAuthorizeURL() {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: OAUTH_CALLBACK_URL,
    response_type: 'code',
    scope: 'identify guilds'
  });
  return `${OAUTH_BASE}?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const params = new URLSearchParams();
  params.append('client_id', DISCORD_CLIENT_ID);
  params.append('client_secret', DISCORD_CLIENT_SECRET);
  params.append('grant_type', 'authorization_code');
  params.append('code', code);
  params.append('redirect_uri', OAUTH_CALLBACK_URL);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  return res.json();
}

async function getUserGuilds(access_token) {
  const res = await fetch(`${API_BASE}/users/@me/guilds`, { headers: { Authorization: `Bearer ${access_token}` } });
  if (!res.ok) throw new Error('Failed to fetch guilds');
  return res.json();
}

function hasManageRoles(permBitfield) {
  // Manage Roles permission bit is: 1 << 28 = 268435456
  const MANAGE_ROLES = 1 << 28;
  return (BigInt(permBitfield) & BigInt(MANAGE_ROLES)) !== 0n;
}

// ---------- ROUTES: Public ----------
app.get('/', (req, res) => {
  res.send(`<h2>RoleSwapBot</h2><p><a href="/login">Login with Discord</a> to manage guild role swaps.</p>`);
});

app.get('/login', (req, res) => {
  res.redirect(oauthAuthorizeURL());
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Missing code');
  try {
    const tokenData = await exchangeCodeForToken(code);
    // tokenData.access_token, refresh_token, expires_in
    req.session.oauth = tokenData;
    // fetch user guilds and store
    const guilds = await getUserGuilds(tokenData.access_token);
    req.session.guilds = guilds;
    res.redirect('/dashboard');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('OAuth error');
  }
});

// ---------- LOGIN CHECK MIDDLEWARE ----------
function requireLogin(req, res, next) {
  if (req.session && req.session.oauth && req.session.guilds) return next();
  res.redirect('/login');
}

// ---------- DASHBOARD (GUI) ----------
app.get('/dashboard', requireLogin, (req, res) => {
  const userGuilds = req.session.guilds || [];
  // show only guilds where user has Manage Roles
  const manageable = userGuilds.filter(g => hasManageRoles(g.permissions));
  let html = `<!doctype html><html><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>RoleSwapBot Dashboard</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
    </head><body class="bg-light"><div class="container py-4">
    <h1>RoleSwapBot Dashboard</h1>
    <p>Logged in (Discord OAuth). Manage swaps for a server where you have Manage Roles.</p>
    <div class="row">`;

  if (manageable.length === 0) {
    html += `<div class="col-12"><div class="alert alert-warning">No manageable guilds found (you need Manage Roles).</div></div>`;
  } else {
    manageable.forEach(g => {
      html += `<div class="col-md-6">
        <div class="card mb-3">
          <div class="card-body">
            <h5 class="card-title">${g.name}</h5>
            <p class="card-text">ID: ${g.id}</p>
            <a href="/guild/${g.id}" class="btn btn-primary">Manage ${g.name}</a>
          </div>
        </div>
      </div>`;
    });
  }

  html += `</div>
    <hr>
    <p><a href="/">Back</a> · <a href="/logout">Logout</a></p>
    </div></body></html>`;
  res.send(html);
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---------- GUILD ADMIN UI ----------
app.get('/guild/:id', requireLogin, (req, res) => {
  const guildId = req.params.id;
  const userGuilds = req.session.guilds || [];
  const guild = userGuilds.find(g => g.id === guildId);
  if (!guild || !hasManageRoles(guild.permissions)) {
    return res.status(403).send('You are not allowed to manage this guild.');
  }

  const swaps = (config.roleSwapRules && config.roleSwapRules[guildId
