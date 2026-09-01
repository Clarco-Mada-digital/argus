import http from 'node:http';
import { Engine } from '../core/engine.js';
import { renderHtml, ICONE_SVG } from '../report/html.js';
import { renderJson, renderMarkdown, renderSarif } from '../report/formats.js';

/**
 * Serveur local du tableau de bord.
 *
 * Il expose le rapport HTML sur `/`, une API JSON sur `/api/report`, et un flux
 * d'evenements sur `/api/events` pour suivre un scan en direct. Aucune donnee
 * ne sort de la machine : le serveur ecoute sur 127.0.0.1 par defaut.
 */
export async function startServer(config, { port = 4173, host = '127.0.0.1' } = {}) {
  let cache = null;
  let running = null;
  const clients = new Set();

  const broadcast = (event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) {
      try {
        client.write(payload);
      } catch {
        clients.delete(client);
      }
    }
  };

  async function scan({ force = false } = {}) {
    if (cache && !force) return cache;
    if (running) return running;

    running = new Engine(config, {
      onEvent: (event) => {
        if (event.type === 'done') return; // charge utile trop lourde pour le flux
        broadcast(event);
      },
    })
      .run()
      .then((result) => {
        cache = result;
        running = null;
        broadcast({ type: 'ready', score: result.scores.global, findings: result.findings.length });
        return result;
      })
      .catch((error) => {
        running = null;
        broadcast({ type: 'failed', message: error.message });
        throw error;
      });

    return running;
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    // Le tableau de bord est strictement local : on refuse toute origine tierce.
    const origin = request.headers.origin;
    if (origin && !origin.startsWith(`http://${host}`) && !origin.startsWith('http://localhost')) {
      response.writeHead(403).end('Origine refusee');
      return;
    }

    try {
      if (url.pathname === '/api/events') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        response.write(': connecte\n\n');
        clients.add(response);
        request.on('close', () => clients.delete(response));
        return;
      }

      if (url.pathname === '/api/report') {
        const result = await scan({ force: url.searchParams.has('refresh') });
        send(response, 200, 'application/json; charset=utf-8', renderJson(result));
        return;
      }

      if (url.pathname === '/api/report.sarif') {
        send(response, 200, 'application/json; charset=utf-8', renderSarif(await scan()));
        return;
      }

      if (url.pathname === '/api/report.md') {
        send(response, 200, 'text/markdown; charset=utf-8', renderMarkdown(await scan()));
        return;
      }

      if (url.pathname === '/favicon.svg' || url.pathname === '/favicon.ico') {
        // Le tableau de bord sert l'icone en fichier : un onglet ouvert en
        // permanence merite une marque nette plutot qu'un data URI reencode.
        send(response, 200, 'image/svg+xml; charset=utf-8', ICONE_SVG);
        return;
      }

      if (url.pathname === '/health') {
        send(response, 200, 'application/json', JSON.stringify({ status: 'ok', cached: Boolean(cache) }));
        return;
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        const result = await scan({ force: url.searchParams.has('refresh') });
        send(response, 200, 'text/html; charset=utf-8', withLiveControls(renderHtml(result)));
        return;
      }

      send(response, 404, 'text/plain; charset=utf-8', 'Introuvable');
    } catch (error) {
      send(response, 500, 'text/plain; charset=utf-8', `Erreur pendant l'analyse : ${error.message}`);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const actualPort = server.address().port;

  return {
    url: `http://${host}:${actualPort}`,
    port: actualPort,
    server,
    scan,
    close() {
      for (const client of clients) client.end();
      server.close();
    },
  };
}

function send(response, status, contentType, body) {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'self'",
  });
  response.end(body);
}

/**
 * Injecte dans le rapport statique les commandes propres au mode serveur :
 * bouton de relance, indicateur de progression et raccourci clavier.
 */
function withLiveControls(html) {
  const controls = `
<style>
  .argus-live {
    position: fixed; right: 20px; bottom: 20px; z-index: 100;
    display: flex; align-items: center; gap: 10px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 999px;
    padding: 8px 8px 8px 16px; box-shadow: var(--shadow); font-size: 13px;
  }
  .argus-live button {
    background: var(--accent); color: #fff; border: none; border-radius: 999px;
    padding: 6px 14px; font-weight: 600;
  }
  .argus-live button[disabled] { opacity: .6; cursor: progress; }
  .argus-live .status { color: var(--text-dim); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
<div class="argus-live">
  <span class="status" id="argus-status">Rapport a jour</span>
  <button type="button" id="argus-rescan">Relancer</button>
</div>
<script>
(function () {
  const status = document.getElementById('argus-status');
  const button = document.getElementById('argus-rescan');
  const labels = {
    indexing: 'Indexation des fichiers…', security: 'Analyse de securite…', routes: 'Analyse des routes…',
    deadcode: 'Recherche de code mort…', seo: 'Analyse SEO…', design: 'Design et accessibilite…',
    performance: 'Performance…', quality: 'Qualite du code…', dependencies: 'Dependances…',
  };

  const events = new EventSource('/api/events');
  events.onmessage = (message) => {
    const event = JSON.parse(message.data);
    if (event.type === 'phase') status.textContent = labels[event.phase] || event.message || 'Analyse…';
    if (event.type === 'ready') { status.textContent = 'Termine, rechargement…'; location.href = '/'; }
    if (event.type === 'failed') { status.textContent = 'Echec : ' + event.message; button.disabled = false; }
  };

  function rescan() {
    button.disabled = true;
    status.textContent = 'Analyse en cours…';
    fetch('/api/report?refresh=1').then(() => location.href = '/').catch(() => { button.disabled = false; });
  }

  button.addEventListener('click', rescan);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'r' && (e.metaKey || e.ctrlKey) && e.shiftKey) { e.preventDefault(); rescan(); }
  });
})();
</script>
`;
  return html.replace('</body>', `${controls}</body>`);
}
