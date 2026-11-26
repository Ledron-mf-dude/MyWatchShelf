# Fix list after the friends-mode test (2026-11-26)

Source of the findings: `REPORT.md` in this folder (numbers below refer to it). The owner asked for ALL
bugs (1–13), ALL privacy items (14–19) and ALL inconveniences (20–37) to be fixed. This file holds the
controller's decisions on HOW; where it is silent, choose the smallest change that removes the finding.
Design spec of the feature: `docs/superpowers/specs/2026-11-25-friend-ratings-design.md`.

General rules for every package:
- Pure decidable logic goes to `js/social.js` (or `js/logic.js`) with tests in `tests/social.test.mjs`.
- `firestore.rules` semantics must not be loosened. If a package needs a new field in `public/{uid}`,
  the existing rule already allows extra fields; do not edit the rules unless the package says so.
- Old links and old stored data must keep working (people already shared links).
- Every new string is an `[en, uk]` pair in `js/i18n.js`. Ukrainian wording must not depend on gender
  or on declining a person's name (see package 4, item 28) — write new strings that way from the start.
- Do not touch `sw.js` (the controller bumps the cache at the end), except adding a NEW js file to `SHELL`.

---

## Package 1 — collections: create, edit, links, conditions
Files mostly: `js/panel.js` (build dialog, share dialog), `js/shared.js`, `js/social.js`, `js/synced.js`,
`js/cloud.js` (public payload), `js/app.js` (route), `js/logic.js` (`cleanRecs`, `recItem`), `styles.css`.

- **#2 duplicate name.** Saving a NEW collection whose name (trimmed, case-insensitive) already exists is
  refused with a toast: "A collection named X already exists — pick another name or edit that one". Nothing is written.
- **#21 edit a collection.** A "Редагувати" button on each collection card (section «Рекомендації») and in the
  share dialog of a collection (it replaces the confusing «Зібрати список» there). It opens the same build dialog
  pre-filled: name, the stored conditions (if any), ticks = current members. Saving in edit mode REPLACES the
  membership with exactly the ticked titles (adds the tag to new ones, removes it from unticked ones), stores or
  removes the conditions like create does, and applies a rename to every member and to the listdef. Renaming to
  another existing collection's name is refused like #2. One name for the action everywhere: «Нова добірка»
  (create) and «Редагувати добірку» (edit); remove «Зібрати список» / «Зібрати добірку» wording (#28 part).
- **#19 stable link.** Every collection gets a stable key: a listdef record now exists for EVERY collection
  (hand-picked ones too — with empty conditions) and carries `key` (8–12 chars `[a-z0-9]`, random, created once,
  never changed by rename/edit; synced with the listdef). Existing collections without a listdef/key get one
  lazily (when the «Рекомендації» section or the share dialog needs a link). The public document gets
  `cols: { [key]: name }` (cleaned on read: keys `^[a-z0-9]{6,16}$`, names ≤ 40 chars, ≤ 60 entries; reject
  `__proto__`-style keys). New live link form: `#u=<uid>&c=<key>`; the route resolves key → name through `cols`
  and then filters items by that name as today. Old `#u=<uid>&l=<name>` links keep working unchanged. Snapshot
  links (`#r=`) are unchanged. `isEmptyFilter`-based logic ("is this list condition-based?") must keep working
  now that hand-picked lists also have a listdef.
  A friend record's remembered collections (`lists`, names) stay names (they are matched against item `l`).
- **#8 manual ticks survive conditions.** In the build dialog, changing a condition must not wipe manual
  choices: keep two sets — titles ticked by hand (`plus`) and titles unticked by hand (`minus`); the shown
  selection = (matches of the conditions ∪ plus) \ minus. Empty conditions = just `plus`. "Сформувати знову"
  keeps its current meaning (conditions only) — say in the dialog footer, when both conditions and manual
  changes exist, that manual additions stay and a rebuild re-applies only the conditions (rebuild must not
  drop `plus` titles: store `plus`/`minus` id lists in the listdef, cleaned, ≤ 500 ids each, and make
  `listDiff` honour them).
- **#17 "only recommended".** New condition chip «Лише з позначкою „раджу“» (`f.rec: true`); in the picker
  list, rows that are `planned` or have no score get a small muted badge («у планах» / «без оцінки») so the
  owner sees what would be shared unrated. `cleanListFilter`, `filterSort`/matching and the card's
  condition text learn the new field.
- **#10 honest texts.** Share dialog text depends on the list kind: general recommendations — "live, changes
  appear at once"; hand-picked collection — "live link; the list changes only when you edit it"; by conditions —
  "live link; new matching titles are added when you press «Сформувати знову»". Delete confirmation: signed in —
  "the link stops working"; signed out (snapshot links) — "links you already sent are snapshots and keep
  showing the old list".
- **#34.** After «Сформувати знову» do NOT open the share dialog (stay where you are, toast "Updated: +a −d");
  the confirmation lists the titles to add/remove by name (up to 6 each, then "+N"). On a condition-based
  card show a small badge «є зміни: +a −d» when `listDiff` is non-empty.
- **#31 years.** Year fields: digits only (`inputmode=numeric`, strip non-digits on input), applied on `input`
  (debounced ~300 ms) not only on blur; only «from» = from that year on; only «to» = up to that year;
  both = range; reversed input is swapped in the fields. Update the hint text. Keep old stored filters
  meaning what they meant: an OLD stored filter with only `from` meant "exactly that year" — on read
  (`cleanListFilter` of stored data has no way to know) accept this behaviour change, but mention it in the report.
- **#5 phone share dialog** overflows at 375 px (link field, poster strip, texts): fix the CSS; also the
  horizontal scrollbar in the build dialog list on phone; share dialog must not change width between tabs (#37).
- **#37 parts here:** name field shows a counter `n/40` and Enter saves; in the build dialog the conditions
  block must not eat the whole height (collapsible on small heights or a two-column layout ≥ 900 px) so that
  several result rows are visible; poster strip on cards shows «+N» on phone too; cards keep alphabetical order
  (leave as is).

## Package 2 — rating a friend's list (the shared-list page)
Files mostly: `js/friends.js` (reply UI), `js/views.js` (`renderRecs`), `js/app.js` (route, chrome),
`js/cloud.js`, `js/social.js`, `styles.css`.

- **#1 lost rating + save state.** Find why a score clicked ~1 s before leaving the page is lost (debounce?
  queued write? Firestore write not flushed?) and remove the cause as far as the platform allows: send the
  write immediately on click (no artificial delay), keep the serialized queue. Each card shows the state of
  the reader's own rating: «надсилається…» → «збережено ✓» (or «не збережено — повторити»). While writes are
  pending, `beforeunload` asks the browser to warn, and `pagehide`/`visibilitychange→hidden` must not cancel them.
- **#3 scale after sign-in.** After signing in from the shared page the rating scale must appear by itself
  (no second click) as soon as the user is known.
- **#4 + #7-of-Bogdan name dialog.** The first rating must never be thrown away: keep the chosen score pending
  while the name dialog is open; on save — send it; on cancel/empty — keep the score shown as "not sent" with a
  line «Щоб надіслати оцінку, потрібен підпис» and a button to reopen. Dialog text in this context: "{owner}
  will see this name next to your scores" (not the text about one's own recommendation links).
- **#6 «Надіслати мої оцінки».** Opens a small confirm dialog listing what will be sent (title → score, up to
  ~12 then "+N") before sending. A score the reader deliberately removed on this owner's list is not offered
  again: remember removed ids per owner (local, cleaned, bounded) and exclude them until the reader rates that
  title on this list again.
- **#14 who sees my scores.** A line directly under the hero of a live list (`#u=`): closed —
  «Твої оцінки тут бачить лише {owner}»; open — «{owner} показує оцінки всім, хто має це посилання і ввійшов:
  твої оцінки теж видно». When a reader who already has ratings on this owner's list sees `open === true`
  for the first time (remember per owner locally that they have seen the closed state / the last seen value),
  show it as a dismissible notice box, not just the grey line. For signed-out visitors of an open list:
  «Увійди, щоб оцінити й побачити оцінки інших» (#3 of Vika's recheck).
- **#23 one rule for "my score".** (a) Rating a title that IS on my shelf: also sets my shelf score (existing
  rule) and the toast/state says so («…і на твоїй полиці»); removing the rating on the friend's list does not
  touch the shelf — say nothing more. (b) «Собі у список» for a title I have rated on this list adds it as
  «Переглянуто» with that score (and my comment stays only on the friend's list). (c) Titles I rated but do not
  have: after rating, the card offers a one-tap «Додати собі з цією оцінкою». (d) taste-match counts and
  "збіг/сперечаєтесь" badges must use the same notion of "my score" (shelf score, else my rating on this list).
- **#30.** The badge says «збіг» only when the two scores differ by ≤ 0.5; 1–2 apart — «близько»; more —
  «розійшлись» (replace «сперечаєтесь»). Taste-match percent is shown only with ≥ 3 commonly rated titles;
  otherwise «Замало спільних оцінок». Fix «За 1 тайтлами» with `tn`.
- **#29 owner on own link.** When the signed-in user is the owner (or, signed out, when the list's items all
  come from own shelf and the link was opened via «Як бачить гість» — pass a marker in the URL, e.g. `&me=1`,
  that only changes presentation): show a banner «Це твій список — так його бачать гості», hide taste match and
  «Уже в тебе», and for the signed-in owner show the friends' ratings block exactly as an allowed friend would
  see it (so the owner can verify the visibility switch, #16). «Як бачить гість» opens in a new tab.
- **#24 header on the shared page.** The account button (menu with sign-in/out, language, name) is present on
  the shared-list page too; the page language follows the browser language on first visit (uk if
  `navigator.language` starts with `uk`, else en) — check how the default is chosen today and fix only if it
  ignores the browser. One «Мій список» button, not two.
- **#22 phone.** Score buttons ≥ 40 px touch height and ≥ 30 px width at 375 px (two rows of five is fine);
  the comment field is a 2-row auto-growing textarea (max 500 chars, counter appears near the limit) with an
  explicit small «Зберегти» that shows the same save state as #1; Enter in it saves, Shift+Enter = newline.
  On phone the author's score stays next to the title, not at the bottom of the card.
- **#33.** A visible «×» / «прибрати» next to "your score" removes it; clicking the same number still works.
- **#36.** When the page becomes visible again (or every 60 s while visible) re-read the public doc and the
  replies for the open list and redraw if changed — without stealing focus from a comment being typed.
- **#13.** `#u=` with an empty/invalid uid → the normal friendly "list could not be opened" page (no SDK text);
  a real user with an unknown collection key/name → «У {owner} немає такої добірки» + link to their general
  recommendations; the tab title is reset on the error page; error sentences start with a capital letter.
- Friends' ratings block on a card (#4, #5 of Vika's recheck): title «Оцінки інших» (they are not necessarily
  the reader's friends), comment separated from the score («Богдан · 9 — „коментар“»).
- Closing the preview panel or rating a title must not re-render the whole list (posters flash, scroll jumps,
  #18/#21 of the reports): update the affected card only.

## Package 3 — the «Друзі» screen and «Керувати друзями»
Files mostly: `js/friends.js` (`renderFriends`, `friendsBlock`, `friendActions`, `keepButton`), `js/social.js`
(`friendTable`, `cleanFriend`, `recsFor`), `js/app.js` (nav), `js/i18n.js`, `styles.css`.

- **#20 «Запам'ятати».** Keep the data model (remembered collections per person) but make it legible:
  pressing it gives a toast «{name} тепер у Друзях» (or «Добірку „X“ додано до {name}») with an action
  «Відкрити Друзі», and the button turns into a disabled «Запам'ятано ✓». In «Керувати друзями» each friend
  shows what is remembered: «загальні рекомендації» and each remembered collection as a LINK that opens that
  list (`#u=<id>` / `#u=<id>&l=<name>`; snapshot friends have no link — show plain names), each with a small
  «×» to forget just that collection. A friend record gets `kept: boolean` = the owner pressed «Запам'ятати» on
  this person's general link at least once (`cleanFriend`, default false; migrate: existing `follow === true`
  records count as kept). `recsFor`: general recommendations (`p !== 0`) only when `kept`, collections by `lists`.
- **#18.** «Показувати рекомендації» is offered only for a friend with `kept` or non-empty `lists`. A person who
  only rated my list has no such toggle (their recommendations are never fetched).
- **#9.** «Прибрати рекомендації» → confirm, then really forgets: `follow: false`, `kept: false`, `lists: []`,
  cached recommendations of that person removed; rows that existed only because of their recommendations
  disappear; their ratings of my lists stay. Toast confirms.
- **#15 delete friend.** The confirmation becomes a question with two explicit outcomes (the owner asked for
  exactly this): title «Сховати {name}?», text explains that the column disappears and can be restored from
  the hidden list, plus a checkbox (unchecked by default) «Також видалити оцінки, які {name} поставив(ла) —
  word it without gender: „Також видалити оцінки цієї людини на моїх списках (назавжди)“». Unchecked = hide
  only (nothing deleted in the cloud; restoring brings the column back with its ratings). Checked = today's
  behaviour (cloud reply deleted when signed in and online; if it cannot be deleted now, say so and do not
  pretend). Button label follows the checkbox («Сховати» / «Сховати й видалити оцінки»). Extend `modal`/
  `confirmBox` in `js/ui.js` minimally to support one checkbox.
- **#16 visibility switch.** Show its state on the «Друзі» page itself, under the header: «Оцінки друзів бачиш
  лише ти» / «Оцінки друзів бачать усі, хто має твоє посилання і ввійшов» with a «Змінити» button (the switch
  can stay in the manage dialog too). Turning it ON asks for confirmation that names what happens (including
  that earlier ratings become visible, and how many people/ratings that is); turning it OFF needs no
  confirmation. Both give a toast. The off-state text is explicit. (Owner can verify the effect on their own
  link — done in package 2 #29.)
- **#11 two things in one cell.** A friend's cell shows both facts separately when both exist: their rating of
  MY list (score + comment) and their own recommendation (★ score + their comment), on two lines with small
  labels («оцінка» / «радить»). `friendTable` returns both; averages use: their rating of my list if present,
  else their recommendation score. Recommendation-only rows (titles not on my shelf) are grouped after the
  rows of my titles under a subheading «Радять друзі» and keep the «+ Собі у список» action.
- **#25/#26 comments.** On desktop a cell with a comment shows a small comment icon and the first ~40 chars
  under the score (full text in the title tooltip and on click-to-expand); on phone the friend columns become
  stacked lines inside the title's row (no horizontal table scrolling): «Богдан 9 — коментар».
- **#32.** With a person selected, «Сер.» column is hidden and the header count shows the visible rows. The
  «Сер.» header gets a tooltip/short caption «середнє друзів, без твоєї оцінки»; with a single friend the
  column is hidden. The page header counts friends AND titles («2 друзі · 9 тайтлів»). The header row is sticky.
- **#12 «Усі оцінки» in the title card.** Closes the card, goes to «Друзі», scrolls to that title's row and
  briefly highlights it (works when already on «Друзі» too).
- **Friends block for titles not on my shelf** (opened from «Друзі»): the preview card shows the same friends
  block (Bogdan's remark 15).
- **#27 phone navigation.** Bottom tabs become: Головна, Бібліотека, «+», Друзі, Рекомендації. «Каталог» and
  «Статистика» move to the account menu next to «Календар» (and stay in the desktop top nav as today). The
  "new ratings" dot shows on the «Друзі» tab.
- **Empty state of «Друзі»** says where «Запам'ятати» is ("on a friend's list page, next to the title") and
  offers «Скопіювати посилання на мої рекомендації» directly when there is something to share.
- The guest who is not signed in does not see the visibility switch (it has no effect without an account) —
  show «Увійди, щоб друзі могли оцінювати твої списки» instead.
- Stale background: after a toggle in «Керувати друзями» the table behind updates immediately.

## Package 4 — catalogue failures, wording, labels, small things
Files: `js/meta.js`, `js/panel.js` (`loadDemo`, palette), `js/views.js`, `js/i18n.js`, `js/ui.js`, `styles.css`.

- **#7 catalogue unreachable.** Every catalogue request gets a timeout (8 s) and an AbortController.
  «Показати на прикладі»: demo titles carry built-in basic data (title, year, kind, a couple of genres) so the
  demo fills the shelf even offline; metadata is fetched afterwards in the background; the toast ends with the
  real count («Додано 14» / «Додано 8, ще 6 уже були»). Search: show «Шукаю…», and on failure «Каталог зараз
  недоступний — спробуй ще» with a retry button (and pasting an IMDb link/id still adds the title with the id
  as its name). «Популярне зараз» / «Каталог»: skeletons are replaced by an error block with «Спробувати ще».
- **#28 wording.** No declined names and no gendered forms in Ukrainian strings: «Добірка · {name}»,
  «Рекомендації · {name}», «Показувати рекомендації цієї людини», «ще не в тебе» (instead of «ще не бачив»),
  one term for the shelf — «Моя полиця» for the button on shared pages (nav item «Бібліотека» stays), the
  recommend toggle on the title card uses one phrase in both states («Раджу друзям» with on/off state) and the
  «Рекомендації» section refers to that same phrase. English strings: singular "they".
- **#35 accessibility.** Every icon-only or state button has an `aria-label`; toggles use `role="switch"` +
  `aria-checked`; build-dialog rows have an accessible name (title); mini posters on collection cards have
  `title`/`alt` with the title name.
- **#37 small things.** «0 з 62 серій · 100%» for a finished series → show total/total; demo dialog text counts
  only what will actually be added; a toast never survives navigation to another page; toast position must not
  cover the primary button of the bottom card (raise it above the tab bar / keep 16 px gap); the library tile
  behind an open card updates its score when the card closes without a full re-render flash; shared-list rows
  without an author score show «без оцінки».

---

## Report contract (every package)
Report file: `.superpowers/sdd/2026-11-26-friends-fixes/package-N-report.md` — per item: what changed
(file:line), tests added (RED → GREEN), anything not done and why, "Not verified at runtime" list.
Commits: one per item or small group, Ukrainian subject, explicit paths (never `git add -A`).

## Additions after package 1 (belong to package 4)
- Creating a collection from the title card («Нова добірка» chip) must refuse an existing name the same way as
  the build dialog (reuse the package-1 helper).
- Adding/removing a title to a condition-based collection from the title card records it in that collection's
  manual `plus` / `minus` lists (package-1 listdef fields), so «Сформувати знову» does not undo it.
