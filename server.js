const express = require('express');
const path = require('path');
const Scraper = require('./scraper');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let currentScraper = null;

app.get('/api/search', (req, res) => {
  const query = req.query.q;
  const category = req.query.c || 'todas';
  if (!query) return res.status(400).send('Query required');

  // SSE Setup
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const emit = (type, data) => {
    res.write('event: ' + type + '\ndata: ' + JSON.stringify(data) + '\n\n');
  };

  if (currentScraper) {
    currentScraper.stop();
  }

  currentScraper = new Scraper(emit);
  
  currentScraper.run(query, category).then(() => {
    emit('finished', true);
    res.end();
  }).catch(err => {
    emit('log', 'Erro interno: ' + err.message);
    emit('finished', false);
    res.end();
  });

  req.on('close', () => {
    if (currentScraper) currentScraper.stop();
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor rodando na porta ' + PORT);
});
