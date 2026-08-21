const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');

const lojas = {
  esportes: [
    "http://007007haoyuntiyu.x.yupoo.com",
    "https://aodong888.x.yupoo.com",
    "https://changjiangsports.x.yupoo.com",
    "https://dongshanstore.x.yupoo.com",
    "https://feitengsports.x.yupoo.com",
    "https://football-all.x.yupoo.com",
    "https://football-allyuanyan.x.yupoo.com",
    "https://qiumishijie.x.yupoo.com",
    "https://xingkong-sports.x.yupoo.com",
    "https://xingkong-sports.x.zhidian-inc.cn",
    "https://yiyisports2016.x.yupoo.com",
    "https://1215795243.x.yupoo.com",
    "https://1215795243.x.zhidian-inc.cn",
    "https://3179704378.x.yupoo.com",
    "https://407131796.x.yupoo.com",
    "https://8618320710438.x.yupoo.com",
    "https://8618320710438.x.zhidian-inc.cn"
  ],
  luxo: [
    "https://vipno1.x.yupoo.com",
    "https://gaoduan001.x.yupoo.com",
    "https://chenzhefuzhuang.x.yupoo.com",
    "https://chenzhefuzhuang.x.zhidian-inc.cn",
    "https://sanguomaoye666.x.yupoo.com",
    "https://yehecheng.x.yupoo.com",
    "https://ywq2000.x.yupoo.com",
    "https://dachang88.x.yupoo.com"
  ],
  outros: [
    "https://599152050.x.yupoo.com",
    "https://879322886k.x.yupoo.com",
    "https://aosendi.x.yupoo.com",
    "https://aowei2022.x.yupoo.com",
    "https://ax6789.x.yupoo.com",
    "https://huandong123.x.yupoo.com",
    "https://huandong123.x.zhidian-inc.cn",
    "https://huang456852.x.yupoo.com",
    "https://pp111115555.x.yupoo.com",
    "https://sf0594888.x.yupoo.com",
    "https://ting8899.x.yupoo.com",
    "https://ty-guoji2.x.yupoo.com"
  ]
};

const MAX_ABAS_SIMULTANEAS = 5;

const TERMOS_GENERICOS = new Set([
  'national', 'team', 'football', 'club', 'fc', 'rugby', 'union', 
  'seleção', 'selecao', 'clube', 'futebol', 'nacional'
]);

async function traduzir(texto, idiomaDestino) {
  try {
    // Corrige números de temporada juntos (ex: 2425 -> 24/25) para o tradutor não achar que é milhar
    let textoCorrigido = texto.replace(/(2223|2324|2425|2526|2627)/g, m => m.substring(0,2) + '/' + m.substring(2));
    
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${idiomaDestino}&dt=t&q=${encodeURIComponent(textoCorrigido)}`;
    const resposta = await fetch(url);
    const json = await resposta.json();
    return json[0][0][0].toLowerCase();
  } catch (erro) {
    return null;
  }
}

async function expandirTermoWiki(termo) {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(termo)}&utf8=&format=json&srlimit=1`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.query && data.query.search && data.query.search.length > 0) {
      let tituloOrig = data.query.search[0].title;
      let palavras = tituloOrig.split(' ');
      let tituloLimpo = palavras.filter(p => !TERMOS_GENERICOS.has(p.toLowerCase())).join(' ').trim();
      return tituloLimpo;
    }
  } catch (e) { }
  return termo;
}

class Scraper {
  constructor(emit) {
    this.emit = emit;
    this.browser = null;
    this.pausarExecucao = false;
    this.filaDeTarefas = [];
    this.albunsEncontrados = [];
    this.paginasLidas = 0;
    this.tarefasAtivas = 0;
  }

  stop() {
    this.pausarExecucao = true;
  }

  async run(query, category) {
    let respostaLimpa = query.trim().toLowerCase();
    let limiteRecentes = 0;
    const matchUltima = respostaLimpa.match(/^(últimas|ultimas|última|ultima)\s*(\d+)?\s*(.*)/);
    if (matchUltima) {
      const palavra = matchUltima[1];
      const numero = matchUltima[2];
      const resto = matchUltima[3];
      limiteRecentes = numero ? parseInt(numero, 10) : (palavra.endsWith('s') ? 5 : 1);
      respostaLimpa = resto.trim();
      if (!respostaLimpa) respostaLimpa = "camisa";
    }

    if (!respostaLimpa) return;

    // Dicionário Inteligente para evitar confusões comuns no futebol (ex: Santos vs Santos Laguna)
    const dicionarioFutebol = {
      'santos': { proibidas: ['laguna', 'diguna', '拉古纳', '帝古纳'] },
      'real': { proibidas: ['sociedad', 'betis', '皇家社会', '皇家贝蒂斯'] },
      'milan': { proibidas: ['inter', '国际米兰'] },
      'inter': { proibidas: ['miami', '迈阿密'] },
      'atletico': { proibidas: ['paranaense', 'mineiro', 'bilbao'] },
      'flamengo': { proibidas: [] }
    };

    // Extrair palavras proibidas customizadas (começando com -)
    const partes = respostaLimpa.split(/\s+/);
    let queryPositiva = [];
    let proibidasCustom = [];
    partes.forEach(p => {
      if (p.startsWith('-')) proibidasCustom.push(p.substring(1).toLowerCase());
      else queryPositiva.push(p);
    });
    respostaLimpa = queryPositiva.join(' ');

    if (!respostaLimpa) return;
    
    // Injetar proibições do dicionário inteligente silenciosamente
    const palavrasBusca = respostaLimpa.split(' ');
    for (const pb of palavrasBusca) {
      if (dicionarioFutebol[pb]) {
        // Só adiciona a proibida se o usuário não tiver digitado ela propositalmente
        const proibs = dicionarioFutebol[pb].proibidas.filter(p => !respostaLimpa.includes(p));
        proibidasCustom.push(...proibs);
      }
    }

    this.emit('search_info', { limit: limiteRecentes });

    const termosPt = respostaLimpa.split(',').map(t => t.trim()).filter(Boolean);
    let termosBase = [];
    
    for (const termo of termosPt) {
      termosBase.push(termo);
      this.emit('log', `⏳ Buscando termos relacionados para "${termo}"...`);
      const termoExpandido = await expandirTermoWiki(termo);
      if (termoExpandido && termoExpandido !== termo) {
         termosBase.push(termoExpandido);
         this.emit('log', `💡 Termo correlacionado encontrado: "${termoExpandido}"`);
      }
    }

    this.emit('log', `⏳ Traduzindo termos...`);
    let palavrasChaveSet = new Set();
    
    // Capitaliza a primeira letra de cada palavra para forçar o tradutor a tratar como nome próprio
    const toTitleCase = (str) => str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    
    for (const t of termosBase) {
      const termoProprio = toTitleCase(t);
      palavrasChaveSet.add(t); // mantem a original tbm
      const en = await traduzir(termoProprio, 'en'); if (en) palavrasChaveSet.add(en);
      const ru = await traduzir(termoProprio, 'ru'); if (ru) palavrasChaveSet.add(ru);
      const zh = await traduzir(termoProprio, 'zh-CN'); if (zh) palavrasChaveSet.add(zh);
    }

    const palavrasChaveExibicao = [...palavrasChaveSet].filter(Boolean);
    this.emit('log', `✅ Buscando por: [ ${palavrasChaveExibicao.join(' | ')} ]`);
    
    // Lowercase for the actual matching
    const palavrasChave = palavrasChaveExibicao.map(t => t.toLowerCase());
    
    const reqInfantil = /(infantil|crian[çc]a|kid|menino|menina|child)/i.test(respostaLimpa);
    const reqFeminino = /(feminin[oa]|mulher|woman|women|lady)/i.test(respostaLimpa);

    let palavrasProibidas = [];
    if (!reqInfantil) palavrasProibidas.push('kids', 'child', 'youth', '童', 'infantil', 'menino', 'menina', 'boy', 'girl');
    if (!reqFeminino) palavrasProibidas.push('women', 'woman', 'female', 'lady', 'ladies', '女', 'feminino', 'feminina', 'mulher');
    
    // Adicionar as proibidas inseridas pelo usuário
    if (proibidasCustom.length > 0) {
      palavrasProibidas.push(...proibidasCustom);
      for (const p of proibidasCustom) {
        const zh = await traduzir(toTitleCase(p), 'zh-CN');
        if (zh) palavrasProibidas.push(zh.toLowerCase());
      }
    }

    if (palavrasProibidas.length > 0) {
      this.emit('log', `🚫 Ocultando palavras e categorias indesejadas...`);
    }

    let dominiosUsados = [];
    if (category === 'esportes') dominiosUsados = lojas.esportes;
    else if (category === 'luxo') dominiosUsados = lojas.luxo;
    else if (category === 'outros') dominiosUsados = lojas.outros;
    else dominiosUsados = [...lojas.esportes, ...lojas.luxo, ...lojas.outros];

    this.filaDeTarefas = [];
    dominiosUsados.forEach(dominio => {
      palavrasChave.forEach(kw => {
        this.filaDeTarefas.push({ urlBase: dominio.replace(/\/$/, ''), keyword: kw, pagina: 1 });
      });
    });
    this.albunsEncontrados = [];
    this.paginasLidas = 0;
    this.tarefasAtivas = 0;
    this.pausarExecucao = false;

    await this.iniciarPesquisa(palavrasChave, limiteRecentes, palavrasProibidas, dominiosUsados.length);
  }

  async iniciarPesquisa(palavrasChave, limiteRecentes, palavrasProibidas, totalLojas) {
    this.emit('log', `🕷️ Iniciando Varredura Turbo (${MAX_ABAS_SIMULTANEAS} abas em ${totalLojas} Lojas)...`);
    
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    let tempoInicio = Date.now();

    const loopConsole = setInterval(() => {
      if (this.pausarExecucao) return clearInterval(loopConsole);
      const decorridoSec = (Date.now() - tempoInicio) / 1000;
      const vel = this.paginasLidas / (decorridoSec || 1);
      const restanteSecs = vel > 0 ? this.filaDeTarefas.length / vel : 0;
      const mm = Math.floor(restanteSecs / 60);
      const ss = Math.floor(restanteSecs % 60).toString().padStart(2, '0');
      
      this.emit('progress', {
         lidas: this.paginasLidas,
         fila: this.filaDeTarefas.length,
         encontrados: this.albunsEncontrados.length,
         eta: `${mm}m${ss}s`
      });
    }, 1000);

    const promessasWorkers = [];
    for (let i = 0; i < MAX_ABAS_SIMULTANEAS; i++) {
      promessasWorkers.push(this.workerAba(palavrasChave, palavrasProibidas));
    }

    await Promise.all(promessasWorkers);

    clearInterval(loopConsole);
    if (this.browser) await this.browser.close();
    
    if (this.albunsEncontrados.length > 0) {
      this.emit('log', '⏳ Organizando e traduzindo resultados para Português...');
      
      this.albunsEncontrados.forEach(a => {
         const match = a.link.match(/\/albums\/(\d+)/);
         a.id = match ? parseInt(match[1], 10) : 0;
      });
      this.albunsEncontrados.sort((a, b) => b.id - a.id);
      
      let resultadosFinais = this.albunsEncontrados;
      if (limiteRecentes > 0) {
        resultadosFinais = this.albunsEncontrados.slice(0, limiteRecentes);
      }
      
      let resultsArr = [];
      for (const item of resultadosFinais) {
        let tituloPt = await traduzir(item.titulo, 'pt');
        if (!tituloPt) tituloPt = item.titulo;
        resultsArr.push({ titulo: tituloPt.toUpperCase(), link: item.link, original: item.titulo, capa: item.capa });
      }
      this.emit('done', resultsArr);
    } else {
      this.emit('done', []);
    }
  }

  async workerAba(palavrasChave, palavrasProibidas) {
    const page = await this.browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
      else req.continue();
    });

    while (!this.pausarExecucao) {
      if (this.filaDeTarefas.length === 0) {
        if (this.tarefasAtivas === 0) break;
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      
      const tarefa = this.filaDeTarefas.shift();
      if (!tarefa) continue;
      
      this.tarefasAtivas++;
      const urlBusca = `${tarefa.urlBase}/search/album?uid=1&q=${encodeURIComponent(tarefa.keyword)}&page=${tarefa.pagina}`;

      try {
        await page.goto(urlBusca, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const dadosPagina = await page.evaluate(() => {
          const itens = Array.from(document.querySelectorAll('a.album__main'));
          return itens.map(album => {
            const imgEl = album.querySelector('img');
            let coverUrl = '';
            if (imgEl) {
              coverUrl = imgEl.getAttribute('data-src') || imgEl.getAttribute('src') || '';
              if (coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;
            }
            return {
              titulo: album.getAttribute('title') ? album.getAttribute('title').toLowerCase() : '',
              link: album.getAttribute('href'),
              capa: coverUrl
            };
          });
        });

        if (dadosPagina.length > 0) {
          this.filaDeTarefas.push({ urlBase: tarefa.urlBase, keyword: tarefa.keyword, pagina: tarefa.pagina + 1 });
          const matches = dadosPagina.filter(album => {
            const temKeyword = palavrasChave.some(kw => album.titulo.includes(kw));
            if (!temKeyword) return false;
            const temProibida = palavrasProibidas.some(kw => album.titulo.includes(kw));
            return !temProibida;
          });

          if (matches.length > 0) {
            for (const m of matches) {
              const linkCompleto = m.link.startsWith('http') ? m.link : tarefa.urlBase + m.link;
              
              // Evita duplicatas se o mesmo album vier de keywords diferentes
              if (this.albunsEncontrados.some(a => a.link === linkCompleto)) continue;

              this.albunsEncontrados.push({ titulo: m.titulo, link: linkCompleto, capa: m.capa });
              
              // Traduz em tempo real (em background) e emite para o frontend
              traduzir(m.titulo, 'pt').then(tituloPt => {
                this.emit('album_found', { 
                  titulo: (tituloPt || m.titulo).toUpperCase(), 
                  link: linkCompleto, 
                  original: m.titulo, 
                  capa: m.capa 
                });
              });
            }
          }
        }
      } catch (erro) {
      }
      this.tarefasAtivas--;
      this.paginasLidas++;
    }
    await page.close();
  }
}

module.exports = Scraper;
