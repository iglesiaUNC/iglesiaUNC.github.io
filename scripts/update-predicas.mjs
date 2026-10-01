// Busca las 2 prédicas más recientes del canal de YouTube y actualiza los dos
// bloques marcados con <!-- PREDICA:1 --> / <!-- PREDICA:2 --> en index.html.
//
// Se ejecuta automáticamente todos los días (.github/workflows/update-predicas.yml).
// También se puede correr a mano con: YOUTUBE_API_KEY=xxxx node scripts/update-predicas.mjs

import { readFileSync, writeFileSync } from 'node:fs';

const CHANNEL_ID = 'UCyhUR-hVJ0xJXlgWRJ7ucpw';
const API_KEY = process.env.YOUTUBE_API_KEY;
const HTML_PATH = new URL('../index.html', import.meta.url);
// El canal también sube YouTube Shorts (clips verticales cortos) que no son
// prédicas completas. Los descartamos por duración: una prédica real dura
// varios minutos; un Short dura máximo 1 minuto. Usamos 3 minutos de margen.
const DURACION_MINIMA_SEGUNDOS = 180;

if (!API_KEY) {
  console.error('Falta la variable de entorno YOUTUBE_API_KEY.');
  process.exit(1);
}

function escapeHtml(texto) {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatearFecha(fecha) {
  return fecha.toLocaleDateString('es-EC', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const MESES = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};

// Los 2 videos a mostrar se eligen por fecha de SUBIDA (publishedAt), sin
// importar cuándo se predicaron. Pero para el texto que se muestra en la
// tarjeta usamos la fecha que el título trae escrita a mano ("...-DD de Mes
// AAAA"), porque es la fecha real de la prédica y puede no coincidir con la
// de subida. Si el título no trae fecha, se usa publishedAt como respaldo.
function extraerFechaDeTitulo(tituloCompleto) {
  const m = tituloCompleto.match(/(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+(\d{4})/i);
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase()];
  if (mes === undefined) return null;
  return new Date(Date.UTC(Number(m[3]), mes, Number(m[1])));
}

// El canal nombra sus videos como "Título - Pr. Nombre -DD de Mes AAAA".
function partirTitulo(tituloCompleto) {
  const matchPredicador = tituloCompleto.match(/Pr\.\s*([^-]+)/i);
  const predicador = matchPredicador ? `Pr. ${matchPredicador[1].trim()}` : 'Iglesia Un Nuevo Comienzo';

  const matchTitulo = tituloCompleto.match(/^(.*?)\s*-\s*Pr\./i);
  const titulo = matchTitulo ? matchTitulo[1].trim() : tituloCompleto.trim();

  return { titulo, predicador };
}

// ISO 8601 ("PT1H2M10S") -> segundos
function duracionEnSegundos(iso8601) {
  const m = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const [, h, min, s] = m;
  return (Number(h) || 0) * 3600 + (Number(min) || 0) * 60 + (Number(s) || 0);
}

async function buscarVideosRecientes() {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('key', API_KEY);
  url.searchParams.set('channelId', CHANNEL_ID);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('order', 'date');
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', '15'); // de sobra para que, tras filtrar Shorts, queden al menos 2

  const respuesta = await fetch(url);
  if (!respuesta.ok) {
    throw new Error(`YouTube API (search) respondió ${respuesta.status}: ${await respuesta.text()}`);
  }
  const datos = await respuesta.json();
  return (datos.items || []).map((item) => item.id.videoId);
}

async function obtenerDuraciones(ids) {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('key', API_KEY);
  url.searchParams.set('id', ids.join(','));
  url.searchParams.set('part', 'snippet,contentDetails');

  const respuesta = await fetch(url);
  if (!respuesta.ok) {
    throw new Error(`YouTube API (videos) respondió ${respuesta.status}: ${await respuesta.text()}`);
  }
  const datos = await respuesta.json();
  return datos.items || [];
}

async function obtenerUltimasPredicas() {
  const ids = await buscarVideosRecientes();
  if (ids.length === 0) {
    throw new Error('La API no devolvió ningún video del canal.');
  }

  const detalles = await obtenerDuraciones(ids);
  const predicas = detalles
    .filter((v) => duracionEnSegundos(v.contentDetails.duration) >= DURACION_MINIMA_SEGUNDOS)
    .sort((a, b) => new Date(b.snippet.publishedAt) - new Date(a.snippet.publishedAt));

  if (predicas.length < 2) {
    throw new Error('No encontré al menos 2 videos que no sean Shorts.');
  }

  return predicas.slice(0, 2).map((item) => {
    const { titulo, predicador } = partirTitulo(item.snippet.title);
    const fecha = extraerFechaDeTitulo(item.snippet.title) || new Date(item.snippet.publishedAt);
    return {
      id: item.id,
      titulo,
      subtitulo: `${predicador}, ${formatearFecha(fecha)}`,
    };
  });
}

function bloqueHtml(numero, video) {
  const titulo = escapeHtml(video.titulo);
  const subtitulo = escapeHtml(video.subtitulo);
  return (
    `<!-- PREDICA:${numero} -->\n` +
    `        <article class="reveal">\n` +
    `          <button class="video-lite" data-id="${video.id}" aria-label="Reproducir: ${titulo}"><span class="play"><svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></svg></span></button>\n` +
    `          <div class="video-info"><h3>${titulo}</h3><p>${subtitulo}</p></div>\n` +
    `        </article>\n` +
    `        <!-- /PREDICA:${numero} -->`
  );
}

function reemplazarBloque(html, numero, nuevoBloque) {
  const patron = new RegExp(
    `<!-- PREDICA:${numero} -->[\\s\\S]*?<!-- /PREDICA:${numero} -->`
  );
  if (!patron.test(html)) {
    throw new Error(`No encontré los marcadores PREDICA:${numero} en index.html`);
  }
  return html.replace(patron, nuevoBloque);
}

const [video1, video2] = await obtenerUltimasPredicas();

let html = readFileSync(HTML_PATH, 'utf8');
html = reemplazarBloque(html, 1, bloqueHtml(1, video1));
html = reemplazarBloque(html, 2, bloqueHtml(2, video2));
writeFileSync(HTML_PATH, html);

console.log('Prédicas actualizadas:');
console.log(' 1.', video1.titulo, '-', video1.id);
console.log(' 2.', video2.titulo, '-', video2.id);
