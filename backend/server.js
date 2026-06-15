import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  loginToGigya,
  getKamereonAccountId,
  getVehiclesList,
  getBatteryStatus,
  setChargingAction
} from './renaultService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'db.json');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Stockage du mot de passe en mémoire pour le re-login silencieux
let cachedPassword = '';
let lastRealCheckTime = 0;
const REAL_CHECK_INTERVAL = 2 * 60 * 1000; // 2 minutes

// Helpers pour lire/écrire db.json
async function readDb() {
  try {
    const data = await fs.readFile(dbPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Erreur de lecture de db.json, réinitialisation...', error);
    const initialDb = {
      session: { isLoggedIn: false, email: '', vin: '', accountId: '', personId: '', gigyaJwt: '', jwtExpiration: 0, isDemoMode: true },
      schedule: { enabled: false, startTime: '22:00', endTime: '06:00', targetSoc: 80 },
      simulation: { batteryLevel: 52, batteryAutonomy: 165, plugStatus: 1, chargingStatus: 0.0, chargingRemainingTime: null, chargingInstantaneousPower: 0.0, batteryTemperature: 20, batteryCapacity: 52, chargingRateKw: 7.4, lastUpdated: new Date().toISOString() },
      logs: []
    };
    await writeDb(initialDb);
    return initialDb;
  }
}

async function writeDb(data) {
  await fs.writeFile(dbPath, JSON.stringify(data, null, 2), 'utf8');
}

async function addLog(db, type, message) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    type,
    message
  };
  db.logs = db.logs || [];
  db.logs.unshift(logEntry); // Ajouter au début pour avoir le plus récent en premier
  if (db.logs.length > 50) {
    db.logs = db.logs.slice(0, 50); // Limiter à 50 logs
  }
  console.log(`[LOG] [${type.toUpperCase()}] ${message}`);
}

// Vérifie si l'heure courante (format HH:MM) est dans la plage horaire
function isTimeInWindow(nowStr, startStr, endStr) {
  const [nowH, nowM] = nowStr.split(':').map(Number);
  const [startH, startM] = startStr.split(':').map(Number);
  const [endH, endM] = endStr.split(':').map(Number);

  const nowMin = nowH * 60 + nowM;
  const startMin = startH * 60 + startM;
  const endMin = endH * 60 + endM;

  if (startMin <= endMin) {
    return nowMin >= startMin && nowMin <= endMin;
  } else {
    // Plage horaire traversant minuit (ex: 22:00 à 06:00)
    return nowMin >= startMin || nowMin <= endMin;
  }
}

// ==========================================
// ROUTES API
// ==========================================

// Authentification
app.post('/api/auth/login', async (req, res) => {
  const { email, password, isDemoMode } = req.body;

  try {
    const db = await readDb();

    if (isDemoMode) {
      db.session = {
        isLoggedIn: true,
        email: email || 'demo@zoe.com',
        vin: 'VF11000000ZOEDEMO',
        accountId: 'demo-account',
        personId: 'demo-person',
        gigyaJwt: 'demo-jwt-token',
        jwtExpiration: Date.now() + 3600 * 1000,
        isDemoMode: true
      };
      cachedPassword = '';
      await addLog(db, 'info', 'Connexion en Mode Démo réussie.');
      await writeDb(db);
      return res.json({ success: true, session: db.session });
    }

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }

    // Authentification réelle via renaultService
    await addLog(db, 'info', `Tentative de connexion pour ${email}...`);
    const authData = await loginToGigya(email, password);
    const accountId = await getKamereonAccountId(authData.jwtToken, authData.personId);
    
    // Récupérer la liste des véhicules
    const vehicles = await getVehiclesList(authData.jwtToken, accountId);
    if (vehicles.length === 0) {
      throw new Error('Aucun véhicule trouvé sur votre compte Renault.');
    }

    // Trouver le premier véhicule Zoe ou par défaut le premier véhicule
    const myCar = vehicles.find(v => v.brand === 'RENAULT' && v.vin.startsWith('VF1')) || vehicles[0];
    
    db.session = {
      isLoggedIn: true,
      email: email,
      vin: myCar.vin,
      accountId: accountId,
      personId: authData.personId,
      gigyaJwt: authData.jwtToken,
      jwtExpiration: authData.expiration,
      isDemoMode: false
    };

    // Stocker le mot de passe en mémoire pour rafraîchir le jeton plus tard
    cachedPassword = password;
    lastRealCheckTime = 0; // Forcer la mise à jour immédiate

    await addLog(db, 'info', `Connexion réussie pour le véhicule VIN: ${myCar.vin}`);
    await writeDb(db);
    res.json({ success: true, session: db.session });

  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

// Déconnexion
app.post('/api/auth/logout', async (req, res) => {
  try {
    const db = await readDb();
    db.session = {
      isLoggedIn: false,
      email: '',
      vin: '',
      accountId: '',
      personId: '',
      gigyaJwt: '',
      jwtExpiration: 0,
      isDemoMode: true
    };
    cachedPassword = '';
    await addLog(db, 'info', 'Utilisateur déconnecté. Retour au Mode Démo.');
    await writeDb(db);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Récupérer le statut du véhicule
app.get('/api/vehicle/status', async (req, res) => {
  try {
    const db = await readDb();

    if (!db.session.isLoggedIn) {
      return res.json({ session: db.session, batteryStatus: db.simulation });
    }

    if (db.session.isDemoMode) {
      return res.json({ session: db.session, batteryStatus: db.simulation });
    }

    // Mode Réel
    // Rafraîchir le token si expiré
    if (Date.now() >= db.session.jwtExpiration - 60000) {
      if (!cachedPassword) {
        await addLog(db, 'info', 'Jeton d\'accès expiré et mot de passe absent en mémoire. Déconnexion automatique.');
        db.session.isLoggedIn = false;
        await writeDb(db);
        return res.json({ session: db.session, batteryStatus: db.simulation });
      }

      try {
        await addLog(db, 'info', 'Jeton JWT Renault expiré. Rafraîchissement automatique...');
        const authData = await loginToGigya(db.session.email, cachedPassword);
        db.session.gigyaJwt = authData.jwtToken;
        db.session.jwtExpiration = authData.expiration;
        await writeDb(db);
      } catch (refreshError) {
        console.error('Erreur lors du rafraîchissement automatique du token:', refreshError.message);
        // Cooldown de 5 minutes en cas d'erreur / 429
        db.session.jwtExpiration = Date.now() + 5 * 60 * 1000;
        await writeDb(db);
      }
    }

    // Récupérer le statut réel de la batterie
    const batteryStatus = await getBatteryStatus(db.session.gigyaJwt, db.session.accountId, db.session.vin);
    
    // Mettre à jour l'historique local dans la simulation pour garder une copie locale
    db.simulation = {
      batteryLevel: batteryStatus.batteryLevel,
      batteryAutonomy: batteryStatus.batteryAutonomy,
      plugStatus: batteryStatus.plugStatus,
      chargingStatus: batteryStatus.chargingStatus,
      chargingRemainingTime: batteryStatus.chargingRemainingTime,
      chargingInstantaneousPower: batteryStatus.chargingInstantaneousPower,
      batteryTemperature: batteryStatus.batteryTemperature || 20,
      batteryCapacity: batteryStatus.batteryCapacity || 52,
      chargingRateKw: db.simulation.chargingRateKw, // Conserver la config locale
      lastUpdated: new Date().toISOString()
    };
    
    await writeDb(db);
    res.json({ session: db.session, batteryStatus: db.simulation });

  } catch (error) {
    console.error('Erreur get vehicle status:', error.message);
    // En cas de panne de l'API Renault, on renvoie les dernières données en cache
    const db = await readDb();
    res.json({ session: db.session, batteryStatus: db.simulation, warning: 'API Renault injoignable, affichage des données en cache.' });
  }
});

// Contrôle manuel (Démarrer / Arrêter la charge)
app.post('/api/vehicle/command', async (req, res) => {
  const { action } = req.body; // 'start' ou 'stop'

  if (action !== 'start' && action !== 'stop') {
    return res.status(400).json({ error: "L'action doit être 'start' ou 'stop'." });
  }

  try {
    const db = await readDb();

    if (db.session.isDemoMode) {
      if (action === 'start') {
        if (db.simulation.plugStatus === 0) {
          return res.status(400).json({ error: "Impossible de charger: Le véhicule n'est pas branché." });
        }
        db.simulation.chargingStatus = 1.0;
        db.simulation.chargingInstantaneousPower = db.simulation.chargingRateKw;
        await addLog(db, 'action', 'Action manuelle : Démarrage de la charge (Simulé).');
      } else {
        db.simulation.chargingStatus = 0.0;
        db.simulation.chargingInstantaneousPower = 0.0;
        db.simulation.chargingRemainingTime = null;
        await addLog(db, 'action', 'Action manuelle : Arrêt de la charge (Simulé).');
      }
      await writeDb(db);
      return res.json({ success: true, batteryStatus: db.simulation });
    }

    // Mode Réel
    if (!db.session.isLoggedIn) {
      return res.status(401).json({ error: 'Non authentifié.' });
    }

    await addLog(db, 'action', `Action manuelle : Envoi de commande ${action === 'start' ? 'Démarrage' : 'Arrêt'} charge...`);
    await setChargingAction(db.session.gigyaJwt, db.session.accountId, db.session.vin, action);
    
    // Mettre à jour immédiatement le statut supposé
    db.simulation.chargingStatus = action === 'start' ? 1.0 : 0.0;
    db.simulation.chargingInstantaneousPower = action === 'start' ? 7.4 : 0.0;
    await writeDb(db);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Configuration de la planification (Schedule)
app.get('/api/schedule', async (req, res) => {
  const db = await readDb();
  res.json(db.schedule);
});

app.post('/api/schedule', async (req, res) => {
  const { enabled, startTime, endTime, targetSoc } = req.body;

  try {
    const db = await readDb();
    
    db.schedule = {
      enabled: enabled !== undefined ? !!enabled : db.schedule.enabled,
      startTime: startTime || db.schedule.startTime,
      endTime: endTime || db.schedule.endTime,
      targetSoc: targetSoc !== undefined ? Number(targetSoc) : db.schedule.targetSoc
    };

    await addLog(
      db, 
      'info', 
      `Planification mise à jour : ${db.schedule.enabled ? 'Activée' : 'Désactivée'} | Plage : ${db.schedule.startTime}-${db.schedule.endTime} | Cible : ${db.schedule.targetSoc}%`
    );
    await writeDb(db);
    res.json({ success: true, schedule: db.schedule });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Récupération des logs
app.get('/api/logs', async (req, res) => {
  const db = await readDb();
  res.json(db.logs || []);
});

// Mise à jour de l'état simulé (exclusivement pour les tests de la démo)
app.post('/api/simulation/update', async (req, res) => {
  try {
    const db = await readDb();
    const { batteryLevel, plugStatus, chargingStatus, chargingRateKw } = req.body;

    if (batteryLevel !== undefined) db.simulation.batteryLevel = Math.max(0, Math.min(100, Number(batteryLevel)));
    if (plugStatus !== undefined) db.simulation.plugStatus = Number(plugStatus);
    if (chargingStatus !== undefined) db.simulation.chargingStatus = Number(chargingStatus);
    if (chargingRateKw !== undefined) db.simulation.chargingRateKw = Number(chargingRateKw);

    db.simulation.batteryAutonomy = Math.round(db.simulation.batteryLevel * 3.2);
    
    if (db.simulation.chargingStatus === 1.0) {
      db.simulation.chargingInstantaneousPower = db.simulation.chargingRateKw;
    } else {
      db.simulation.chargingInstantaneousPower = 0.0;
      db.simulation.chargingRemainingTime = null;
    }

    db.simulation.lastUpdated = new Date().toISOString();

    await addLog(db, 'info', `Statut de simulation modifié manuellement : SoC=${db.simulation.batteryLevel}%, Prise=${db.simulation.plugStatus === 1 ? 'Branchée' : 'Débranchée'}`);
    await writeDb(db);
    res.json({ success: true, simulation: db.simulation });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// BOUCLE DE CONTRÔLE SMART CHARGE (10 SECONDES)
// ==========================================
setInterval(async () => {
  try {
    const db = await readDb();
    
    // Ignorer si l'utilisateur n'est pas connecté
    if (!db.session.isLoggedIn) return;

    const { enabled, startTime, endTime, targetSoc } = db.schedule;
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const currentTimeStr = `${hours}:${minutes}`;

    if (db.session.isDemoMode) {
      // ---------------------------------
      // LOGIQUE DU SIMULATEUR DE CHARGE
      // ---------------------------------
      let changed = false;

      // 1. Si charge active, faire augmenter le pourcentage
      if (db.simulation.chargingStatus === 1.0) {
        if (db.simulation.batteryLevel < 100) {
          db.simulation.batteryLevel += 1; // simulation accélérée (+1% toutes les 10s)
          db.simulation.batteryAutonomy = Math.round(db.simulation.batteryLevel * 3.2);
          
          // Estimer le temps restant simulé (en minutes)
          const remainingPercent = Math.max(0, targetSoc - db.simulation.batteryLevel);
          db.simulation.chargingRemainingTime = Math.round((remainingPercent * 0.52 / db.simulation.chargingRateKw) * 60);
          changed = true;
        } else {
          db.simulation.chargingStatus = 0.2; // Charge finie
          db.simulation.chargingInstantaneousPower = 0.0;
          db.simulation.chargingRemainingTime = null;
          await addLog(db, 'info', '[Simulateur] Charge terminée : Batterie à 100%.');
          changed = true;
        }
      }

      // 2. Traiter la logique de planification intelligente
      if (enabled) {
        const inWindow = isTimeInWindow(currentTimeStr, startTime, endTime);

        if (db.simulation.plugStatus === 1) {
          // Si branché
          if (db.simulation.batteryLevel >= targetSoc) {
            // Seuil atteint ou dépassé
            if (db.simulation.chargingStatus === 1.0) {
              db.simulation.chargingStatus = 0.2; // Charge terminée
              db.simulation.chargingInstantaneousPower = 0.0;
              db.simulation.chargingRemainingTime = null;
              await addLog(db, 'info', `[Simulateur] Arrêt intelligent de la charge : Limite cible de ${targetSoc}% atteinte (SoC: ${db.simulation.batteryLevel}%).`);
              changed = true;
            }
          } else if (inWindow) {
            // Dans la fenêtre horaire et sous le pourcentage cible
            if (db.simulation.chargingStatus !== 1.0) {
              db.simulation.chargingStatus = 1.0;
              db.simulation.chargingInstantaneousPower = db.simulation.chargingRateKw;
              await addLog(db, 'info', `[Simulateur] Démarrage intelligent de la charge : Plage horaire active (${startTime}-${endTime}) et niveau de charge sous la cible.`);
              changed = true;
            }
          } else {
            // Hors de la plage horaire
            if (db.simulation.chargingStatus === 1.0) {
              db.simulation.chargingStatus = 0.1; // En attente de plage horaire
              db.simulation.chargingInstantaneousPower = 0.0;
              db.simulation.chargingRemainingTime = null;
              await addLog(db, 'info', `[Simulateur] Arrêt intelligent de la charge : Hors de la plage horaire planifiée.`);
              changed = true;
            }
          }
        }
      }

      if (changed) {
        db.simulation.lastUpdated = new Date().toISOString();
        await writeDb(db);
      }

    } else {
      // ---------------------------------
      // LOGIQUE DU CONTRÔLE SMART CHARGE RÉEL
      // ---------------------------------
      if (!enabled) return;

      const nowMs = Date.now();
      if (nowMs - lastRealCheckTime < REAL_CHECK_INTERVAL) return;
      lastRealCheckTime = nowMs;

      // S'assurer que le JWT est toujours valide
      if (nowMs >= db.session.jwtExpiration - 60000) {
        if (!cachedPassword) {
          await addLog(db, 'info', '[SmartCharge] Jeton d\'accès expiré et mot de passe absent en mémoire. Déconnexion automatique.');
          db.session.isLoggedIn = false;
          await writeDb(db);
          return;
        }

        try {
          await addLog(db, 'info', '[SmartCharge] Rafraîchissement silencieux du token Renault...');
          const authData = await loginToGigya(db.session.email, cachedPassword);
          db.session.gigyaJwt = authData.jwtToken;
          db.session.jwtExpiration = authData.expiration;
          await writeDb(db);
        } catch (refreshError) {
          console.error('[SmartCharge] Erreur rafraîchissement token:', refreshError.message);
          // Cooldown 5 minutes
          db.session.jwtExpiration = Date.now() + 5 * 60 * 1000;
          await writeDb(db);
        }
      }

      await addLog(db, 'info', '[SmartCharge] Vérification périodique du véhicule sur le serveur Renault...');
      const batteryStatus = await getBatteryStatus(db.session.gigyaJwt, db.session.accountId, db.session.vin);
      
      const currentSoc = batteryStatus.batteryLevel;
      const isPlugged = batteryStatus.plugStatus === 1;
      const isCharging = batteryStatus.chargingStatus === 1.0;

      // Mettre à jour le cache local
      db.simulation = {
        batteryLevel: currentSoc,
        batteryAutonomy: batteryStatus.batteryAutonomy,
        plugStatus: batteryStatus.plugStatus,
        chargingStatus: batteryStatus.chargingStatus,
        chargingRemainingTime: batteryStatus.chargingRemainingTime,
        chargingInstantaneousPower: batteryStatus.chargingInstantaneousPower,
        batteryTemperature: batteryStatus.batteryTemperature || 20,
        batteryCapacity: batteryStatus.batteryCapacity || 52,
        chargingRateKw: db.simulation.chargingRateKw,
        lastUpdated: new Date().toISOString()
      };
      await writeDb(db);

      if (!isPlugged) return; // Si non branchée, rien à faire

      const inWindow = isTimeInWindow(currentTimeStr, startTime, endTime);

      if (currentSoc >= targetSoc) {
        // Arrêter si charge en cours
        if (isCharging) {
          await addLog(db, 'info', `[SmartCharge] Arrêt de la charge : Limite cible de ${targetSoc}% atteinte (SoC actuel: ${currentSoc}%).`);
          await setChargingAction(db.session.gigyaJwt, db.session.accountId, db.session.vin, 'stop');
          db.simulation.chargingStatus = 0.0;
          db.simulation.chargingInstantaneousPower = 0.0;
          await writeDb(db);
        }
      } else if (inWindow) {
        // Démarrer si non en cours de charge
        if (!isCharging) {
          await addLog(db, 'info', `[SmartCharge] Démarrage de la charge : Plage horaire active (${startTime}-${endTime}) et niveau de charge sous la cible.`);
          await setChargingAction(db.session.gigyaJwt, db.session.accountId, db.session.vin, 'start');
          db.simulation.chargingStatus = 1.0;
          db.simulation.chargingInstantaneousPower = 7.4;
          await writeDb(db);
        }
      } else {
        // Hors plage horaire, couper la charge si elle tourne
        if (isCharging) {
          await addLog(db, 'info', `[SmartCharge] Arrêt de la charge : Hors de la plage horaire planifiée.`);
          await setChargingAction(db.session.gigyaJwt, db.session.accountId, db.session.vin, 'stop');
          db.simulation.chargingStatus = 0.0;
          db.simulation.chargingInstantaneousPower = 0.0;
          await writeDb(db);
        }
      }
    }
  } catch (error) {
    console.error('Erreur dans la boucle de contrôle Smart Charge:', error.message);
  }
}, 10000); // Exécuter la boucle toutes les 10 secondes

// Servir les fichiers statiques du frontend en production
const frontendPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendPath));

// Pour toute autre route, renvoyer l'index.html du frontend
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Serveur SmartCharge démarré sur http://localhost:${PORT}`);
});
