# Analyse financière — M.G.B

Application séparée de M.G.B, dédiée à l'analyse financière du parc
(revenu, taux de remplissage, écart au loyer fixe, tendances) sur
l'ensemble des biens à la fois, à partir des données VRPlatform.

Elle réutilise **le même projet Supabase que M.G.B** : mêmes comptes, mêmes
identifiants de connexion. Un compte doit avoir le rôle « admin » (table
`profiles`) pour accéder aux données financières.

## Configuration

Copiez `.env.example` en `.env.local` et renseignez :

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — les mêmes
  valeurs que sur le déploiement M.G.B (Project Settings > API).
- `VRPLATFORM_API_KEY` / `VRPLATFORM_TEAM_ID` — les mêmes identifiants que
  sur le déploiement M.G.B.

## Développement

```bash
npm install
npm run dev
```

## Déploiement (Vercel)

1. Importez ce dépôt comme nouveau projet Vercel.
2. Renseignez les 4 variables d'environnement ci-dessus dans les
   paramètres du projet.
3. Déployez — l'application aura sa propre URL, indépendante de M.G.B.

## Fonctionnalités

- **Vue consolidée** : revenu (Rents, Channel Fees, Net Commissionable
  Revenue) et taux de remplissage du portefeuille entier, mois par mois,
  pour une année choisie.
- **Comparaison des biens** : tableau trié par bien (revenu, taux de
  remplissage, écart cumulé au loyer fixe) pour l'année choisie.
- **Tendances** : évolution du revenu net ou du taux de remplissage sur
  les 5 dernières années, pour le portefeuille entier ou un bien précis.

Un bien réparti sur plusieurs listings VRPlatform (renseigné dans
l'onglet Finances de M.G.B) est automatiquement regroupé ici aussi.
