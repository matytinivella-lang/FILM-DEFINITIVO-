/* Film Esame Cinema — script.js
   Ora la TMDB API key NON è più hardcoded: puoi impostarla in localStorage o tramite la UI.
   Esempio (console del browser):
     localStorage.setItem('TMDB_API_KEY', 'la_tua_chiave');

   Oppure chiama in runtime:
     window.setTMDBKey('la_tua_chiave');

   Il codice legge sempre la chiave da localStorage; se non è presente,
   le chiamate TMDB non verranno effettuate ma l'app continua a funzionare.
*/

const STATE_KEY = 'filmEsameState_v1';
const THEME_KEY = 'filmEsameTheme';
const POSTER_CACHE_PREFIX = 'tmdbPoster_';
const filmsUrl = 'films.json';

let films = [];
let state = {}; // { [id]: { watched:bool, rating:int, notes:string } }
let posterCache = {};

/* Entry */
document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  loadState();
  initUI();
  loadFilms();
});

/* TMDB key accessor: read ONLY from localStorage */
function getStoredTmdbKey(){
  return localStorage.getItem('TMDB_API_KEY') || '';
}

/* Optional runtime helper to set the key and trigger poster fetch */
window.setTMDBKey = function(key){
  if(!key) return;
  localStorage.setItem('TMDB_API_KEY', key);
  // kick off background fetch e re-render
  fetchAllPosters().then(() => renderFilms());
};

/* Theme */
function loadTheme(){
  const t = localStorage.getItem(THEME_KEY) || 'dark';
  document.body.classList.toggle('light-theme', t === 'light');
  const toggle = document.getElementById('themeToggle');
  if(toggle) {
    toggle.checked = (t === 'light');
    toggle.addEventListener('change', (e) => {
      const mode = e.target.checked ? 'light' : 'dark';
      document.body.classList.toggle('light-theme', mode === 'light');
      localStorage.setItem(THEME_KEY, mode);
    });
  }
}

/* State persistence (avoid redundant writes) */
function loadState(){
  try {
    const raw = localStorage.getItem(STATE_KEY);
    state = raw ? JSON.parse(raw) : {};
  } catch(e) {
    console.error('Errore parsing stato locale', e);
    state = {};
  }
}
function saveState(){
  try {
    const json = JSON.stringify(state);
    if(localStorage.getItem(STATE_KEY) === json) return; // nothing changed
    localStorage.setItem(STATE_KEY, json);
  } catch(e){
    console.error('Errore salvataggio stato locale', e);
  }
}

/* UI init (defensive: verifica gli elementi prima di usarli) */
function initUI(){
  const search = document.getElementById('search');
  const sort = document.getElementById('sort');
  const reset = document.getElementById('resetProgress');

  if(search) search.addEventListener('input', renderFilmsDebounced);
  if(sort) sort.addEventListener('change', renderFilms);
  if(reset) reset.addEventListener('click', () => {
    if(!confirm('Azzera tutti i progressi? Questa azione non è reversibile.')) return;
    state = {};
    saveState();
    renderFilms();
  });

  // TMDB key controls
  const tmdbInput = document.getElementById('tmdbKeyInput');
  const saveBtn = document.getElementById('saveTmdbKey');
  const clearBtn = document.getElementById('clearTmdbKey');
  if(tmdbInput) tmdbInput.value = getStoredTmdbKey();
  if(saveBtn && tmdbInput) saveBtn.addEventListener('click', () => {
    const v = tmdbInput.value && tmdbInput.value.trim();
    if(!v){ alert('Inserisci una chiave TMDB valida.'); return; }
    localStorage.setItem('TMDB_API_KEY', v);
    // refresh posters
    fetchAllPosters().then(() => renderFilms());
    alert('Chiave TMDB salvata. I poster verranno scaricati in background.');
  });
  if(clearBtn){
    clearBtn.addEventListener('click', () => {
      localStorage.removeItem('TMDB_API_KEY');
      if(tmdbInput) tmdbInput.value = '';
      // clear poster cache entries
      try {
        Object.keys(localStorage).forEach(k => { if(k && k.startsWith(POSTER_CACHE_PREFIX)) localStorage.removeItem(k); });
        posterCache = {};
        renderFilms();
      } catch(e){ /* ignore */ }
      alert('Chiave TMDB rimossa e cache poster cancellata.');
    });
  }

  // import/export state
  const exportBtn = document.getElementById('exportState');
  const importBtn = document.getElementById('importState');
  const importFile = document.getElementById('importFile');
  if(exportBtn) exportBtn.addEventListener('click', exportState);
  if(importBtn && importFile) importBtn.addEventListener('click', () => importFile.click());
  if(importFile) importFile.addEventListener('change', handleImportFile);
}

/* Fetch films.json */
async function loadFilms(){
  const grid = document.getElementById('grid');
  if(!grid) {
    console.error('Elemento #grid non trovato nella pagina.');
    return;
  }
  try {
    const res = await fetch(filmsUrl);
    // Mostra maggiori dettagli quando la risposta non è OK
    if(!res.ok){
      const text = await res.text().catch(() => '[impossibile leggere body]');
      console.error('films.json fetch failed:', res.status, res.statusText, text);
      throw new Error('films.json fetch failed: ' + res.status + ' ' + res.statusText);
    }
    // Verifica che sia JSON (previene Unexpected token <)
    const ct = res.headers.get('content-type') || '';
    if(!ct.includes('application/json') && !ct.includes('text/json')){
      const text = await res.text().catch(() => '[impossibile leggere body]');
      console.error('films.json non è JSON. Content-Type:', ct, 'body snippet:', text.slice(0,300));
      throw new Error('films.json non è JSON. Vedi console per il body di risposta.');
    }
    films = await res.json();
    // render subito l'interfaccia e poi tentare di recuperare i poster in background
    renderFilms();
    fetchAllPosters(); // background
  } catch(e){
    console.error('Impossibile caricare films.json', e);
    if(grid) grid.innerHTML = '<p style="color:var(--muted)">Impossibile caricare la lista dei film. Controlla la Console per dettagli.</p>';
  }
}

/* Poster fetching (TMDB) con caching in localStorage e spacing per evitare burst */
async function fetchPosterForFilm(film){
  const key = POSTER_CACHE_PREFIX + film.id;
  const stored = localStorage.getItem(key);
  if(stored) return stored;
  const tmdbKey = getStoredTmdbKey();
  if(!tmdbKey) return null;
  try {
    const q = encodeURIComponent(film.tmdbQuery || film.originalTitle || film.title || '');
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${q}&page=1`;
    const res = await fetch(url);
    if(!res.ok) throw new Error(`TMDB search failed (${res.status})`);
    const data = await res.json();
    if(data && Array.isArray(data.results) && data.results.length){
      // prefer matching year if presente
      let pick = data.results[0];
      if(film.year){
        const exact = data.results.find(r => r.release_date && r.release_date.startsWith(String(film.year)));
        if(exact) pick = exact;
      }
      if(pick && pick.poster_path){
        const posterUrl = 'https://image.tmdb.org/t/p/w500' + pick.poster_path;
        try { localStorage.setItem(key, posterUrl); } catch(e){ /* ignore quota errors */ }
        return posterUrl;
      }
    }
  } catch(e){
    console.debug('TMDB fetch error for', film.title, e);
  }
  return null;
}

async function fetchAllPosters(){
  const tmdbKey = getStoredTmdbKey();
  if(!tmdbKey) return;
  if(!Array.isArray(films) || films.length === 0) return;
  for(const film of films){
    // small spacing to avoid bursts
    await new Promise(res => setTimeout(res, 200));
    const url = await fetchPosterForFilm(film);
    if(url){
      posterCache[film.id] = url;
      // update existing img if already renderizzato
      const img = document.querySelector(`img[data-film-id="${film.id}"]`);
      if(img) img.src = url;
    }
  }
}

/* Rendering */
let renderTimer = null;
function renderFilmsDebounced(){ clearTimeout(renderTimer); renderTimer = setTimeout(renderFilms, 150); }

function renderFilms(){
  const grid = document.getElementById('grid');
  const tmpl = document.getElementById('card-template');
  const searchInput = document.getElementById('search');
  const sortEl = document.getElementById('sort');

  if(!grid || !tmpl) {
    // se manca il template o la griglia, non possiamo renderizzare
    return;
  }

  grid.innerHTML = '';
  const searchVal = (searchInput && searchInput.value) ? (searchInput.value || '').toLowerCase() : '';
  const sortVal = sortEl ? sortEl.value : '';

  let list = Array.isArray(films) ? films.slice() : [];

  // filtro ricerca
  if(searchVal){
    list = list.filter(f => {
      const hay = ((f.title || '') + ' ' + (f.originalTitle||'') + ' ' + (f.director||'') + ' ' + (f.year||'')).toLowerCase();
      return hay.includes(searchVal);
    });
  }

  // ordinamento
  if(sortVal === 'year-asc') list.sort((a,b) => (a.year||0) - (b.year||0));
  else if(sortVal === 'year-desc') list.sort((a,b) => (b.year||0) - (a.year||0));
  else if(sortVal === 'director-asc') list.sort((a,b) => (a.director||'').localeCompare(b.director||''));
  else if(sortVal === 'director-desc') list.sort((a,b) => (b.director||'').localeCompare(a.director||''));

  for(const film of list){
    const node = tmpl.content.cloneNode(true);
    const card = node.querySelector('.card');
    const img = node.querySelector('.poster');
    const watchedBtn = node.querySelector('.watched-toggle');
    const titleEl = node.querySelector('.film-title');
    const yearEl = node.querySelector('.year');
    const dirEl = node.querySelector('.director');
    const stars = Array.from(node.querySelectorAll('.star'));
    const notesEl = node.querySelector('.notes');

    if(titleEl) {
      titleEl.textContent = `${film.title || ''}${film.originalTitle ? ' — ' + film.originalTitle : ''}`;
      titleEl.title = (film.title || '') + (film.originalTitle ? (' — ' + film.originalTitle) : '');
    }
    if(yearEl) yearEl.textContent = film.year || '';
    if(dirEl) dirEl.textContent = film.director || '';

    if(img){
      img.dataset.filmId = film.id;
      img.alt = `${film.title || 'Poster'} poster`;
      const cached = localStorage.getItem(POSTER_CACHE_PREFIX + film.id);
      if(cached) img.src = cached;
      else if(posterCache[film.id]) img.src = posterCache[film.id];
      else img.src = placeholderDataUrl(film.title, film.year);
    }

    // stato
    const s = state[film.id] || { watched:false, rating:0, notes:'' };
    if(s.watched && card) card.classList.add('watched');

    if(watchedBtn){
      watchedBtn.setAttribute('aria-pressed', s.watched ? 'true' : 'false');
      watchedBtn.addEventListener('click', () => {
        const cur = state[film.id] || { watched:false, rating:0, notes:'' };
        cur.watched = !cur.watched;
        state[film.id] = cur;
        saveState();
        if(cur.watched && card) card.classList.add('watched'); 
        else if(card) card.classList.remove('watched');
        watchedBtn.setAttribute('aria-pressed', cur.watched ? 'true' : 'false');
        updateProgress();
      });
    }

    // rating
    function setRating(val, save = true){
      const cur = state[film.id] || { watched:false, rating:0, notes:'' };
      if(cur.rating === val){
        // update UI only
        stars.forEach(sbt => {
          const active = Number(sbt.dataset.value) <= val;
          sbt.classList.toggle('active', active);
          sbt.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        return;
      }
      cur.rating = val;
      state[film.id] = cur;
      if(save) saveState();
      stars.forEach(sbt => {
        const active = Number(sbt.dataset.value) <= val;
        sbt.classList.toggle('active', active);
        sbt.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
    stars.forEach(st => {
      const v = Number(st.dataset.value);
      // initialize aria-pressed
      st.setAttribute('aria-pressed', Number(s.rating || 0) >= v ? 'true' : 'false');
      st.addEventListener('click', () => setRating(v, true));
    });
    // init rating UI
    setRating(s.rating || 0, false);

    // notes (debounce salvataggio)
    if(notesEl){
      notesEl.value = s.notes || '';
      let notesTimer = null;
      notesEl.addEventListener('input', (e) => {
        clearTimeout(notesTimer);
        notesTimer = setTimeout(() => {
          const cur = state[film.id] || { watched:false, rating:0, notes:'' };
          if(cur.notes === notesEl.value) return; // avoid redundant save
          cur.notes = notesEl.value;
          state[film.id] = cur;
          saveState();
        }, 500);
      });
    }

    grid.appendChild(node);
  }

  updateProgress();
}

/* Progress */
function updateProgress(){
  const total = Array.isArray(films) ? films.length : 0;
  const watchedCount = Object.values(state).filter(s => s && s.watched).length;
  const percent = total ? Math.round((watchedCount / total) * 100) : 0;
  const bar = document.getElementById('progressBar');
  const text = document.getElementById('progressText');
  if(bar) bar.style.width = percent + '%';
  if(text) text.textContent = `${watchedCount}/${total}`;

  // Update accessibility attributes on the progress container
  const progressElem = document.querySelector('.progress[role="progressbar"]') || document.querySelector('.progress');
  if(progressElem){
    progressElem.setAttribute('aria-valuenow', String(percent));
    progressElem.setAttribute('aria-valuetext', `${watchedCount} su ${total} film`);
  }
}

/* Export / Import state */
function exportState(){
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    filmsCount: Array.isArray(films) ? films.length : 0,
    state: state
  };
  const data = JSON.stringify(payload, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `film-esame-state-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function handleImportFile(e){
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = function(ev){
    try{
      const parsed = JSON.parse(String(ev.target.result));
      if(!parsed || typeof parsed !== 'object' || !parsed.state){
        alert('File non valido: struttura inattesa.');
        return;
      }
      if(!confirm('Importare lo stato dal file selezionato? Questa azione sovrascriverà lo stato corrente.')) return;
      state = parsed.state || {};
      saveState();
      renderFilms();
      alert('Import completato.');
    }catch(err){
      console.error('Import error', err);
      alert('Impossibile importare il file: JSON non valido.');
    }
  };
  reader.readAsText(file);
  // reset input so same file can be reselected later
  e.target.value = '';
}

/* Placeholder SVG data URL */
function placeholderDataUrl(title, year){
  const c1 = '#0b2230', c2 = '#123344';
  const t = escapeHtml(title || 'Poster');
  const y = year ? ' • ' + year : '';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='900'>
    <defs>
      <linearGradient id='g' x1='0' x2='1'>
        <stop offset='0' stop-color='${c1}' />
        <stop offset='1' stop-color='${c2}' />
      </linearGradient>
    </defs>
    <rect width='100%' height='100%' fill='url(#g)'/>
    <g fill='#88b0c6' font-family='Arial, Helvetica, sans-serif'>
      <text x='50%' y='45%' font-size='28' text-anchor='middle' opacity='0.95'>🎬</text>
      <text x='50%' y='55%' font-size='20' text-anchor='middle'>${t}${y}</text>
    </g>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c]));
}

/* Fine */
