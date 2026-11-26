// Наповнення полиці без мережі (каталог cinemeta буває недоступний, і тоді
// «Показати на прикладі» нічого не додає). Вставити в консоль сторінки тестувальника
// або виконати через інструмент браузера: (await import('/docs/qa/friends-test/seed.js')).seed('alice')
const T = Date.now();
const e = (id, type, kind, title, year, status, score, rec, recNote, genres, extra = {}) => ({
  id, type, kind, title, year, status, score, rec, recNote, season: 1, episode: 0, lists: [], added: T, updated: T,
  meta: { imdb: 8.5, plot: '', genres, country: '', seasons: type === 'series' ? { 1: 12 } : {} }, ...extra,
});
const SHELVES = {
  alice: [
    e('tt22248376', 'series', 'anime', 'Frieren: Beyond Journey\'s End', '2023–', 'watching', 10, true, 'Тиха й дуже красива', ['Animation', 'Adventure', 'Drama']),
    e('tt0903747', 'series', 'series', 'Breaking Bad', '2008–2013', 'done', 10, true, 'Еталон', ['Crime', 'Drama', 'Thriller']),
    e('tt2560140', 'series', 'anime', 'Attack on Titan', '2013–2023', 'done', 9, true, '', ['Animation', 'Action', 'Adventure']),
    e('tt11126994', 'series', 'series', 'Arcane', '2021–2024', 'watching', 9, true, 'Найкраща анімація останніх років: кожен кадр як картина, а історія сестер тримає до останньої серії. Другий сезон трохи поспішає, але фінал вартий усього. Дивитись обовʼязково.', ['Animation', 'Action', 'Adventure']),
    e('tt9335498', 'series', 'anime', 'Demon Slayer', '2019–', 'paused', 8, false, '', ['Animation', 'Action', 'Adventure']),
    e('tt5180504', 'series', 'series', 'The Witcher', '2019–', 'dropped', 6, false, '', ['Action', 'Adventure', 'Drama']),
    e('tt13443470', 'series', 'series', 'Wednesday', '2022–', 'done', 8, false, '', ['Comedy', 'Crime', 'Fantasy']),
    e('tt14452776', 'series', 'series', 'The Bear', '2022–', 'watching', 9, true, '', ['Comedy', 'Drama']),
    e('tt0245429', 'movie', 'anime', 'Spirited Away', '2001', 'done', 10, true, 'Класика Міядзакі', ['Animation', 'Adventure', 'Family']),
    e('tt0816692', 'movie', 'movie', 'Interstellar', '2014', 'done', 9.5, true, 'Космос і музика Ціммера <b>!</b>', ['Adventure', 'Drama', 'Sci-Fi']),
    e('tt15239678', 'movie', 'movie', 'Dune: Part Two', '2024', 'done', 9, false, '', ['Action', 'Adventure', 'Drama']),
    e('tt6751668', 'movie', 'movie', 'Parasite', '2019', 'done', 8, true, 'Чорна комедія, яка раптом стає трилером', ['Drama', 'Thriller']),
    e('tt5311514', 'movie', 'anime', 'Your Name.', '2016', 'planned', 0, false, '', ['Animation', 'Drama', 'Fantasy']),
    e('tt1160419', 'movie', 'movie', 'Dune', '2021', 'planned', 0, false, '', ['Action', 'Adventure', 'Drama']),
  ],
  bogdan: [
    e('tt0903747', 'series', 'series', 'Breaking Bad', '2008–2013', 'done', 8, false, '', ['Crime', 'Drama', 'Thriller']),
    e('tt11126994', 'series', 'series', 'Arcane', '2021–2024', 'done', 10, false, '', ['Animation', 'Action', 'Adventure']),
    e('tt0816692', 'movie', 'movie', 'Interstellar', '2014', 'done', 7, false, '', ['Adventure', 'Drama', 'Sci-Fi']),
    e('tt0944947', 'series', 'series', 'Game of Thrones', '2011–2019', 'done', 8, false, '', ['Action', 'Adventure', 'Drama']),
    e('tt2861424', 'series', 'series', 'Rick and Morty', '2013–', 'watching', 9, false, '', ['Animation', 'Adventure', 'Comedy']),
    e('tt0409591', 'series', 'anime', 'Naruto', '2002–2007', 'done', 7, false, '', ['Animation', 'Action', 'Adventure']),
    e('tt1375666', 'movie', 'movie', 'Inception', '2010', 'done', 9, false, '', ['Action', 'Adventure', 'Sci-Fi']),
    e('tt0468569', 'movie', 'movie', 'The Dark Knight', '2008', 'done', 10, false, '', ['Action', 'Crime', 'Drama']),
  ],
};
export async function seed(who) {
  const { store } = await import('/js/store.js');
  return store.importMany(SHELVES[who]);
}
