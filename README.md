# 🔋 SmartCharge Zoe

> Une application Web mobile-first au design iOS premium (glassmorphisme) pour suivre et optimiser la recharge de votre Renault Zoe. 

Cette application s'authentifie directement auprès de l'**API Renault Connect** (Gigya + Kamereon) et implémente un contrôle de charge intelligent pour forcer la charge pendant les heures creuses et **arrêter automatiquement la charge à un pourcentage de batterie (SoC) précis** (fonctionnalité non disponible nativement sur la Renault Zoe).

---

## 📱 Aperçu de l'interface

L'application est conçue pour ressembler à une application iOS native avec :
- Une **jauge de batterie circulaire animée** (pulsante en cours de charge, verte au repos, orange/rouge quand faible).
- Une grille de statistiques en temps réel : Autonomie restante, Statut de la prise (Branchée/Débranchée), Puissance de charge instantanée en kW, et Temps restant estimé.
- Un **bouton de contrôle manuel** à réponse rapide pour forcer ou couper la charge.
- Un **planificateur intelligent** permettant de configurer des plages horaires d'heures creuses et de fixer un seuil maximal de charge (ex: couper à 80%).
- Un **Mode Démo (Simulateur)** intégré pour tester l'algorithme de recharge intelligente de manière accélérée et interactive.

---

## 🛠️ Architecture technique

L'application repose sur une architecture moderne Client-Serveur :

- **Frontend (React & Vite)** : Interface utilisateur fluide optimisée pour mobile, utilisant `lucide-react` pour les icônes premium, des flous d'arrière-plan de style Apple et des animations CSS fluides.
- **Backend (Express.js & Node.js)** :
  - **renaultService.js** : Gère l'échange de jetons et la communication avec Gigya SAP (authentification) et les API Kamereon de Renault pour le statut de batterie et les commandes.
  - **Boucle d'arrière-plan (SmartCharge)** : Démon autonome s'exécutant en continu. En mode réel, il vérifie l'état de la voiture toutes les 2 minutes si la prise est branchée et envoie des requêtes d'arrêt/démarrage selon votre planning.
  - **Base de données légère (db.json)** : Stockage persistant de la configuration de votre planning, de l'état de la session et des journaux d'activité.

---

## 🚀 Installation et Démarrage

### Prérequis
- [Node.js](https://nodejs.org/) (v16 ou supérieur)
- Un compte **MyRenault** actif avec un véhicule associé

### Démarrage rapide en développement
1. Clonez ce dépôt.
2. Ouvrez un terminal dans le répertoire racine et exécutez la commande suivante pour installer toutes les dépendances (racine, frontend, backend) :
   ```bash
   npm run install:all
   ```
3. Lancez les deux serveurs (React sur le port 3000 et Express sur le port 3001) en simultané avec :
   ```bash
   npm run dev
   ```
4. Ouvrez votre navigateur sur **[http://localhost:3000](http://localhost:3000)**.

---

## 🧪 Mode Simulateur (Démo)
Si vous n'avez pas vos identifiants ou si votre voiture n'est pas branchée, cochez simplement **"Utiliser le Mode Démo"** lors de la connexion.
Vous aurez accès à un **Panneau de contrôle de simulateur** pour brancher/débrancher virtuellement la voiture, augmenter/diminuer sa batterie par pas de 10% et choisir la puissance de charge. L'algorithme se comportera exactement comme avec un vrai véhicule !

---

## 📝 Licence
Projet libre d'utilisation à des fins personnelles. Non affilié ou endossé par Renault.
