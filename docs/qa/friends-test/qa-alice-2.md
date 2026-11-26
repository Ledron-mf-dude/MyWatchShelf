# Role: ALICE — the owner. Phase 2: friends have rated your lists.

You are still signed in at `http://alice2.localhost:8769/` (reload the tab first). Common rules: `qa-common.md`.

## What friends did (ground truth to check against)

BOGDAN (signature "Богдан") rated on your lists:
| Title | Score | Comment |
|---|---|---|
| Breaking Bad | 9 | Фінал найкращий <i>тест</i> (literal HTML — must show as plain text) |
| Spirited Away | 9 | — |
| Interstellar | none (rated, then removed) | — |
| Arcane | 10 | — |
| Parasite | 6,5 | Переоцінений, але фінал сильний |
| Frieren | 8,5 | Повільно, але затягує |
| Attack on Titan | 7,5 | — |
| Demon Slayer | 5 | — |
| The Bear | 8 | Стрес як на справжній кухні |
| Wednesday | 4 | a 217-character comment ending "Кінець тесту 123456789." |
| Your Name. | not rated | — |

VIKA (signature "Віка") rated on "Аніме": Frieren 3 with comment «Занадто повільно, заснула на 3-й серії <i>тест</i>»; Spirited Away 5; Attack on Titan 10; Demon Slayer 6,5; Your Name. — rated 7 then removed (must show nothing).

Bogdan's own links (replace hostname with yours):
- General (3: Arcane 10 "Перший сезон — шедевр", The Dark Knight 10, Breaking Bad 9 "Класика, але не 10"): http://bogdan2.localhost:8769/#u=iOUgUaYaXMgFVXclXb2IYLOuD9xz
- "Від Богдана" (Arcane 10, Breaking Bad 9, Inception 9): http://bogdan2.localhost:8769/#u=iOUgUaYaXMgFVXclXb2IYLOuD9xz&l=%D0%92%D1%96%D0%B4%20%D0%91%D0%BE%D0%B3%D0%B4%D0%B0%D0%BD%D0%B0

## Part A (do now)
1. Before opening "Друзі": is there any sign that something new arrived (dot on nav, on the account button, on phone)? 
2. Open "Друзі". Are Bogdan and Vika there as columns without you doing anything? Compare EVERY cell with the tables above (scores, half points, removed scores, comments, the HTML comment, the long comment). Check "Сер." values — what exactly is averaged? Use the person and type filters. Does the "new" marker go away after you looked, and stay away after reload?
3. Open the title card of Frieren and of Wednesday from your shelf: is there a friends block, is it correct, does "Усі оцінки" lead somewhere sensible?
4. Open Bogdan's general link, then his "Від Богдана" link; press "Запам'ятати" on each. Back in "Друзі": what changed? Can you tell "Bogdan rated my title" from "Bogdan recommends this title" (★)? Are The Dark Knight / Inception (not on your shelf) shown, and what can you do with them?
5. "Керувати друзями": try every control for Bogdan — show/hide his recommendations, remove his recommendations, hide (delete) the friend and bring him back. After each: what changed in the table, and was it what the label promised? Finish with Bogdan visible again.
6. Phone layout of "Друзі" with real data and of "Керувати друзями".
7. LAST: turn ON "Друзі бачать оцінки одне одного". What feedback do you get? Open your own "Аніме" link ("Як бачить гість") — do you now see Bogdan's and Vika's ratings there?

Stop with the switch ON and report (only NEW remarks and ideas; state clearly for each cell mismatch: title, friend, expected, actual). You will be messaged for part B.
