/* Film Esame Cinema — script.js
   - Inserisci la tua TMDB API key nella variabile TMDB_API_KEY qui sotto:
     const TMDB_API_KEY = 'la_tua_chiave';
   - Oppure imposta la chiave in localStorage: localStorage.setItem('TMDB_API_KEY', 'la_tua_chiave');
*/

const TMDB_API_KEY = 'ed8901b31c0b54c6ad923aa053be94bb'; // <-- incolla qui la tua chiave TMDB oppure impostala in localStorage
const STATE_KEY = 'filmEsameState_v1';
const THEME_KEY = 'filmEsameTheme';
const POSTER_CACHE_PREFIX = 'tmdbPoster_';
const filmsUrl = 'films.json';

let films = [];
let state = {}; // { [id]: { watched:bool, rating:int, notes:string } }
let posterCache = {};

document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  loadState();
  initUI();
  loadFilms();
});

function getStoredTmdbKey(){
  return TMDB_API_KEY || localStorage.getItem('TMDB_API_KEY') || '';
}

function loadTheme(){
  const t = localStorage.getItem(THEME_KEY) || 'dark';
  document.body.classList.toggle('light-theme', t === 'light');
  const toggle = document.getElementById('themeToggle');
  if(toggle) toggle.checked = (t === 'light');
  if(toggle){
    toggle.addEventListener('change', (e) => {
      const mode = e.target.checked ? 'light' : 'dark';
      document.body.classList.toggle('light-theme', mode === 'light');
      localStorage.setItem(THEME_KEY, mode);
    });
  }
}

/* State persistence */
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
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

/* UI init */
function initUI(){
  const search = document.getElementById('search');
  const sort = document.getElementById('sort');
  const reset = document.getElementById('resetProgress');
  search.addEventListener('input', renderFilmsDebounced);
  sort.addEventListener('change', renderFilms);
  reset.addEventListener('click', () => {
    if(!confirm('Azzera tutti i progressi? Questa azione non è reversibile.')) return;
    state = {};
    saveState();
    renderFilms();
  });
}

/* Fetch films.json */
async function loadFilms(){
  try {
    const res = await fetch(filmsUrl);
    films = await res.json();
    // store posters lookup attempt but do not block UI: we will fetch posters asynchronously
    renderFilms();
    fetchAllPosters(); // attempt to fetch posters in background
  } catch(e){
    console.error('Impossibile caricare films.json', e);
    document.getElementById('grid').innerHTML = '<p style="color:var(--muted)">Impossibile caricare la lista dei film.</p>';
  }
}

/* Poster fetching (TMDB) with basic caching and rate spacing */
async function fetchPosterForFilm(film){
  const key = POSTER_CACHE_PREFIX + film.id;
  const stored = localStorage.getItem(key);
  if(stored) return stored;
  const tmdbKey = getStoredTmdbKey();
  if(!tmdbKey) return null;
  try {
    const q = encodeURIComponent(film.tmdbQuery || film.originalTitle || film.title);
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${q}&page=1`;
    const res = await fetch(url);
    if(!res.ok) throw new Error('TMDB search failed');
    const data = await res.json();
    if(data && data.results && data.results.length){
      // prefer exact year match
      let pick = data.results[0];
      if(film.year){
        const exact = data.results.find(r => r.release_date && r.release_date.startsWith(String(film.year)));
        if(exact) pick = exact;
      }
      if(pick && pick.poster_path){
        const posterUrl = 'https://image.tmdb.org/t/p/w500' + pick.poster_path;
        localStorage.setItem(key, posterUrl);
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
  for(const film of films){
    // small spacing to avoid bursts
    await new Promise(res => setTimeout(res, 200));
    const url = await fetchPosterForFilm(film);
    if(url){
      posterCache[film.id] = url;
      // update existing img if already rendered
      const img = document.querySelector(`img[data-film-id="${film.id}"]`);
      if(img) img.src = url;
    }
  }
}

/* Render */
let renderTimer = null;
function renderFilmsDebounced(){ clearTimeout(renderTimer); renderTimer = setTimeout(renderFilms, 150); }

function renderFilms(){
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  const tmpl = document.getElementById('card-template');
  const searchVal = (document.getElementById('search').value || '').toLowerCase();
  const sortVal = document.getElementById('sort').value;

  let list = films.slice();

  // search filtering
  if(searchVal){
    list = list.filter(f => {
      const hay = ((f.title || '') + ' ' + (f.originalTitle||'') + ' ' + (f.director||'') + ' ' + (f.year||'')).toLowerCase();
      return hay.includes(searchVal);
    });
  }

  // sorting
  if(sortVal === 'year-asc') list.sort((a,b) => (a.year||0) - (b.year||0));
  else if(sortVal === 'year-desc') list.sort((a,b) => (b.year||0) - (a.year||0));
  else if(sortVal === 'director-asc') list.sort((a,b) => (a.director||'').localeCompare(b.director||''));
  else if(sortVal === 'director-desc') list.sort((a,b) => (b.director||'').localeCompare(a.director||''));
  // default: keep file order

  for(const film of list){
    const node = tmpl.content.cloneNode(true);
    const card = node.querySelector('.card');
    const img = node.querySelector('.poster');
    const watchedBtn = node.querySelector('.watched-toggle');
    const titleEl = node.querySelector('.film-title');
    const yearEl = node.querySelector('.year');
    const dirEl = node.querySelector('.director');
    const stars = [...node.querySelectorAll('.star')];
    const notesEl = node.querySelector('.notes');

    // fill
    titleEl.textContent = `${film.title} ${film.originalTitle ? '— ' + film.originalTitle : ''}`;
    titleEl.title = film.title + (film.originalTitle ? (' — ' + film.originalTitle) : '');
    yearEl.textContent = film.year || '';
    dirEl.textContent = film.director || '';

    img.dataset.filmId = film.id;
    img.alt = `${film.title} poster`;
    const cached = localStorage.getItem(POSTER_CACHE_PREFIX + film.id);
    if(cached){
      img.src = cached;
    } else if(posterCache[film.id]){
      img.src = posterCache[film.id];
    } else {
      img.src = placeholderDataUrl(film.title, film.year);
    }

    // state
    const s = state[film.id] || { watched:false, rating:0, notes:'' };
    if(s.watched) card.classList.add('watched');
    // watched button
    watchedBtn.addEventListener('click', () => {
      const cur = state[film.id] || { watched:false, rating:0, notes:'' };
      cur.watched = !cur.watched;
      state[film.id] = cur;
      saveState();
      if(cur.watched) card.classList.add('watched'); else card.classList.remove('watched');
      updateProgress();
    });

    // rating
    function setRating(val){
      const cur = state[film.id] || { watched:false, rating:0, notes:'' };
      cur.rating = val;
      state[film.id] = cur;
      saveState();
      stars.forEach(sbt => sbt.classList.toggle('active', Number(sbt.dataset.value) <= val));
    }
    stars.forEach(st => {
      const v = Number(st.dataset.value);
      st.addEventListener('click', () => {
        setRating(v);
      });
    });
    // init rating UI
    setRating(s.rating || 0);

    // notes (debounce save)
    notesEl.value = s.notes || '';
    let notesTimer = null;
    notesEl.addEventListener('input', (e) => {
      clearTimeout(notesTimer);
      notesTimer = setTimeout(() => {
        const cur = state[film.id] || { watched:false, rating:0, notes:'' };
        cur.notes = notesEl.value;
        state[film.id] = cur;
        saveState();
      }, 500);
    });

    grid.appendChild(node);
  }

  updateProgress();
}

/* Progress */
function updateProgress(){
  const total = films.length;
  const watchedCount = Object.values(state).filter(s => s && s.watched).length;
  const percent = total ? Math.round((watchedCount / total) * 100) : 0;
  const bar = document.getElementById('progressBar');
  const text = document.getElementById('progressText');
  if(bar) bar.style.width = percent + '%';
  if(text) text.textContent = `${watchedCount}/${total}`;
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
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* Utility: debounce for render called earlier */

/* Expose a helper to re-fetch posters after inserting the API key in localStorage or in the script variable */
window.updateTMDBKeyAndFetch = async function(key){
  if(key) localStorage.setItem('TMDB_API_KEY', key);
  // also update TMDB_API_KEY variable isn't possible at runtime if function-scoped const used; fetch uses localStorage fallback too.
  await fetchAllPosters();
  renderFilms();
};

/* End of script.js */
