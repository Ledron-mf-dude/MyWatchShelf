# Оцінки друзів і списки за фільтром — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Власник збирає список тайтлів (вручну або за фільтром), надсилає другові, той ставить свої оцінки, а власник бачить зведення по тайтлу й окремий екран «Друзі» з оцінками та рекомендаціями кожного друга.

**Architecture:** Чиста логіка — в новому `js/social.js` (без DOM, з тестами). Усе, що має синхронізуватися між пристроями власника (друзі, фільтри добірок, налаштування видимості), живе в одному узагальненому локальному сховищі `js/synced.js` за наявним правилом «свіжіше за `updated` перемагає, видалене — мітка». Відповіді друзів — документи `public/{owner}/replies/{friend}`; рекомендації друзів читаються з наявного `public/{uid}`. Екран і дії — в новому `js/friends.js`.

**Tech Stack:** ES-модулі без збирання й залежностей, Firebase JS SDK 10.14.1 з CDN (Auth + Firestore), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-25-friend-ratings-design.md`

## Global Constraints

- Жодних залежностей і кроку збирання; нові файли — звичайні ES-модулі в `js/`.
- Кожен новий рядок інтерфейсу — у `js/i18n.js` парою `[англійською, українською]`.
- Кожен новий файл у `js/` додається в `SHELL` у `sw.js`; `CACHE` підвищується (`mws-shell-v19`, далі `v20`…) у кожному завданні, що змінює файли оболонки.
- Усе, що прийшло з хмари, посилання чи `localStorage`, проходить функцію очищення перед використанням і вставляється в HTML лише через `esc()`.
- Оцінка — 1–10 з кроком 0,5 (`half()` у `logic.js`), коментар до 500 символів, підпис до 80, назва добірки до 40, до 8 добірок на запис.
- Межі: 500 тайтлів у `public/{uid}` разом; 500 тайтлів у відповіді; 100 друзів у таблиці.
- Ім'я з Google-акаунта в публічні документи не потрапляє: підпис — лише `store.settings.name`.
- Коміти — українською, у стилі `git log` репозиторію; комітити лише з дозволу власника.
- Перевірка в браузері — через наявний `.claude/launch.json` (локальний сервер), не `python -m http.server` з Bash.

## Review Focus

1. Відповідь зі сміттям (чужий формат `ttID`, оцінка 99, коментар на 10 000 символів, 5000 ключів) → обрізається й чиститься, сторінка не падає. Тест — у завданні 5.
2. Видалений друг відповідає знову → у таблиці не з'являється. Тест — у завданні 8.
3. Одна людина і відповіла, і запам'ятана з посилання → один стовпець, а не два. Тест — у завданні 8.
4. «Сформувати знову», коли нові збіги вже мають 8 добірок або разом виходить понад 500 опублікованих → запис пропущено / збереження заблоковано з числом зайвих. Тест — у завданні 3.
5. Власник відкрив власне посилання, або гість відкрив знімок `#r=` → полів оцінювання немає. Тест — у завданні 5 (`replyMode`).
6. Назва добірки з `/`, `.` чи `..` → коректний ідентифікатор документа. Тест — у завданні 2 (`defId`).

---

## Структура файлів

| Файл | Що робить |
|---|---|
| `js/social.js` (новий) | чиста логіка: фільтр добірки, різниця при переформуванні, очищення відповіді й друга, таблиця друзів |
| `js/synced.js` (новий) | узагальнене локальне сховище записів з `updated`/`deleted`; три екземпляри: `friends`, `listdefs`, `prefs` |
| `js/friends.js` (новий) | екран «Друзі», оцінювання на сторінці списку, керування друзями, локальний кеш відповідей і рекомендацій |
| `js/cloud.js` | синхронізація трьох сховищ, відповіді, повернення на список після входу, `open` у публічному документі |
| `js/logic.js` | `filterSort` приймає кілька типів; `cleanRecs` пропускає `open` |
| `js/panel.js` | діалог «Поділитися»: збирання списку, «Сформувати знову»; блок «Друзі» в картці |
| `js/views.js`, `js/app.js` | поля оцінювання в `renderRecs`, маршрут `friends`, пункт навігації |
| `firestore.rules`, `README.md`, `sw.js`, `styles.css`, `js/i18n.js` | супровід |
| `tests/social.test.mjs` (новий) | тести `social.js` і `synced.js` |

---

## Етап 1. Список за фільтром

### Task 1: Правила Firestore

**Files:**
- Modify: `firestore.rules`
- Modify: `README.md` (розділ «Як це влаштовано» — три нові шляхи; «Власна копія» — нагадати оновити правила)

**Interfaces:**
- Produces: шляхи `users/{uid}/friends/{id}`, `users/{uid}/listdefs/{id}`, `users/{uid}/prefs/{id}`, `public/{owner}/replies/{friend}`; поле `open: bool` у `public/{uid}`.

- [ ] **Step 1: Додати правила**

```
match /users/{uid}/{coll}/{docId} {
  allow read, write: if request.auth != null && request.auth.uid == uid
    && coll in ['friends', 'listdefs', 'prefs'];
}
match /public/{owner}/replies/{friend} {
  allow read: if request.auth != null && (request.auth.uid == owner || request.auth.uid == friend
    || get(/databases/$(database)/documents/public/$(owner)).data.get('open', false) == true);
  allow create, update: if request.auth != null && request.auth.uid == friend && friend != owner
    && request.resource.data.items is map && request.resource.data.items.size() <= 500
    && request.resource.data.name is string && request.resource.data.name.size() <= 80;
  allow delete: if request.auth != null && (request.auth.uid == owner || request.auth.uid == friend);
}
```

До наявного `match /public/{uid}` у `write` дописати: `&& request.resource.data.get('open', false) is bool`.

- [ ] **Step 2: Перевірити синтаксис** — правила вставляються власником у консоль Firebase вручну; у плані виконання зупинитися й попросити власника вставити та підтвердити, що консоль прийняла їх без помилок. До підтвердження завдання 2 можна робити (воно працює й без хмари), завдання 6 — ні.
- [ ] **Step 3: Оновити README і закомітити** — `Правила: друзі, фільтри добірок, відповіді друзів`.

### Task 2: Узагальнене сховище `synced.js` і його синхронізація

**Files:**
- Create: `js/synced.js`
- Modify: `js/cloud.js` (функція `onUser`, блок зміни власника), `sw.js`
- Test: `tests/social.test.mjs`

**Interfaces:**
- Produces:
  - `makeSynced(name: string, clean: (r) => record|null)` → `{ list(), raw(), get(id), save(id, patch), remove(id), applyRemote(list): boolean, onChange(fn), onLocal(fn), clear() }` — поведінка дзеркалить `store` з `js/store.js`: ключ `mws.<name>.v1`, запис `{ id, updated, deleted? , ... }`, `save` ставить `updated: Date.now()`, `remove` лишає мітку, `applyRemote` бере запис із більшим `updated` (при рівних — той, що приїхав).
  - `export const friends, listdefs, prefs` — три екземпляри (функції очищення — із завдань 3, 5, 8; у цьому завданні `clean` для всіх трьох — тимчасова тотожна перевірка наявності рядкового `id`, яку ті завдання замінять).
  - `defId(name: string): string` — `'l_' + encodeURIComponent(name)`.
- Consumes: шляхи із завдання 1.

- [ ] **Step 1: Тести, що падають**

```js
test('synced: свіжіше перемагає, видалене лишається міткою', () => {
  const s = makeSynced('t1', r => (typeof r?.id === 'string' ? r : null));
  s.save('a', { v: 1 });
  const at = s.get('a').updated;
  assert.equal(s.applyRemote([{ id: 'a', v: 2, updated: at - 1 }]), false);
  assert.equal(s.get('a').v, 1);
  assert.equal(s.applyRemote([{ id: 'a', v: 3, updated: at + 1 }]), true);
  assert.equal(s.get('a').v, 3);
  s.remove('a');
  assert.equal(s.get('a'), null);
  assert.equal(s.raw().length, 1);
  assert.equal(s.raw()[0].deleted, true);
  assert.equal(s.applyRemote([{ id: 'x' }, null, { v: 1 }]), true);   // без id відкидається
  assert.equal(s.list().length, 1);
});
test('defId безпечний для назв із / і крапками', () => {
  assert.equal(defId('.'), 'l_.');
  assert.equal(defId('a/b'), 'l_a%2Fb');
  assert.ok(!defId('..').includes('/') && defId('..') !== '..');
});
```

- [ ] **Step 2:** `npm test` → FAIL (`makeSynced is not defined`).
- [ ] **Step 3: Написати `js/synced.js`.** `localStorage` у Node немає — читання й запис у `try/catch`, як у `store.js`, тоді сховище живе в пам'яті.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Під'єднати до хмари в `cloud.js`.** У `onUser` для кожного з `[['friends', friends], ['listdefs', listdefs], ['prefs', prefs]]` — те саме, що вже зроблено для `entries`: `onSnapshot` колекції `users/{uid}/<name>` → `applyRemote`; на першому знімку відправити нагору локальні записи, яких немає в хмарі або які свіжіші; `onLocal` → `setDoc`. Усі відписки зберігати й знімати там, де зараз `unsub?.()`. У блоці `owner !== u.uid` викликати `clear()` для всіх трьох.
- [ ] **Step 6:** `sw.js`: додати `js/synced.js`, `CACHE = 'mws-shell-v19'`. Закомітити — `Сховище для друзів, фільтрів добірок і налаштувань із синхронізацією`.

### Task 3: Логіка збирання списку

**Files:**
- Create: `js/social.js`
- Modify: `js/logic.js` (`filterSort`), `js/synced.js` (очищення `listdefs`), `sw.js`
- Test: `tests/social.test.mjs`, `tests/logic.test.mjs`

**Interfaces:**
- Produces:
  - `filterSort`: нове поле фільтра `f.kinds: string[]` — порожнє або відсутнє означає «усі типи»; наявне `f.kind` працює як раніше.
  - `cleanListFilter(f) → { kinds: string[], from: string, to: string, status: string, genres: string[], mine: string }` — `kinds` лише з `KIND_IDS`, `status` — з `STATUS_IDS` або `'all'`, `genres` до 6, `mine` — `''` або число 1–10 рядком.
  - `isEmptyFilter(f): boolean` — усе за замовчуванням.
  - `cleanListDef(r) → { id, name, f, updated, deleted? } | null` — запис сховища `listdefs`; `id === defId(name)`.
  - `listDiff(entries, name, f) → { add: entry[], drop: entry[], skip: entry[] }` — `add`: підходять під фільтр і не мають мітки `name`; `drop`: мають мітку, але вже не підходять; `skip`: підійшли б, але вже мають 8 добірок (у `add` не входять).
  - `publicOver(entries, addIds: string[]) → number` — на скільки опублікованих (`rec` або непорожній `lists`) стало б більше за 500, якщо записи `addIds` отримають мітку; 0 — якщо вміщається.
  - `PUBLIC_MAX = 500`, `LISTS_MAX = 8`.

- [ ] **Step 1: Тести, що падають**

```js
const E = (id, o = {}) => sanitize({ id, title: id, kind: 'series', updated: 1, ...o });
test('filterSort: кілька типів одночасно', () => {
  const list = [E('tt0000001', { kind: 'anime' }), E('tt0000002', { kind: 'movie', type: 'movie' }), E('tt0000003')];
  assert.deepEqual(filterSort(list, { kinds: ['anime', 'series'] }, 'title', 1).map(e => e.id), ['tt0000001', 'tt0000003']);
  assert.equal(filterSort(list, { kinds: [] }, 'title', 1).length, 3);
});
test('cleanListFilter відкидає невідоме', () => {
  const f = cleanListFilter({ kinds: ['anime', 'x'], status: 'нема', mine: '99', genres: 'не масив', from: 2020 });
  assert.deepEqual(f, { kinds: ['anime'], from: '2020', to: '', status: 'all', genres: [], mine: '' });
  assert.equal(isEmptyFilter(cleanListFilter({})), true);
  assert.equal(isEmptyFilter(f), false);
});
test('listDiff: що додати, що прибрати, що пропустити', () => {
  const full = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const list = [
    E('tt0000001', { kind: 'anime', year: '2024' }),
    E('tt0000002', { kind: 'anime', year: '2019', lists: ['Нові'] }),
    E('tt0000003', { kind: 'anime', year: '2025', lists: ['Нові'] }),
    E('tt0000004', { kind: 'anime', year: '2025', lists: full }),
  ];
  const d = listDiff(list, 'Нові', cleanListFilter({ kinds: ['anime'], from: '2024' }));
  assert.deepEqual(d.add.map(e => e.id), ['tt0000001']);
  assert.deepEqual(d.drop.map(e => e.id), ['tt0000002']);
  assert.deepEqual(d.skip.map(e => e.id), ['tt0000004']);
});
test('publicOver рахує лише нові публікації', () => {
  const list = Array.from({ length: 499 }, (_, i) => E('tt' + String(1000000 + i), { rec: true }));
  list.push(E('tt2000001'), E('tt2000002'), E('tt2000003', { rec: true }));
  assert.equal(publicOver(list, ['tt2000003']), 0);              // уже опублікований
  assert.equal(publicOver(list, ['tt2000001', 'tt2000002']), 2);
});
```

- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Реалізувати** функції; у `filterSort` — один рядок перевірки `f.kinds`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** `listdefs` у `synced.js` отримує `cleanListDef`; `sw.js`: додати `js/social.js`, `v20`. Закомітити — `Логіка списку за фільтром: кілька типів, різниця при переформуванні, межа публікації`.

### Task 4: Діалог «Зібрати список» і «Сформувати знову»

**Files:**
- Modify: `js/panel.js` (`openShare` і поруч), `js/app.js` (нові дії в `on({...})`), `js/i18n.js`, `styles.css`, `sw.js`

**Interfaces:**
- Consumes: `cleanListFilter`, `isEmptyFilter`, `listDiff`, `publicOver`, `LISTS_MAX` (завдання 3); `listdefs`, `defId` (завдання 2); `filterSort`.
- Produces: дії `list-build` (відкрити збирання), `build-set` (змінити умову фільтра; `data-v="kinds:anime"` тощо), `build-tick` (галочка на тайтлі), `build-save`, `list-rebuild` (`data-v` — назва добірки).

- [ ] **Step 1: Збирання.** У діалозі «Поділитися» — кнопка «Зібрати список» → оверлей `{ type: 'build', f, picked: Set<id>, touched: boolean }`:
  - чипи умов: тип (кілька), статус (один), жанри (шість найчастіших з `insights`), роки «від/до» (поля), моя оцінка «від» (чипи 7, 8, 9);
  - під ними — перелік `filterSort(store.list(), f, 'score', -1)` з галочками; зміна фільтра ставить галочки на всьому знайденому; `build-tick` міняє одну й ставить `touched = true`;
  - якщо фільтр порожній, показується вся полиця без галочок (ручний вибір);
  - внизу — кількість вибраних, поле назви, кнопка «Зберегти добірку» і текст-попередження з наявного `lists.note`.
- [ ] **Step 2: Збереження (`build-save`).** Порожня назва чи нуль вибраних → `toast`. `publicOver(...) > 0` → `toast` з числом зайвих, нічого не зберігається. Інакше кожному вибраному запису з менш ніж 8 добірками додати мітку через `store.save(id, { lists })`; пропущені — одним `toast` з кількістю. Якщо `!isEmptyFilter(f)` → `listdefs.save(defId(name), { name, f })`; якщо фільтр порожній → запис `listdefs` для цієї назви не створюється. Після збереження — `openShare(name)`.
- [ ] **Step 3: «Сформувати знову».** В `openShare(list)`, коли `listdefs.get(defId(list))` існує, — кнопка `list-rebuild`. Дія рахує `listDiff`; якщо `add` і `drop` порожні → `toast` «змін немає»; інакше `confirmBox` з кількостями доданих, прибраних і пропущених; перевірка `publicOver` як у кроці 2; після підтвердження — оновити мітки й знову `openShare(list)`.
- [ ] **Step 4: Зникнення добірки.** Коли з добірки знято останню мітку (в картці чи тут), її `listdefs`-запис видаляється: підписатися на `store.onChange` у `panel.js` і для кожного `listdefs.list()`, чиєї назви немає в `listNames(store.list())`, викликати `listdefs.remove(id)`.
- [ ] **Step 5: Перевірка в браузері.** Запустити перегляд із `.claude/launch.json`, завантажити приклад (меню → «Показ на прикладі»), зібрати «аніме + серіали, від 2020», зняти одну галочку, зберегти як «Нові». Очікується: добірка «Нові» з'явилась у чипах бібліотеки з правильною кількістю; у «Поділитися» є «Сформувати знову»; після зміни року запису так, щоб він випав із фільтра, кнопка показує «прибрати 1». `read_console_messages` — без помилок.
- [ ] **Step 6:** `npm test` → PASS; `sw.js` `v21`; закомітити — `Поділитися: зібрати список за фільтром і переформувати його кнопкою`.

---

## Етап 2. Відповіді друзів

### Task 5: Логіка відповіді

**Files:**
- Modify: `js/social.js`, `js/logic.js` (`cleanRecs`)
- Test: `tests/social.test.mjs`, `tests/logic.test.mjs`

**Interfaces:**
- Produces:
  - `cleanRecs(data)` — додатково `out.open = true`, коли `data.open === true`.
  - `cleanReply(data) → { name: string, items: { [ttID]: { s, n, at, t, k, y } }, updated: number }` — не більше 500 ключів, ключ має відповідати `^tt[0-9]{6,10}$`, `s` через `half`, елемент без оцінки й без коментаря відкидається.
  - `replyItem(x, s, n, now) → { s, n, at, t, k, y }` — `x` — елемент рекомендацій (`{ id, k, t, y }`).
  - `replyMode({ ownerUid, meUid, signedIn }) → 'none' | 'signin' | 'rate'` — `'none'`, коли `ownerUid` порожній (знімок) або дорівнює `meUid`; `'signin'`, коли не ввійшов; інакше `'rate'`.
  - `shelfScores(entries, items) → { [ttID]: number }` — оцінки з полиці для тайтлів зі списку (для кнопки «Надіслати мої оцінки»).

- [ ] **Step 1: Тести, що падають**

```js
test('cleanReply чистить сміття й тримає межі', () => {
  const big = Object.fromEntries(Array.from({ length: 600 }, (_, i) => ['tt' + String(1000000 + i), { s: 7 }]));
  assert.equal(Object.keys(cleanReply({ items: big }).items).length, 500);
  const r = cleanReply({ name: 'x'.repeat(200), updated: '5', items: {
    tt0000001: { s: 99, n: 'y'.repeat(10000), t: 'A', k: 'нема', y: 2020, at: 3 },
    'нема': { s: 5 }, tt0000002: { s: 0, n: '' }, tt0000003: 'рядок', tt0000004: { s: 0, n: 'лише слова' },
  } });
  assert.equal(r.name.length, 80);
  assert.deepEqual(Object.keys(r.items), ['tt0000001', 'tt0000004']);
  assert.deepEqual(r.items.tt0000001, { s: 10, n: 'y'.repeat(500), at: 3, t: 'A', k: 'series', y: '2020' });
  assert.deepEqual(cleanReply(null), { name: '', items: {}, updated: 0 });
});
test('replyMode: власне посилання і знімок — без оцінювання', () => {
  assert.equal(replyMode({ ownerUid: '', meUid: 'a', signedIn: true }), 'none');
  assert.equal(replyMode({ ownerUid: 'a', meUid: 'a', signedIn: true }), 'none');
  assert.equal(replyMode({ ownerUid: 'a', meUid: '', signedIn: false }), 'signin');
  assert.equal(replyMode({ ownerUid: 'a', meUid: 'b', signedIn: true }), 'rate');
});
test('shelfScores бере лише оцінені тайтли зі списку', () => {
  const mine = [E('tt0000001', { score: 8.5 }), E('tt0000002'), E('tt0000009', { score: 6 })];
  assert.deepEqual(shelfScores(mine, [{ id: 'tt0000001' }, { id: 'tt0000002' }, { id: 'tt0000003' }]), { tt0000001: 8.5 });
});
test('cleanRecs пропускає open лише як true', () => {
  assert.equal(cleanRecs({ items: [], open: true }).open, true);
  assert.equal('open' in cleanRecs({ items: [], open: 'так' }), false);
});
```

- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** реалізувати. **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** закомітити — `Логіка відповіді друга: очищення, режим оцінювання, оцінки з полиці`.

### Task 6: Хмара — відповіді й повернення після входу

**Files:**
- Modify: `js/cloud.js`, `js/synced.js` (очищення `prefs`), `js/social.js`
- Test: `tests/social.test.mjs`

**Interfaces:**
- Consumes: `cleanReply`, `prefs`.
- Produces (методи об'єкта `cloud`):
  - `sendReply(ownerUid, reply): Promise<void>` — `setDoc(public/{owner}/replies/{me})`, `updated: Date.now()`.
  - `loadReply(ownerUid, friendUid): Promise<reply|null>` і `loadReplies(ownerUid): Promise<{ [uid]: reply }>` — результат через `cleanReply`.
  - `watchReplies(cb: (map) => void): () => void` — `onSnapshot` колекції відповідей на список поточного користувача.
  - `deleteReply(ownerUid, friendUid): Promise<void>`.
  - `returnHash(hash: string): string` у `social.js` — повертає `hash`, якщо він відповідає `^#u=[\w-]{1,128}(&l=[^#&]{1,400})?$`, інакше `''`.
  - `cleanPrefs(r) → { id: 'social', open: boolean, seenAt: number, updated }`.
  - `recsPayload()` додає `open: true`, коли `prefs.get('social')?.open`; зміна `prefs` викликає `schedulePublish()`.

- [ ] **Step 1: Тест**

```js
test('returnHash пускає лише адресу списку', () => {
  assert.equal(returnHash('#u=abcDEF_12-3'), '#u=abcDEF_12-3');
  assert.equal(returnHash('#u=abc&l=%D0%9D%D0%BE%D0%B2%D1%96'), '#u=abc&l=%D0%9D%D0%BE%D0%B2%D1%96');
  assert.equal(returnHash('#id_token=x&state=y'), '');
  assert.equal(returnHash('#u=abc&x=1'), '');
  assert.equal(returnHash('#/library'), '');
});
```

- [ ] **Step 2:** FAIL → реалізувати → PASS.
- [ ] **Step 3: Повернення на список.** У `signIn()` перед `location.assign` — `localStorage.setItem('mws.returnTo', returnHash(location.hash))`. У `takeReturn()` там, де зараз `history.replaceState(null, '', location.pathname + location.search)`, дописати в адресу збережений і ще раз перевірений `returnHash(...)` та прибрати ключ. Так це спрацює незалежно від того, що викликається першим — `cloud.init()` чи `route()`.
- [ ] **Step 4: Методи відповідей** за сигнатурами вище.
- [ ] **Step 5: Перевірка.** Правила із завдання 1 мають бути вже в консолі. `npm test` → PASS. У браузері: вхід з адреси `#u=<власний uid>` повертає на ту саму адресу, консоль без помилок. Запис відповіді потребує другого акаунта, тому наскрізно перевіряється в завданні 7.
- [ ] **Step 6:** закомітити — `Хмара: відповіді друзів, видимість оцінок, повернення на список після входу`.

### Task 7: Оцінювання на сторінці списку

**Files:**
- Create: `js/friends.js`
- Modify: `js/app.js` (`route`: зберегти `view.recs.uid` і `view.recs.open`; під'єднати дії), `js/views.js` (`renderRecs`), `js/i18n.js`, `styles.css`, `sw.js`

**Interfaces:**
- Consumes: `replyMode`, `replyItem`, `shelfScores`, `cleanReply`; `cloud.sendReply`, `cloud.loadReply`, `cloud.loadReplies`; `view.recs = { name, title, items, uid, open }`.
- Produces:
  - `replyBox(x): string` — HTML поля оцінювання для картки (або кнопка входу, або порожньо) — викликається з `renderRecs`.
  - `othersLine(id): string` — оцінки інших друзів, коли `view.recs.open`.
  - `loadReplyState(redraw): void` — тягне власну відповідь (і чужі, якщо `open`) та викликає `redraw`.
  - `replyActions` — `rate` (`data-v` — оцінка 1–10), `rate-half`, `rate-all` («Надіслати мої оцінки»), `rate-signin`; додаються в `on({...})`.

- [ ] **Step 1: Стан.** У `friends.js` — `const rs = { owner: '', mine: { name: '', items: {} }, others: {} }`; скидається, коли змінився `view.recs.uid`.
- [ ] **Step 2: Поля.** `replyBox` — той самий ряд із 10 кнопок і «+½», що в `cardHtml` (класи `scores`, `fill`, `on`, `half`), плюс поле коментаря `data-reply-note`; коментар зберігається через 500 мс після введення, як `pending` у `panel.js`. Режим `'signin'` → кнопка `rate-signin`, що викликає `cloud.signIn()`.
- [ ] **Step 3: Збереження.** Перша відповідь без `store.settings.name` → `promptBox` з підписом (наявні ключі `menu.name`, `name.text`); відмова — нічого не зберігати. Якщо `view.recs.open` — перед першою відповіддю `confirmBox` «оцінки бачать усі друзі автора». Далі: оновити `rs.mine.items[id] = replyItem(...)`, `cloud.sendReply(owner, rs.mine)`; якщо `store.get(id)` існує — `store.save(id, { score })`; якщо немає — на полицю нічого не додавати. Повторне натискання тієї ж оцінки знімає її (елемент без оцінки й коментаря видаляється з `items`).
- [ ] **Step 4: «Надіслати мої оцінки».** Кнопка над списком, коли `Object.keys(shelfScores(store.list(), items))` містить тайтли, яких ще немає у відповіді; дія додає їх одним `sendReply`.
- [ ] **Step 5: Перевірка в браузері** (потрібні два акаунти Google; якщо другого немає — зупинитися й попросити власника пройти цей крок): акаунт А публікує добірку, акаунт Б відкриває `#u=<A>&l=<назва>` без входу → бачить «Увійти, щоб оцінити» → після входу опиняється на тій самій добірці → ставить 8,5 і коментар → перезавантаження зберігає оцінку. Акаунт А на власному посиланні полів не бачить. Посилання `#r=` — полів немає.
- [ ] **Step 6:** `sw.js`: додати `js/friends.js`, `v22`; закомітити — `Сторінка списку: друг ставить свою оцінку поруч з оцінкою автора`.

---

## Етап 3. Друзі

### Task 8: Логіка таблиці друзів

**Files:**
- Modify: `js/social.js`, `js/synced.js` (очищення `friends`)
- Test: `tests/social.test.mjs`

**Interfaces:**
- Produces:
  - `cleanFriend(r) → { id, uid, name, kind: 'live'|'snap', follow: boolean, added, updated, items?, deleted? } | null` — `items` (через `cleanRecs`) лише для `kind: 'snap'`; для `'live'` `id === uid`.
  - `snapId(name, items) → string` — `'s'` + 8 шістнадцяткових цифр хешу FNV-1a від підпису й відсортованих `id`.
  - `FRIENDS_MAX = 100`.
  - `friendTable({ entries, friends, replies, recs }) → { cols, hidden, rows }`:
    - `friends` — `friendsStore.raw()`; `replies` — `{ [uid]: reply }`; `recs` — `{ [friendId]: item[] }`;
    - `cols: [{ id, name }]` — не видалені, перші 100 за `added`; ім'я — з відповіді, якщо є, інакше із запису; `hidden` — скільки не вмістилось;
    - `rows: [{ id, t, k, y, mine, have, cells: { [friendId]: { s, n, rec } }, avg, n }]` — тайтли, де хоч один стовпець має відповідь або рекомендацію; `s` — з відповіді, а якщо її немає — з рекомендацій; `rec: true`, коли тайтл є в рекомендаціях друга з `follow: true` (або `kind: 'snap'`); `avg` — середнє за друзями з `s > 0`, округлене до 0,1, `mine` у нього не входить; сортування за `avg` спадно, далі за назвою.
  - `newReplyAuthors(friends, replies) → string[]` — `uid` відповідей, для яких у сховищі немає жодного запису (ані живого, ані мітки видалення).
  - `unseenCount(table, replies, seenAt) → number` — скільки видимих друзів мають `reply.updated > seenAt`.

- [ ] **Step 1: Тести, що падають**

```js
const F = (id, o = {}) => cleanFriend({ id, uid: id, name: id, kind: 'live', follow: false, added: 1, updated: 1, ...o });
const R = (name, items) => cleanReply({ name, updated: 10, items });
test('friendTable: відповідь має перевагу, ★ — з рекомендацій, одна людина — один стовпець', () => {
  const tb = friendTable({
    entries: [E('tt0000001', { score: 10 })],
    friends: [F('oleh', { follow: true }), F('ira', { added: 2 })],
    replies: { oleh: R('Олег', { tt0000001: { s: 8, t: 'A' } }), ira: R('Іра', { tt0000001: { s: 9.5, t: 'A' } }) },
    recs: { oleh: [{ id: 'tt0000001', t: 'A', k: 'series', s: 6 }, { id: 'tt0000002', t: 'B', k: 'anime', s: 9 }] },
  });
  assert.deepEqual(tb.cols.map(c => c.name), ['Олег', 'Іра']);
  const a = tb.rows.find(r => r.id === 'tt0000001'), b = tb.rows.find(r => r.id === 'tt0000002');
  assert.deepEqual(a.cells.oleh, { s: 8, n: '', rec: true });
  assert.equal(a.avg, 8.8); assert.equal(a.mine, 10); assert.equal(a.have, true);
  assert.deepEqual(b.cells.oleh, { s: 9, n: '', rec: true });
  assert.equal(b.have, false); assert.equal(b.cells.ira, undefined);
  assert.deepEqual(tb.rows.map(r => r.id), ['tt0000002', 'tt0000001']);
});
test('видалений друг не повертається, коли відповідає знову', () => {
  const friends = [{ id: 'oleh', deleted: true, updated: 5 }];
  const replies = { oleh: R('Олег', { tt0000001: { s: 8, t: 'A' } }) };
  assert.deepEqual(newReplyAuthors(friends, replies), []);
  assert.equal(friendTable({ entries: [], friends, replies, recs: {} }).rows.length, 0);
  assert.deepEqual(newReplyAuthors([], replies), ['oleh']);
});
test('рекомендації без follow не читаються; понад 100 друзів ховаються', () => {
  const tb = friendTable({ entries: [], friends: [F('oleh')], replies: {}, recs: { oleh: [{ id: 'tt0000002', t: 'B', k: 'anime', s: 9 }] } });
  assert.equal(tb.rows.length, 0);
  const many = Array.from({ length: 103 }, (_, i) => F('u' + i, { added: i }));
  const big = friendTable({ entries: [], friends: many, replies: {}, recs: {} });
  assert.equal(big.cols.length, 100); assert.equal(big.hidden, 3); assert.equal(big.cols[0].id, 'u0');
});
test('snapId стабільний і залежить від вмісту', () => {
  const a = snapId('Олег', [{ id: 'tt0000002' }, { id: 'tt0000001' }]);
  assert.equal(a, snapId('Олег', [{ id: 'tt0000001' }, { id: 'tt0000002' }]));
  assert.notEqual(a, snapId('Іра', [{ id: 'tt0000001' }, { id: 'tt0000002' }]));
  assert.match(a, /^s[0-9a-f]{8}$/);
});
test('unseenCount рахує лише свіжіші за останній перегляд', () => {
  const friends = [F('oleh'), F('ira')], replies = { oleh: R('Олег', { tt0000001: { s: 8 } }) };
  const tb = friendTable({ entries: [], friends, replies, recs: {} });
  assert.equal(unseenCount(tb, replies, 5), 1);
  assert.equal(unseenCount(tb, replies, 10), 0);
});
```

- [ ] **Step 2:** FAIL → **Step 3:** реалізувати → **Step 4:** PASS.
- [ ] **Step 5:** `friends` у `synced.js` отримує `cleanFriend`; закомітити — `Логіка таблиці друзів: зведення оцінок, рекомендації, приховані`.

### Task 9: Запам'ятати друга, кеш і оновлення

**Files:**
- Modify: `js/friends.js`, `js/views.js` (`renderRecs` — кнопка), `js/app.js` (дії, запуск), `js/i18n.js`, `sw.js`

**Interfaces:**
- Consumes: `friends`, `prefs` (сховища); `cloud.loadPublic`, `cloud.watchReplies`; `newReplyAuthors`, `snapId`, `friendTable`.
- Produces:
  - `social.table(): table` — `friendTable` на поточних даних (сховище + кеш).
  - `social.start(redraw)` — викликається з `app.js` після `cloud.init()`; при вході підписується на відповіді, при відкритті застосунку оновлює рекомендації друзів із `follow: true`.
  - локальний кеш `mws.social.cache.v1` = `{ replies: { [uid]: reply }, recs: { [friendId]: item[] } }` — у хмару не йде; читається через `cleanReply`/`cleanRecs`.
  - дії: `friend-keep` (запам'ятати автора відкритої сторінки рекомендацій).

- [ ] **Step 1: Кнопка «Запам'ятати»** у шапці `renderRecs`, коли це чуже посилання й друга ще немає серед не видалених. Живе посилання → `friends.save(uid, { uid, name, kind: 'live', follow: true, added: Date.now() })` і рекомендації в кеш. Знімок → `friends.save(snapId(name, items), { name, kind: 'snap', follow: true, items, added })`. Якщо запис був міткою видалення — запам'ятовування його відновлює.
- [ ] **Step 2: Відповіді.** Коли `cloud.user` є — `cloud.watchReplies(map => …)`: зберегти в кеш; для кожного з `newReplyAuthors(friends.raw(), map)` — `friends.save(uid, { uid, name, kind: 'live', follow: false, added: Date.now() })`; викликати `redraw`.
- [ ] **Step 3: Рекомендації.** Раз на відкриття застосунку (і при `online`) для кожного живого друга з `follow: true` — `cloud.loadPublic(uid)` → у кеш. Помилка одного друга не зупиняє інших; `updated` запису друга не змінюється.
- [ ] **Step 4: Перевірка в браузері.** Відкрити чуже живе посилання → «Запам'ятати» → кнопка зникає; у `localStorage` з'явились `mws.friends.v1` і `mws.social.cache.v1`; після перезавантаження без мережі (вимкнути мережу в інструментах) `social.table()` у консолі повертає ті самі рядки.
- [ ] **Step 5:** `sw.js` `v23`; закомітити — `Друзі: запам'ятати автора рекомендацій, кеш відповідей і рекомендацій`.

### Task 10: Екран «Друзі» й керування

**Files:**
- Modify: `js/friends.js`, `js/app.js` (`NAV`, `RENDER`, меню акаунта, позначка «нове»), `js/i18n.js`, `styles.css`, `sw.js`

**Interfaces:**
- Consumes: `social.table()`, `unseenCount`, `friends`, `prefs`, `cloud.deleteReply`, `addItem`/`openCard`/`openPreview` з `panel.js`, `remember` з `ui.js`.
- Produces: `renderFriends()`; маршрут `#/friends`; дії `fr-who` (фільтр за другом), `fr-kind`, `fr-manage`, `fr-open` (перемикач видимості), `fr-follow`, `fr-drop-recs`, `fr-del`, `fr-restore`.

- [ ] **Step 1: Маршрут і навігація.** `NAV` отримує `['friends', 'user']`; у нижній панелі телефона пункту немає (як календар) — додати його рядком у меню акаунта поруч із календарем. Позначка «нове» — крапка на пункті, коли `unseenCount(table, cache.replies, prefs.get('social')?.seenAt || 0) > 0`; відкриття екрана зберігає `prefs.save('social', { seenAt: Date.now() })`.
- [ ] **Step 2: Таблиця.** Заголовок, чипи друзів («Усі» + кожен стовпець) і типів; рядок: постер, назва, «Я», по клітинці на друга (оцінка, ★ для `rec`, коментар у `title` і під оцінкою у вузькому вигляді), середня. Вибраний друг лишає один стовпець і лише його рядки. Натиск на рядок: `openCard`, якщо тайтл на полиці, інакше `remember({ id, type, kind, title, year })` + `openPreview`. Тайтл не на полиці має кнопку наявної дії `take`. Порожній стан пояснює, як отримати перші оцінки, з кнопкою наявної дії `share`. На вузькому екрані таблиця прокручується горизонтально, перший стовпець закріплений.
- [ ] **Step 3: Керування (`fr-manage`, оверлей).** Перемикач «Друзі бачать оцінки одне одного» → `prefs.save('social', { open })`. Для кожного друга: перемикач «Показувати його рекомендації» (`follow`), «Прибрати його рекомендації» (`follow: false` і чистка кешу; для знімка — видалення запису), «Видалити друга» (`confirmBox`, потім `friends.remove(id)` і `cloud.deleteReply(me, uid)` без очікування успіху). Нижче — приховані: видалені з кнопкою «Повернути» (`friends.save(id, {...})` з попереднім ім'ям) і рядок «ще N», якщо `table.hidden > 0`.
- [ ] **Step 4: Перевірка в браузері.** З даними завдань 7 і 9: екран показує обидва джерела в одній таблиці; фільтр за другом лишає його рядки; ★ лише на тому, що він радив; видалення друга прибирає стовпець, «Повернути» повертає; «Прибрати його рекомендації» лишає рядки з його відповідями. Перевірити ширину 375 px (`resize_window` → `mobile`) і світлу тему. Консоль — без помилок.
- [ ] **Step 5:** `sw.js` `v24`; закомітити — `Екран «Друзі»: таблиця оцінок і рекомендацій, керування друзями`.

### Task 11: Блок «Друзі» в картці й документація

**Files:**
- Modify: `js/panel.js` (`cardHtml`, перед секцією нотатки), `js/friends.js`, `js/i18n.js`, `styles.css`, `README.md`, `sw.js`

**Interfaces:**
- Consumes: `social.table()`.
- Produces: `friendsBlock(id): string` у `friends.js` — секція для картки або `''`, коли жодної оцінки немає.

- [ ] **Step 1:** `friendsBlock` — середня й рядок на друга: ім'я, оцінка, ★, коментар; посилання «Усі оцінки» на `#/friends`. `friends.js` уже імпортує `panel.js` (завдання 10), тому щоб не утворити коло імпортів, `panel.js` не імпортує `friends.js`, а отримує блок через реєстрацію: `friends.js` викликає `setCardExtra(friendsBlock)`, експортований із `panel.js`.
- [ ] **Step 2: README:** рядок у таблиці «Що вміє», оновлена схема (`public/{uid}/replies`, `users/{uid}/friends|listdefs|prefs`), абзац у «Рекомендації» про оцінки друзів і перемикач видимості, `social.js`/`synced.js`/`friends.js` у переліку файлів.
- [ ] **Step 3: Перевірка.** `npm test` → PASS. У браузері відкрити картку тайтла з оцінками друзів → блок є; картку без оцінок → блоку немає. Перемкнути мову → усі нові підписи перекладені (жодного ключа виду `fr.xxx` на екрані).
- [ ] **Step 4:** `sw.js` `v25`; закомітити — `Картка: оцінки друзів; опис нового в README`.
