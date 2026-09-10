const $ = (selector) => document.querySelector(selector);
const guildSelect = $('#guild');
let guildId = localStorage.getItem('guildId');
let token = localStorage.getItem('dashboardToken') || '';
let latest = null;

function time(ms) { const seconds = Math.max(0, Math.floor((ms || 0) / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2200); }

async function loadGuilds() {
  const data = await fetch('/api/guilds').then((r) => r.json());
  guildSelect.innerHTML = data.guilds.map((g) => `<option value="${g.id}">${g.name}</option>`).join('');
  if (!data.guilds.length) throw new Error('El bot todavía no está conectado a servidores.');
  if (!data.guilds.some((g) => g.id === guildId)) guildId = data.guilds[0].id;
  guildSelect.value = guildId;
}

async function refresh() {
  if (!guildId) return;
  try {
    latest = await fetch(`/api/guild/${guildId}`).then((r) => r.json());
    if (latest.error) throw new Error(latest.error);
    render(latest); $('#status').textContent = '● EN LÍNEA';
  } catch (error) { $('#status').textContent = '● SIN CONEXIÓN'; }
}

function render(data) {
  const p = data.player; const current = p.current; const summary = data.stats.summary;
  $('#title').textContent = current?.title || 'Nada reproduciéndose';
  $('#artist').textContent = current?.author || 'Añade música desde Discord para comenzar';
  $('#duration').textContent = current?.duration || time(current?.durationMs);
  $('#elapsed').textContent = time(p.progressMs);
  $('#progress').style.width = `${current?.durationMs ? Math.min(100, p.progressMs / current.durationMs * 100) : 0}%`;
  $('#cover').style.backgroundImage = current?.thumbnail ? `url("${current.thumbnail.replaceAll('"', '')}")` : '';
  $('#cover').innerHTML = current?.thumbnail ? '' : '<span>♪</span>';
  $('#toggle').dataset.action = p.paused ? 'resume' : 'pause'; $('#toggle').textContent = p.paused ? '▶' : 'Ⅱ';
  document.querySelectorAll('.controls button').forEach((button) => { button.disabled = !p.active; });
  $('#plays').textContent = summary.totalPlays.toLocaleString();
  $('#hours').textContent = `${Math.floor(summary.totalDurationMs / 3600000)}h ${Math.floor(summary.totalDurationMs % 3600000 / 60000)}m`;
  $('#users').textContent = summary.activeUsersCount; $('#queued').textContent = p.queue.length; $('#channel').textContent = p.channel || 'Sin canal';
  $('#queue').innerHTML = p.queue.length ? p.queue.slice(0, 8).map((track, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span><div><b>${escapeHtml(track.title)}</b><small>${escapeHtml(track.author)}</small></div><em>${track.duration}</em></li>`).join('') : '<li class="empty">La cola está vacía</li>';
  const max = Math.max(1, ...data.stats.days.map((d) => d.count));
  $('#chart').innerHTML = data.stats.days.map((d) => `<div class="bar"><i style="height:${Math.max(3, d.count / max * 180)}px"></i>${d.label}<br><b>${d.count}</b></div>`).join('');
  const sleep = data.sleep;
  $('#sleepLabel').textContent = !sleep ? 'Apagado' : sleep.mode === 'track' ? 'Fin de canción' : time(sleep.remainingMs);
  $('#sleepDetail').textContent = !sleep ? 'La música seguirá sonando' : sleep.mode === 'track' ? 'Se detendrá al acabar esta pista' : `Se detendrá a las ${new Date(sleep.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value || ''; return div.innerHTML; }
async function action(body) {
  let response = await fetch(`/api/guild/${guildId}/control`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  if (response.status === 401) { const entered = prompt('Clave del dashboard:'); if (entered === null) return; token = entered; localStorage.setItem('dashboardToken', token); return action(body); }
  const result = await response.json(); if (!response.ok) return toast(result.error || 'No se pudo completar'); toast('Control aplicado'); setTimeout(refresh, 150);
}

document.addEventListener('click', (event) => { const button = event.target.closest('[data-action],[data-minutes]'); if (!button) return; action(button.dataset.minutes ? { action: 'sleep-minutes', minutes: Number(button.dataset.minutes) } : { action: button.dataset.action }); });
guildSelect.addEventListener('change', () => { guildId = guildSelect.value; localStorage.setItem('guildId', guildId); refresh(); });
await loadGuilds().then(refresh).catch((error) => toast(error.message)); setInterval(refresh, 3000);
