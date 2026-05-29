# KICKSTOCK — CAHIER DE TESTS COMPLET
**Version :** 2.0.0  
**Date de mise à jour :** 2026-05-29  
**Périmètre :** Monorepo Phase 2 — `apps/web` · `packages/*` · Base de données Supabase  
**Méthode :** Tests unitaires · Tests d'intégration · Tests de bout en bout · Audit sécurité · QA UI/UX

> **Note de version 2.0** : Mise à jour complète sur base du code actuel. Principaux changements reflétés : mode offline-first (`localGameStore` + `NEXT_PUBLIC_OFFLINE_MODE`), nouveau flux d'authentification invité (pseudo + Cloudflare Turnstile + rate limiting), routes auth (`/api/auth/guest`, `/api/auth/check-pseudo`, `/api/auth/check-email`, `/api/auth/set-username`), codes d'erreur structurés dans `/api/trade`, UUID v4 validé dans `/api/game/state`, ETag/304 sur `/api/game/state`, correction des taux de taxe (`calcTax` : 10 % groupes / 5 % KO), `MechanicsContract` implémenté, Sentry actif sur les 3 routes API, migration invité→compte OAuth (`migrate_guest_to_user`).

---

## TABLE DES MATIÈRES

1. [Infrastructure & Repo](#1-infrastructure--repo)
2. [Sécurité & Isolation](#2-sécurité--isolation)
3. [Tests Fonctionnels Métier](#3-tests-fonctionnels-métier)
4. [Compatibilité UI/UX](#4-compatibilité-uiux)

---

## Conventions

| Statut | Signification |
|--------|---------------|
| `[ ]` | Non exécuté |
| `[x]` | Passé |
| `[!]` | Échoué — anomalie ouverte |
| `[~]` | Partiellement validé — action en cours |

**Sévérités :**
- 🔴 **BLOQUANT** — mise en production interdite
- 🟠 **MAJEUR** — à corriger avant release
- 🟡 **MINEUR** — suivi post-release acceptable
- 🔵 **COSMÉTIQUE** — aucun impact fonctionnel

---

## 1. INFRASTRUCTURE & REPO

### 1.1 Structure du Monorepo

#### 1.1.1 Vérification de l'arbre de packages

**Objectif :** `pnpm-workspace.yaml` (`apps/*`, `packages/*`) reconnaît les quatre workspaces.

```bash
pnpm ls -r --depth 0
```

**Résultat attendu :**
```
kickstock (root)
├── web                    @ apps/web
├── @kickstock/constants   @ packages/constants
├── @kickstock/game-engine @ packages/game-engine
└── @kickstock/types       @ packages/types
```

---

#### 1.1.2 Acyclicité du graphe de dépendances

**Hiérarchie obligatoire :**
```
@kickstock/types  →  @kickstock/constants  →  @kickstock/game-engine  →  apps/web
```

**Procédure :**
```bash
# @kickstock/types ne doit importer aucun autre package interne
grep -r "@kickstock/" packages/types/src/

# @kickstock/constants ne doit pas importer game-engine
grep -r "@kickstock/game-engine" packages/constants/src/

# @kickstock/game-engine ne doit pas importer apps/web
grep -r "from 'apps/" packages/game-engine/src/
```

**Résultat attendu :** Aucune ligne retournée pour les trois commandes.

---

#### 1.1.3 Type-check global

```bash
pnpm -r type-check
```

**Résultat attendu :** `0 errors` pour chaque workspace. Une erreur `TS2305` sur `@kickstock/types` indique un export manquant ou un `tsconfig` mal configuré.

---

#### 1.1.4 Isolation de compilabilité par package

```bash
pnpm --filter @kickstock/types build
pnpm --filter @kickstock/constants build
pnpm --filter @kickstock/game-engine build
```

**Résultat attendu :** Exit code `0` pour chaque commande indépendamment, sans lancer `apps/web`.

---

#### 1.1.5 Cohérence des constantes financières entre TS et SQL

**Objectif :** Les valeurs de `DIV_RATES` et `INIT_CASH` dans `@kickstock/constants` correspondent aux paramètres utilisés dans les RPC Supabase.

**Référence `packages/constants/src/index.ts` :**
```typescript
DIV_RATES = { r32:0.10, r16:0.15, qf:0.20, sf:0.30, final:0.40, champion:0.60 }
INIT_CASH = 10_000
```

**Procédure :** Vérifier dans `db/FULL_SETUP.sql` que le RPC `distribute_dividends` reçoit bien `p_rate = DIV_RATES[round]` et que `get_or_create_portfolio` initialise `cash = 10000`. Toute divergence entre les deux sources est un bug de distribution financière.

---

#### 1.1.6 Variable d'environnement `NEXT_PUBLIC_OFFLINE_MODE`

**Objectif :** Le mode de jeu (`localGameStore` vs `onlineGameStore`) est contrôlé par `NEXT_PUBLIC_OFFLINE_MODE`. Vérifier que le store actif correspond à la variable d'environnement déployée.

**Procédure :**

```bash
# Vérifier la valeur déployée sur Vercel
# En local, vérifier apps/web/.env.local
grep "NEXT_PUBLIC_OFFLINE_MODE" apps/web/.env.local apps/web/.env.production 2>/dev/null
```

**Comportements attendus :**

| `NEXT_PUBLIC_OFFLINE_MODE` | Store actif | Trades | Simulation | Leaderboard |
|---------------------------|-------------|--------|-----------|-------------|
| `true` (ou non défini) | `localGameStore` | Client-side, localStorage | Client-side | `syncBestScore` vers Supabase |
| `false` | `onlineGameStore` | Via `/api/trade` | Via `/api/game/advance` | Intégré |

> **État actuel du code :** `gameStore.ts` ré-exporte `useLocalGameStore` — le mode offline est actif par défaut.

---

### 1.2 Pipeline CI

#### 1.2.1 Linting global

```bash
pnpm lint   # équivalent à pnpm -r lint
```

**Résultat attendu :** Zéro erreur, exit code `0`. Les `// eslint-disable-next-line @typescript-eslint/no-explicit-any` présents dans les routes API (contournement du typage Supabase) sont documentés et acceptables ponctuellement — ils ne doivent pas proliférer.

---

#### 1.2.2 Build de production

```bash
pnpm build   # équivalent à pnpm --filter web build
```

**Résultat attendu :**
- `✓ Compiled successfully`
- Aucune erreur TypeScript à la compilation
- Toutes les routes API apparaissent avec le flag `(Dynamic)` : `/api/trade`, `/api/game/state`, `/api/game/advance`, `/api/market`, `/api/auth/guest`, `/api/auth/check-pseudo`, `/api/auth/check-email`, `/api/auth/set-username`
- `export const maxDuration = 60` visible sur `/api/game/advance` (Vercel Fluid Functions)

---

### 1.3 Tests unitaires `@kickstock/game-engine`

#### 1.3.1 Exécution de la suite existante

```bash
pnpm --filter @kickstock/game-engine test
```

**Couverture actuelle (`engine.test.ts`) — valider que tous ces tests passent :**

| Suite | Cas | Input | Résultat attendu |
|-------|-----|-------|-----------------|
| `applyResult` | Victoire A symétrique | `(100, 100, 'A')` | `[150, 50]` |
| `applyResult` | Match nul | `(100, 100, 'draw')` | `[125, 125]` |
| `applyResult` | Victoire A asymétrique | `(200, 50, 'A')` | `[225, 25]` |
| `applyResult` | Prix plancher | `(1000, 10, 'A')` | `nB >= 1` |
| `calcTax` | Phase groupes 10% min 10 KC | `(200, 100, false)` | `20` |
| `calcTax` | Phase groupes minimum | `(50, 50, false)` | `10` |
| `calcTax` | Phase KO 5% min 10 KC | `(200, 100, true)` | `10` |
| `calcTax` | Phase KO au-dessus du min | `(300, 100, true)` | `15` |
| `calcTax` | Nation éliminée (price=1) | `(100, 1, false)` | `0` |
| `calcDividend` | R32 10% | `(200, 'r32')` | `20` |
| `calcDividend` | Champion 60% | `(500, 'champion')` | `300` |
| `calcDividend` | Clé inconnue | `(100, 'unknown')` | `0` |
| `simulate` | KO : jamais de draw | 50 itérations, `isKO=true` | Résultat toujours `'A'` ou `'B'` |
| `simulate` | Groupes : draw possible | 200 itérations, forces égales | Set contient `'draw'` |
| `simulate` | Favori gagne plus souvent | 1000 itérations, `str=95 vs 40` | Favori gagne > 70 % |

---

#### 1.3.2 Cas manquants à ajouter

Ces cas ne sont pas couverts dans `engine.test.ts` et représentent des risques de régression :

| Fonction | Cas à ajouter | Justification |
|----------|--------------|---------------|
| `applyResult` | Arrondi à 1 décimale | `applyResult(33, 17, 'A')` — vérifie `Math.round(x * 10) / 10` |
| `calcTax` | Price = 0 (edge) | `calcTax(100, 0, false)` doit retourner `0` comme `price <= 1` |
| `calcDividend` | Arrondi | `calcDividend(33, 'r32')` → `3.3` (pas `3.300000001`) |
| `deriveGroupStandings` | Tri multi-critères | Égalité de points → goal difference → buts marqués |
| `buildR32Pool` | 32 équipes uniques | Retourne exactement 32 entrées sans doublon |
| `simulate` | Résultat SF / 3rd | Phase `SF` : draw possible en 90min, KO ensuite |

---

## 2. SÉCURITÉ & ISOLATION

### 2.1 Statut des vulnérabilités identifiées

| ID | Titre | Sévérité | Statut actuel |
|----|-------|----------|--------------|
| CRITIQUE-1 | `/api/game/advance` sans authentification | 🔴 BLOQUANT | **Non corrigé** — aucun `X-Advance-Secret` ni vérification de rôle dans le code actuel |
| CRITIQUE-2 | RLS `portfolios_select_device` expose tous les portfolios anonymes | 🔴 BLOQUANT | **À vérifier** — policy toujours présente dans `db/FULL_SETUP.sql` ; les routes API utilisent le client admin (contournement partiel), mais la fuite via la clé anon reste active |
| HAUTE-1 | Hijacking via `X-Device-ID` non validé | 🟠 MAJEUR | **Partiellement corrigé** — UUID v4 validé dans `/api/game/state` et `/api/auth/guest` ; **non validé dans `/api/trade`** |
| HAUTE-2 | Vue `leaderboard` expose `portfolios.id` | 🟠 MAJEUR | **À vérifier** — dépend de si la vue a été recréée sans `p.id` en base |
| MOYENNE | Messages d'erreur internes retournés au client | 🟡 MINEUR | **Corrigé** — les 3 routes retournent désormais `{ code: 'INTERNAL_ERROR', error: 'Erreur interne' }` en 500 |

> **Règle de release :** Les vulnérabilités CRITIQUE-1 et CRITIQUE-2 doivent être corrigées et leurs tests respectifs doivent passer `[x]` avant toute mise en production.

---

### 2.2 Tests RLS Supabase

> **Prérequis communs :** Deux comptes de test dans l'environnement de staging — `UID_A` et `UID_B` — chacun avec un portfolio initialisé et au moins une position ouverte.

```javascript
// Client B (l'attaquant simulé)
const sbB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
await sbB.auth.signInWithPassword({ email: 'test-b@kickstock.test', password: '...' });

// Client non authentifié
const sbAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

---

#### RLS-01 — Isolation lecture des `portfolios`

**Politique :** `portfolios_select_own` (`auth.uid() = user_id`)

```javascript
const { data } = await sbB.from('portfolios').select('*').eq('user_id', UID_A);
```

**Résultat attendu :** `data = []`.

> ⚠️ **CRITIQUE-2 non corrigé :** Si la politique `portfolios_select_device` (`device_id IS NOT NULL`) est toujours active, tous les portfolios avec un `device_id` sont visibles. Ce test **échouera** tant que la politique n'est pas supprimée.

---

#### RLS-02 — Isolation lecture des `positions`

```javascript
const { data } = await sbB.from('positions').select('*').eq('user_id', UID_A);
```
**Résultat attendu :** `data = []`.

---

#### RLS-03 — Isolation lecture des `transactions`

```javascript
const { data } = await sbB.from('transactions').select('*').eq('portfolio_id', PORTFOLIO_ID_A);
```
**Résultat attendu :** `data = []`. La politique sous-requête (`portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())`) ne peut être satisfaite que par la session A.

---

#### RLS-04 — Tentative de modification du portfolio d'autrui

```javascript
const { data } = await sbB.from('portfolios').update({ cash: 9999999 }).eq('user_id', UID_A);
```
**Résultat attendu :** `data = []` — 0 ligne modifiée. Vérifier via le client A que le cash est inchangé.

---

#### RLS-05 — Tentative d'INSERT de trade au nom d'autrui

```javascript
const { error } = await sbB.from('trades').insert({
  user_id: UID_A, nation_id: 'BRA', mode: 'sell',
  quantity: 100, price: 200, tax: 0, net_amount: 20000, day_index: 5,
});
```
**Résultat attendu :** `error` non null (code `42501`) ou 0 ligne insérée.

---

#### RLS-06 — Isolation des `dividends`

```javascript
const { data } = await sbB.from('dividends').select('*').eq('portfolio_id', PORTFOLIO_ID_A);
```
**Résultat attendu :** `data = []`.

---

#### RLS-07 — Isolation des `holdings`

```javascript
const { data } = await sbB.from('holdings').select('*').eq('portfolio_id', PORTFOLIO_ID_A);
```
**Résultat attendu :** `data = []`.

---

#### RLS-08 — Lectures publiques autorisées

```javascript
const publicTables = ['nations', 'price_history', 'game_state', 'nation_prices',
                      'group_standings', 'knockout_pools', 'matches', 'groups'];
for (const t of publicTables) {
  const { data, error } = await sbAnon.from(t).select('*').limit(1);
  // Attendu : data non null, error null
}
```

**Tables privées — doit retourner `[]` sans authentification :**
```javascript
const privateTables = ['portfolios','positions','trades','holdings',
                       'transactions','dividends','profiles'];
for (const t of privateTables) {
  const { data } = await sbAnon.from(t).select('*').limit(5);
  // Attendu : data = []
}
```

---

#### RLS-09 — Vue `leaderboard` — absence de `portfolios.id`

```javascript
const { data } = await sbAnon.from('leaderboard').select('*');
```

**Résultat attendu :** Les colonnes retournées sont `username`, `country`, `best_score`, `updated_at` uniquement. `p.id` (UUID de portfolio) ne doit pas apparaître.

> ⚠️ **HAUTE-2 :** Si la vue n'a pas été recréée, `p.id` sera présent. Vérifier en SQL :
> ```sql
> SELECT column_name FROM information_schema.columns
> WHERE table_name = 'leaderboard' ORDER BY ordinal_position;
> ```

---

#### RLS-10 — Accès aux `competitions` réservé aux authentifiés

```javascript
const { data } = await sbAnon.from('competitions').select('*');
```
**Résultat attendu :** `data = []` (politique `comp_select_authenticated` : `auth.role() = 'authenticated'`).

---

### 2.3 Authentification

#### AUTH-01 — Cookies de session HttpOnly/Secure/SameSite

**Procédure :** Après connexion en production (HTTPS), inspecter les cookies `sb-*` dans DevTools → Application → Cookies.

**Résultat attendu pour chaque cookie `sb-*` :**
- `HttpOnly` : coché
- `Secure` : coché (HTTPS uniquement)
- `SameSite` : `Lax`

**Test XSS :**
```javascript
document.cookie // ne doit pas contenir les tokens Supabase
```

---

#### AUTH-02 — Middleware : refresh de session silencieux

**Objectif :** Le middleware (`apps/web/middleware.ts`) appelle `supabase.auth.getUser()` à chaque requête pour rafraîchir les tokens expirés avant qu'ils n'atteignent les routes.

**Procédure :** Simuler une session proche de l'expiration. Envoyer une requête à `/api/game/state`. Observer que le middleware a rafraîchi le cookie `sb-access-token` dans la réponse.

**Résultat attendu :** La réponse contient `Set-Cookie` avec un nouveau `sb-access-token` si le token était proche de l'expiration.

---

#### AUTH-03 — Middleware : redirection des utilisateurs connectés hors des pages auth

**Procédure :** Avec une session active, naviguer vers `/login` et `/register`.

**Résultat attendu :** Redirection HTTP 307 vers `/`. Les pages `/auth/callback` et `/auth/confirm` sont exclues du matcher du middleware et ne déclenchent pas ce comportement.

---

#### AUTH-04 — Déconnexion forcée

```javascript
await sbA.auth.signOut();
const { data } = await sbA.from('portfolios').select('*');
```
**Résultat attendu :** `data = []` immédiatement après `signOut()`.

---

#### AUTH-05 — Trigger `handle_new_user` — création profil + portfolio

**Procédure :**
1. Créer un compte via `supabase.auth.signUp({ email, password, options: { data: { username: 'TestUser' } } })`.
2. Vérifier en base :
```sql
SELECT p.id, p.username, pf.cash
FROM profiles p JOIN portfolios pf ON pf.user_id = p.id
WHERE p.id = '<new_user_id>';
```
**Résultat attendu :** `username = 'TestUser'`, `cash = 10000.00`. Les deux lignes créées dans la même transaction ACID.

---

### 2.4 Flux d'authentification invité

#### AUTH-GUEST-01 — `GET /api/auth/check-pseudo` — disponibilité du pseudo

**Cas à tester :**

```bash
# Pseudo disponible (3-20 chars, alphanumérique + _ -)
GET /api/auth/check-pseudo?q=Zidane99
# Attendu : { available: true }

# Pseudo déjà pris (case-insensitive)
GET /api/auth/check-pseudo?q=zidane99
# Attendu : { available: false, suggestion: "zidane99XX" }

# Trop court
GET /api/auth/check-pseudo?q=ab
# Attendu : { available: false, error: "invalid_format" }

# Commence par _
GET /api/auth/check-pseudo?q=_admin
# Attendu : { available: false, error: "invalid_format" }

# Caractère interdit (espace)
GET /api/auth/check-pseudo?q=Zi%20dane
# Attendu : { available: false, error: "invalid_format" }

# Mot réservé
GET /api/auth/check-pseudo?q=admin
# Attendu : { available: false, suggestion: "adminXX" }
```

**Règle de validation dans le code (`isValidFormat`) :**
- Longueur : 3 à 20 caractères
- Regex : `^[a-zA-Z0-9_-]+$`
- Ne commence pas et ne termine pas par `_` ou `-`

---

#### AUTH-GUEST-02 — `POST /api/auth/guest` — rate limiting

**Objectif :** Pas plus de 5 créations de pseudo depuis la même IP en 10 minutes.

**Procédure :**
```bash
# Envoyer 6 requêtes depuis la même IP avec des pseudos valides distincts
for i in $(seq 1 6); do
  curl -s -X POST https://kickstock.app/api/auth/guest \
    -H "Content-Type: application/json" \
    -d "{\"pseudo\": \"TestUser$i\", \"deviceId\": \"$(uuidgen | tr 'A-F' 'a-f')\"}"
done
```
**Résultat attendu :** Les 5 premières requêtes retournent `{ ok: true }` ou des erreurs métier. La 6ème retourne HTTP 429 `{ error: "too_many_requests" }`.

> **Note :** Le rate limiter est en mémoire (`lib/rateLimit.ts`), par instance Vercel. Il se réinitialise au démarrage de l'instance — comportement acceptable pour une protection de base contre les botnets.

---

#### AUTH-GUEST-03 — `POST /api/auth/guest` — validation UUID v4 du `deviceId`

```bash
# deviceId non UUID
curl -s -X POST https://kickstock.app/api/auth/guest \
  -H "Content-Type: application/json" \
  -d '{"pseudo":"TestUser","deviceId":"not-a-uuid"}'
# Attendu : HTTP 400, { "error": "invalid_device_id" }

# UUID v1 (non v4)
curl -s -X POST https://kickstock.app/api/auth/guest \
  -H "Content-Type: application/json" \
  -d '{"pseudo":"TestUser","deviceId":"6ba7b810-9dad-11d1-80b4-00c04fd430c8"}'
# Attendu : HTTP 400, { "error": "invalid_device_id" }
```

**Regex de référence :** `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`

---

#### AUTH-GUEST-04 — `POST /api/auth/guest` — Cloudflare Turnstile

**Objectif :** Si `TURNSTILE_SECRET_KEY` est défini, le champ `cfToken` est obligatoire et vérifié.

```bash
# Token manquant alors que Turnstile est activé
curl -s -X POST https://kickstock.app/api/auth/guest \
  -H "Content-Type: application/json" \
  -d '{"pseudo":"TestUser","deviceId":"<valid-uuid-v4>"}'
# Attendu (si Turnstile activé) : HTTP 400, { "error": "missing_captcha" }

# Token invalide
curl -s -X POST https://kickstock.app/api/auth/guest \
  -H "Content-Type: application/json" \
  -d '{"pseudo":"TestUser","deviceId":"<valid-uuid-v4>","cfToken":"fake-token"}'
# Attendu : HTTP 403, { "error": "captcha_failed" }
```

**Bypass pour les tests automatisés :** Ne pas définir `TURNSTILE_SECRET_KEY` dans l'environnement de test — le bloc Turnstile est ignoré si la clé est absente.

---

#### AUTH-GUEST-05 — Namespace de pseudo partagé invité/authentifié

**Objectif :** Un pseudo pris par un invité (`portfolios.guest_username`) ne peut pas être repris par un utilisateur authentifié (`profiles.username`), et vice-versa.

**Procédure :**
1. Créer un invité avec pseudo `TigerWoods`.
2. Créer un compte authentifié et appeler `POST /api/auth/set-username` avec `username: 'TigerWoods'`.

**Résultat attendu :** `POST /api/auth/set-username` retourne HTTP 409 `{ error: 'taken' }`.

**Vérification inverse :**
1. Utilisateur authentifié avec `username = 'TigerWoods'` en base.
2. Tenter `GET /api/auth/check-pseudo?q=tigerwoods`.

**Résultat attendu :** `{ available: false, suggestion: "tigerwoodsXX" }` (vérification case-insensitive).

---

#### AUTH-GUEST-06 — `GET /api/auth/check-email`

```bash
# Email enregistré et confirmé
GET /api/auth/check-email?q=known@user.com
# Attendu : { exists: true, confirmed: true }

# Email enregistré mais non confirmé
GET /api/auth/check-email?q=unconfirmed@user.com
# Attendu : { exists: true, confirmed: false }

# Email inexistant
GET /api/auth/check-email?q=ghost@user.com
# Attendu : { exists: false, confirmed: false }

# Format invalide
GET /api/auth/check-email?q=notanemail
# Attendu : HTTP 400, { error: "invalid_email" }
```

---

### 2.5 OAuth et migration invité → compte

#### AUTH-OAUTH-01 — Flux OAuth Google nominal

**Procédure :**
1. Depuis le `GuestModal`, cliquer sur "Continuer avec Google".
2. Observer que `saveOAuthPending()` a été appelé (pseudo sauvegardé dans `localStorage` sous `kickstock_oauth_pending`).
3. Vérifier que le cookie `ks_pending_device` est posé (`SameSite=Lax`, `max-age=600`).
4. Après le retour OAuth, observer l'URL : `/?ks_migrated=1&ks_new_user=1&ks_pseudo=MonPseudo`.

**Résultat attendu :**
- Le RPC `migrate_guest_to_user` est appelé avec `p_device_id` (du cookie) et `p_user_id` (du JWT).
- Le portfolio anonyme est migré vers le compte authentifié.
- L'URL contient `ks_migrated=1` si la migration a réussi.
- Le cookie `ks_pending_device` est supprimé (`maxAge: 0`) après le callback.

---

#### AUTH-OAUTH-02 — Détection de première inscription (`isNewUser`)

**Logique dans `/auth/callback/route.ts` :**
```typescript
const isNewUser = Date.now() - new Date(session.user.created_at).getTime() < 2 * 60 * 1000;
```

**Procédure :** Créer un compte Google et vérifier que `ks_new_user=1` est dans l'URL de redirection.

**Résultat attendu :** `ks_new_user=1` présent si le compte a moins de 2 minutes.

---

#### AUTH-OAUTH-03 — Erreur OAuth — redirection propre

```bash
# Simuler une erreur OAuth (paramètre error dans l'URL de callback)
GET /auth/callback?error=access_denied
# Attendu : redirection vers /?ks_auth_error=1
```

---

### 2.6 Sécurisation de l'API de Trade

#### SEC-TRADE-01 — Protection de `/api/game/advance` (CRITIQUE-1)

> ⚠️ **Vulnérabilité non corrigée.** La route actuelle n'a aucune protection d'authentification ni de secret. Ce test documente le comportement actuel et **doit passer de `[!]` à `[x]`** une fois le correctif appliqué.

**Comportement actuel à documenter :**
```bash
# N'importe quel client anonyme peut avancer le jeu
curl -s -X POST https://kickstock.app/api/game/advance \
  -H "Content-Type: application/json" \
  -H "X-Device-ID: $(uuidgen | tr 'A-F' 'a-f')" \
  -d '{"dayIndex": 0}'
# Résultat actuel : HTTP 200, le jeu avance
# Résultat attendu après correctif : HTTP 401
```

**Correctif recommandé :** Ajouter la vérification du header `X-Advance-Secret` comparé à `process.env.ADVANCE_SECRET`, OU restreindre l'accès aux utilisateurs avec un rôle `admin`.

---

#### SEC-TRADE-02 — Validation UUID v4 dans `/api/trade` (HAUTE-1)

> ⚠️ **UUID v4 non validé dans `/api/trade`.** La validation est présente dans `/api/game/state` et `/api/auth/guest` mais pas dans `/api/trade`.

**Test de l'état actuel :**
```bash
# Injection dans le device_id — DOIT être rejeté (mais ne l'est pas actuellement)
curl -s -X POST https://kickstock.app/api/trade \
  -H "Content-Type: application/json" \
  -H "X-Device-ID: '; DROP TABLE portfolios;--" \
  -d '{"nationId":"BRA","mode":"buy","quantity":1}'
# Résultat actuel : passe jusqu'au RPC Supabase (protégé par prepared statements)
# Résultat attendu après correctif : HTTP 400, { code: "INVALID_DEVICE_ID" }
```

**Note :** Le RPC `execute_trade` est un appel Supabase paramétré — il n'est pas vulnérable à l'injection SQL directe. Mais un `device_id` arbitraire pourrait correspondre à celui d'un autre joueur si la valeur est devinée.

---

#### SEC-TRADE-03 — Codes d'erreur structurés dans `/api/trade`

**Objectif :** Toutes les réponses d'erreur de la route `/api/trade` incluent un champ `code` machine-readable.

**Cas à tester :**

| Scénario | HTTP | `code` attendu | `error` attendu |
|----------|------|---------------|-----------------|
| `nationId` manquant | 400 | `INVALID_PARAMS` | `'nationId manquant'` |
| `mode = 'short'` | 400 | `INVALID_MODE` | `'mode doit être buy ou sell'` |
| `quantity = 0` | 400 | `INVALID_QUANTITY` | `'quantité invalide'` |
| `quantity = -5` | 400 | `INVALID_QUANTITY` | `'quantité invalide'` |
| `quantity = 2.9` (décimal) | 400 | `INVALID_QUANTITY` | `'quantité invalide'` |
| `X-Device-ID` absent | 400 | `MISSING_DEVICE_ID` | `'X-Device-ID requis'` |
| Fonds insuffisants (RPC) | 422 | `INSUFFICIENT_FUNDS` | Message du RPC |
| Nation éliminée (RPC) | 422 | `NATION_ELIMINATED` | `'Nation éliminée 💀'` |
| Nation inexistante (RPC) | 422 | `NOT_FOUND` | Message du RPC |
| Erreur interne (500) | 500 | `INTERNAL_ERROR` | `'Erreur interne'` |

> **Changement depuis v1.0 :** `quantity = 2.9` est maintenant **rejeté au niveau de la route** (`!Number.isInteger(quantity)` → HTTP 400) et non plus tronqué (`Math.floor`). Le `Math.floor` subsiste uniquement comme garde-fou avant le RPC, mais la validation amont empêche les décimaux d'y arriver.

---

#### SEC-TRADE-04 — Anti double-dépense (atomicité RPC `execute_trade`)

**Objectif :** Deux trades simultanés sur le même portfolio ne peuvent pas débiter le cash deux fois.

**Procédure :**
```bash
DEVICE="<valid-uuid-v4>"
# Portfolio : cash = 500 KC, BRA = 200 KC/action — chaque achat = 400 KC

curl -s -X POST https://kickstock.app/api/trade \
  -H "X-Device-ID: $DEVICE" -H "Content-Type: application/json" \
  -d '{"nationId":"BRA","mode":"buy","quantity":2}' &

curl -s -X POST https://kickstock.app/api/trade \
  -H "X-Device-ID: $DEVICE" -H "Content-Type: application/json" \
  -d '{"nationId":"BRA","mode":"buy","quantity":2}' &
wait
```

**Résultat attendu :** Une requête réussit (`new_cash: 100`). L'autre retourne HTTP 422 `{ code: "INSUFFICIENT_FUNDS" }`. Le cash final est exactement `100 KC`, jamais négatif.

**Mécanisme :** `FOR UPDATE` sur `portfolios` et `holdings` dans le RPC sérialise les accès concurrents.

---

#### SEC-TRADE-05 — Stratégie d'authentification dans `/api/trade`

**Objectif :** Un utilisateur connecté utilise le client Supabase sessionné (JWT) — `auth.uid()` est défini à l'intérieur du RPC. Un utilisateur anonyme utilise le client admin.

**Procédure :**
1. Faire un trade avec un utilisateur connecté → vérifier que `user_id` dans la table `transactions` correspond au `auth.uid()`.
2. Faire un trade en mode anonyme → vérifier que `user_id` est `null` dans `transactions` (ou absent) et que `portfolio.device_id` est renseigné.

---

#### SEC-TRADE-06 — Règle métier : achat d'une nation éliminée

**Procédure :**
```sql
-- Marquer HAI comme éliminée (env. de test)
UPDATE game_state SET eliminated = array_append(eliminated, 'HAI') WHERE id = 1;
```
```bash
curl -s -X POST https://kickstock.app/api/trade \
  -H "X-Device-ID: $DEVICE" -H "Content-Type: application/json" \
  -d '{"nationId":"HAI","mode":"buy","quantity":5}'
# Attendu : HTTP 422, { code: "NATION_ELIMINATED", error: "Nation éliminée 💀" }
```

**Vente d'une nation éliminée — sans frais :**
```bash
curl -s -X POST https://kickstock.app/api/trade \
  -H "X-Device-ID: $DEVICE" -H "Content-Type: application/json" \
  -d '{"nationId":"HAI","mode":"sell","quantity":5}'
# Attendu : HTTP 200, { ok: true, fee: 0 }
# Logique : calcTax(amount, price=1, isKO) = 0 car price <= 1
```

---

#### SEC-TRADE-07 — Frais de transaction (`calcTax`) — validation des taux

> **Correction de la v1.0 :** Les taux étaient inversés dans la v1.0 du test plan. Le taux correct est :
> - Phase **groupes** (`isKO = false`) : **10%**, minimum 10 KC
> - Phase **KO** (`isKO = true`) : **5%**, minimum 10 KC
> - Nation éliminée (price ≤ 1) : **0%**

**Scénarios de validation :**

| Phase | Quantité | Prix | Brut | Taux | Fee attendu | Net attendu |
|-------|----------|------|------|------|-------------|-------------|
| Groupes (jour ≤ 16) | 10 | 200 | 2 000 | 10% | 200 KC | 1 800 KC |
| Groupes — min 10 KC | 1 | 50 | 50 | 10% mais min | 10 KC | 40 KC |
| KO (jour ≥ 17) | 10 | 200 | 2 000 | 5% | 100 KC | 1 900 KC |
| KO — min 10 KC | 1 | 100 | 100 | 5% mais min | 10 KC | 90 KC |
| Éliminée (price=1) | 5 | 1 | 5 | 0% | 0 KC | 5 KC |

---

#### SEC-TRADE-08 — Plafond 40% (phase groupes, jours 0–22)

**Logique dans le RPC :** `v_is_cap = (current_day_index <= 22)`. Si actif, `((v_held + p_quantity) * v_price) / v_tot_val > 0.40` → rejet.

```
Portfolio : cash = 10 000 KC, 0 position, BRA = 200 KC
40% de 10 000 = 4 000 KC → max 20 actions BRA

Achat de 20 BRA (4 000 KC = exactement 40%) → OK
Achat d'1 BRA supplémentaire (dépasse 40%) → HTTP 422, error: "⛔ Plafond 40% atteint"
```

**Note :** Le plafond 40% est implémenté uniquement dans le RPC `execute_trade` (mode online). En mode offline (`localGameStore`), cette règle n'est **pas** appliquée côté client — c'est un **écart de parité** à documenter et potentiellement corriger.

---

#### SEC-TRADE-09 — Généricité des messages d'erreur 500

**Objectif :** Aucun détail interne ne doit fuiter dans les erreurs 500.

```bash
# Payload JSON malformé
curl -s -X POST https://kickstock.app/api/game/advance \
  -H "Content-Type: application/json" \
  -d 'json_invalide{'
# Attendu : HTTP 500, { error: "Internal server error" }
# Résultat actuel (corrigé) : générique ✅
```

**Vérification Sentry :** Les erreurs 500 doivent apparaître dans le dashboard Sentry (`Sentry.captureException` est appelé dans chaque route). Vérifier qu'une erreur intentionnelle génère bien un événement Sentry.

---

#### SEC-TRADE-10 — ETag et cache conditionnel sur `/api/game/state`

**Objectif :** La route retourne `ETag: "d{dayIndex}-p{portfolioId}"` et honore `If-None-Match`.

```bash
# Première requête
curl -v https://kickstock.app/api/game/state \
  -H "X-Device-ID: $DEVICE"
# Attendu : HTTP 200 avec header ETag: "d5-p<uuid>"

# Deuxième requête avec l'ETag reçu
curl -v https://kickstock.app/api/game/state \
  -H "X-Device-ID: $DEVICE" \
  -H "If-None-Match: \"d5-p<uuid>\""
# Attendu : HTTP 304 (pas de body) — état non modifié
```

**Vérification côté client :** `lib/api.ts` intercepte les 304 en levant `new Error('NOT_MODIFIED')` — le store Zustand doit conserver son état sans écraser les données.

---

## 3. TESTS FONCTIONNELS MÉTIER

> **Mode de jeu actuel :** Le mode offline (`localGameStore`) est actif par défaut. Dans ce mode, les trades et la simulation s'exécutent **entièrement côté client** via `@kickstock/game-engine`. L'API `/api/trade` et `/api/game/advance` **ne sont pas appelées** pour les actions du joueur. Les tests des sections 3.2 et 3.3 marqués `[OFFLINE]` s'appliquent au store local ; ceux marqués `[ONLINE]` s'appliquent à la route API correspondante.

---

### 3.1 Inscription, connexion et initialisation

---

**ID :** FT-AUTH-01  
**Titre :** Première ouverture — affichage du `GuestModal`  
**Pré-requis :** Navigateur sans `localStorage.kickstock_pseudo` et sans session Supabase active  
**Étapes :**
1. Ouvrir l'application sur un navigateur vierge.

**Résultat attendu :**
- `GuestModal` s'affiche (condition : `!getPseudo() && !user`).
- Sur un device non tactile, le champ pseudo est auto-focusé après 100ms.
- Le widget Cloudflare Turnstile invisible se charge si `NEXT_PUBLIC_TURNSTILE_SITE_KEY` est défini.

---

**ID :** FT-AUTH-02  
**Titre :** Création de pseudo invité — flux nominal  
**Pré-requis :** Pseudo `NoviceTrader` non pris  
**Étapes :**
1. Saisir `NoviceTrader` dans le champ.
2. Quitter le champ (blur) → l'indicateur de disponibilité s'affiche.
3. Cliquer sur "JOUER MAINTENANT".

**Résultat attendu :**
- `GET /api/auth/check-pseudo?q=NoviceTrader` retourne `{ available: true }`.
- `POST /api/auth/guest` avec `{ pseudo: 'NoviceTrader', deviceId: '<uuid-v4>', cfToken: '...' }` retourne `{ ok: true }`.
- `localStorage.kickstock_pseudo = 'NoviceTrader'` est posé.
- L'événement `kickstock:pseudo-saved` est dispatché.
- Le store est réinitialisé (`resetGame()`) : cash = 10 000 KC, portfolio vide.
- Le `GuestModal` se ferme.
- Si c'est la première fois (`!localStorage.kickstock_seen_tutorial`), l'événement `kickstock:show-tutorial` est dispatché.
- En base Supabase : `portfolios.guest_username = 'NoviceTrader'` pour ce `device_id`.

---

**ID :** FT-AUTH-03  
**Titre :** Pseudo déjà pris — suggestion automatique  
**Pré-requis :** `Zidane99` déjà en base  
**Étapes :**
1. Saisir `Zidane99` et quitter le champ.

**Résultat attendu :**
- Indicateur rouge "Pseudo déjà utilisé."
- Bouton "Utiliser « ZidaneXX »" avec une suggestion générée.
- Cliquer sur la suggestion met à jour le champ et relance la vérification.

---

**ID :** FT-AUTH-04  
**Titre :** Connexion OAuth Google — migration du portfolio invité  
**Pré-requis :** Joueur invité avec `device_id = UUID_G`, cash = 7 500 KC, 3 positions ouvertes, `guest_username = 'TigerFan'`  
**Étapes :**
1. Depuis le `GuestModal`, cliquer sur "Continuer avec Google".
2. Compléter l'authentification Google.

**Résultat attendu :**
- Cookie `ks_pending_device = UUID_G` posé avant la redirection.
- `/auth/callback` appelle `migrate_guest_to_user(p_device_id=UUID_G, p_user_id=UID_NEW)`.
- RPC retourne `{ status: 'migrated', guest_username: 'TigerFan' }`.
- URL de redirection : `/?ks_migrated=1&ks_new_user=1&ks_pseudo=TigerFan`.
- Le portfolio migré conserve cash = 7 500 KC et les 3 positions.

---

**ID :** FT-AUTH-05  
**Titre :** `syncFromServer` — synchronisation cross-device à la connexion  
**Pré-requis :** Utilisateur connecté, état sauvegardé en base (`user_game_states`) au Jour 5, device local au Jour 3  
**Étapes :**
1. Se connecter sur un nouvel appareil où `localGameStore` est au Jour 3.

**Résultat attendu :**
- `syncFromServer()` lit `user_game_states` pour cet utilisateur.
- `serverDay (5) >= localDay (3)` → l'état serveur remplace l'état local.
- Le store affiche Jour 5 avec le portfolio du serveur.

**Cas inverse :** State local au Jour 7, serveur au Jour 5 → l'état local est poussé vers le serveur.

---

**ID :** FT-AUTH-06  
**Titre :** `syncBestScore` — mise à jour atomique du meilleur score  
**Pré-requis :** `portfolios.best_score = 12 000 KC` en base, joueur atteint 15 000 KC de valeur totale après un advance  
**Résultat attendu :**
- `syncBestScore(15000)` est appelé (fire-and-forget).
- Requête Supabase : `UPDATE portfolios SET best_score = 15000 WHERE user_id = UID AND (best_score IS NULL OR best_score < 15000)`.
- La vue `leaderboard` reflète le nouveau score.

---

### 3.2 Flux de Trade (mode offline — `localGameStore`)

> En mode offline, les trades sont entièrement locaux. Pas d'appel réseau.

---

**ID :** FT-TRADE-01 `[OFFLINE]`  
**Titre :** Achat nominal — mise à jour immédiate du store  
**Pré-requis :** `dayIndex = 3` (phase groupes), cash = 10 000 KC, BRA = 200 KC  
**Étapes :**
1. Appeler `store.trade('buy', 'BRA', 10)`.

**Résultat attendu :**
- Retourne `null` (pas d'erreur).
- `store.cash = 10 000 − (200 × 10) = 8 000 KC` (arrondi à 1 décimale via `Math.round(x * 10) / 10`).
- `store.portfolio['BRA'] = 10`.
- `store.avgCost['BRA'] = 200`.
- `store.txLog[0] = { dir: 'buy', flag: '🇧🇷', name: 'Brazil', qty: 10, price: 200, day: 3 }`.
- `localStorage['ks-game-state']` contient les nouvelles valeurs (persistance Zustand).
- Un timer debounce de 5 s est lancé pour sauvegarder sur Supabase si l'utilisateur est connecté.

---

**ID :** FT-TRADE-02 `[OFFLINE]`  
**Titre :** Vente partielle — calcul de la taxe en phase groupes (10%, min 10 KC)  
**Pré-requis :** `dayIndex = 5`, 20 actions BRA à prix moyen 180 KC, prix courant BRA = 200 KC, cash = 5 000 KC  
**Étapes :**
1. Appeler `store.trade('sell', 'BRA', 10)`.

**Résultat attendu :**
- `calcTax(2000, 200, false)` = `max(2000 × 0.10, 10)` = **200 KC**
- `net = 2000 − 200 = 1 800 KC`
- `store.cash = 5 000 + 1 800 = 6 800 KC`
- `store.portfolio['BRA'] = 10`

---

**ID :** FT-TRADE-03 `[OFFLINE]`  
**Titre :** Vente — taxe en phase KO (5%, min 10 KC)  
**Pré-requis :** `dayIndex = 20` (phase R32), 10 actions GER, prix = 100 KC  
**Étapes :**
1. Appeler `store.trade('sell', 'GER', 10)`.

**Résultat attendu :**
- `calcTax(1000, 100, true)` = `max(1000 × 0.05, 10)` = **50 KC**
- `net = 1000 − 50 = 950 KC`

---

**ID :** FT-TRADE-04 `[OFFLINE]`  
**Titre :** Vente totale — nettoyage du portfolio et de `avgCost`  
**Pré-requis :** Exactement 5 actions GER  
**Étapes :**
1. Appeler `store.trade('sell', 'GER', 5)`.

**Résultat attendu :**
- `store.portfolio` ne contient plus la clé `'GER'`.
- `store.avgCost` ne contient plus la clé `'GER'`.

---

**ID :** FT-TRADE-05 `[OFFLINE]`  
**Titre :** Calcul du prix moyen pondéré à l'achat  
**Pré-requis :** 10 actions BRA à avgCost = 180 KC, nouveau prix BRA = 220 KC  
**Étapes :**
1. Acheter 10 actions BRA supplémentaires à 220 KC.

**Résultat attendu :**
- `newAvg = (10 × 180 + 10 × 220) / 20 = 200 KC`
- `store.avgCost['BRA'] = 200`

---

### 3.3 Cas limites de Trade

---

**ID :** FT-EDGE-01  
**Titre :** Solde insuffisant  
**Pré-requis :** Cash = 150 KC, BRA = 200 KC  
**Résultat attendu :** `store.trade('buy', 'BRA', 1)` retourne `'Fonds insuffisants'`. Cash inchangé.

---

**ID :** FT-EDGE-02  
**Titre :** Vente à découvert  
**Pré-requis :** 0 actions MEX  
**Résultat attendu :** `store.trade('sell', 'MEX', 1)` retourne `'Actions insuffisantes'`.

---

**ID :** FT-EDGE-03  
**Titre :** Achat d'une nation éliminée  
**Pré-requis :** HAI dans `store.eliminated`  
**Résultat attendu :** `store.trade('buy', 'HAI', 1)` retourne `'Nation éliminée 💀'`.

---

**ID :** FT-EDGE-04  
**Titre :** Vente d'une nation éliminée — sans frais  
**Pré-requis :** HAI dans `store.eliminated`, 10 actions HAI, prix = 1 KC (liquidé)  
**Étapes :** `store.trade('sell', 'HAI', 10)`.  
**Résultat attendu :**
- `calcTax(10, 1, anyKO)` = 0 (car `price <= 1`)
- Cash augmente de 10 KC (10 × 1 KC).

---

**ID :** FT-EDGE-05  
**Titre :** Nation inexistante  
**Résultat attendu :** `store.trade('buy', 'ZZZ', 1)` retourne `'Nation introuvable'`.

---

**ID :** FT-EDGE-06  
**Titre :** Overflow du `txLog` — troncature à 100 entrées  
**Pré-requis :** `txLog` contient exactement 100 entrées  
**Étapes :** Effectuer un 101ème trade.  
**Résultat attendu :** `store.txLog.length === 100`. La 101ème entrée est ajoutée en tête et la plus ancienne (index 100) est supprimée via `.slice(0, 100)`.

---

**ID :** FT-EDGE-07  
**Titre :** `resetGame()` — remise à zéro complète  
**Étapes :** Appeler `store.resetGame()`.  
**Résultat attendu :**
- `store.cash = 10 000 KC`
- `store.portfolio = {}`
- `store.txLog = []`
- `store.dayIndex = 0`
- `store.eliminated = []`
- `localStorage['ks-game-state']` contient l'état vide persisté.

---

### 3.4 Flux de simulation (Advance Day)

---

**ID :** FT-SIM-01 `[OFFLINE]`  
**Titre :** Simulation d'une journée de groupes — prix, résultats, historique  
**Pré-requis :** `dayIndex = 0` (Jour 1 : MEX vs RSA, KOR vs CZE)  
**Étapes :** Appeler `store.advanceDay()`.

**Résultat attendu :**
- Retourne `{ results: [...], flash: {...} }` avec 2 matchs simulés.
- `results[0]` contient `{ a: 'MEX', b: 'RSA', scoreA, scoreB, res, pA, pB, newPA, newPB, ... }`.
- `newPA > pA` ou `newPA < pA` selon le résultat. Prix plancher : `Math.max(1, rawPA)`.
- `store.dayIndex = 1`.
- `store.priceHistory['MEX']` contient maintenant 2 entrées.
- `store.matchResults[0]` contient les résultats du Jour 0.
- `flash['MEX']` = `'fu'` si prix hausse, `'fd'` si baisse.
- `bestScore` mis à jour si `(cash + valeur_portfolio) > ancien bestScore`.
- `syncBestScore` appelé si le bestScore a changé.
- State sauvegardé immédiatement sur Supabase si l'utilisateur est connecté (pas de debounce — le day advance est un point de sauvegarde majeur).

---

**ID :** FT-SIM-02 `[OFFLINE]`  
**Titre :** Construction du R32 pool après le Jour 17 (dernier jour de groupes)  
**Pré-requis :** `dayIndex = 16`, les 17 journées de groupes jouées, standings calculables  
**Étapes :** Appeler `store.advanceDay()`.

**Résultat attendu :**
- `buildR32Pool(allResults, eliminated)` est appelé.
- `store.r32Pool` contient 32 nations qualifiées (les 2 premiers de chaque groupe + 8 meilleurs 3ièmes).
- Les nations non qualifiées sont ajoutées à `store.eliminated` et leur prix est fixé à 1 KC.
- `flash[nation_non_qualifiee] = 'fd'` pour chaque nation éliminée lors de ce jour.

---

**ID :** FT-SIM-03 `[OFFLINE]`  
**Titre :** Distribution des dividendes lors de R32 (Jour 17)  
**Pré-requis :** `dayIndex = 17` (phase R32, `divKey = 'r32'`), 10 actions BRA, BRA qualifiée, prix BRA = 250 KC  
**Étapes :** Appeler `store.advanceDay()`.

**Résultat attendu :**
- BRA gagne son match R32 : `calcDividend(250, 'r32')` = `250 × 0.10 = 25 KC/action`.
- `10 actions × 25 KC = 250 KC` ajoutés au cash.
- `results[i].divCash = 250` pour le match de BRA.
- Si BRA perd : pas de dividende pour ce round.

---

**ID :** FT-SIM-04 `[OFFLINE]`  
**Titre :** Finale — dividende pour le finaliste perdant + champion  
**Pré-requis :** `dayIndex = 33` (phase `Final`, `divKey = 'final'`), 5 actions FRA (champion), 3 actions ARG (finaliste perdant)  
**Étapes :** Appeler `store.advanceDay()`.

**Résultat attendu :**
- FRA (champion) reçoit : dividende `final` + dividende `champion`
  - Dividende final : `5 × calcDividend(prix_FRA, 'final')` = `5 × prix_FRA × 0.40`
  - Champion bonus : `5 × prix_FRA × 0.60`
- ARG (finaliste) reçoit : dividende `final`
  - `3 × calcDividend(prix_ARG, 'final')` = `3 × prix_ARG × 0.40`
- ARG est ajouté à `eliminated`, son prix fixé à 1 KC.
- `store.champion = 'FRA'`.

---

**ID :** FT-SIM-05 `[OFFLINE]`  
**Titre :** Liquidation d'une nation éliminée en KO  
**Pré-requis :** Joueur détient 10 actions RSA, RSA perd son match R32 (`elimId = 'RSA'`), prix RSA = 15 KC au moment de l'élimination  
**Étapes :** Appeler `store.advanceDay()`.

**Résultat attendu :**
- `store.eliminated` contient `'RSA'`.
- `store.prices['RSA'] = 1` (liquidation à 1 KC).
- `store.cash` est augmenté de `10 × 1 = 10 KC` (liquidation des positions au prix plancher de 1 KC).
- `store.portfolio` ne contient plus `'RSA'`.
- `flash['RSA'] = 'fd'`.

---

**ID :** FT-SIM-06 `[OFFLINE]`  
**Titre :** Match SF — pas d'élimination pour le perdant (`phase !== 'SF'`)  
**Pré-requis :** `dayIndex = 29` (phase `SF`)  
**Résultat attendu :**
- Le perdant d'une demi-finale n'est **pas** ajouté à `eliminated` (`elimId = null` car `day.phase === 'SF'`).
- Le perdant est ajouté à `store.thirdPool` pour le match de 3ème place.

---

**ID :** FT-SIM-07 `[OFFLINE]`  
**Titre :** Journée KO vide — auto-skip  
**Pré-requis :** `dayIndex = X` pointe sur un jour KO dont le pool n'est pas encore rempli (`todayMatches.length === 0`)  
**Résultat attendu :** `store.dayIndex` est incrémenté de 1. `advanceDay()` retourne `{ results: [], flash: {} }`.

---

**ID :** FT-SIM-08 `[OFFLINE]`  
**Titre :** Calcul du `bestScore` après advance  
**Pré-requis :** Cash = 8 000 KC, portfolio = 5 × BRA @ 250 KC = 1 250 KC de valeur. Total = 9 250 KC. `bestScore` actuel = 9 000 KC.  
**Étapes :** `store.advanceDay()`.  
**Résultat attendu :** `store.bestScore = 9 250 KC` (nouveau total > ancien bestScore). `syncBestScore(9250)` est appelé.

---

### 3.5 Comportement réseau et persistance

---

**ID :** FT-NET-01  
**Titre :** Coupure réseau pendant un trade `[OFFLINE]`  
**Résultat attendu :** Le trade en mode offline est **entièrement synchrone et local** — aucun appel réseau n'est effectué. Une coupure réseau n'a aucun impact sur le trade. Le state Zustand est mis à jour immédiatement.

---

**ID :** FT-NET-02  
**Titre :** Coupure réseau pendant la sauvegarde debounced  
**Pré-requis :** Utilisateur connecté. Trade effectué → debounce de 5 s en attente.  
**Étapes :** Couper le réseau avant que le debounce ne s'écoule.  
**Résultat attendu :** `writeStateToSupabase` échoue silencieusement (`catch { /* best-effort */ }`). L'état local dans `localStorage` est intact — la prochaine connexion déclenchera une nouvelle tentative de sync.

---

**ID :** FT-NET-03  
**Titre :** Rechargement de page — persistance `localStorage`  
**Pré-requis :** Trade effectué, cash = 7 500 KC, 3 positions ouvertes.  
**Étapes :** Recharger la page (F5).  
**Résultat attendu :**
- Zustand `persist` rehydrate depuis `localStorage['ks-game-state']`.
- Cash = 7 500 KC, portfolio intact, `dayIndex` correct — état identique avant rechargement.
- `loading = false` immédiatement (pas d'appel API `fetchState` en mode offline).

---

## 4. COMPATIBILITÉ UI/UX

### 4.1 Matrice d'environnements cibles

| # | Environnement | Viewport | Shell attendu | Statut |
|---|--------------|----------|---------------|--------|
| E1 | Chrome 124+ macOS | 1440 × 900 | BrowserShell | `[ ]` |
| E2 | Chrome 124+ Windows | 1920 × 1080 | BrowserShell | `[ ]` |
| E3 | Firefox 125+ macOS | 1440 × 900 | BrowserShell | `[ ]` |
| E4 | Safari 17+ macOS | 1440 × 900 | BrowserShell | `[ ]` |
| E5 | Edge 124+ Windows | 1920 × 1080 | BrowserShell | `[ ]` |
| E6 | Chrome DevTools iPhone 14 Pro (393 px) | 393 px | MobileShell | `[ ]` |
| E7 | Chrome DevTools Pixel 7 (412 px) | 412 px | MobileShell | `[ ]` |
| E8 | Safari iOS 17 — iPhone réel | < 600 px | MobileShell | `[ ]` |
| E9 | Chrome Android — Galaxy S24 | < 600 px | MobileShell | `[ ]` |
| E10 | iPad Pro 12.9" portrait | 1024 px | BrowserShell | `[ ]` |
| E11 | iPad mini portrait | 768 px | BrowserShell | `[ ]` |
| E12 | Resize live 1200 px → 500 px | Transition | Switch shell | `[ ]` |

**Breakpoint de référence :** `MOBILE_BREAKPOINT = 600` dans `@kickstock/constants` — source de vérité unique pour `useLayout()` et les tests.

---

### 4.2 Checklist commune (tous environnements)

Pour chaque ligne de la matrice :

- `[ ]` Le bon shell est monté selon `window.innerWidth` vs `MOBILE_BREAKPOINT`
- `[ ]` Aucune erreur dans la console JavaScript (`console.error`, erreurs réseau non gérées)
- `[ ]` Le `GuestModal` s'affiche si aucun pseudo ni session active
- `[ ]` Le cash (10 000 KC initial) s'affiche dans le header
- `[ ]` Le ticker défile sans saccade
- `[ ]` Un trade de test (achat 1 action) s'exécute correctement et met à jour le cash
- `[ ]` Les variables CSS `--gold`, `--gain`, `--loss` sont correctement appliquées
- `[ ]` Aucun overflow horizontal sur le body

---

### 4.3 `useValidateMechanics` — Contrat des shells

**Objectif :** En mode `development`, chaque shell appelle `useValidateMechanics(contract, shellName)` qui avertit si un des 9 champs de `MechanicsContract` est manquant.

**Champs obligatoires (définis dans `@kickstock/types`) :**

| Champ | Signification |
|-------|--------------|
| `canViewNationPrice` | Afficher le prix courant d'une nation |
| `canBuy` | Initier un achat |
| `canSell` | Initier une vente |
| `canViewPortfolio` | Voir ses positions |
| `canViewCash` | Voir son solde |
| `canViewPnL` | Voir son P&L non réalisé |
| `canSimulate` | Déclencher la simulation d'un jour |
| `canViewStandings` | Voir les classements de groupe |
| `canViewSchedule` | Voir le calendrier des matchs |

**Procédure :** En dev, ouvrir la console sur le MobileShell et le BrowserShell. Aucun warning `[KickStock] ⚠️ Shell "..." is missing required mechanics` ne doit apparaître.

---

### 4.4 Tests spécifiques Browser (Desktop)

#### UI-BROWSER-01 — Sidebar 72px — intégrité au viewport minimal

**Procédure :** Ouvrir le BrowserShell à exactement 600 px.  
**Résultat attendu :**
- Sidebar : `width: 72px`, `flex-shrink: 0` — ne rétrécit pas.
- Zone `ks-main` : `flex: 1`, `min-width: 0` — prend le reste.
- Aucune scrollbar horizontale.

---

#### UI-BROWSER-02 — Vue HOME : layout 2 colonnes

**Résultat attendu :** Colonne gauche `width: 48%`, colonne droite `flex: 1`. Scroll vertical indépendant de chaque colonne. À 800 px de largeur totale (après sidebar 72 px → 728 px pour le main), les deux colonnes restent lisibles sans troncature.

---

#### UI-BROWSER-03 — Grille Market `auto-fill`

La grille `.mkt-grid` utilise `grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))`.

| Largeur fenêtre | Colonnes attendues |
|-----------------|--------------------|
| 1400 px | 5–6 |
| 900 px | 3–4 |
| 700 px | 2–3 |

---

#### UI-BROWSER-04 — Hover states sur les tiles

**Résultat attendu :** Transition CSS visible (background, bordure ou élévation). Curseur `pointer`. Pas de saut brutal (transition présente).

---

#### UI-BROWSER-05 — Standings multi-groupes (12 groupes)

**Résultat attendu :**
- Grille `.std-grid` : `repeat(auto-fill, minmax(280px, 1fr))`.
- Chaque groupe affiche MP/W/D/L/GF/GA/Pts correctement alignés pour 4 équipes.
- À 1440 px : 4–5 groupes par ligne.

---

#### UI-BROWSER-06 — Bouton PLAY topbar — état disabled pendant l'avancement

**Résultat attendu :**
- Clic sur PLAY → bouton immédiatement disabled (indicateur de chargement).
- Impossible de cliquer deux fois (prévention de double-appel à `advanceDay`).
- Après la réponse, bouton réactivé, résultats affichés.

---

#### UI-BROWSER-07 — Graphique de prix historique (si implémenté)

**Résultat attendu :**
- Données provenant de `store.priceHistory[nationId]` — tableau de prix par `dayIndex`.
- Dernier point = `store.prices[nationId]`.
- Le graphique ne crash pas si `priceHistory[id]` n'a qu'une entrée (Jour 0).

---

### 4.5 Tests spécifiques Mobile

#### UI-MOBILE-01 — Zones tactiles : 44 × 44 px minimum

| Élément interactif | Dimension minimale |
|--------------------|-------------------|
| Chacun des 5 boutons de la Tab Bar | 44 × 44 px (Tab Bar = 64 px de hauteur, largeur = viewport/5) |
| Bouton central "⚡ PLAY" | 44 × 44 px (généralement plus grand — accentué) |
| Boutons "Acheter" / "Vendre" dans `TradeModal` | 44 px de hauteur |
| Bouton de confirmation | 44 px de hauteur |
| Input de quantité | 44 px de hauteur |
| Zone cliquable de chaque NationCard | Card entière (padding + height) |
| Bouton "×" de fermeture des overlays | 44 × 44 px (padding autour de l'icône) |
| Éléments de liste `ScheduleTab` | 44 px de hauteur par item |

**Procédure :** En DevTools mobile, inspecter la `boundingClientRect` ou les dimensions CSS effectives de chaque élément.

---

#### UI-MOBILE-02 — Tab Bar Bottom Navigation

**Résultat attendu :**
- 5 onglets : SCHED. · STNDGS · ⚡PLAY · MARKET · PORTF.
- L'onglet actif est distinctement identifié (couleur `--gold`, fond ou indicateur).
- La Tab Bar reste fixe en bas même si le contenu est long (`flex-shrink: 0` sur `.nav`).
- Chaque changement d'onglet démonte l'onglet précédent et monte le suivant (`{tab === 'market' && <MarketTab />}`).

---

#### UI-MOBILE-03 — `100dvh` — barre d'adresse et barre système

**Procédure :** Ouvrir sur Chrome Android ou Safari iOS réel.  
**Résultat attendu :**
- `.shell { height: 100dvh }` : viewport dynamique — la Tab Bar n'est pas coupée par la barre système (home indicator, barre d'adresse).
- Après que l'utilisateur scrolle (barre d'adresse repliée), la mise en page reste cohérente.

---

#### UI-MOBILE-04 — Performance du scroll sur 48 NationCards

**Procédure :**
1. Onglet MARKET ouvert (48 NationCards).
2. Activer le profil de perf Chrome DevTools (Performance tab, throttling CPU ×4).
3. Scroll rapide haut-bas plusieurs fois.

**Résultat attendu :**
- Frame rate stable ≥ 55 fps.
- Aucun "jank" visible.
- `.scroll { overflow-y: auto; scrollbar-width: none }` — scrollbar invisible.

---

#### UI-MOBILE-05 — Clavier virtuel — `TradeModal`

**Procédure :** Sur device réel, tapper sur l'input de quantité du `TradeModal`.  
**Résultat attendu :**
- L'input reste visible (pas masqué derrière le clavier).
- Le bouton de confirmation reste accessible (le modal remonte avec le clavier).
- Sur iOS/Safari : pas de "rubber band" bloquant l'interaction avec le modal.

**Comportement à éviter :** Bouton de confirmation entièrement masqué et inaccessible sans fermer le clavier.

---

#### UI-MOBILE-06 — `GuestModal` — focus auto et Turnstile

**Procédure :**
1. Ouvrir sur un device réel (touch).
2. Observer si l'input pseudo est auto-focusé.

**Résultat attendu :**
- Sur un **device tactile** (`window.matchMedia('(pointer: coarse)').matches === true`) : le focus n'est **pas** déclenché automatiquement (pour éviter l'ouverture du clavier au premier affichage).
- Sur un **desktop non tactile** : focus après 100 ms.
- Le widget Turnstile invisible est chargé dynamiquement sans script synchrone.

---

#### UI-MOBILE-07 — Flash d'hydration SSR → MobileShell

**Objectif :** Le flash (BrowserShell pendant 1 frame avant basculement en MobileShell) est imperceptible.

**Procédure :** Hard Reload sur device réel avec CPU throttling ×4.  
**Résultat attendu :**
- Flash < 16 ms (imperceptible à 60 Hz).
- `export const dynamic = 'force-dynamic'` présent dans `apps/web/app/page.tsx` — Next.js ne met pas en cache la version statique.

---

#### UI-MOBILE-08 — Redimensionnement live — switch de shell propre

**Procédure :**
1. BrowserShell à 800 px, `TradeModal` ouvert.
2. Réduire à 500 px (passage sous 600 px).

**Résultat attendu :**
- `BrowserShell` démonté, `MobileShell` monté.
- Le `TradeModal` en cours est fermé (état local réinitialisé — comportement documenté).
- Aucune erreur React `Can't perform a React state update on an unmounted component`.
- Le store Zustand est intact — cash et portfolio inchangés après le switch.

---

### 4.6 Composants partagés

#### UI-SHARED-01 — `TradeModal` — cohérence mobile/browser

**Objectif :** Le `TradeModal` utilise le même store (`useGameStore`) dans les deux shells.

**Procédure :**
1. Trade via MobileShell → observer le cash dans le header.
2. Même trade via BrowserShell → observer le cash.

**Résultat attendu :** Le cash est débité identiquement. Le fee calculé (`calcTax`) est le même. Le `txLog` est mis à jour dans les deux cas via le même store Zustand.

---

#### UI-SHARED-02 — `AuthWidget` — compact vs normal

**Résultat attendu :**
- Mobile (`<AuthWidget compact />`) : avatar ou initiale uniquement, sans libellé texte.
- Browser (`<AuthWidget />`) : username ou "Connexion" visible.
- Dans les deux cas, le même flux d'authentification Supabase est déclenché.

---

#### UI-SHARED-03 — Ticker — animation CSS et cohérence des prix

**Résultat attendu :**
- Animation 100% CSS (pas de re-render React par frame).
- Prix affichés = `store.prices` au moment du rendu.
- Hausse → couleur `--gain` (#00FF87), baisse → `--loss` (#FF3B5C).

---

## ANNEXE A — Commandes de référence

```bash
# Depuis la racine du monorepo
pnpm lint              # Linter global
pnpm -r type-check     # Type-check global
pnpm -r test           # Tests unitaires globaux
pnpm build             # Build de production

# Ciblé
pnpm --filter @kickstock/game-engine test
pnpm --filter web dev
```

---

## ANNEXE B — Requêtes SQL de vérification Supabase

```sql
-- Vérifier les politiques RLS actives (chercher portfolios_select_device)
SELECT tablename, policyname, cmd, qual
FROM pg_policies WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Vérifier les colonnes de la vue leaderboard (p.id ne doit pas y être)
SELECT column_name FROM information_schema.columns
WHERE table_name = 'leaderboard' ORDER BY ordinal_position;

-- État courant du jeu
SELECT current_day_index, current_phase, advancing, champion_id,
       array_length(eliminated, 1) AS nb_eliminated
FROM game_state WHERE id = 1;

-- Vérifier les dividendes distribués (dernier avancement)
SELECT n.flag, n.name, d.round, d.amount, d.shares, d.day_index
FROM dividends d JOIN nations n ON n.id = d.nation_id
ORDER BY d.created_at DESC LIMIT 20;

-- Vérifier l'atomicité d'un trade (cash + holding cohérents)
SELECT p.cash,
       h.nation_id,
       h.quantity,
       h.quantity * n.current_price AS position_value
FROM portfolios p
JOIN holdings h ON h.portfolio_id = p.id
JOIN nations n ON n.id = h.nation_id
WHERE p.device_id = '<device_id_de_test>'
ORDER BY h.nation_id;

-- Historique des prix d'une nation
SELECT day_index, price, effective_at
FROM nation_prices WHERE nation_id = 'BRA'
ORDER BY day_index ASC;

-- Vérifier la table user_game_states (sync cross-device)
SELECT user_id, (game_state->>'dayIndex')::int AS day, updated_at
FROM user_game_states ORDER BY updated_at DESC LIMIT 10;
```

---

## ANNEXE C — Matrice de statut des vulnérabilités (mise à jour v2.0)

| ID | Titre | Sévérité | Statut | Action requise |
|----|-------|----------|--------|---------------|
| CRITIQUE-1 | `/api/game/advance` sans authentification | 🔴 BLOQUANT | **Non corrigé** | Ajouter vérification de rôle admin ou `X-Advance-Secret` |
| CRITIQUE-2 | RLS `portfolios_select_device` expose tous les portfolios anonymes | 🔴 BLOQUANT | **À vérifier en base** | `DROP POLICY IF EXISTS "portfolios_select_device" ON portfolios;` |
| HAUTE-1 | UUID v4 non validé dans `/api/trade` | 🟠 MAJEUR | **Partiellement corrigé** — validé dans `/api/game/state` et `/api/auth/guest` seulement | Ajouter regex UUID v4 dans `apps/web/app/api/trade/route.ts` |
| HAUTE-2 | Vue `leaderboard` expose `portfolios.id` | 🟠 MAJEUR | **À vérifier en base** | Recréer la vue sans `p.id` |
| MOYENNE | Messages d'erreur internes retournés au client | 🟡 MINEUR | **Corrigé** dans les 3 routes API ✅ | — |
| NOUVEAU | Plafond 40% absent du mode offline | 🟡 MINEUR | **Écart de parité** — règle présente dans RPC online, absente dans `localGameStore` | Implémenter `calcCap()` dans `@kickstock/game-engine` et l'appeler dans `localGameStore.trade()` |

> **Règle de release :** Les vulnérabilités 🔴 BLOQUANT (CRITIQUE-1, CRITIQUE-2) doivent être corrigées. Les tests **SEC-TRADE-01**, **RLS-01** et **RLS-09** doivent passer au statut `[x]` avant toute mise en production.

---

*Document mis à jour le 2026-05-29 — Version 2.0. À maintenir à chaque évolution du schéma de base de données, des routes API, ou de l'architecture des composants.*
