# WanderTales Guild — Phase 6 (Seasons & Cloud Saves)

A cozy fantasy life sim in the browser. You are the Guild Master of a small town that will eventually be populated by registered members of the @wandertales.guild community.

Phases 1–6 are done: seasons, weather and festivals, a Town Chronicle and cloud saves (see Phase 6 below). Before that: a playable 3D town whose residents live simulated lives and run its economy, followers of @wandertales.guild can register to become residents, and the best of them are recruited into the Guild through Instagram comment events. All residents are **clearly-labelled placeholders** (`src/game/residents.mock.ts`).

## Run it

Requires Node 22+ (tested on Node 26).

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173 — the follower registration page is http://localhost:5173/#/register.

Without Supabase settings the game uses a **local dev backend** (labelled in the UI): registrations live in this browser only. To go live, set up Supabase (below). On a phone on the same Wi-Fi, use the "Network" URL Vite prints.

```bash
npm test
```
Checks the town layout (every NPC route walkable, collision sliding), runs 3 game days of the life simulation headless (everyone sleeps, eats and works; needs stay in range; skills and friendships grow; nobody becomes miserable) checks that every dialogue line is complete, and tests the economy (gold is conserved, bread gets baked, a cottage gets placed and built by the builder, cancel refunds, upgrades, hiring, trade, save/load).

```bash
npm run build
```

## Supabase setup (live registrations)

1. Create a project at supabase.com.
2. In the SQL Editor, run the files in [supabase/migrations](supabase/migrations) **in order**: `0001_community.sql`, `0002_follower_check.sql`, `0003_guild.sql`, then `0004_cloud_save.sql` (only needed for cloud saves) (or `supabase db push` with the Supabase CLI).
3. Authentication → Sign In / Providers: turn on **Anonymous sign-ins** (followers register without an account) and **Email** (magic link for the Guild Master). Under URL Configuration set the Site URL and redirect URL to where the game is hosted. Turning on CAPTCHA for sign-ins is strongly recommended against spam.
4. Copy `.env.example` to `.env.local` and fill in the Project URL and the **anon** key (never the service_role key).
5. Start the game, open 🏘️ Community, sign in with your email, then make that account the Guild Master in the SQL Editor:
   ```sql
   insert into public.player_profiles (user_id, role)
   select id, 'guild_master' from auth.users where email = 'you@example.com'
   on conflict (user_id) do update set role = 'guild_master';
   ```
6. Follower check: open 🏘️ Community → **Followers** and upload the follower list from Instagram's "Download your information" export (steps are shown in the panel). From then on only accounts on that list can register; others see "Kamu belum follow @wandertales.guild" with a Follow button. Re-upload a fresh export now and then so new followers can join.
7. Backups: Supabase takes daily backups on paid plans; every approval/removal is also recorded in `audit_log`.

How the data is protected: all tables have Row Level Security. Followers can only read their own registration; residents are listed through `list_residents()`, which hides Instagram names unless the resident agreed. Every write goes through SQL functions that validate input and check the Guild Master role on the server — the browser is never trusted. `npm test` runs these rules against a real Postgres (PGlite) to prove it.
Outputs a static site in `dist/` — deploy to any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages).

## Controls

| | Desktop | Mobile |
|---|---|---|
| Switch Town View / Explore | `V` or bottom button | button top-right |
| **Town View** pan | drag, WASD / arrows | drag |
| zoom | mouse wheel | pinch |
| rotate | right-drag, Q / E | — |
| select building / resident | click | tap |
| **Explore** move | WASD / arrows | joystick |
| sprint | Shift | 🏃 button |
| look around | drag | drag |
| interact (talk / inspect) | E | tap the prompt |
| close panels | Esc | ✕ |

## Project structure

```
src/
  App.tsx                 Canvas + screens
  game/                   pure logic, no React (testable with plain Node)
    map.ts                building definitions, colliders, NPC walk graph, BFS pathfinding
    collision.ts          circle-vs-box collision with wall sliding
    scenery.ts            deterministic trees, rocks, flowers, lamp placement
    residents.mock.ts     MOCK residents (placeholders)
    sim.ts                life simulation: needs, utility AI, professions XP, friendships, conversations
    professions.ts        all 19 professions: workplace, shift, wage, output; XP curve
    dialogue.ts           template dialogue from personality, profession, place, relationship, needs
    avatar.ts             avatar options, random avatars, Instagram/name/appearance validation
    community.ts          brings approved members into town, finds them a free bed
    csv.ts                CSV parsing, validation and de-duplication for imports
    recruitment.ts        ranks, classes, comment CSV reader, leaderboard scoring (mirror of the SQL rules)
    guild.ts              quest board, adventures, records, reputation
    town.ts               building types, construction/upgrades, placement rules, storage, prices, trade, ledger
    persist.ts            browser save/load of the simulated world
    store.ts              Zustand game state (mode, clock, selection, settings)
    live.ts               per-frame shared state (input, player, camera, NPC positions)
    selfcheck.test.ts     layout/pathfinding/collision checks (npm test)
  world/                  React Three Fiber scene
    Environment.tsx       day/night lighting, ground, paths, river, trees, lamps, fireflies
    Buildings.tsx         procedural low-poly buildings, hover/selection
    Character.tsx         modular chibi character + walk/idle/work animation
    Player.tsx            Guild Master controller + interaction detection
    NPCs.tsx              moves residents toward what the simulation wants, speech bubbles, runs the sim
    CameraRig.tsx         hybrid isometric / third-person camera
    Placement.tsx         construction preview (ghost building, door and new road)
    materials.ts          shared geometry + material cache
  backend/                Backend interface: supabase.ts (live) and local.ts (dev), sync.ts
  ui/                     Guild.tsx (Guild Hall), Register.tsx (public page), Community.tsx (Guild Master), AvatarEditor.tsx, HUD, panels (TownPanels.tsx: building, build menu, storage & trade), main menu, mobile joystick
```

Adding real residents later: give each one an `Appearance` (skin, hair, outfit, height…) and a home/work building id — `Character` and `NPCs` already render any resident from that data.

supabase/
  migrations/0001_community.sql   tables, RLS, validation + admin functions
  migrations/0002_follower_check.sql  follower list (hashed) + follow check
  migrations/0003_guild.sql       guild members, ranks, recruitment events, comments, leaderboard
  migrations/0004_cloud_save.sql  one cloud save slot per town, compare-and-set writes (conflict detection)
  tests/community.test.ts         runs the migration in PGlite and tests the rules

## Status

**Done — Phase 1**
- Main menu with Guild Master name (remembered in the browser)
- Town: Guild HQ, Town Square + fountain, Bakery, Blacksmith, Tavern, Market, Farm, 4 cottages, Construction site, Fishing dock, river, forest, mountains
- Hybrid camera: isometric town view and third-person exploration, smooth transitions, same world
- Playable Guild Master: walk, sprint, collision with buildings/trees/river
- 12 placeholder residents that walk along a path graph so they never cross buildings
- Walk, idle and work animations
- Clickable buildings and residents with info panels; "Explore here" and "Find in town"
- Talk to residents and inspect buildings in Explore mode
- Day/night cycle: sun, sky, fog, glowing windows and lanterns, fireflies; game speed 1× / 5× / 30×
- Desktop + mobile controls and responsive HUD; High/Low graphics setting
- Performance: instanced trees/rocks/flowers/lamps/paths, shared geometry + materials

**Done — Phase 2**
- Needs per resident: fullness (hunger), energy, social, health, happiness (0–100), plus wealth
- Utility AI picks between sleep, eat, work, socialize, shop and stroll from needs, time of day and personality; residents commit to an activity and only switch when it's done, urgent, or clearly better
- Personality matters: Hardworking residents learn faster, Lazy ones nap more, Social ones get lonely faster and favour the tavern, Shy ones socialize less, Greedy moods follow their wallet
- 19 professions with shifts (e.g. Baker 5–13, Bartender 14–23), wages, and skill levels 1–10 gained by working (⭐ bubble on level-up)
- Eating at the tavern costs money; poorer residents eat at home (indoors)
- Friendships 0–100 (Stranger → Acquaintance → Friend → Good Friend → Best Friend); housemates and coworkers start as acquaintances; compatibility depends on personalities
- Conversations when residents meet at the square, tavern or market (💬 bubble), passing greetings (👋), visiting a friend who is out
- Contextual dialogue from personality, profession, place and relationship; residents tell the Guild Master when they're hungry, tired or lonely
- Resident panel: needs bars, XP, shift, wealth, top friends, last conversation, friendship with you; town mood in the top bar
- Walking speeds up with game speed so routines still work at 30×
- Distance tier: far-away characters skip limb animation
- World saves in the browser every 15 s (and on leaving); Settings → Reset world

**Done — Phase 3**
- 🔨 Build menu: Cottage, Farm, Bakery, Smithy, Tavern, Market, Lumber Camp, Stone Quarry, Iron Mine, Carpenter's Workshop, Alchemist's Lab — each with gold + material costs
- Placement preview follows the cursor (tap on mobile), snaps to the grid, rotates (R), shows the door and the new road; red with a reason when invalid (overlap, blocks a road or lamp, too close to the river/square/edge, no road access). Trees on the plot are cut for +2 wood each
- Construction and upgrades (max level 3) are done by Builders during their shift: they walk to the site, scaffolding goes up and the building rises with progress. Cancel = full refund before work starts, half after
- Levels add worker slots, +25% production speed, beds (cottages) or storage (Guild HQ)
- Worker assignment: hire residents into a building's professions, fire them (unemployed); skill is kept per profession
- Production chains run by workers on duty, faster with skill and building level: Farm → Wheat/Vegetables/Herbs, Dock → Fish, Bakery Wheat → Bread, Smithy Iron + Wood → Weapons, Workshop Wood → Furniture, Lab Herbs → Potions, Lumber/Quarry/Mine → Wood/Stone/Iron. Missing inputs or full storage stop production
- Money flow: the treasury pays wages; residents pay rent, buy meals at the tavern (consumes stored food) and goods at the market — only while those are staffed. Unpaid workers get unhappy. Gold is conserved (tested): only trade and construction move it in or out of town
- Supply & demand prices (0.6×–1.8× base by stock); travelling merchant buys at 80% and sells at 130%; one-click "Sell surplus"
- Storage & Trade panel: stock, prices, trade buttons, last 7 days income vs spending, recent transactions
- Top bar shows gold, wood, stone, food and residents/beds

**Done — Phase 4**
- Public registration page (`#/register`): Instagram username + town name → avatar creator with live 3D preview → personality + consent → a one-time code (e.g. `WTG-3F9A1C`) to send by DM to @wandertales.guild. Followers can check their status and withdraw consent (deletes their resident)
- Instagram ownership is confirmed by that DM code, checked by the Guild Master. No scraping and no Meta API
- Follow check without any API: the Guild Master uploads @wandertales.guild's own follower list from Instagram's official "Download your information" export (JSON/HTML). Registration checks it right after the username step; non-followers get "Kamu belum follow @wandertales.guild" and a Follow button. Only SHA-256 fingerprints of usernames are stored. The list is as fresh as the last upload
- Avatar generator: skin tone, hair style and color, eye style, shirt, trousers, hat, accessory (glasses/scarf/flower), body build, height; Randomize
- 🏘️ Community panel (Guild Master): review pending registrations with their code and avatar, approve/reject, list and remove residents, manual add (with consent checkbox), CSV import with per-row preview (invalid handle, no consent, duplicates, already registered)
- Duplicate prevention: one live registration per Instagram account (case-insensitive, URLs and @ accepted), one pending registration per applicant, 3 attempts per day
- Each resident has a permanent `resident_id` independent of their Instagram username; Instagram is only shown in game with consent
- Housing: approved members move into a built cottage with a free bed; if none, they wait until you build one (they arrive automatically). Placeholder residents can be switched off to free their beds
- New residents arrive unemployed — hire them in any building. Their needs, skills and jobs are saved
- Supabase backend with RLS and server-side validation; local dev backend (clearly labelled) when not configured

**Done — Phase 5**
- ⚔️ Guild Hall (nav button, or the Guild HQ building → "Open Guild Hall"): Overview, Members, Quests, Recruitment, Records
- Guild Members are a separate record on top of a registered resident: rank (Novice → Apprentice → Adventurer → Veteran → Elite → Legendary), class (Warrior, Mage, Archer, Rogue, Healer, Paladin), renown. Members wear a cape in their class color in town
- Recruitment events linked to an Instagram post: dates, comments needed, recruit slots, anti-spam settings. Comments are imported from a CSV (`username, text, timestamp`) — no Meta API. Comment text is hashed in the browser; only the hash and its length are stored
- Counting happens on the server from the raw comments: only inside the event dates, at least N letters (emoji/mention-only comments don't count), the same text counts once, max N per person per day, the guild account is ignored, re-imports skip duplicates
- Leaderboard: rank, @username, valid/total comments, eligibility with a reason (not a registered resident, needs N more, already a member). The Guild Master picks a class and recruits — never automatic, limited by slots. Recounts keep decisions. Close the event when done
- Quest board: 3 quests per day (10 quest types, difficulty 1–5, 4–20 hours). Pick a party; success depends on rank vs difficulty, party size, a Healer and class variety. Members leave town during the quest. Success brings gold and goods to the town and renown to each member; failure sends them home hurt. Ranks rise automatically with renown (saved on the server; queued if you're offline)
- Guild reputation, quest earnings and an adventure log, saved with the town

**Done — Phase 6**
- 🗓️ Calendar: 4 seasons of 7 days (a 28-day year), shown in the clock. Day 1 is spring day 1. Seasons and weather are pure functions of the game clock, so they need no saving and are identical after a reload
- 🌦️ Weather per day: clear, cloudy, rain, thunderstorm, snow, fog — chosen from a table per season (no snow outside winter). Rain/snow/storms come and go during the day. Visuals: overcast sky, fog, rain streaks, snowfall with a white blanket on the grass, autumn leaves, spring petals, lightning in storms; trees and ground change colour with the season
- Gameplay effects: farms grow ~15% faster in summer, ~10% in autumn and half as fast in winter, and like gentle rain; outdoor jobs (farm, lumber, quarry, mine, dock) slow down in snow and storms; residents standing outside in rain, snow or storms get a little unhappier
- 🎆 Festivals on the last day of every season, 14:00–23:00: Blossom Festival, Midsummer Fair, Harvest Festival, Winter Lights. The square gets poles, bunting and lanterns, residents gather there, and socialising/relaxing gives extra social and joy. A banner shows while it runs
- 📜 Town Chronicle (nav button): the calendar plus a diary grouped by day — seasons, storms and snow, festivals, buildings finished, residents reaching level 3+, quests, new community residents moving in, and gold/population milestones. Filter by Nature / Town / Guild. Saved with the town (last 300 entries)
- ☁️ Cloud saves (Settings → Cloud save, Guild Master only): uploads the same snapshot as the local save every 2 minutes, or on "Save now". Every upload states which cloud revision it is based on. If another device saved in between, nothing is overwritten: you see both saves (day, season, gold, residents, buildings, which device, when) and choose **Keep this device** or **Use cloud save**. On start the game compares with the cloud the same way. Needs `0004_cloud_save.sql`; with the local dev backend the "cloud" is one slot in this browser so the flow can be tried

**Done — Phase 7, part 1: Sound**
- Sound made with Web Audio: rain, wind (snow and storms), birdsong on clear spring/summer days, thunder after lightning, and quiet looping background music (`public/audio/bgm.mp3`, softened with a low-pass filter for a cozy feel). What you hear follows the weather and clock (`src/game/audiomix.ts`)
- Starts on your first click or key press (browser rule), pauses when the tab is hidden. Settings → Sound: on/off, master volume and a separate music (BGM) volume, remembered in this browser

**Done — Phase 7, part 2: Guild Hall interior**
- Walk up to the Guild HQ door in Explore mode → "Enter Guild Headquarters" (E), or Building panel → "🚪 Go inside". Built from boxes (no model files), following the art in the asset folder: wooden hall, red-carpet staircase, quest board and reception desk, fireplace with a flickering fire, bookshelves, banners, lanterns, plants, crates
- Guild members who are home (not on a quest) stand in the hall, up to three, with name labels. Stand at the quest board → E opens the Guild Hall panel. Walk out through the door (or press E there) to return to the town. Camera stays inside the room; the front wall fades out of the way when the camera is outside it. Rain and snow stop indoors, weather sounds are muffled, the music keeps playing
- Town View / Build are paused while you are inside (using them takes you back outside)
- The Tavern (built from boxes too): bar counter, four tables with benches, a fireplace, barrels and a pantry shelf. Same controls as the Guild Hall — walk to its door → "Enter" (E), or Building panel → "🚪 Go inside". Note: a resident serving or eating at the tavern is still shown in town near its door (the tavern has no indoor patrons yet) — the room is for the Guild Master to walk into, not a second home for residents
- The Bakery: a glowing brick oven, a flour-dusted kneading table, a work counter and two bread shelves. Same controls (E / "🚪 Go inside")
- The Smithy: a glowing forge, an anvil and workbench, a weapon rack along the wall, a grindstone, ore crates. Same controls
- The Market: four produce stalls with striped awnings and colourful fruit/veg piles, crates by the door. Same controls
- Every cottage (h1, h2, ... however many are built): a bed, a small hearth, a table and a wardrobe. One layout shared by all of them — rooms are keyed by the building's *kind*, not its id, so a newly built cottage gets an interior automatically
- Residents actually on shift, shopping, eating/socialising at the tavern, or asleep at home show up standing in that room (a handful of fixed spots, not their simulated position) — walk in on the right hour and you'll find the baker at the oven or three residents asleep in their cottage. Nobody doubles up outdoors while shown inside (town residents aren't rendered at all while the Guild Master is in a room)
- While the Guild Master is inside any room, town residents aren't rendered (the camera can't see the town from in there anyway) — avoids a guild member being shown both in town and standing in the Guild Hall at once

- Automatic Instagram verification (Instagram Messaging API webhook via an Edge Function — needs a Meta app and review) — later; manual code check works today
- Guild members, ranks, recruitment events, Instagram comment import (via official API or CSV only) — Phase 5
- GLB art assets for buildings — Phase 7 (sound is done, see above). Web Worker for the simulation: not needed yet — measured 0.008 ms per sim step for 12 residents at 60 fps (a worker only pays off at hundreds of residents)
- Known simplifications: one shared town storage (no per-building inventories or hauling); demolishing finished buildings isn't supported yet; all economy rules run in the browser until the Phase 4 backend validates them; NPCs keep separate walking lanes but don't actively steer around each other; cloud saves are one slot per town with no merge (you pick one save), only the Guild Master can use them, and old versions are not kept; third-person camera can clip into walls; Rapier physics not used (simple box collision is enough so far)

## Testing checklist

- [ ] `npm test` prints `selfcheck ok`, `sim ok` and `dialogue ok`
- [ ] `npm run build` succeeds
- [ ] Menu: enter a name → town loads; reload keeps the name
- [ ] Town View: pan (drag + WASD), zoom (wheel), rotate (right-drag, Q/E)
- [ ] Hover a building → ring + name; click → panel with correct info
- [ ] Building panel "Explore here" → Guild Master appears at its door in third-person
- [ ] Explore: WASD moves relative to camera; Shift sprints; can't walk through buildings, trees or the river; can walk onto the dock
- [ ] Walk near a resident → "Talk to …" prompt; E opens their panel with a greeting
- [ ] `V` toggles modes with a smooth camera move
- [ ] Residents walk to work at their own shift times, animate while working, go home at night and disappear indoors
- [ ] Resident panel needs bars change over time; eating refills fullness, sleeping refills energy, chatting refills social
- [ ] 💬 bubbles appear when residents chat; panel shows "Chatting with …" and the last conversation line; friendship values rise
- [ ] Talking to a resident as Guild Master raises your friendship with them (once per game day)
- [ ] Reload the page → time, needs, levels and friendships are kept; Settings → Reset world starts over
- [ ] Build menu → pick a building → preview turns green/red with a reason; R rotates; place it → gold and materials are deducted, a road appears
- [ ] During builder hours (7–16) the builder walks to the site and the building rises; it becomes usable when finished
- [ ] Cancel a construction before work starts → full refund; after → half
- [ ] Building panel: hire a resident, fire them, upgrade (needs builders), see recipe and worker status
- [ ] Storage: bread rises while bakers work and falls when residents eat at the tavern; sell/buy changes gold and stock; prices move with stock
- [ ] Let the treasury run dry → workers show "unpaid" and get unhappy; selling surplus fixes it
- [ ] Seasons: clock shows e.g. "🌸 Spring 3/7 · Rain"; after 7 days it says Summer, leaves/ground colours change; winter turns the grass white
- [ ] Rain/snow/fog/storm appear on their days (Chronicle → "Nature"), sky gets darker, particles follow the camera in Town View and Explore
- [ ] Day 7 of a season at 14:00: banner "… on the square!", bunting around the square, residents gather there
- [ ] 📜 Chronicle lists finished buildings, quests, seasons and festivals; reload keeps it
- [ ] Settings → Cloud save → tick "Sync" → "✔ Synced"; a second browser profile with a different town shows the conflict choice and overwrites nothing until you pick
- [ ] Sound: after the first click, rain is audible on rainy days, birds by day; Settings → Sound mutes and changes volume
- [ ] Explore → walk to the Tavern door → "Enter" → inside: tables, bar and fireplace block movement; walking out returns you outside
- [ ] Explore → walk to the Bakery door → "Enter" → inside: oven, counter and shelves block movement; walking out returns you outside
- [ ] Explore → walk to the Smithy door → "Enter" → inside: forge, anvil and rack block movement; walking out returns you to the smithy's own door
- [ ] Explore → walk to the Market door → "Enter" → inside: stalls and crates block movement; walking out returns you outside
- [ ] Explore → walk to any cottage door → "Enter" → inside: bed, hearth, table and wardrobe block movement; walking out returns you to that cottage's own door
- [ ] Explore → walk to the Guild HQ door → "Enter" → inside: can't walk through desk, stairs, fireplace or walls; quest board prompt opens the Guild Hall; walking out the door returns you to the path outside
- [ ] Speed up time (⏩): sky darkens, windows and lanterns glow, fireflies appear; morning returns
- [ ] Residents / Buildings list → selecting one flies the camera there
- [ ] Settings: switching to Low removes shadows and keeps the game running
- [ ] Phone (or browser mobile emulation): joystick moves, sprint works, menus don't overlap, pinch zooms
- [ ] `#/register`: invalid username is flagged; avatar editor updates the 3D preview; Join is disabled until consent is ticked; a code is shown
- [ ] Registering the same Instagram twice (any casing, with @ or as a URL) is refused
- [ ] 🏘️ Community → Pending shows the registration; Approve → the resident appears in town (or waits for a bed); Reject → status page says not approved
- [ ] With all beds full, build a Cottage → waiting residents move in when it finishes
- [ ] Toggle placeholder residents off → registered residents take their beds; on → they return with their state
- [ ] Import CSV: rows without consent, duplicates and bad handles are shown and skipped
- [ ] Withdraw on the status page → the resident leaves town
- [ ] Community → Followers: upload followers_1.json → count shown; a username not on the list gets the "belum follow" error with a Follow button; a follower continues, and Pending shows "✓ Follows"
- [ ] With Supabase configured: Community asks the Guild Master to sign in; a non-Guild-Master account sees no registrations
- [ ] Guild Hall → Recruitment: create an event with an Instagram post link; import a comments CSV; the leaderboard shows valid/total counts and reasons; recruit an eligible resident with a class; slots are enforced
- [ ] The new member appears under Members with a cape in town; promote/demote/change class works
- [ ] Quests: pick a party, see the success chance, send them; they disappear from town and come back at the shown time with a result in Records
- [ ] No errors in the browser console
