# Ancient

A small Dota 2 companion for your Steam profile: rank, estimated MMR, win rate, recent matches, and a left-side page navigation for Overview, Match History, Scout Report, and Party Roster. The Overview uses a wide layout with a personal improvement focus alongside recent matches. That focus compares available stats from recent wins and losses to suggest one area to review; it is a prompt based on correlation, not proof of what caused a result. The scout report includes hero records, rank history, party history, hero matchups, professional item trends, and performance benchmarks. It is based on public OpenDota data and may be incomplete when profile or match data is unavailable. The hero field guide compares recent personal stats with all-rank benchmarks; professional builds and matchup statistics are contextual references, not predictions. Patch trends, party comparison, and personal goals are marked as coming soon.

Unranked profiles may also see a predicted rank based on a recency-weighted average of medal-star steps from recorded match-average ranks in up to 20 recent games. It requires at least five matches with rank data and is explicitly an estimate, not a confirmed personal rank. Use **Sync recent games** to ask OpenDota to refresh a profile and reload its data; newly played matches may take a few minutes to appear. Select a match to open its full battle report, including both teams, player heroes, inventories, K/D/A, last hits, net worth, GPM, and XPM. Where OpenDota includes replay timeline data, the report also plots team net-worth, experience, and gold advantages per minute.

## Run locally

1. Install Python 3.9 or later.
2. From this folder, run `py -3 local_server.py` on Windows or `python3 local_server.py` on macOS/Linux.
3. Open [http://127.0.0.1:8000](http://127.0.0.1:8000) and sign in with Steam.

Steam sign-in uses Steam OpenID and is validated by the app server. The app does not ask for or store your Steam password. Public match and profile data is fetched from OpenDota. OpenDota may not have an MMR estimate, average rank, or per-minute replay timeline for every player or match; unavailable data is identified in the dashboard or match report.

Dashboard profile, record, recent matches, hero names, and scout-report sections load independently so a slow endpoint does not hold up the rest of the page. The full Match History page loads up to 100 games when opened and supports filtering by result and hero. Hero matchups, pro item trends, and benchmarks update when a different hero is selected. OpenDota requests time out after 12 seconds and show a retry option if data is unavailable.

If the Steam profile avatar is missing or fails to load, the dashboard uses Dota 2 Invoker artwork as a fallback.

The local server binds only to `127.0.0.1`. The sign-in callback uses that same address and port, so if you change `PORT`, open the app at the matching `http://127.0.0.1:<port>` URL.

## Deploy to Vercel

1. Push this repository to GitHub and import it in Vercel. No build command or third-party packages are required: Vercel serves the static dashboard and the Python functions in `api/auth/`.
2. In the Vercel project's **Settings → Environment Variables**, add `SESSION_SECRET` as a **Secret** for Production and Preview. Generate a fresh value locally with `py -c "import secrets; print(secrets.token_urlsafe(48))"` on Windows or `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` on macOS/Linux. Do not commit this value or expose it in a `NEXT_PUBLIC_` variable.
3. After the first deployment, add `APP_URL` as a **Config** environment variable for Production using the site's canonical HTTPS origin, for example `https://ancientdota2.vercel.app` (no path). For Preview, leave it unset to use Vercel's preview host, or set it to that environment's canonical HTTPS domain.
4. Redeploy after adding or changing environment variables. Open the deployment and use **Sign in with Steam**.

The Steam callback is generated from the public site origin. `APP_URL` is recommended for the Production domain; if omitted, Vercel deployments accept the current `*.vercel.app` host. The signed, HttpOnly session cookie does not require an in-memory session store, so it works across serverless function instances. Sessions expire after 24 hours; signing out clears the browser cookie.

## Privacy

The Steam OpenID assertion is verified server-side. The account ID is stored only inside a signed, HttpOnly cookie; no profile or match data is written by the app. On Vercel, `SESSION_SECRET` signs short-lived OpenID state and 24-hour sessions. The friend list is stored in your browser's local storage and is not sent to the app server. Match, profile, and scout-report requests go directly from your browser to the public OpenDota API. Friends need a public OpenDota profile for their stats to appear.
