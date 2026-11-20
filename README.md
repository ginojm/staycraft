# Foyaltoloman

Foyaltoloman est une application de réservation de logements bâtie avec React, TypeScript, Vite, Express et PostgreSQL. Les logements de démonstration sont chargés depuis PostgreSQL. Les comptes, favoris, réservations, annonces, conversations, messages et avis sont persistés par l’API.

## Prérequis

- Node.js 20.19 ou plus récent et npm
- Docker Desktop démarré (le service PostgreSQL tourne dans un conteneur PostgreSQL 17)

## Démarrage local

Si `.env` n’existe pas encore (par exemple après un nouveau clone), depuis la racine du projet dans PowerShell :

```powershell
Copy-Item .env.example .env
```

Modifiez `.env` avant de continuer : choisissez un mot de passe PostgreSQL local et un `JWT_SECRET` aléatoire d’au moins 32 caractères. Utilisez le même mot de passe dans `POSTGRES_PASSWORD` et `DATABASE_URL`.

Puis lancez :

```powershell
npm install
npm run db:up
npm run db:migrate
npm run dev
```

L’application est disponible sur l’URL affichée par Vite (habituellement `http://localhost:5173`). L’API répond sur `http://localhost:3001/api` et le conteneur PostgreSQL sur le port `5433` (pour ne pas entrer en conflit avec un PostgreSQL local sur `5432`).

`npm run db:up` démarre PostgreSQL et conserve ses données dans le volume Docker `postgres_data`. `npm run db:down` arrête le conteneur sans supprimer les données. Le script de migration est réexécutable sans dupliquer les tables ni les logements de démonstration.

## Déployer toute l’application avec Docker

Docker Desktop doit être démarré. Créez `.env` à partir de `.env.example` si nécessaire, puis définissez un `POSTGRES_PASSWORD` local et un `JWT_SECRET` aléatoire d’au moins 32 caractères. Pour que `DATABASE_URL` fonctionne aussi en mode développement, utilisez un mot de passe composé de lettres et de chiffres ou encodez ses caractères réservés dans l’URL.

Depuis la racine du projet :

```powershell
docker compose up --build -d
docker compose ps
```

Cette commande construit l’image du frontend et de l’API, démarre PostgreSQL, applique les migrations, puis expose l’application à `http://localhost:8080`. Changez `APP_PORT` dans `.env` pour choisir un autre port. PostgreSQL reste sur le réseau interne Docker; son port `5433` n’est accessible que depuis la machine locale.

```powershell
docker compose logs -f app
docker compose down
```

`docker compose down` arrête les conteneurs en conservant la base dans `postgres_data`. N’ajoutez pas `-v` sauf si vous souhaitez supprimer définitivement les données.

## Modèle de données

Les migrations de `server/migrations/` créent :

- comptes utilisateurs et annonces avec leurs équipements;
- réservations, contraintes de dates sans chevauchement et montants détaillés;
- catalogue de suppléments classés par catégorie, unités horaires et tarifs figés dans chaque réservation;
- transactions et remboursements (structure prête pour un prestataire de paiement);
- favoris, conversations, participants, messages et notifications;
- avis liés aux réservations, avec recalcul automatique des notes moyennes.

L’API expose notamment `/api/auth`, `/api/listings`, `/api/favorites`, `/api/booking-addons`, `/api/bookings`, `/api/conversations`, `POST /api/bookings/:id/review` et `GET /api/listings/:id/reviews`. Les opérations personnelles nécessitent un jeton Bearer. Les mots de passe sont hachés côté serveur. Le catalogue de suppléments couvre les petits plaisirs, les packs romantiques (avec et sans alcool), le confort, les transferts et la consigne à bagages; chaque option comprend une vignette cliquable qui s’agrandit dans un aperçu. Les voyageurs peuvent choisir jusqu’à 12 heures d’arrivée anticipée ou de départ tardif; les tarifs et quantités sont vérifiés par l’API et enregistrés avec la réservation. Ces horaires restent soumis à la disponibilité de l’hôte.

## Connexion Google / Gmail

La création de compte par e-mail et mot de passe fonctionne sans configuration supplémentaire. Pour activer le bouton « Continuer avec Google », créez un identifiant OAuth de type **Application Web** dans Google Cloud Console et ajoutez ces URI de redirection autorisées :

- `http://localhost:3001/api/auth/google/callback` pour le mode développement;
- `http://localhost:8080/api/auth/google/callback` pour Docker (remplacez le port si `APP_PORT` change).

Renseignez `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` dans `.env`. Pour le mode développement, gardez `GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/google/callback` et `APP_BASE_URL=http://localhost:5173`. Pour Docker, `PUBLIC_APP_URL` détermine l’adresse de retour; sa valeur par défaut est `http://localhost:8080`. Ajoutez les deux URI de rappel à la console Google. Le bouton Google reste caché tant que ces identifiants ne sont pas configurés. N’exposez jamais le secret OAuth dans le code ou le dépôt.

Après configuration, redémarrez le serveur de développement ou appliquez `docker compose up --build -d` pour Docker. Google confirme l’adresse e-mail; le compte est alors créé automatiquement ou associé au compte existant ayant cette même adresse.

## Paiements et mise en production

Aucun prestataire de paiement n’est encore connecté : la création d’une réservation enregistre une demande en attente, mais ne prélève rien. Les tables de paiement permettent d’ajouter ensuite Stripe ou un autre prestataire sans stocker de données de carte bancaire.

Avant une mise en production, configurez un prestataire de paiement et ses webhooks, la vérification des e-mails, HTTPS, des sauvegardes PostgreSQL et des secrets propres à l’environnement. Ne réutilisez pas les valeurs d’exemple de `.env`.

## Vérification

```powershell
npm run build
```
# staycraft

## Application Android

Le projet contient maintenant une application Android Capacitor dans `android/`. Elle réutilise le frontend React et communique avec l'API Express.

Pour un build mobile, créez un fichier `.env.production.local` (non versionné) avec l'URL HTTPS publique de l'API :

```dotenv
VITE_API_URL=https://api.exemple.com
```

Puis lancez :

```powershell
npm run mobile:sync
cd android
./gradlew assembleDebug
```

Le fichier APK de debug sera produit dans `android/app/build/outputs/apk/debug/`. Pour publier sur Google Play, générez un bundle signé (`assembleRelease` ou `bundleRelease`) avec une clé de signature dédiée et configurez la fiche Play Console. Les secrets présents dans `.env` restent uniquement côté serveur et ne doivent jamais être inclus dans l'application Android.

Pour tester l'authentification dans l'émulateur, laissez l'API démarrée dans un terminal avec `npm run dev:api`. `.env.local` doit utiliser `VITE_API_URL=http://10.0.2.2:3001` : `10.0.2.2` désigne la machine hôte depuis l'émulateur Android. Le trafic HTTP clair est activé uniquement pour ce test local dans `capacitor.config.json`; avant une publication, utilisez une API HTTPS et désactivez cette option.
