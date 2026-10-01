// Busca las 2 prédicas más recientes del canal de YouTube y actualiza los dos
// bloques marcados con <!-- PREDICA:1 --> / <!-- PREDICA:2 --> en index.html.
//
// Se ejecuta automáticamente todos los días (.github/workflows/update-predicas.yml).
// También se puede correr a mano con: YOUTUBE_API_KEY=xxxx node scripts/update-predicas.mjs

import { readFileSync, writeFileSync } from 'node:fs';

const CHANNEL_ID = 'UCyhUR-hVJ0xJXlgWRJ7ucpw';
const API_KEY = process.env.YOUTUBE_API_KEY;
const HTML_PATH = new URL('../index.html', import.meta.url);

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

function formatearFecha(iso) {
  return new Date(iso).toLocaleDateString('es-EC', { day: 'numeric', month: 'long', year: 'numeric' });
}

// El canal nombra sus videos como "Título - Pr. Nombre -DD de Mes AAAA".
// Extraemos el título y el predicador de ahí, pero la FECHA siempre se toma
// de la API (publishedAt), que es la fuente confiable.
function partirTitulo(tituloCompleto) {
  const matchPredicador = tituloCompleto.match(/Pr\.\s*([^-]+)/i);
  const predicador = matchPredicador ? `Pr. ${matchPredicador[1].trim()}` : 'Iglesia Un Nuevo Comienzo';

  const matchTitulo = tituloCompleto.match(/^(.*?)\s*-\s*Pr\./i);
  const titulo = matchTitulo ? matchTitulo[1].trim() : tituloCompleto.trim();

  return { titulo, predicador };
}

async function obtenerUltimasPredicas() {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('key', API_KEY);
  url.searchParams.set('channelId', CHANNEL_ID);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('order', 'date');
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', '2');

  const respuesta = await fetch(url);
  if (!respuesta.ok) {
    throw new Error(`YouTube API respondió ${respuesta.status}: ${await respuesta.text()}`);
  }
  const datos = await respuesta.json();
  if (!datos.items || datos.items.length < 2) {
    throw new Error('La API no devolvió al menos 2 videos.');
  }
  return datos.items.slice(0, 2).map((item) => {
    const { titulo, predicador } = partirTitulo(item.snippet.title);
    return {
      id: item.id.videoId,
      titulo,
      subtitulo: `${predicador}, ${formatearFecha(item.snippet.publishedAt)}`,
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
