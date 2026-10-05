# TCG board FX trials

Three experimental branches fork from `main` (navy/gold flat cloth). Playtest each, then use `tcg-board-polish` as the recommended merge or cherry-pick further.

| Branch | Focus |
|--------|--------|
| `tcg-fx-live-punchy` | PTCG Live–style combat: sharper hit/lunge/KO, legal pulse, hand lift |
| `tcg-fx-arcade` | Heavier shake, screen flash veil, overlay bursts, big coin/win motion |
| `tcg-ux-clarity` | Legal vs selected, prompts, refusal tips, action sheet — baseline combat FX |
| `tcg-board-polish` | **Recommended mix:** live-punchy combat + subtle impact veil/bursts + UX clarity affordances |

Toggle **Disable animations** in PS settings to verify `noanim` still skips FX.

After playtesting, merge the branch you prefer into `main`, or open a PR from `tcg-board-polish`.
