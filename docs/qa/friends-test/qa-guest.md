# Role: GUEST — a friend who never signs in. Then VIKA — a second signed-in friend.

Address (part A): `http://guest2.localhost:8769/?emu=guest2` — open it once WITH `?emu=` (otherwise the page talks to the real cloud instead of the local emulator), but do NOT sign in during part A.
Alice's links are in `qa-links.md` next to this file (replace her hostname with yours).

## Part A — not signed in
1. Open each of Alice's links (general, "Аніме", "Нове", "Для Богдана"). For each: is it clear whose list it is, how many titles, what her scores/comments are? Open title previews. Use sorting/filters if any.
2. Try to rate a title. What does the app say? Is the path to signing in obvious? (Do not sign in.)
3. Add 2 titles to your own shelf from her list; check they appear on your shelf ("Моя полиця").
4. Press "Запам'ятати" if offered without sign-in. Then look at your "Друзі" section and at a card of a title Alice recommended.
5. Open a broken link: change a few characters of the user id after `#u=`, and a collection name that does not exist (`&l=Нема`). What do you see?
6. Phone layout of the shared-list page (resize_window preset mobile → desktop).

## Part B — become VIKA, a second rater
Use a NEW hostname so it is a new person: `http://vika2.localhost:8769/?emu=vika2`.
7. Open Alice's "Аніме" link (with the vika hostname), sign in, rate 3–4 titles — deliberately give scores DIFFERENT from what a typical fan would (e.g. 3, 5, 10) and one comment. Do not set a signature first: what name will Alice see for you? Does the app ask for one?
8. Check: can you see Bogdan's ratings on Alice's list? (Expected: no — Alice has not opened them yet.) Write down exactly what you see; you may be asked to re-check later.

Final message: include the list of titles and scores VIKA gave (so the owner's view can be checked against it), and whether a signature was requested.
