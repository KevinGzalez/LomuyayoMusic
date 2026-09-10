import QuickChart from 'quickchart-js';
import {
  getPlaysByDay,
  getPlaysOverTime,
  getTopArtists,
  getTopSongs,
  getTopUsers,
} from './stats-db.js';

/**
 * Genera una barra de progreso visual en texto (ej. "████████▒▒▒▒")
 */
export function generateVisualBar(count, max, length = 10) {
  if (!max || max <= 0) return '░'.repeat(length);
  const ratio = Math.min(1, Math.max(0, count / max));
  const filled = Math.round(ratio * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

/**
 * Genera una URL de gráfico de QuickChart de forma instantánea sin peticiones de red en Node.js.
 * @param {string} guildId
 * @param {'day' | 'artist' | 'song' | 'user' | 'month'} chartType
 * @returns {string|null} URL de la imagen del gráfico
 */
export function generateChartUrl(guildId, chartType = 'day') {
  try {
    const chart = new QuickChart();
    chart.setWidth(600);
    chart.setHeight(320);
    chart.setDevicePixelRatio(2.0);
    chart.setBackgroundColor('#2f3136'); // Fondo oscuro Discord

    switch (chartType) {
      case 'day': {
        const data = getPlaysByDay(guildId);
        chart.setConfig({
          type: 'bar',
          data: {
            labels: data.map((d) => d.label),
            datasets: [{
              label: 'Canciones por día',
              data: data.map((d) => d.count),
              backgroundColor: 'rgba(88, 101, 242, 0.85)',
              borderColor: '#5865F2',
              borderWidth: 2,
              borderRadius: 6,
            }],
          },
          options: createChartOptions('📈 Reproducciones por Día (Semana)'),
        });
        break;
      }

      case 'month': {
        const data = getPlaysOverTime(guildId, 'month');
        chart.setConfig({
          type: 'line',
          data: {
            labels: data.map((d) => d.label),
            datasets: [{
              label: 'Reproducciones',
              data: data.map((d) => d.count),
              fill: true,
              backgroundColor: 'rgba(88, 101, 242, 0.25)',
              borderColor: '#5865F2',
              borderWidth: 3,
              tension: 0.3,
            }],
          },
          options: createChartOptions('📈 Reproducciones Último Mes'),
        });
        break;
      }

      case 'artist': {
        const artists = getTopArtists(guildId, 7);
        const labels = artists.length ? artists.map((a) => truncate(a.song_author, 18)) : ['Sin datos'];
        const counts = artists.length ? artists.map((a) => a.play_count) : [0];

        chart.setConfig({
          type: 'horizontalBar',
          data: {
            labels,
            datasets: [{
              label: 'Reproducciones',
              data: counts,
              backgroundColor: 'rgba(235, 69, 158, 0.85)',
              borderColor: '#eb459e',
              borderWidth: 2,
              borderRadius: 6,
            }],
          },
          options: createChartOptions('🎤 Top Artistas Más Escuchados'),
        });
        break;
      }

      case 'song': {
        const songs = getTopSongs(guildId, 7);
        const labels = songs.length ? songs.map((s) => truncate(s.song_title, 20)) : ['Sin datos'];
        const counts = songs.length ? songs.map((s) => s.play_count) : [0];

        chart.setConfig({
          type: 'horizontalBar',
          data: {
            labels,
            datasets: [{
              label: 'Reproducciones',
              data: counts,
              backgroundColor: 'rgba(87, 242, 135, 0.85)',
              borderColor: '#57f287',
              borderWidth: 2,
              borderRadius: 6,
            }],
          },
          options: createChartOptions('🏆 Top Canciones Más Escuchadas'),
        });
        break;
      }

      case 'user': {
        const users = getTopUsers(guildId, 6);
        const labels = users.length ? users.map((u) => truncate(u.user_tag, 16)) : ['Sin datos'];
        const counts = users.length ? users.map((u) => u.play_count) : [0];

        chart.setConfig({
          type: 'doughnut',
          data: {
            labels,
            datasets: [{
              data: counts,
              backgroundColor: [
                '#5865F2',
                '#57F287',
                '#FEE75C',
                '#EB459E',
                '#ED4245',
                '#99AAB5',
              ],
              borderColor: '#2f3136',
              borderWidth: 3,
            }],
          },
          options: {
            plugins: {
              title: {
                display: true,
                text: '👥 Usuarios Más Activos',
                fontColor: '#ffffff',
                fontSize: 16,
              },
              legend: {
                position: 'right',
                labels: {
                  fontColor: '#dcddde',
                  fontSize: 12,
                },
              },
            },
          },
        });
        break;
      }

      default:
        return generateChartUrl(guildId, 'day');
    }

    return chart.getUrl();
  } catch (error) {
    console.warn('[QuickChart URL]', error.message);
    return null;
  }
}

function createChartOptions(titleText) {
  return {
    title: {
      display: true,
      text: titleText,
      fontColor: '#ffffff',
      fontSize: 16,
      padding: 12,
    },
    legend: {
      display: false,
    },
    scales: {
      xAxes: [{
        ticks: {
          fontColor: '#b9bbbe',
          fontSize: 11,
          beginAtZero: true,
          precision: 0,
        },
        gridLines: {
          color: 'rgba(255, 255, 255, 0.08)',
        },
      }],
      yAxes: [{
        ticks: {
          fontColor: '#b9bbbe',
          fontSize: 11,
          beginAtZero: true,
          precision: 0,
        },
        gridLines: {
          color: 'rgba(255, 255, 255, 0.08)',
        },
      }],
    },
  };
}

function truncate(str, maxLength) {
  const text = String(str || '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
