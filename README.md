# CED Signals — panneau multi-timeframe pour aggr

Page statique (un seul fichier `index.html`, aucune dépendance) qui lit les bougies Binance spot + perp
de 1m à 1W et applique la même logique que l'indicateur aggr « CED Flow » :
condition bull/bear, LAST CHANGE, score, RSI, flux, dernier signal (divergence, absorption, spot/perp).
Une légende dépliable explique comment lire le graphique aggr.

## Mise en ligne (GitHub Pages, dépôt dev-mht/signals)

1. Créer le dépôt public `signals` sous l'organisation `dev-mht`.
2. Y pousser `index.html`, `CNAME` et `.nojekyll` (ce README est facultatif) :

   ```bash
   cd ~/Projects/signals
   git init -b main
   git add index.html CNAME .nojekyll README.md
   git commit -m "CED Signals : panneau multi-timeframe"
   git remote add origin git@github.com:dev-mht/signals.git
   git push -u origin main
   ```

3. Sur GitHub : Settings → Pages → Source « Deploy from a branch », branche `main`, dossier `/ (root)`.
4. DNS de apexpad.io : ajouter un enregistrement `CNAME` `signals` → `dev-mht.github.io`
   (si le DNS est chez Cloudflare, laisser le nuage gris « DNS only » le temps que GitHub émette le certificat).
5. De retour dans Settings → Pages : vérifier que le domaine `signals.apexpad.io` est validé, puis cocher « Enforce HTTPS ».

Avant que le DNS soit actif, la page est déjà accessible à `https://dev-mht.github.io/signals/`.

## Dans aggr

Menu « + » → panneau **Website** → adresse :

```
https://signals.apexpad.io/
```

Paramètres d'URL facultatifs :

- `?symbol=ETHUSDT` pour une autre paire Binance (par défaut BTCUSDT) ;
- `?tf=1h` pour la timeframe affichée en haut au chargement (sinon la dernière choisie, ou 15m).

Exemple : `https://signals.apexpad.io/?symbol=BTCUSDT&tf=15m`

Le panneau se rafraîchit seul (15 s pour le 1m jusqu'à 10 min pour le 1W).
Si le message « Binance injoignable » reste affiché, le navigateur refuse l'appel direct à l'API Binance :
dans ce cas, un petit Worker Cloudflare servant de relais règle le problème.

## Réglages de la logique

En haut du script, objet `P` : pivots (6 à gauche, 3 à droite), EMA 21/55, RSI 14, delta moyen sur 9 bougies,
seuil de condition 3, récence des divergences 12 bougies. Ils sont identiques aux valeurs par défaut de CED Flow
dans aggr ; si tu changes l'un, change l'autre pour que le panneau et le graphique restent d'accord.
