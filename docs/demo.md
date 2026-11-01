# Scénario de Démonstration — Procure-to-Pay (2 Minutes)

Ce document présente un scénario fluide et rythmé permettant d'illustrer l'intégralité du cycle d'achat **Procure-to-Pay (P2P)** en **2 minutes chrono**.
Il est conçu pour être exécuté en direct devant un recruteur ou enregistré en vidéo.

---

## 📋 Prérequis et Données de Test

- Serveur applicatif démarré (`npx cds watch` ou `docker compose up -d`).
- Portail ouvert dans le navigateur : **[http://localhost:4004](http://localhost:4004)**.
- Les personas de test sont accessibles en 1 clic via le sélecteur situé dans la **barre de navigation personnalisée** en haut à droite :
  - **Alice** (`alice` / `alice`) : Demandeur (_Requester_)
  - **Dave** (`dave` / `dave`) : Second demandeur (_Requester_) pour prouver l'isolation des données
  - **Bob** (`bob` / `bob`) : Responsable des achats (_Manager_)
  - **Carol** (`carol` / `carol`) : Gestionnaire d'entrepôt (_Warehouse_)
  - **Admin** (`admin` / `admin`) : Administrateur du référentiel (_Admin_)

---

## ⏱️ Chronologie du Scénario Pas à Pas

### Étape 0 : Accueil et Présentation du Portail (10 secondes)

1. Ouvrir la page d'accueil [http://localhost:4004](http://localhost:4004).
2. Présenter le portail d'accueil personnalisé avec ses 4 tuiles Fiori Elements (_Demandes d'achat_, _Commandes d'achat_, _Catalogue Produits_, _Mouvements de stock_) et la barre de navigation personnalisée affichant l'utilisateur connecté.
3. 📸 **Capture à prendre** : `01-portail-accueil.png`

---

### Étape 1 : Création & Soumission d'une Demande d'Achat (30 secondes)

- **Acteur** : **Alice** (Demandeur — `Requester`)

1. Dans la barre de navigation personnalisée, sélectionner le profil **Alice (Demandeur)**.
2. Cliquer sur la tuile **Demandes d'achat** (`purchase-requests`).
3. Cliquer sur **Créer** (+).
4. Renseigner la description : `Demande équipements IT et consommables T4`.
5. Ajouter 2 lignes d'articles appartenant à des fournisseurs distincts :
   - Article 1 : `Ordinateur Portable Pro 15"` — Quantité : `5` (Fournisseur : _TechCorp Solutions_)
   - Article 2 : `Papier A4 Standard (Ramette)` — Quantité : `10` (Fournisseur : _Office Supplies Express_)
6. Constater le recalcul automatique et instantané du montant total de la demande.
7. Cliquer sur **Enregistrer** (la demande passe au statut `Brouillon` / `DRAFT`).
8. Cliquer sur le bouton d'action **Soumettre**.
9. 💬 **Message exact attendu** :
   > `La demande PR-1001 a été soumise. Un manager doit maintenant l'approuver.`
10. Constater le changement de statut vers `Soumise` (criticité orange).
11. 📸 **Capture à prendre** : `02-pr-creation-alice.png`

---

### Étape 2 : Démonstration de l'Isolation des Données (15 secondes)

- **Acteur** : **Dave** (Autre demandeur — `Requester`)

1. Dans la barre de navigation personnalisée, basculer sur le profil **Dave (Demandeur)**.
2. Rafraîchir ou afficher la liste des demandes d'achat.
3. **Constat clé pour le recruteur** : La demande `PR-1001` d'Alice n'apparaît **pas** dans la liste de Dave. La directive `@restrict: where: 'createdBy = $user'` garantit l'étanchéité absolue des demandes entre collaborateurs.

---

### Étape 3 : Revue et Approbation Managériale (25 secondes)

- **Acteur** : **Bob** (Manager — `Manager`)

1. Dans la barre de navigation personnalisée, basculer sur le profil **Bob (Manager)**.
2. Ouvrir la tuile **Demandes d'achat** : Bob a une visibilité transverse sur toutes les demandes de l'entreprise.
3. Ouvrir la demande `PR-1001` soumise par Alice.
4. _Optionnel (démonstration du rejet avec motif)_ : Cliquer sur **Refuser**. Saisir le motif `Dépassement d'enveloppe budgétaire`.
   - 💬 Message attendu : `La demande PR-1001 a été refusée. Le motif a été enregistré.`
5. Cliquer sur le bouton **Approuver**.
6. 💬 **Message exact attendu** :
   > `La demande PR-1001 a été approuvée. Vous pouvez générer les commandes d'achat.`
7. Le statut de la demande passe à `Approuvée` (criticité verte).
8. 📸 **Capture à prendre** : `03-pr-approval-bob.png`

---

### Étape 4 : Découpage Automatique des Commandes par Fournisseur (15 secondes)

- **Acteur** : **Bob** (Manager — `Manager`)

1. Sur la demande approuvée `PR-1001`, cliquer sur **Créer les commandes d'achat**.
2. 💬 **Message exact attendu** :
   > `2 commande(s) créée(s) : PO-1001, PO-1002.`
3. **Point fort architecture** : Le moteur CAP a automatiquement regroupé les articles par fournisseur et créé :
   - `PO-1001` pour _TechCorp Solutions_ (5 ordinateurs portables).
   - `PO-1002` pour _Office Supplies Express_ (10 ramettes de papier).
4. Cliquer sur le lien de la commande `PO-1001` pour vérifier son contenu.
5. 📸 **Capture à prendre** : `04-po-split-supplier.png`

---

### Étape 5 : Réception Magasin Partielle et Totale (20 secondes)

- **Acteur** : **Carol** (Magasinier — `Warehouse`)

1. Dans la barre de navigation personnalisée, basculer sur le profil **Carol (Magasinier)**.
2. Ouvrir l'application **Commandes d'achat** (`purchase-orders`).
3. Sélectionner la commande `PO-1001` (statut `Ouverte`).
4. Cliquer sur l'action **Réceptionner**.
5. **Réception partielle** : Dans la boîte de dialogue, saisir `2` unités sur les 5 commandées.
6. 💬 **Message exact attendu** :
   > `Réception GR-1001 enregistrée. Commande PO-1001 : partiellement reçue (3 articles restent à recevoir).`
7. Le statut de la commande devient `Partiellement reçue` (criticité jaune).
8. **Réception du solde** : Cliquer à nouveau sur **Réceptionner** sans spécifier de quantité restreinte (ou avec le restant `3`).
9. 💬 **Message exact attendu** :
   > `Réception GR-1002 enregistrée. Commande PO-1001 : totalement reçue. Le stock a été mis à jour.`
10. La commande passe définitivement au statut `Reçue` (criticité verte). Le bouton de réception est désormais automatiquement désactivé.
11. 📸 **Capture à prendre** : `05-goods-receipt-carol.png`

---

### Étape 6 : Traçabilité des Mouvements & Audit Trail (10 secondes)

- **Acteur** : **Carol** (Magasinier) ou **Admin**

1. Revenir au portail d'accueil personnalisé et ouvrir l'application **Mouvements de stock** (`stock-movements`).
2. Constater la présence des deux entrées `IN` référençant les bons de réception `GR-1001` et `GR-1002`.
3. Ouvrir l'application **Catalogue Produits** (`products`) : constater l'incrémentation atomique du stock physique de l'ordinateur portable (+2 puis +3 = +5 unités réelles en stock).
4. 📸 **Capture à prendre** : `06-stock-movements-history.png`

---

### Étape 7 (Facultative) : Contrôle du Catalogue & Alerte Stock Bas (10 secondes)

- **Acteur** : **Carol** (Magasinier) ou **Admin**

1. Dans le portail d'accueil, ouvrir l'application **Catalogue Produits** (`products`).
2. Constater le catalogue du magasinier avec le stock actualisé de l'ordinateur portable (`LAPTOP-01` à 17 unités).
3. Observer l'indicateur critique de stock bas : la souris ergonomique (`MOUSE-01`) apparaît en rouge (`stock < minStock`).
4. 📸 **Capture à prendre** : `07-catalogue-stock-bas.png`

---

## 📁 Répertoire des Captures Attendues (`docs/screenshots/`)

Pour finaliser l'illustration visuelle du dépôt, déposez les fichiers d'images nommés exactement comme suit dans le dossier `docs/screenshots/` :

| Nom de fichier                   | Écran / Contenu à capturer                                                                    | Rôle actif            |
| :------------------------------- | :-------------------------------------------------------------------------------------------- | :-------------------- |
| `01-portail-accueil.png`         | Portail d'accueil personnalisé avec la barre de navigation et le sélecteur de persona         | Non connecté ou Admin |
| `02-pr-creation-alice.png`       | Demande d'achat créée avec 2 articles multi-fournisseurs et toast de soumission               | Alice (Demandeur)     |
| `03-pr-approval-bob.png`         | Demande au statut `Approuvée` avec confirmation et boutons d'actions managériaux              | Bob (Manager)         |
| `04-po-split-supplier.png`       | Liste des commandes d'achat générées et ventilées par fournisseur distinct                    | Bob (Manager)         |
| `05-goods-receipt-carol.png`     | Dialogue de saisie de réception magasin et mise à jour en `Partiellement reçue`               | Carol (Magasinier)    |
| `06-stock-movements-history.png` | Registre chronologique d'audit des mouvements de stock (`GR-100x`, type `IN`)                 | Carol ou Admin        |
| `07-catalogue-stock-bas.png`     | Catalogue produits : stock à jour (LAPTOP-01 à 17) et alerte de stock bas en rouge (MOUSE-01) | Carol ou Admin        |
